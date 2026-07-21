import { chatCompletion } from "./llmProvider";
import { formatGeneratorContextBlock } from "./generateFromRagEnhancements";
import { fetchConsecutiveTextbookChunks, retrieveChunks } from "../ama/retrieval/retrievalService";
import {
  chunksToGenerationSources,
  formatSourcesSummary,
  type RagGenerationSource,
} from "../ama/retrieval/ragSourceAttribution";
import { analyzeQuestion } from "../ama/grading/questionAnalysisService";
import {
  buildAssessmentCasePackage,
  evidenceUnitsToRubricIdeas,
  saveGeneratedAssessmentCase,
} from "../ama/grading/v3/assessmentCaseService";
import {
  buildCandidateChunkPool,
  mergeChunksExcerpt,
  questionDraftContextChunks,
  resolveGroundingChunksForQuestion,
} from "../ama/grading/v3/groundingChunks";
import type { RetrievedChunk, RubricIdea } from "../ama/types";
import { getRetrievalContext, storeRetrievalContext } from "./openEndedGenerationContext";

export type OpenEndedRagInput = {
  query: string;
  subject?: string | null;
  form?: string | null;
  topK?: number;
  chapterFilter?: string | null;
  chapterHint?: string | null;
};

export type GeneratedOpenEndedQuestion = {
  id: number;
  sortOrder: number;
  questionText: string;
  questionType: "short_answer";
  difficulty: "mixed";
  options: [];
  correctAnswer: "";
  explanation: string | null;
  maxMarks: number;
  questionForGrade: string;
  modelAnswer: string;
  rubricId: string;
  rubricIdeas: RubricIdea[];
  sources: RagGenerationSource[];
  sourceLabel: string;
};

export type GenerateOpenEndedStepInput = OpenEndedRagInput & {
  questionIndex: number;
  totalQuestions: number;
  priorStems?: string[];
  generationContextId?: string | null;
};

export type GenerateOpenEndedStepResult = {
  question: GeneratedOpenEndedQuestion | null;
  generationContextId: string;
  questionIndex: number;
  totalQuestions: number;
  sources: RagGenerationSource[];
  sourceLabel: string;
};

const OPEN_ENDED_QUESTION_COUNT_MAX = 12;

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function textbookHits(hits: RetrievedChunk[]): RetrievedChunk[] {
  return hits.filter((h) => h.sourceType === "textbook");
}

function textbookChunkRef(chunk: RetrievedChunk): string {
  return `textbook:${chunk.textbookId}:chunk:${chunk.chunkId}`;
}

function pickPrimaryTextbookChunk(hits: RetrievedChunk[], questionIndex: number): RetrievedChunk | null {
  const textbooks = textbookHits(hits);
  if (textbooks.length === 0) return null;
  const idx = (Math.max(1, questionIndex) - 1) % textbooks.length;
  return textbooks[idx] ?? null;
}

function sourcesFromHits(hits: RetrievedChunk[]): RagGenerationSource[] {
  return chunksToGenerationSources(hits);
}

function normalizeOpenEndedQuestionText(questionTextRaw: string, maxMarks: number): string | null {
  const trimmed = questionTextRaw.trim();
  if (!trimmed) return null;
  return /\bmarks?\)|\bmarkah\)/i.test(trimmed) ? trimmed : `${trimmed} (${maxMarks} marks)`;
}

