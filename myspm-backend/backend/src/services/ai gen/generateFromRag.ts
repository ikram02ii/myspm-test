import { chatCompletion } from "./llmProvider";
import {
  buildGenerationReminders,
  finalizeGeneratedAnswer,
  formatGeneratorContextBlock,
  type GenerateRagDiagram,
  type StructuredQuestionDiagram,
} from "./generateFromRagEnhancements";
import { fetchConsecutiveTextbookChunks, retrieveChunks } from "../ama/retrieval/retrievalService";
import { enrichMathAnswerWithSvg } from "./mathSvg";
import { analyzeQuestion } from "../ama/grading/questionAnalysisService";
import { buildEnglishSpeakingPdfContext } from "../ama/speaking/englishSpeakingPdfService";
import { englishSpeakingPartFromQuery } from "../ama/speaking/englishSpeakingTypes";
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
import type { RetrievedChunk, RubricIdea, RubricIdeaKind } from "../ama/types";
import { getRetrievalContext, storeRetrievalContext } from "./openEndedGenerationContext";

export type GenerateRagInput = {
  /** Natural language: topic + what to generate. Output is bilingual EN+BM for stems, options, and Penjelasan unless subject is in RAG_FORCE_BM_SUBJECTS (default: Sejarah). */
  query: string;
  subject?: string | null;
  /** Matches `rag_textbooks.form` (e.g. Form 4 / Form 5) so retrieval uses the correct textbook rows. */
  form?: string | null;
  topK?: number;
  generateImage?: boolean;
  imagePrompt?: string | null;
  /** Only textbook chunks whose `chapter` contains this substring (case-insensitive). */
  chapterFilter?: string | null;
  /** Boosts chunks whose `chapter` contains this substring; use for topic-specific generation. */
  chapterHint?: string | null;
  /** For AI Practice subjective mode: create saved rubrics and return structured question objects. */
  createOpenEndedRubrics?: boolean;
  /** How many subjective questions to generate sequentially (1–12). Parsed from query if omitted. */
  questionCount?: number;
  /** Skip Postgres/RAG retrieval — LLM only (English speaking practice). */
  skipRetrieval?: boolean;
  /** Use English oral-exam prompt instead of textbook MCQ template. */
  englishSpeaking?: boolean;
  /** Override path to SPM Speaking Part 2 & 3 PDF (else ENGLISH_SPEAKING_SOURCE_PDF or Knowledge Base default). */
  englishSpeakingPdfPath?: string | null;
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
};

export type {
  GenerateRagDiagram,
  StructuredQuestionDiagram,
} from "./generateFromRagEnhancements";

export type GenerateRagResult = {
  answer: string;
  diagram?: GenerateRagDiagram;
  diagrams?: GenerateRagDiagram[];
  structuredDiagrams?: StructuredQuestionDiagram[];
  sources: Array<{
    documentId: number;
    chunkIndex: number;
    title: string | null;
    subject: string | null;
    sourceType: string;
    excerpt: string;
    distance: number;
  }>;
  /** Page PNGs from retrieved source PDFs (diagrams / layout). */
  sourcePageImages: Array<{
    documentId: number;
    title: string | null;
    pageNumber: number;
    url: string;
  }>;
  generatedImages: Array<{
    url: string;
    prompt: string;
    questionIndex?: number;
  }>;
  openEndedQuestions?: GeneratedOpenEndedQuestion[];
};

async function packageGeneratedAnswer(
  input: GenerateRagInput,
  answerRaw: string,
  extras: Omit<GenerateRagResult, "answer" | "diagram" | "diagrams" | "structuredDiagrams" | "generatedImages">,
): Promise<GenerateRagResult> {
  const finalized = await finalizeGeneratedAnswer(
    {
      query: input.query,
      subject: input.subject,
      generateImage: input.generateImage,
      imagePrompt: input.imagePrompt,
    },
    answerRaw,
  );
  return {
    ...extras,
    answer: finalized.answer,
    diagram: finalized.diagram,
    diagrams: finalized.diagrams,
    structuredDiagrams: finalized.structuredDiagrams,
    generatedImages: finalized.generatedImages,
  };
}

