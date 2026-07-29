import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ragDb, ragRubricsTable } from "../../../../lib/ragDb";
import { embedText } from "../../retrieval/embeddingsService";
import { buildAssessmentCaseFile } from "./buildAssessmentCase";
import { isStoredAcfUsable } from "./acfFinalizePolicy";
import type {
  AssessmentCaseDbPayload,
  AssessmentCaseFile,
  AssessmentCaseSourceMeta,
  StoredAssessmentCase,
  VerifiedCalculationAnswer,
} from "../shared/types";
import type { QuestionAnalysis } from "../../types";

function normalizeQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bump when ACF build/routing semantics change so stale cached cases are not reused. */
const ACF_CACHE_VERSION = "p3-top-level-qclassify-v1";

function questionHash(subject: string, form: string, maxScore: number, question: string): string {
  const base = `${ACF_CACHE_VERSION}|${subject.toLowerCase()}|${form.toLowerCase()}|${maxScore}|${normalizeQuestion(question)}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 64);
}

function parseNumberArray(text?: string | null): number[] | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return undefined;
  }
}

export function encodeAssessmentSourceRef(meta: AssessmentCaseSourceMeta): string {
  return JSON.stringify(meta);
}

export function parseAssessmentSourceRef(ref?: string | null): AssessmentCaseSourceMeta | null {
  if (!ref?.trim()) return null;
  const t = ref.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t) as Partial<AssessmentCaseSourceMeta>;
    if (parsed.v !== 3 || !Array.isArray(parsed.chunkRefs)) return null;
    return {
      v: 3,
      pipeline: "evidence_centric",
      contextSource: parsed.contextSource === "textbook" ? "textbook" : "llm_fallback",
      chunkRefs: parsed.chunkRefs.filter((x): x is string => typeof x === "string"),
      referenceModelAnswer:
        typeof parsed.referenceModelAnswer === "string" ? parsed.referenceModelAnswer.trim() : undefined,
      intentFamily: parsed.intentFamily,
      intentCategory: parsed.intentCategory,
      verifiedAt: typeof parsed.verifiedAt === "string" ? parsed.verifiedAt : undefined,
      verificationMethod:
        parsed.verificationMethod === "reverse_check" ||
        parsed.verificationMethod === "dual_computation" ||
        parsed.verificationMethod === "pending_review"
          ? parsed.verificationMethod
          : undefined,
    };
  } catch {
    return null;
  }
}

export function parseAssessmentCaseFromDbRow(row: {
  rubricId: string;
  questionHash: string;
  subject: string;
  form: string;
  questionText: string;
  maxScore: number;
  ideas: string;
  sourceRef: string | null;
}): StoredAssessmentCase | null {
  try {
    const parsed = JSON.parse(row.ideas) as AssessmentCaseDbPayload | unknown[];
    if (Array.isArray(parsed)) return null;
    if (parsed?.v !== 3 || !parsed.acf) return null;
    return {
      caseId: row.rubricId,
      questionHash: row.questionHash,
      subject: row.subject,
      form: row.form,
      questionText: row.questionText,
      maxScore: row.maxScore,
      acf: parsed.acf,
      sourceRef: row.sourceRef ?? undefined,
    };
  } catch {
    return null;
  }
}

export function getReferenceModelAnswer(sourceRef?: string | null): string | undefined {
  const meta = parseAssessmentSourceRef(sourceRef);
  return meta?.referenceModelAnswer?.trim() || undefined;
}

export async function getAssessmentCaseById(caseId: string): Promise<StoredAssessmentCase | null> {
  if (!ragDb) return null;
  const id = caseId.trim();
  if (!id) return null;
  const rows = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionHash: ragRubricsTable.questionHash,
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      questionText: ragRubricsTable.questionText,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
      sourceRef: ragRubricsTable.sourceRef,
    })
    .from(ragRubricsTable)
    .where(eq(ragRubricsTable.rubricId, id))
    .limit(1);
  if (rows.length === 0) return null;
  return parseAssessmentCaseFromDbRow(rows[0]);
}

async function saveAssessmentCase(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  acf: AssessmentCaseFile;
  questionEmbedding?: number[];
}): Promise<StoredAssessmentCase> {
  if (!ragDb) throw new Error("RAG database not configured");
  const subject = params.subject.trim() || "General";
  const form = params.form.trim() || "General";
  const qHash = questionHash(subject, form, params.maxScore, params.question);
  const caseId = `acf-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const payload: AssessmentCaseDbPayload = { v: 3, acf: params.acf };
  const sourceRef = encodeAssessmentSourceRef({
    v: 3,
    pipeline: "evidence_centric",
    contextSource: params.acf.contextSource,
    chunkRefs: params.acf.chunkRefs,
    referenceModelAnswer: params.acf.referenceModelAnswer,
    intentFamily: params.acf.intent.family,
    intentCategory: params.acf.intent.category,
    verifiedAt: params.acf.verifiedAt,
    verificationMethod: params.acf.verificationMethod,
  });

  await ragDb.insert(ragRubricsTable).values({
    rubricId: caseId,
    questionHash: qHash,
    subject,
    form,
    questionText: params.question.trim(),
    questionType: params.acf.intent.category,
    maxScore: params.maxScore,
    ideas: JSON.stringify(payload),
    embedding: params.questionEmbedding ? JSON.stringify(params.questionEmbedding) : null,
    source: "llm_generated",
    sourceRef,
  });

  return {
    caseId,
    questionHash: qHash,
    subject,
    form,
    questionText: params.question.trim(),
    maxScore: params.maxScore,
    acf: params.acf,
    sourceRef,
  };
}