async function generateOneOpenEndedQuestionDraft(params: {
  input: OpenEndedRagInput;
  form?: string;
  contextBlocks: string[];
  questionIndex: number;
  totalQuestions: number;
  priorStems: string[];
  chunkGroundingMode?: "none" | "single" | "multi";
}): Promise<{ questionText: string; maxMarks: number } | null> {
  const hasContext = params.contextBlocks.length > 0;
  const system = [
    "You generate ONE short Malaysian SPM subjective practice question.",
    "Return JSON only, no prose, no code fences.",
    'Schema: { "questionText": string, "maxMarks": number }',
    "Generate exactly one question per response.",
    "questionText must include mark allocation at the end, e.g. '(2 marks)'.",
    "maxMarks must be an integer from 1 to 3 only.",
    "The question must be short and answerable in a few sentences.",
    "Use SPM Form 4/5 depth only.",
    "Do not repeat or closely paraphrase any prior question stem listed in the user message.",
    params.chunkGroundingMode === "single"
      ? "Ground the question ONLY in the single textbook excerpt provided — the model answer must be findable in that same excerpt."
      : params.chunkGroundingMode === "multi"
        ? "Ground the question in the consecutive textbook excerpts provided (they are adjacent sections from the book). You may combine facts across them. Do not require knowledge outside these excerpts."
        : null,
  ]
    .filter(Boolean)
    .join("\n");

  const priorBlock =
    params.priorStems.length > 0
      ? `Already generated (do not repeat):\n${params.priorStems.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`
      : "";

  const user = [
    hasContext
      ? `Use these syllabus/material excerpts as factual grounding:\n\n${params.contextBlocks.join("\n\n---\n\n")}`
      : "No knowledge-base excerpts were retrieved; use only safe general SPM-level knowledge.",
    priorBlock,
    `User request:\n${params.input.query}`,
    `Subject: ${params.input.subject ?? "General"}`,
    `Form: ${params.form ?? "General"}`,
    `Generate question ${params.questionIndex} of ${params.totalQuestions} only.`,
  ].join("\n\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      subject: params.input.subject,
      query: `${params.input.query} [open-ended ${params.questionIndex}/${params.totalQuestions}]`,
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    console.warn("[rag] open-ended question JSON parse failed", {
      index: params.questionIndex,
      preview: raw.slice(0, 300),
    });
    return null;
  }

  const row =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const questionTextRaw = typeof row?.["questionText"] === "string" ? row["questionText"].trim() : "";
  if (!questionTextRaw) return null;
  const marksRaw = typeof row?.["maxMarks"] === "number" ? row["maxMarks"] : Number(row?.["maxMarks"]);
  const maxMarks = Number.isFinite(marksRaw) ? Math.max(1, Math.min(3, Math.floor(marksRaw))) : 2;
  const questionText = normalizeOpenEndedQuestionText(questionTextRaw, maxMarks);
  if (!questionText) return null;
  return { questionText, maxMarks };
}

async function finalizeOpenEndedQuestion(params: {
  input: OpenEndedRagInput;
  form?: string;
  questionText: string;
  maxMarks: number;
  sortOrder: number;
  groundingChunks: RetrievedChunk[];
}): Promise<GeneratedOpenEndedQuestion> {
  const attributionChunks =
    params.groundingChunks.length > 0 ? params.groundingChunks : [];
  const sources = chunksToGenerationSources(attributionChunks);
  const sourceLabel = formatSourcesSummary(sources);
  const questionAnalysis = analyzeQuestion(params.questionText, params.input.subject);
  const seedContent = mergeChunksExcerpt(params.groundingChunks);
  const { acf, sourceRef } = await buildAssessmentCasePackage({
    question: params.questionText,
    subject: params.input.subject ?? "General",
    form: params.form ?? "General",
    maxScore: params.maxMarks,
    questionAnalysis,
    seedChunkContent: seedContent || undefined,
    seedChunkRefs: params.groundingChunks.map(textbookChunkRef),
    skipRetrieval: params.groundingChunks.length > 0 && seedContent.length > 0,
    chapterFilter: params.input.chapterFilter?.trim() || undefined,
    chapterHint: params.input.chapterHint?.trim() || undefined,
  });
  const modelAnswer = acf.referenceModelAnswer || "A concise correct answer based on the expected understanding.";
  const stored = await saveGeneratedAssessmentCase({
    question: params.questionText,
    subject: params.input.subject,
    form: params.form,
    maxScore: params.maxMarks,
    acf,
    sourceRef,
  });
  const displayIdeas = evidenceUnitsToRubricIdeas(acf);
  return {
    id: params.sortOrder,
    sortOrder: params.sortOrder,
    questionText: params.questionText,
    questionType: "short_answer",
    difficulty: "mixed",
    options: [],
    correctAnswer: "",
    explanation: `Model answer: ${modelAnswer}\n\nMarking points:\n${displayIdeas.map((idea) => `- (${idea.marks}m) ${idea.idea}`).join("\n")}`,
    maxMarks: params.maxMarks,
    questionForGrade: params.questionText,
    modelAnswer,
    rubricId: stored.caseId,
    rubricIdeas: displayIdeas,
    sources,
    sourceLabel,
  };
}