const PROMPT_INTRO = `You are an assistant for Malaysian SPM exam preparation.
Use ONLY the provided context excerpts when stating specific facts. If context is insufficient, say so in one short sentence (follow the language rule below for those sentences).
{{LANGUAGE_RULE}}
Use simple language Form 4/5 students can follow: short sentences, common school words, SPM textbook level only — not university or journal style.
Do not copy long passages verbatim from the context; paraphrase into original question stems.

When generating objective (A–D) questions, follow this EXACT layout for EVERY item (no extra sections, no preamble about "aras kognitif" unless the user explicitly asks):

`;

const LAYOUT_BILINGUAL = `Soalan 1
EN: <question stem in English — one or two short sentences>
BM: <same stem in Bahasa Melayu — same meaning, not a literal word-for-word translation if that sounds unnatural>

A. EN: <option in English> — BM: <equivalent option in Bahasa Melayu>
B. EN: <...> — BM: <...>
C. EN: <...> — BM: <...>
D. EN: <...> — BM: <...>

Jawapan: <single letter A/B/C/D only; same letter for both languages>

Penjelasan:
EN: <one or two short sentences of explanation only; do not cite sources>
BM: <same scientific meaning in Bahasa Melayu>

Soalan 2
... (same pattern)
`;

const LAYOUT_BM_ONLY = `Soalan 1
<soalan dalam satu atau dua ayat>
A. <pilihan>
B. <pilihan>
C. <pilihan>
D. <pilihan>

Jawapan: <satu huruf A/B/C/D sahaja>
Penjelasan: <satu atau dua ayat ringkas isi sahaja; jangan rujuk sumber>

Soalan 2
... (same pattern)
`;

const PROMPT_OUTRO = `
Strict bans (violation = wrong answer):
- No "Rujuk", "rujuk", "#1", "#2", "doc=", "chunk=", "[1]", "konteks", "bersumber", "eksplisit", "lihat #", "berdasarkan konteks di".
- No emojis (no ✅ etc.), no italics used only for meta-commentary, no footnotes, no "Jawapan betul" — use the exact label "Jawapan:" only.
- No invented exam paper numbers like "28." or "14." before the question unless the user pasted that number and asked you to keep it.
- No horizontal rules made of many dashes unless the user asked for separators; use a single blank line between soalan only.
- Do not explain your process or list command words you used; output questions and answers only.`;

const LANGUAGE_RULE_BILINGUAL = `Write every question stem, every A–D option, the Jawapan line, and both Penjelasan lines in BOTH English and Bahasa Melayu using the EN: / BM: pattern shown in the template. Keep scientific terms consistent across languages. If the user's request is in only one language, still produce the full bilingual output unless they explicitly ask for one language only.`;

const LANGUAGE_RULE_FORCE_BM =
  "For this subject, respond entirely in Bahasa Melayu (standard SPM). If the user's request is in English or mixed, still write the whole answer in BM only.";

const ENGLISH_SPEAKING_SYSTEM = `You are an expert SPM English oral exam question writer for Malaysian Form 4/5 students.
Generate realistic speaking practice prompts only — no textbook citations, no MCQ format, no bilingual BM lines unless the user asks.
Use natural Malaysian classroom English. Follow the user's output format exactly. Do not add preamble or process commentary.`;