export async function buildAssessmentCasePackage(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
  seedChunkContent?: string;
  seedChunkRefs?: string[];
  skipRetrieval?: boolean;
  verifiedCalculationAnswer?: VerifiedCalculationAnswer;
  chapterFilter?: string;
  chapterHint?: string;
}): Promise<{ acf: AssessmentCaseFile; caseId?: string; sourceRef: string }> {
  const acf = await buildAssessmentCaseFile({
    question: params.question,
    subject: params.subject,
    form: params.form,
    maxScore: params.maxScore,
    questionAnalysis: params.questionAnalysis ?? null,
    seedChunkContent: params.seedChunkContent,
    seedChunkRefs: params.seedChunkRefs,
    skipRetrieval: params.skipRetrieval,
    verifiedCalculationAnswer: params.verifiedCalculationAnswer,
    chapterFilter: params.chapterFilter,
    chapterHint: params.chapterHint,
  });

  const sourceRef = encodeAssessmentSourceRef({
    v: 3,
    pipeline: "evidence_centric",
    contextSource: acf.contextSource,
    chunkRefs: acf.chunkRefs,
    referenceModelAnswer: acf.referenceModelAnswer,
    intentFamily: acf.intent.family,
    intentCategory: acf.intent.category,
    verifiedAt: acf.verifiedAt,
    verificationMethod: acf.verificationMethod,
  });

  return { acf, sourceRef };
}

export async function saveGeneratedAssessmentCase(params: {
  question: string;
  subject?: string | null;
  form?: string | null;
  maxScore: number;
  acf: AssessmentCaseFile;
  sourceRef?: string;
}): Promise<StoredAssessmentCase> {
  const question = params.question.trim();
  const embedding = await embedText(question);
  return saveAssessmentCase({
    question,
    subject: params.subject?.trim() || "General",
    form: params.form?.trim() || "General",
    maxScore: Math.max(1, Math.floor(params.maxScore)),
    acf: params.acf,
    questionEmbedding: embedding,
  });
}

export async function getOrCreateAssessmentCase(params: {
  question: string;
  subject?: string;
  form?: string;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
  skipNearestCached?: boolean;
  auditedContextExcerpt?: string | null;
  seedChunkContent?: string;
  seedChunkRefs?: string[];
  chapterFilter?: string;
  chapterHint?: string;
}): Promise<StoredAssessmentCase> {
  if (!ragDb) throw new Error("RAG database not configured");
  const subject = params.subject?.trim() || "General";
  const form = params.form?.trim() || "General";
  const maxScore = Math.max(1, Math.floor(params.maxScore));
  const question = params.question.trim();
  const qHash = questionHash(subject, form, maxScore, question);

  const exact = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionHash: ragRubricsTable.questionHash,
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      questionText: ragRubricsTable.questionText,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
      sourceRef: ragRubricsTable.sourceRef,
    })
    .from(ragRubricsTable)
    .where(eq(ragRubricsTable.questionHash, qHash))
    .orderBy(desc(ragRubricsTable.updatedAt));

  for (const row of exact) {
    const stored = parseAssessmentCaseFromDbRow(row);
    if (stored && isStoredAcfUsable(stored.acf)) return stored;
  }

  if (exact.length > 0 && process.env.NODE_ENV === "development") {
    console.warn("[acf] replacing invalid cached case(s)", { questionHash: qHash, count: exact.length });
  }

  if (exact.length > 0) {
    await ragDb.delete(ragRubricsTable).where(eq(ragRubricsTable.questionHash, qHash));
  }

  const seed =
    params.seedChunkContent?.trim() ||
    params.auditedContextExcerpt?.trim() ||
    "";

  const acf = await buildAssessmentCaseFile({
    question,
    subject,
    form,
    maxScore,
    questionAnalysis: params.questionAnalysis ?? null,
    seedChunkContent: seed || undefined,
    seedChunkRefs: params.seedChunkRefs,
    skipRetrieval: seed.length >= 80,
    chapterFilter: params.chapterFilter,
    chapterHint: params.chapterHint,
  });

  return saveAssessmentCase({
    question,
    subject,
    form,
    maxScore,
    acf,
    // Skip embedding latency on first create — exact questionHash lookup does not need it.
    questionEmbedding: undefined,
  });
}

export function displayMarkSchemeLabels(acf: AssessmentCaseFile): string[] {
  return acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content);
}

/** API compatibility: map evidence units to legacy RubricIdea shape for clients. */
export function evidenceUnitsToRubricIdeas(acf: AssessmentCaseFile): import("../../types").RubricIdea[] {
  return acf.units
    .filter((u) => u.creditWeight > 0)
    .map((u) => ({
      id: u.id,
      idea: u.content,
      marks: u.creditWeight,
      kind: "point" as const,
      acceptedConcepts: u.aliases,
      openEnded: acf.markRule.openPool === true,
      gradingMode: acf.markRule.openPool ? ("open_pool" as const) : ("semantic_match" as const),
    }));
}
