import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable, ragRubricsTable } from "../../lib/ragDb";
import { cosineSimilarity, embedText, embedTexts } from "./embeddingsService";
import type { Rubric, RubricIdea, RubricSource } from "./types";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { pastPaperFormWhereClause } from "./pastPaperFormFilter";
import { buildCategoryRubricPromptInstructions } from "./gradingCategoryMarking";
import { backfillRubricRowMetadata, refineRubricIdeas } from "./rubricRefinement";
import { analyzeQuestion } from "./questionAnalysisService";
import { buildRubricStructureHintLines, type RubricStructureContext } from "./rubricStructureHints";
import type { QuestionAnalysis } from "./types";

export type QuestionType =
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
  /** When true, skip vector nearest-neighbour rubric reuse (reduces wrong-topic rubrics). */
  skipNearestCachedRubric?: boolean;
  /** When true, build new rubrics from audited excerpt and/or question only — do not pull unrelated past-paper snippets from DB. */
  useAuditContextOnly?: boolean;
  /** Audited retrieval text (merged blocks) for rubric LLM; may be empty. */
  auditedContextExcerpt?: string | null;
  /** Optional pre-computed question shape (avoids re-analysis). */
  questionAnalysis?: QuestionAnalysis | null;
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
        const kind: RubricIdea["kind"] =
          kindRaw === "feature" ||
          kindRaw === "function" ||
          kindRaw === "point" ||
          kindRaw === "step" ||
          kindRaw === "comparison" ||
          kindRaw === "knowledge" ||
          kindRaw === "explanation" ||
          kindRaw === "example" ||
          kindRaw === "use" ||
          kindRaw === "calculation" ||
          kindRaw === "definition" ||
          kindRaw === "method" ||
          kindRaw === "accuracy" ||
          kindRaw === "equation" ||
          kindRaw === "application"
            ? (kindRaw as RubricIdea["kind"])
            : "point";
        const dependsOnRowId =
          typeof row["dependsOnRowId"] === "string" && row["dependsOnRowId"].trim().length > 0
            ? row["dependsOnRowId"].trim()
            : undefined;
        const demandTypeRaw = typeof row["demandType"] === "string" ? row["demandType"].trim().toLowerCase() : "";
        const equationTypeRaw = typeof row["equationType"] === "string" ? row["equationType"].trim().toLowerCase() : "";
        const id = typeof row["id"] === "string" && row["id"].trim().length > 0 ? row["id"].trim() : `i${idx + 1}`;
        const linkedToId =
          typeof row["linkedToId"] === "string" && row["linkedToId"].trim().length > 0
            ? row["linkedToId"].trim()
            : undefined;
        const keywordsRaw = Array.isArray(row["keywords"])
          ? row["keywords"].filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
          : [];
        const acceptedConcepts = Array.isArray(row["acceptedConcepts"])
          ? row["acceptedConcepts"].filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
          : [];
        const openEndedRaw = row["openEnded"];
        const openEnded =
          typeof openEndedRaw === "boolean"
            ? openEndedRaw
            : typeof openEndedRaw === "string"
              ? /^(true|yes|1)$/i.test(openEndedRaw)
              : false;
        const item: RubricIdea = {
          id,
          idea,
          marks,
          kind,
        };
        if (linkedToId) item.linkedToId = linkedToId;
        if (dependsOnRowId) item.dependsOnRowId = dependsOnRowId;
        if (keywordsRaw.length > 0) item.keywords = [...new Set(keywordsRaw)];
        if (acceptedConcepts.length > 0) item.acceptedConcepts = [...new Set(acceptedConcepts)];
        if (openEnded) item.openEnded = true;
        if (
          demandTypeRaw === "recall" ||
          demandTypeRaw === "definition" ||
          demandTypeRaw === "explanation" ||
          demandTypeRaw === "comparison" ||
          demandTypeRaw === "calculation" ||
          demandTypeRaw === "example" ||
          demandTypeRaw === "application" ||
          demandTypeRaw === "equation" ||
          demandTypeRaw === "diagram_label" ||
          demandTypeRaw === "essay"
        ) {
          item.demandType = demandTypeRaw;
        }
        if (equationTypeRaw === "word" || equationTypeRaw === "symbol" || equationTypeRaw === "ionic" || equationTypeRaw === "half") {
          item.equationType = equationTypeRaw;
        }
        // requiresCausalLink is applied only after refineRubricIdeas(); ignore LLM default here.
        return item;
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