async function buildEnglishSpeakingUserContent(input: GenerateRagInput): Promise<string> {
  const tail = `${input.query}\n\nOutput the speaking prompts only, using the exact format specified above.`;
  let pdfContext: { excerpt: string; pdfPath: string } | null = null;
  try {
    const part = englishSpeakingPartFromQuery(input.query);
    pdfContext = await buildEnglishSpeakingPdfContext({
      pdfPath: input.englishSpeakingPdfPath,
      part: part === "part1" ? "all" : part,
    });
    console.info("[rag][english-speaking] PDF context loaded", {
      pdfPath: pdfContext.pdfPath,
      excerptChars: pdfContext.excerpt.length,
      part,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[rag][english-speaking] PDF context unavailable:", msg);
  }

  if (!pdfContext) {
    return tail;
  }

  return [
    "Official SPM English Speaking reference (extracted from syllabus PDF — Part 2 & Part 3).",
    "Follow task types, timings, and examiner style from this material when writing new practice prompts.",
    "Do not copy long passages verbatim; create original prompts in the same SPM format.",
    "",
    pdfContext.excerpt,
    "",
    "---",
    "",
    tail,
  ].join("\n");
}

async function generateWithoutRetrieval(input: GenerateRagInput): Promise<GenerateRagResult> {
  const useEnglishSpeakingPrompt =
    input.englishSpeaking === true ||
    (input.skipRetrieval === true && input.subject?.trim().toLowerCase() === "english");

  const system = useEnglishSpeakingPrompt
    ? ENGLISH_SPEAKING_SYSTEM
    : systemPromptForSubject(input.subject);

  const userContent = useEnglishSpeakingPrompt
    ? await buildEnglishSpeakingUserContent(input)
    : `${input.query}\n\n(Note: No knowledge-base chunks were retrieved. Answer from general knowledge and clearly label uncertainty.)\n\n${userTemplateHint(input.subject)}${bilingualGenerationReminder(input.subject)}`;

  const answerRaw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    {
      subject: input.subject,
      query: input.query,
      preferGradingModel: useEnglishSpeakingPrompt,
    },
  );

  return packageGeneratedAnswer(input, answerRaw, {
    sources: [],
    sourcePageImages: [],
  });
}

function parseForceBmSubjects(): Set<string> {
  const raw = process.env.RAG_FORCE_BM_SUBJECTS?.trim();
  const parts = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ["sejarah"];
  return new Set(parts);
}

function isForceBmSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase();
  if (!s) return false;
  return parseForceBmSubjects().has(s);
}

function systemPromptForSubject(subject: string | null | undefined): string {
  const force = isForceBmSubject(subject);
  const rule = force ? LANGUAGE_RULE_FORCE_BM : LANGUAGE_RULE_BILINGUAL;
  const layout = force ? LAYOUT_BM_ONLY : LAYOUT_BILINGUAL;
  return `${PROMPT_INTRO.replace("{{LANGUAGE_RULE}}", rule)}${layout}${PROMPT_OUTRO}`;
}

function userTemplateHint(subject: string | null | undefined): string {
  return isForceBmSubject(subject)
    ? "Follow the Bahasa Melayu Soalan / A–D / Jawapan: / Penjelasan: template from the system message."
    : "Follow the Soalan / EN: and BM: stems / bilingual A–D / Jawapan: / Penjelasan EN+BM template from the system message.";
}

/** Extra user nudge: bilingual for all non–force-BM subjects; Math adds diagram JSON hints. */
function bilingualGenerationReminder(subject: string | null | undefined): string {
  if (isForceBmSubject(subject)) return "";
  const base = `

Bilingual output (required): every Soalan must have EN: and BM: stems; every option A–D must include both EN: and BM: on one line each; Penjelasan must have both EN: and BM: lines. Jawapan stays a single letter.`;
  if (subject?.trim() !== "Math") return base;
  return `${base}

Subject is **Math**: same bilingual pattern. If the user requests a diagram, prefer returning a JSON field "rajah_spec" (deterministic shape spec) and optionally "rajah_svg". Supported rajah_spec kinds are:
- {"kind":"triangle","points":[{"x":0,"y":0,"label":"A"},{"x":4,"y":0,"label":"B"},{"x":1,"y":3,"label":"C"}],"title":"..."}
- {"kind":"cartesian_line","xMin":0,"xMax":10,"yMin":0,"yMax":20,"points":[{"x":0,"y":0,"label":"P"},{"x":5,"y":10,"label":"Q"}],"title":"..."}
`;
}

