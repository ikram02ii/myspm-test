/**
 * Generate SPM practice questions + saved rubrics grounded in individual textbook chunks.
 */

import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import { chatCompletion } from "../ai gen/llmProvider";
import { ragDb, ragRubricsTable, ragTextbookChunksTable, ragTextbooksTable } from "../../lib/ragDb";
import { analyzeQuestion, mapAnalysisToRubricQuestionType } from "./questionAnalysisService";
import { isLowQualityChunk } from "./retrievalService";
import { buildRubricIdeasForQuestion, saveGeneratedRubric, type QuestionType } from "./rubricService";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import type { Rubric, RubricIdea } from "./types";

export type TextbookChunkRow = {
  textbookId: string;
  textbookTitle: string;
  subject: string;
  form: string;
  chunkId: string;
  chunkIndex: number;
  chapter: string | null;
  conceptTitle: string | null;
  conceptSummary: string | null;
  content: string;
};

export type CreateRubricsFromTextbookChunksInput = {
  /** External id from `rag_textbooks.textbook_id`, e.g. tb-... */
  textbookId?: string;
  subject?: string;
  form?: string;
  /** Case-insensitive substring on `rag_textbook_chunks.chapter` */
  chapterFilter?: string;
  /** Max chunks to process (default 20, hard cap 200) */
  maxChunks?: number;
  /** Skip first N chunks after ordering by chunk_index */
  offset?: number;
  /** Default marks per generated question (1–3) */
  maxMarks?: number;
  /** Parallel LLM calls (default 2) */
  concurrency?: number;
  /** Skip chunks that already have a rubric with matching sourceRef */
  skipExisting?: boolean;
};

export type ChunkRubricResult = {
  chunkId: string;
  chunkIndex: number;
  chapter: string | null;
  questionText: string;
  maxMarks: number;
  rubricId: string;
  rubricIdeas: RubricIdea[];
  skipped?: boolean;
  skipReason?: string;
};

export type CreateRubricsFromTextbookChunksResult = {
  textbookId: string;
  subject: string;
  form: string;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  items: ChunkRubricResult[];
  errors: Array<{ chunkId: string; message: string }>;
};

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function chunkSourceRef(textbookId: string, chunkId: string): string {
  return `textbook:${textbookId}:chunk:${chunkId}`;
}

function defaultMaxMarks(): number {
  return 2;
}

function clampMaxMarks(n: number | undefined): number {
  const raw = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : defaultMaxMarks();
  return Math.max(1, Math.min(3, raw));
}

export async function listTextbookChunksForRubricGeneration(
  input: Pick<CreateRubricsFromTextbookChunksInput, "textbookId" | "subject" | "form" | "chapterFilter" | "maxChunks" | "offset">,
): Promise<{ textbook: { textbookId: string; subject: string; form: string; title: string }; chunks: TextbookChunkRow[] }> {
  const textbookId = input.textbookId?.trim();
  const subject = input.subject?.trim();
  const form = input.form?.trim();
  if (!textbookId && (!subject || !form)) {
    throw new Error("Provide textbookId or both subject and form.");
  }

  const textbookRows = await ragDb
    .select({
      id: ragTextbooksTable.id,
      textbookId: ragTextbooksTable.textbookId,
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      title: ragTextbooksTable.title,
    })
    .from(ragTextbooksTable)
    .where(
      textbookId
        ? eq(ragTextbooksTable.textbookId, textbookId)
        : and(eq(ragTextbooksTable.subject, subject!), eq(ragTextbooksTable.form, form!)),
    )
    .limit(1);

  const textbook = textbookRows[0];
  if (!textbook) {
    throw new Error(textbookId ? `Textbook not found: ${textbookId}` : `No textbook for ${subject} / ${form}`);
  }

  const chapterFilter = input.chapterFilter?.trim();
  const limit = Math.max(1, Math.min(200, Math.floor(input.maxChunks ?? 20)));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const chunkRows = await ragDb
    .select({
      textbookId: ragTextbooksTable.textbookId,
      textbookTitle: ragTextbooksTable.title,
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      chunkId: ragTextbookChunksTable.chunkId,
      chunkIndex: ragTextbookChunksTable.chunkIndex,
      chapter: ragTextbookChunksTable.chapter,
      conceptTitle: ragTextbookChunksTable.conceptTitle,
      conceptSummary: ragTextbookChunksTable.conceptSummary,
      content: ragTextbookChunksTable.content,
    })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
    .where(
      and(
        eq(ragTextbooksTable.id, textbook.id),
        chapterFilter && chapterFilter.length >= 2
          ? ilike(ragTextbookChunksTable.chapter, `%${chapterFilter.replace(/[%_\\]/g, " ")}%`)
          : undefined,
      ),
    )
    .orderBy(asc(ragTextbookChunksTable.chunkIndex))
    .offset(offset)
    .limit(limit);

  const chunks: TextbookChunkRow[] = chunkRows
    .filter((row) => !isLowQualityChunk(row.content))
    .map((row) => ({
      textbookId: row.textbookId,
      textbookTitle: row.textbookTitle,
      subject: row.subject,
      form: row.form,
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      chapter: row.chapter?.trim() || null,
      conceptTitle: row.conceptTitle?.trim() || null,
      conceptSummary: row.conceptSummary?.trim() || null,
      content: row.content,
    }));

  return {
    textbook: {
      textbookId: textbook.textbookId,
      subject: textbook.subject,
      form: textbook.form,
      title: textbook.title,
    },
    chunks,
  };
}