function structureContextForQuestion(
  question: string,
  subject?: string | null,
  existing?: QuestionAnalysis | null,
): RubricStructureContext {
  if (existing) {
    return {
      questionType: existing.questionType,
      commandWord: existing.commandWord,
      isCompoundQuestion: existing.isCompoundQuestion,
      expectedAnswerStyle: existing.expectedAnswerStyle,
      demandType: existing.demandType,
      isEquationQuestion: existing.isEquationQuestion,
      equationType: existing.equationType,
    };
  }
  const a = analyzeQuestion(question, subject);
  return {
    questionType: a.questionType,
    commandWord: a.commandWord,
    isCompoundQuestion: a.isCompoundQuestion,
    expectedAnswerStyle: a.expectedAnswerStyle,
    demandType: a.demandType,
    isEquationQuestion: a.isEquationQuestion,
    equationType: a.equationType,
  };
}

function resolveStructureContext(
  question: string,
  subject?: string | null,
  input?: RubricStructureContext | QuestionAnalysis | null,
): RubricStructureContext {
  if (!input) return structureContextForQuestion(question, subject);
  if ("topicKeywords" in input) return structureContextForQuestion(question, subject, input);
  return input;
}

/** Refine + rescale rubric mark points for grading or persistence. */
export function finalizeRubricIdeas(
  ideas: RubricIdea[],
  question: string,
  maxScore: number,
  structureContext?: RubricStructureContext | QuestionAnalysis | null,
  subject?: string | null,
): RubricIdea[] {
  const ctx = resolveStructureContext(question, subject, structureContext);
  const analysis =
    structureContext && "demandType" in structureContext
      ? (structureContext as QuestionAnalysis)
      : analyzeQuestion(question, subject);
  const backfilled = backfillRubricRowMetadata(ideas, analysis);
  const refined = refineRubricIdeas(backfilled, question, maxScore, ctx, analysis);
  const stamped = refined.map((row) => ({
    ...row,
    demandType: row.demandType ?? analysis.demandType,
  }));
  return normalizeRubricIdeas(stamped, maxScore);
}