function shouldPostProcessMathSvg(subject: string | null | undefined): boolean {
  return subject?.trim() === "Math";
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isRubricKind(value: string): value is RubricIdeaKind {
  return [
    "feature",
    "function",
    "point",
    "step",
    "comparison",
    "knowledge",
    "explanation",
    "example",
    "use",
    "calculation",
    "definition",
  ].includes(value);
}

function normalizeGeneratedRubricIdeas(raw: unknown, maxMarks: number): RubricIdea[] {
  if (!Array.isArray(raw)) {
    return [{ id: "i1", idea: "Gives a correct SPM-level answer to the question", marks: maxMarks, kind: "point" }];
  }

  const ideas = raw
    .map((item, idx): RubricIdea | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const idea = typeof row["idea"] === "string" ? row["idea"].trim() : "";
      if (!idea) return null;
      const rawMarks = typeof row["marks"] === "number" ? row["marks"] : Number(row["marks"]);
      const marks = Number.isFinite(rawMarks) ? Math.max(1, Math.floor(rawMarks)) : 1;
      const kindRaw = typeof row["kind"] === "string" ? row["kind"].trim().toLowerCase() : "point";
      const keywords = Array.isArray(row["keywords"])
        ? row["keywords"].filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
        : [];
      const acceptedConcepts = Array.isArray(row["acceptedConcepts"])
        ? row["acceptedConcepts"].filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
        : [];
      const out: RubricIdea = {
        id: typeof row["id"] === "string" && row["id"].trim() ? row["id"].trim() : `i${idx + 1}`,
        idea,
        marks,
        kind: isRubricKind(kindRaw) ? kindRaw : "point",
      };
      if (keywords.length > 0) out.keywords = [...new Set(keywords)];
      if (acceptedConcepts.length > 0) out.acceptedConcepts = [...new Set(acceptedConcepts)];
      if (row["openEnded"] === true) out.openEnded = true;
      return out;
    })
    .filter((v): v is RubricIdea => v != null);

  return ideas.length > 0
    ? ideas
    : [{ id: "i1", idea: "Gives a correct SPM-level answer to the question", marks: maxMarks, kind: "point" }];
}

function textbookHits(hits: RetrievedChunk[]): RetrievedChunk[] {
  return hits.filter((h) => h.sourceType === "textbook");
}

function textbookChunkRef(chunk: RetrievedChunk): string {
  return `textbook:${chunk.textbookId}:chunk:${chunk.chunkId}`;
}

/** Primary textbook chunk for this step — rubric may expand to neighbors after the question is drafted. */
function pickPrimaryTextbookChunk(hits: RetrievedChunk[], questionIndex: number): RetrievedChunk | null {
  const textbooks = textbookHits(hits);
  if (textbooks.length === 0) return null;
  const idx = (Math.max(1, questionIndex) - 1) % textbooks.length;
  return textbooks[idx] ?? null;
}

function sourcesFromHits(hits: RetrievedChunk[]): GenerateRagResult["sources"] {
  return hits.map((h) => ({
    documentId: Number(h.textbookId) || 0,
    chunkIndex: h.chunkIndex,
    title: h.title ?? null,
    subject: h.subject ?? null,
    sourceType: h.sourceType,
    excerpt: h.content.slice(0, 400) + (h.content.length > 400 ? "…" : ""),
    distance: h.score ?? 0,
  }));
}

function formatOpenEndedAnswer(questions: GeneratedOpenEndedQuestion[]): string {
  return questions
    .map((q) => {
      const rubricLines = q.rubricIdeas.map((idea) => `- (${idea.marks}m) ${idea.idea}`).join("\n");
      return [
        `Soalan ${q.sortOrder}`,
        q.questionText,
        `Model answer: ${q.modelAnswer}`,
        "Marking points:",
        rubricLines,
      ].join("\n");
    })
    .join("\n\n");
}

const OPEN_ENDED_QUESTION_COUNT_MAX = 12;

function parseOpenEndedQuestionCount(query: string, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(1, Math.min(OPEN_ENDED_QUESTION_COUNT_MAX, Math.floor(explicit)));
  }
  const m = query.match(/\bgenerate\s+(\d+)\b/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.min(OPEN_ENDED_QUESTION_COUNT_MAX, Math.floor(n)));
    }
  }
  return 1;
}

function normalizeOpenEndedQuestionText(questionTextRaw: string, maxMarks: number): string | null {
  const trimmed = questionTextRaw.trim();
  if (!trimmed) return null;
  return /\bmarks?\)|\bmarkah\)/i.test(trimmed) ? trimmed : `${trimmed} (${maxMarks} marks)`;
}