async function existingSourceRefs(textbookId: string, chunkIds: string[]): Promise<Set<string>> {
  if (chunkIds.length === 0) return new Set();
  const refs = chunkIds.map((id) => chunkSourceRef(textbookId, id));
  const rows = await ragDb
    .select({ sourceRef: ragRubricsTable.sourceRef })
    .from(ragRubricsTable)
    .where(inArray(ragRubricsTable.sourceRef, refs));
  return new Set(rows.map((r) => r.sourceRef).filter((v): v is string => Boolean(v)));
}

async function generateQuestionFromChunk(params: {
  chunk: TextbookChunkRow;
  maxMarks: number;
  commandHint?: string;
}): Promise<{ questionText: string; modelAnswer: string }> {
  const { chunk, maxMarks } = params;
  const system = [
    "You write one short Malaysian SPM Form 4/5 exam-style subjective question from a single textbook excerpt.",
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON only: { \"questionText\": string, \"modelAnswer\": string }.",
    "questionText must end with mark allocation, e.g. '(2 marks)' or '(2 markah)'.",
    `maxMarks for the question must be ${maxMarks}.`,
    "Ask only about facts and concepts present in the excerpt — do not require outside knowledge.",
    "Use explain, describe, state, or why as appropriate to the excerpt (not MCQ).",
    "modelAnswer: concise answer an examiner would expect (~maxMarks short points).",
  ].join("\n");

  const user = [
    `Subject: ${chunk.subject}`,
    `Form: ${chunk.form}`,
    chunk.chapter ? `Chapter: ${chunk.chapter}` : null,
    chunk.conceptTitle ? `Concept: ${chunk.conceptTitle}` : null,
    chunk.conceptSummary ? `Summary: ${chunk.conceptSummary}` : null,
    params.commandHint ? `Style hint: ${params.commandHint}` : null,
    "Textbook excerpt (only source of truth):",
    chunk.content,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { subject: chunk.subject, query: chunk.conceptTitle ?? chunk.content.slice(0, 80) },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new Error(`Question JSON parse failed: ${raw.slice(0, 300)}`);
  }

  const questionTextRaw = typeof parsed["questionText"] === "string" ? parsed["questionText"].trim() : "";
  if (!questionTextRaw) throw new Error("LLM returned empty questionText");
  const questionText = /\bmarks?\)|\bmarkah\)/i.test(questionTextRaw)
    ? questionTextRaw
    : `${questionTextRaw} (${maxMarks} marks)`;
  const modelAnswer =
    typeof parsed["modelAnswer"] === "string" && parsed["modelAnswer"].trim()
      ? parsed["modelAnswer"].trim()
      : "See marking rubric.";

  return { questionText, modelAnswer };
}

async function createRubricForChunk(params: {
  chunk: TextbookChunkRow;
  maxMarks: number;
  commandHint?: string;
}): Promise<ChunkRubricResult> {
  const { questionText, modelAnswer } = await generateQuestionFromChunk(params);
  const analysis = analyzeQuestion(questionText, params.chunk.subject);
  const questionType = mapAnalysisToRubricQuestionType(analysis) as QuestionType;
  const ideas = await buildRubricIdeasForQuestion({
    question: questionText,
    subject: params.chunk.subject,
    form: params.chunk.form,
    maxScore: params.maxMarks,
    questionType,
    textbookContextExcerpt: params.chunk.content,
    questionAnalysis: analysis,
  });

  const rubric = await saveGeneratedRubric({
    question: questionText,
    subject: params.chunk.subject,
    form: params.chunk.form,
    maxScore: params.maxMarks,
    questionType,
    ideas,
    source: "llm_generated",
    sourceRef: chunkSourceRef(params.chunk.textbookId, params.chunk.chunkId),
  });

  return {
    chunkId: params.chunk.chunkId,
    chunkIndex: params.chunk.chunkIndex,
    chapter: params.chunk.chapter,
    questionText,
    maxMarks: params.maxMarks,
    rubricId: rubric.rubricId,
    rubricIdeas: rubric.ideas,
  };
}

export async function createRubricsFromTextbookChunks(
  input: CreateRubricsFromTextbookChunksInput,
): Promise<CreateRubricsFromTextbookChunksResult> {
  const maxMarks = clampMaxMarks(input.maxMarks);
  const concurrency = Math.max(1, Math.min(5, Math.floor(input.concurrency ?? 2)));
  const { textbook, chunks } = await listTextbookChunksForRubricGeneration(input);

  let toProcess = chunks;
  if (input.skipExisting !== false) {
    const existing = await existingSourceRefs(
      textbook.textbookId,
      chunks.map((c) => c.chunkId),
    );
    toProcess = chunks.filter((c) => !existing.has(chunkSourceRef(textbook.textbookId, c.chunkId)));
  }

  const items: ChunkRubricResult[] = [];
  const errors: Array<{ chunkId: string; message: string }> = [];
  let skipped = chunks.length - toProcess.length;
  let created = 0;
  let failed = 0;

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, toProcess.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= toProcess.length) return;
      const chunk = toProcess[idx];
      try {
        const result = await createRubricForChunk({ chunk, maxMarks });
        items.push(result);
        created += 1;
      } catch (err) {
        failed += 1;
        errors.push({
          chunkId: chunk.chunkId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  await Promise.all(workers);

  items.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    textbookId: textbook.textbookId,
    subject: textbook.subject,
    form: textbook.form,
    processed: chunks.length,
    created,
    skipped,
    failed,
    items,
    errors,
  };
}
