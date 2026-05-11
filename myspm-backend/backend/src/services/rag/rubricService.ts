import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable, ragRubricsTable } from "../../lib/ragDb";
import { cosineSimilarity, embedText, embedTexts } from "./embeddingsService";
import type { Rubric, RubricIdea, RubricSource } from "./types";

type QuestionType =
  | "state"
  | "name"
  | "list"
  | "explain"
  | "describe"
  | "define"
  | "identify"
  | "compare"
  | "calculate"
  | "discuss"
  | "process"
  | "diagram_label"
  | "graph_reading"
  | "general";

type RubricRequest = {
  question: string;
  subject?: string;
  form?: string;
  maxScore: number;
  questionType: QuestionType;
};

type QwenConfig = { apiKey: string; baseUrl: string; model: string };

function resolveQwenConfig(): QwenConfig {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model = process.env["QWEN_GRADING_MODEL"]?.trim() || "qwen-plus";
  if (!apiKey || !baseUrl) {
    throw new Error("Qwen grading is not configured (set QWEN_GRADING_API_KEY/BASE_URL or reuse QWEN_OCR_*).");
  }
  return { apiKey, baseUrl, model };
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionHash(subject: string, form: string, maxScore: number, question: string): string {
  const base = `${subject.toLowerCase()}|${form.toLowerCase()}|${maxScore}|${normalizeQuestion(question)}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 64);
}

function parseNumberArray(text?: string | null): number[] | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return undefined;
    const vec = parsed.map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => Number.isFinite(v));
    return vec.length > 0 ? vec : undefined;
  } catch {
    return undefined;
  }
}

function parseRubricIdeas(text: string): RubricIdea[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((raw, idx) => {
        if (!raw || typeof raw !== "object") return null;
        const row = raw as Record<string, unknown>;
        const idea = typeof row["idea"] === "string" ? row["idea"].trim() : "";
        if (!idea) return null;
        const marksRaw = typeof row["marks"] === "number" ? row["marks"] : Number(row["marks"]);
        const marks = Number.isFinite(marksRaw) ? Math.max(0, Math.round(marksRaw)) : 0;
        if (marks <= 0) return null;
        const kindRaw = typeof row["kind"] === "string" ? row["kind"].trim().toLowerCase() : "";
        const kind =
          kindRaw === "feature" ||
          kindRaw === "function" ||
          kindRaw === "point" ||
          kindRaw === "step" ||
          kindRaw === "comparison"
            ? kindRaw
            : "point";
        const id = typeof row["id"] === "string" && row["id"].trim().length > 0 ? row["id"].trim() : `i${idx + 1}`;
        const linkedToId =
          typeof row["linkedToId"] === "string" && row["linkedToId"].trim().length > 0
            ? row["linkedToId"].trim()
            : undefined;
        const keywords = Array.isArray(row["keywords"])
          ? row["keywords"].filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
          : undefined;
        return { id, idea, marks, kind, linkedToId, keywords } as RubricIdea;
      })
      .filter((v): v is RubricIdea => v != null);
  } catch {
    return [];
  }
}

function scoreByTokenOverlap(question: string, content: string): number {
  const qTokens = normalizeQuestion(question)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (qTokens.length === 0) return 0;
  const lowered = content.toLowerCase();
  let hits = 0;
  for (const token of qTokens) {
    if (lowered.includes(token)) hits += 1;
  }
  return hits / qTokens.length;
}

function pickBestPastPaperSnippets(question: string, rows: Array<{ content: string }>, topN = 3): string[] {
  return rows
    .map((row) => ({ content: row.content, score: scoreByTokenOverlap(question, row.content) }))
    .filter((row) => row.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((row) => row.content);
}

function normalizeRubricIdeas(ideas: RubricIdea[], maxScore: number): RubricIdea[] {
  const nonEmpty = ideas.filter((idea) => idea.idea.trim().length > 0 && idea.marks > 0);
  if (nonEmpty.length === 0) return [];
  const total = nonEmpty.reduce((sum, i) => sum + i.marks, 0);
  if (total === maxScore) return nonEmpty;
  if (total <= 0) return [];
  // Scale marks to maxScore while preserving relative proportions.
  let acc = 0;
  const scaled = nonEmpty.map((idea, idx) => {
    if (idx === nonEmpty.length - 1) {
      return { ...idea, marks: Math.max(1, maxScore - acc) };
    }
    const value = Math.max(1, Math.round((idea.marks / total) * maxScore));
    acc += value;
    return { ...idea, marks: value };
  });
  // If rounding overshoots, trim from the tail.
  let over = scaled.reduce((sum, i) => sum + i.marks, 0) - maxScore;
  for (let i = scaled.length - 1; i >= 0 && over > 0; i -= 1) {
    const canTake = Math.max(0, scaled[i].marks - 1);
    const take = Math.min(canTake, over);
    scaled[i].marks -= take;
    over -= take;
  }
  return scaled;
}

async function qwenBuildRubric(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  questionType: QuestionType;
  pastPaperContext?: string;
}): Promise<RubricIdea[]> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const system = [
    "You build strict JSON rubrics for Malaysian SPM grading.",
    "Return JSON only: { \"ideas\": [{ \"id\": string, \"idea\": string, \"marks\": number, \"kind\": \"feature|function|point|step|comparison\", \"linkedToId\"?: string, \"keywords\"?: string[] }] }.",
    "Total marks across ideas MUST equal maxScore exactly.",
    "Use SPM level, concise wording, no university depth.",
    "For explain/describe questions: split into feature + function pairs where suitable.",
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question type: ${params.questionType}`,
    `Max score: ${params.maxScore}`,
    `Question: ${params.question}`,
    params.pastPaperContext ? `Past-paper reference context:\n${params.pastPaperContext}` : null,
    "Build mark-point ideas that an SPM examiner would use.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 500) || `Qwen rubric generation failed (${response.status})`);
  }
  if (!response.ok) {
    const message =
      parsedResponse?.error?.message || parsedResponse?.message || rawText.slice(0, 500) || "Qwen rubric generation failed";
    throw new Error(message);
  }
  const content = parsedResponse?.choices?.[0]?.message?.content;
  const rawReply = messageContentToString(content).trim();
  const jsonText = extractJson(rawReply);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Rubric JSON parse failed: ${rawReply.slice(0, 500)}`);
  }
  const ideas = parseRubricIdeas(JSON.stringify(parsed?.ideas ?? []));
  return normalizeRubricIdeas(ideas, params.maxScore);
}

function toRubric(row: {
  rubricId: string;
  questionHash: string;
  subject: string;
  form: string;
  questionText: string;
  questionType: string;
  maxScore: number;
  ideas: string;
  embedding: string | null;
  source: string;
  sourceRef: string | null;
}): Rubric {
  return {
    rubricId: row.rubricId,
    questionHash: row.questionHash,
    subject: row.subject,
    form: row.form,
    questionText: row.questionText,
    questionType: row.questionType,
    maxScore: row.maxScore,
    ideas: parseRubricIdeas(row.ideas),
    embedding: parseNumberArray(row.embedding),
    source: (row.source as RubricSource) ?? "llm_generated",
    sourceRef: row.sourceRef ?? undefined,
  };
}

async function findNearestCachedRubric(params: RubricRequest): Promise<Rubric | null> {
  const subject = params.subject?.trim() || "General";
  const form = params.form?.trim() || "General";
  const rows = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionHash: ragRubricsTable.questionHash,
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      questionText: ragRubricsTable.questionText,
      questionType: ragRubricsTable.questionType,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
      embedding: ragRubricsTable.embedding,
      source: ragRubricsTable.source,
      sourceRef: ragRubricsTable.sourceRef,
      createdAt: ragRubricsTable.createdAt,
    })
    .from(ragRubricsTable)
    .where(
      and(
        eq(ragRubricsTable.subject, subject),
        eq(ragRubricsTable.form, form),
        eq(ragRubricsTable.maxScore, params.maxScore),
      ),
    )
    .orderBy(desc(ragRubricsTable.createdAt))
    .limit(50);

  if (rows.length === 0) return null;
  const queryEmbedding = await embedText(params.question);
  let best: { row: (typeof rows)[number]; score: number } | null = null;
  for (const row of rows) {
    const emb = parseNumberArray(row.embedding);
    if (!emb) continue;
    const sim = cosineSimilarity(queryEmbedding, emb);
    if (!best || sim > best.score) best = { row, score: sim };
  }
  if (!best || best.score < 0.9) return null;
  return toRubric(best.row);
}

async function findPastPaperContext(params: RubricRequest): Promise<{ snippets: string[]; sourceRef?: string } | null> {
  const subject = params.subject?.trim() || "General";
  const form = params.form?.trim() || "General";
  const rows = await ragDb
    .select({
      paperId: ragPastPapersTable.paperId,
      chunkId: ragPastPaperChunksTable.chunkId,
      content: ragPastPaperChunksTable.content,
    })
    .from(ragPastPaperChunksTable)
    .innerJoin(ragPastPapersTable, eq(ragPastPaperChunksTable.pastPaperDbId, ragPastPapersTable.id))
    .where(and(eq(ragPastPapersTable.subject, subject), eq(ragPastPapersTable.form, form)))
    .orderBy(desc(ragPastPapersTable.uploadedAt))
    .limit(120);

  const snippets = pickBestPastPaperSnippets(params.question, rows, 3);
  if (snippets.length === 0) return null;
  const first = rows.find((r) => snippets.includes(r.content));
  return { snippets, sourceRef: first ? `${first.paperId}:${first.chunkId}` : undefined };
}

async function saveRubric(params: RubricRequest & {
  ideas: RubricIdea[];
  source: RubricSource;
  sourceRef?: string;
  questionEmbedding?: number[];
}): Promise<Rubric> {
  const subject = params.subject?.trim() || "General";
  const form = params.form?.trim() || "General";
  const qHash = questionHash(subject, form, params.maxScore, params.question);
  const rubricId = `rub-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const ideas = normalizeRubricIdeas(params.ideas, params.maxScore);
  await ragDb.insert(ragRubricsTable).values({
    rubricId,
    questionHash: qHash,
    subject,
    form,
    questionText: params.question.trim(),
    questionType: params.questionType,
    maxScore: params.maxScore,
    ideas: JSON.stringify(ideas),
    embedding: params.questionEmbedding ? JSON.stringify(params.questionEmbedding) : null,
    source: params.source,
    sourceRef: params.sourceRef ?? null,
  });
  return {
    rubricId,
    questionHash: qHash,
    subject,
    form,
    questionText: params.question.trim(),
    questionType: params.questionType,
    maxScore: params.maxScore,
    ideas,
    embedding: params.questionEmbedding,
    source: params.source,
    sourceRef: params.sourceRef,
  };
}