async function generateOneOpenEndedQuestionDraft(params: {
  input: GenerateRagInput;
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
  input: GenerateRagInput;
  form?: string;
  questionText: string;
  maxMarks: number;
  sortOrder: number;
  groundingChunks: RetrievedChunk[];
}): Promise<GeneratedOpenEndedQuestion> {
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
  };
}

export type GenerateOpenEndedStepInput = GenerateRagInput & {
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
  sources: GenerateRagResult["sources"];
};

async function retrieveHitsForOpenEnded(input: GenerateRagInput): Promise<RetrievedChunk[]> {
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
  input: GenerateRagInput,
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
    return {
      question: null,
      generationContextId,
      questionIndex,
      totalQuestions,
      sources: sourcesFromHits(hits),
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

  return {
    question,
    generationContextId,
    questionIndex,
    totalQuestions,
    sources: sourcesFromHits(hits),
  };
}

async function generateOpenEndedWithSavedRubrics(params: {
  input: GenerateRagInput;
  hits: RetrievedChunk[];
  form?: string;
}): Promise<GenerateRagResult> {
  const totalQuestions = parseOpenEndedQuestionCount(params.input.query, params.input.questionCount);
  const contextId = storeRetrievalContext(params.hits);
  const openEndedQuestions: GeneratedOpenEndedQuestion[] = [];
  const priorStems: string[] = [];

  console.info("[rag] open-ended generation: sequential mode", { totalQuestions });

  for (let i = 0; i < totalQuestions; i += 1) {
    const questionIndex = i + 1;
    const step = await generateOpenEndedQuestionStep({
      ...params.input,
      form: params.form ?? params.input.form,
      questionIndex,
      totalQuestions,
      priorStems,
      generationContextId: contextId,
    });
    if (!step.question) {
      console.warn("[rag] open-ended generation: skipped empty step", { questionIndex });
      continue;
    }
    priorStems.push(step.question.questionText);
    openEndedQuestions.push(step.question);
  }

  if (openEndedQuestions.length === 0) {
    throw new Error("Structured subjective generation returned no usable questions.");
  }

  return {
    answer: formatOpenEndedAnswer(openEndedQuestions),
    sources: sourcesFromHits(params.hits),
    sourcePageImages: [],
    generatedImages: [],
    openEndedQuestions,
  };
}

export async function generateWithRag(
  input: GenerateRagInput,
): Promise<GenerateRagResult> {
  if (input.skipRetrieval) {
    return generateWithoutRetrieval(input);
  }

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

  const hits = retrieval.chunks;

  if (input.createOpenEndedRubrics) {
    return generateOpenEndedWithSavedRubrics({ input, hits, form });
  }

  if (hits.length === 0) {
    const answerRaw = await chatCompletion([
      { role: "system", content: systemPromptForSubject(input.subject) },
      {
        role: "user",
        content: `${input.query}\n\n(Note: No knowledge-base chunks were retrieved. Answer from general knowledge and clearly label uncertainty.)\n\n${userTemplateHint(input.subject)}${bilingualGenerationReminder(input.subject)}${buildGenerationReminders(input.query, input.subject, hits)}`,
      },
    ], { subject: input.subject, query: input.query });
    return packageGeneratedAnswer(input, answerRaw, {
      sources: [],
      sourcePageImages: [],
    });
  }

  const contextBlocks = hits.map((h, i) => formatGeneratorContextBlock(h, i + 1));

  const userContent = `Below are short excerpts from the syllabus/material (numbered for your use only; never show these numbers or any reference to them in your reply):\n\n${contextBlocks.join("\n\n---\n\n")}\n\nUser request:\n${input.query}\n\n${userTemplateHint(input.subject)}${bilingualGenerationReminder(input.subject)}${buildGenerationReminders(input.query, input.subject, hits)}`;

  const answerRaw = await chatCompletion([
    { role: "system", content: systemPromptForSubject(input.subject) },
    { role: "user", content: userContent },
  ], { subject: input.subject, query: input.query });

  return packageGeneratedAnswer(input, answerRaw, {
    sources: sourcesFromHits(hits),
    sourcePageImages: [],
  });
}