async function qwenBuildRubric(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  questionType: QuestionType;
  pastPaperContext?: string;
  structureContext?: RubricStructureContext | null;
}): Promise<RubricIdea[]> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const categoryLines = buildCategoryRubricPromptInstructions(params.question);
  const structureCtx =
    params.structureContext ?? structureContextForQuestion(params.question, params.subject);
  const structureLines = buildRubricStructureHintLines(structureCtx, params.maxScore);
  const system = [
    "You build strict JSON rubrics for Malaysian SPM grading.",
    formatSpmStudentFriendlyRulesBlock(),
    "Each \"idea\" string must be short, plain, and readable by Form 4/5 students (classroom wording, not abstract examiner notes).",
    "Return JSON only: { \"ideas\": [{ \"id\": string, \"idea\": string, \"marks\": number, \"kind\": \"feature|function|point|step|comparison|knowledge|explanation|example|use|calculation|definition\", \"linkedToId\"?: string, \"keywords\"?: string[], \"acceptedConcepts\"?: string[], \"openEnded\"?: boolean, \"requiresCausalLink\"?: boolean }] }.",
    "Each rubric row is a MARKING POINT (one examinable idea), not a full model paragraph.",
    "For open-ended stems (examples, uses, properties, advantages, disadvantages, suggestions, applications), phrase the idea as a CATEGORY check (e.g. 'Any valid example of …') and set openEnded=true; list acceptedConcepts as examples of valid wording, not as an exclusive list, unless the stem is explicitly context-bound (based on the diagram/text/experiment/table/graph/passage).",
    "Retrieved textbook or past-paper text is illustrative only — never the only acceptable wording unless the stem binds to that source.",
    "Total marks across ideas MUST equal maxScore exactly.",
    "Use SPM syllabus depth only — never A-Level or university depth.",
    "For explain/describe/cause-effect questions: split mechanism into atomic marking points; do not merge two different scientific ideas into one row unless the stem clearly asks for a single broad point.",
    "Each idea must be a mark point an SPM examiner would use — specific enough that vague or generic student wording would NOT earn the mark.",
    "Rubrics describe what must be explicitly written; do not assume the grader will infer unstated mechanisms.",
    "Correct SPM-level paraphrases are acceptable when they still show the required detail; do not require exact textbook phrasing.",
    "For function/purpose stems: main-purpose wording at SPM level is sufficient. Do NOT require advanced mechanism details unless the stem explicitly asks (e.g. osmosis, water potential, concentration, isotonic/hypertonic/hypotonic).",
    "For sequence/order/hierarchy/process stems (list the sequence, levels of organisation, atomic model history, steps in a process): include ONE rubric row per stage/level/step IN ORDER (first row = first stage). Order is compulsory — wrong order must not earn the mark for that position.",
    "Default requiresCausalLink to false for all ideas. Only set requiresCausalLink=true for genuinely ambiguous isolated keywords (e.g. a lone word with no mechanism).",
    "For EVERY idea, set \"keywords\" to an array of 4–8 short synonym or paraphrase phrases Malaysian SPM students might write (same scientific meaning, different wording).",
    ...structureLines,
    [
      "EXAMPLE AND INSTANCE ROWS:",
      "When any part of the question stem uses instruction words that ask the student to produce a member of a category — including \"give an example\", \"state an example\", \"name a\", \"give one\", \"berikan contoh\", \"nyatakan contoh\", \"namakan\" — that mark point MUST be built as:",
      "  openEnded: true",
      "  kind: \"example\"",
      "  keywords: terms that describe the category, not a specific answer",
      "  acceptedConcepts: 2–3 illustrative members of the category only",
      "Never set a single specific answer as the only accepted answer for an example row. The marking step will validate category membership, not string match.",
    ].join("\n"),
    ...categoryLines,
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question type: ${params.questionType}`,
    `Max score: ${params.maxScore}`,
    `Question: ${params.question}`,
    params.pastPaperContext
      ? params.pastPaperContext.startsWith("[TEXTBOOK CONTEXT")
        ? `Textbook reference context:\n${params.pastPaperContext}`
        : `Past-paper reference context:\n${params.pastPaperContext}`
      : null,
    "Build mark-point ideas an SPM examiner would use, but phrase every idea in simple student-friendly language.",
    structureLines.join("\n"),
    categoryLines.length > 0
      ? "Follow all CONTEXT-BOUND / OPEN-CATEGORY rubric rules in the system message. Reference context is illustrative, not a mandatory answer list unless the stem is explicitly context-bound."
      : null,
    params.questionType === "identify" ||
    params.questionType === "name" ||
    params.questionType === "state"
      ? "If the question only asks which/what/name/type and the answer is essentially one correct term (or one short phrase), use ONE rubric idea worth maxScore marks. Do NOT split background text from the stem into separate mark ideas the student must repeat."
      : null,
    /\b(function|purpose|role|fungsi|tujuan|peranan)\b/i.test(params.question)
      ? "If the student's answer gives the core purpose correctly (e.g., protection/safety for PPE; food/energy/support for biological substrates), award the main purpose mark even if they omit extra advanced details."
      : null,
    /\b(evolution|development|history|sequence|from\s+.+\s+to)\b/i.test(params.question)
      ? "For brief but valid stage mentions, include acceptedConcepts so short wording still matches (e.g., Dalton solid sphere; Thomson electrons/plum pudding; Rutherford nucleus/empty space; Bohr shells/energy levels)."
      : null,
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
  return finalizeRubricIdeas(ideas, params.question, params.maxScore, structureCtx, params.subject);
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

export async function getRubricById(rubricId: string): Promise<Rubric | null> {
  const id = rubricId.trim();
  if (!id) return null;
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
    })
    .from(ragRubricsTable)
    .where(eq(ragRubricsTable.rubricId, id))
    .limit(1);
  return rows.length > 0 ? toRubric(rows[0]) : null;
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
  const formClause = pastPaperFormWhereClause(params.form);
  const rows = await ragDb
    .select({
      paperId: ragPastPapersTable.paperId,
      chunkId: ragPastPaperChunksTable.chunkId,
      content: ragPastPaperChunksTable.content,
    })
    .from(ragPastPaperChunksTable)
    .innerJoin(ragPastPapersTable, eq(ragPastPaperChunksTable.pastPaperDbId, ragPastPapersTable.id))
    .where(
      formClause
        ? and(eq(ragPastPapersTable.subject, subject), formClause)
        : eq(ragPastPapersTable.subject, subject),
    )
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
  const structureCtx = structureContextForQuestion(
    params.question,
    params.subject,
    params.questionAnalysis ?? null,
  );
  const ideas = finalizeRubricIdeas(params.ideas, params.question, params.maxScore, structureCtx, params.subject);
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

/** Build rubric mark points using optional textbook chunk text as the sole syllabus reference. */
export async function buildRubricIdeasForQuestion(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  questionType?: QuestionType;
  textbookContextExcerpt?: string;
  questionAnalysis?: QuestionAnalysis | null;
}): Promise<RubricIdea[]> {
  const subject = params.subject.trim() || "General";
  const form = params.form.trim() || "General";
  const questionType = params.questionType ?? "general";
  const structureCtx = resolveStructureContext(params.question, subject, params.questionAnalysis ?? null);
  const excerpt = params.textbookContextExcerpt?.trim();
  const ideas = await qwenBuildRubric({
    question: params.question,
    subject,
    form,
    maxScore: params.maxScore,
    questionType,
    pastPaperContext: excerpt
      ? `[TEXTBOOK CONTEXT — build rubric only from this excerpt; do not add facts not supported here]\n${excerpt}`
      : undefined,
    structureContext: structureCtx,
  });
  return finalizeRubricIdeas(ideas, params.question, params.maxScore, structureCtx, subject);
}

export async function saveGeneratedRubric(params: {
  question: string;
  subject?: string | null;
  form?: string | null;
  maxScore: number;
  questionType?: QuestionType;
  ideas: RubricIdea[];
  source?: RubricSource;
  sourceRef?: string;
}): Promise<Rubric> {
  const question = params.question.trim();
  const maxScore = Math.max(1, Math.floor(params.maxScore));
  const questionEmbedding = await embedText(question);
  return saveRubric({
    question,
    subject: params.subject?.trim() || "General",
    form: params.form?.trim() || "General",
    maxScore,
    questionType: params.questionType ?? "general",
    ideas: params.ideas,
    source: params.source ?? "llm_generated",
    sourceRef: params.sourceRef,
    questionEmbedding,
  });
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
  if (exact.length > 0) {
    console.warn(
      `[gradeService] rubricId not sent but hash match found: ${exact[0].rubricId}. ` +
        "Always pass rubricId for generated questions to ensure deterministic marking.",
    );
    return toRubric(exact[0]);
  }

  if (!params.skipNearestCachedRubric) {
    const nearest = await findNearestCachedRubric(params);
    if (nearest) return nearest;
  }

  const questionEmbedding = await embedText(params.question);
  const structureCtx = resolveStructureContext(params.question, subject, params.questionAnalysis ?? null);

  if (params.useAuditContextOnly) {
    const excerpt = params.auditedContextExcerpt?.trim();
    if (excerpt && excerpt.length > 0) {
      const ideas = await qwenBuildRubric({
        question: params.question,
        subject,
        form,
        maxScore: params.maxScore,
        questionType: params.questionType,
        pastPaperContext: `[AUDITED RETRIEVAL — approved chunks only]\n${excerpt}`,
        structureContext: structureCtx,
      });
      return saveRubric({
        ...params,
        subject,
        form,
        ideas,
        source: "llm_generated",
        sourceRef: undefined,
        questionEmbedding,
      });
    }
    const ideas = await qwenBuildRubric({
      question: params.question,
      subject,
      form,
      maxScore: params.maxScore,
      questionType: params.questionType,
      structureContext: structureCtx,
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

  const past = await findPastPaperContext(params);
  if (past) {
    const ideas = await qwenBuildRubric({
      question: params.question,
      subject,
      form,
      maxScore: params.maxScore,
      questionType: params.questionType,
      pastPaperContext: past.snippets.join("\n\n---\n\n"),
      structureContext: structureCtx,
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
    structureContext: structureCtx,
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