export async function getOrCreateRubric(params: RubricRequest): Promise<Rubric> {
  const subject = params.subject?.trim() || "General";
  const form = params.form?.trim() || "General";
  const qHash = questionHash(subject, form, params.maxScore, params.question);

  const exact = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionHash: ragRubricsTable.questionHash,
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      questionText: ragRubricsTable.questionText,
      questionType: ragRubricsTable.questionType,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
      embedding: ragRubricsTable.embedding,
      source: ragRubricsTable.source,
      sourceRef: ragRubricsTable.sourceRef,
    })
    .from(ragRubricsTable)
    .where(eq(ragRubricsTable.questionHash, qHash))
    .limit(1);
  if (exact.length > 0) return toRubric(exact[0]);

  const nearest = await findNearestCachedRubric(params);
  if (nearest) return nearest;

  const questionEmbedding = await embedText(params.question);
  const past = await findPastPaperContext(params);
  if (past) {
    const ideas = await qwenBuildRubric({
      question: params.question,
      subject,
      form,
      maxScore: params.maxScore,
      questionType: params.questionType,
      pastPaperContext: past.snippets.join("\n\n---\n\n"),
    });
    return saveRubric({
      ...params,
      subject,
      form,
      ideas,
      source: "past_paper",
      sourceRef: past.sourceRef,
      questionEmbedding,
    });
  }

  const ideas = await qwenBuildRubric({
    question: params.question,
    subject,
    form,
    maxScore: params.maxScore,
    questionType: params.questionType,
  });
  return saveRubric({
    ...params,
    subject,
    form,
    ideas,
    source: "llm_generated",
    questionEmbedding,
  });
}