async function retrieveHitsForOpenEnded(input: OpenEndedRagInput): Promise<RetrievedChunk[]> {
  const topK = input.topK ?? 8;
  const chapterFilter = input.chapterFilter?.trim() || undefined;
  const chapterHint = input.chapterHint?.trim() || undefined;
  const form = input.form?.trim() || undefined;

  let retrieval = await retrieveChunks({
    query: input.query,
    subject: input.subject ?? undefined,
    form,
    topK,
    chapterFilter,
    chapterHint,
  });

  if (chapterFilter && retrieval.chunks.length === 0) {
    retrieval = await retrieveChunks({
      query: input.query,
      subject: input.subject ?? undefined,
      form,
      topK,
      chapterHint,
    });
  }

  return retrieval.chunks;
}

async function resolveOpenEndedRetrievalContext(
  input: OpenEndedRagInput,
  generationContextId?: string | null,
): Promise<{ hits: RetrievedChunk[]; generationContextId: string }> {
  const cached = getRetrievalContext(generationContextId);
  if (cached) {
    return { hits: cached, generationContextId: generationContextId!.trim() };
  }
  const hits = await retrieveHitsForOpenEnded(input);
  return { hits, generationContextId: storeRetrievalContext(hits) };
}

/** Generate one subjective question + saved rubric (for progressive client loading). */
export async function generateOpenEndedQuestionStep(
  input: GenerateOpenEndedStepInput,
): Promise<GenerateOpenEndedStepResult> {
  const form = input.form?.trim() || undefined;
  const totalQuestions = Math.max(
    1,
    Math.min(OPEN_ENDED_QUESTION_COUNT_MAX, Math.floor(input.totalQuestions)),
  );
  const questionIndex = Math.max(1, Math.min(totalQuestions, Math.floor(input.questionIndex)));
  const priorStems = Array.isArray(input.priorStems)
    ? input.priorStems.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  const { hits, generationContextId } = await resolveOpenEndedRetrievalContext(
    input,
    input.generationContextId,
  );
  const primaryChunk = pickPrimaryTextbookChunk(hits, questionIndex);
  const consecutiveChunks = primaryChunk
    ? await fetchConsecutiveTextbookChunks(primaryChunk, 2)
    : [];
  const candidatePool = buildCandidateChunkPool(hits, primaryChunk, 8, consecutiveChunks);
  const draftContextChunks = questionDraftContextChunks(candidatePool, primaryChunk);
  const contextBlocks = draftContextChunks.map((h, i) => formatGeneratorContextBlock(h, i + 1));
  const chunkGroundingMode: "none" | "single" | "multi" =
    draftContextChunks.length === 0
      ? "none"
      : draftContextChunks.length === 1
        ? "single"
        : "multi";

  console.info("[rag] open-ended step", {
    questionIndex,
    totalQuestions,
    primaryChunkId: primaryChunk?.chunkId ?? null,
    primaryChunkIndex: primaryChunk?.chunkIndex ?? null,
    consecutiveChunkIndices: consecutiveChunks.map((c) => c.chunkIndex),
    draftChunkCount: draftContextChunks.length,
  });

  const draft = await generateOneOpenEndedQuestionDraft({
    input,
    form,
    contextBlocks,
    questionIndex,
    totalQuestions,
    priorStems,
    chunkGroundingMode,
  });

  if (!draft) {
    const emptySources = sourcesFromHits(hits);
    return {
      question: null,
      generationContextId,
      questionIndex,
      totalQuestions,
      sources: emptySources,
      sourceLabel: formatSourcesSummary(emptySources),
    };
  }

  const groundingChunks = await resolveGroundingChunksForQuestion({
    question: draft.questionText,
    subject: input.subject ?? "General",
    maxScore: draft.maxMarks,
    hits,
    primaryChunk,
    candidatePool,
  });

  console.info("[rag] open-ended grounding", {
    questionIndex,
    rubricChunkCount: groundingChunks.length,
    rubricChunkIds: groundingChunks.map((c) => c.chunkId),
  });

  const question = await finalizeOpenEndedQuestion({
    input,
    form,
    questionText: draft.questionText,
    maxMarks: draft.maxMarks,
    sortOrder: questionIndex,
    groundingChunks,
  });

  const stepSources = question?.sources ?? sourcesFromHits(hits);
  return {
    question,
    generationContextId,
    questionIndex,
    totalQuestions,
    sources: stepSources,
    sourceLabel: question?.sourceLabel ?? formatSourcesSummary(stepSources),
  };
}
