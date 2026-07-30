import { chatCompletion, generateImage } from "./llmProvider";
import {
  generateEducationalDiagramsForAnswer,
  isScienceDiagramSubject,
  shouldGenerateEducationalDiagrams,
} from "./educationalDiagramService";
import { finalizeGeneratedAnswer } from "./generateFromRagEnhancements";
import type { StructuredQuestionDiagram } from "./structuredDiagramTypes";
import {
  chunksToGenerationSources,
  formatSourcesSummary,
  type RagGenerationSource,
} from "../ama/retrieval/ragSourceAttribution";
import {
  buildPastPaperMarksGuidance,
  isMcqGenerationQuery,
  isSubjectiveGenerationQuery,
} from "../ama/retrieval/pastPaperMarksHints";
import { buildStrictMarkSchemeGenerationBlock } from "../ama/grading/shared/markSchemeGenerationPolicy";
import {
  buildJawapanVerbFormatRulesForGeneration,
  buildKssmTextbookModelAnswerWordingBlock,
} from "../ama/grading/feedback/modelAnswerFeedbackFormatPolicy";
import { withStrictGenerationLanguage } from "../ama/grading/shared/gradingMandatoryLanguage";
import { retrieveChunks, retrieveGeneralSyllabusChunks } from "../ama/retrieval/retrievalService";
import type { RetrievedChunk } from "../ama/types";
import { englishSpeakingPartFromQuery } from "../ama/speaking/englishSpeakingTypes";
import { generateQuestionFromRagContext } from "./ragQuestionGenerator";
import {
  isValidatedDiagramPipelineEnabled,
  runValidatedDiagramGenerationPipeline,
} from "./validatedDiagramGenerationPipeline";

export type GenerateRagInput = {
  /** Natural language: topic + what to generate (BM/EN). */
  query: string;
  subject?: string | null;
  form?: string | null;
  chapterHint?: string | null;
  chapterFilter?: string | null;
  topK?: number;
  generateImage?: boolean;
  imagePrompt?: string | null;
  /** Skip textbook retrieval (English speaking practice). */
  skipRetrieval?: boolean;
  /** Use English oral-exam prompt instead of textbook MCQ template. */
  englishSpeaking?: boolean;
};

/** Retrieval should use syllabus/topic keywords — not the full MCQ generation prompt. */
export function buildGenerationRetrievalQuery(
  generationQuery: string,
  subject?: string | null,
  form?: string | null,
  chapterHint?: string | null,
): string {
  const hint = chapterHint?.trim();
  if (hint) {
    return [subject?.trim(), hint, form?.trim(), "SPM exam soalan past paper textbook"]
      .filter(Boolean)
      .join(" ");
  }

  const topicMatch = generationQuery.match(
    /focused on(?:\s+topic)?:\s*([^.(]+?)(?:\s*\(|\.|,|$)/i,
  );
  const topic = topicMatch?.[1]?.trim();
  const subjectPart = subject?.trim() ?? "";
  const formPart = form?.trim() ?? "";

  if (topic) {
    return [subjectPart, topic, formPart, "SPM exam soalan past paper textbook"].filter(Boolean).join(" ");
  }

  return [subjectPart, formPart, "SPM exam soalan past year paper trial textbook syllabus"]
    .filter(Boolean)
    .join(" ");
}

/** Parse "Variation seed: abc-123" or "Unique run ID (...): abc-123" from mobile generation query. */
export function parseVariationSeedFromQuery(query: string): string | undefined {
  const unique = query.match(/Unique\s+run\s+ID[^:]*:\s*(\S+)/i);
  if (unique?.[1]?.trim()) return unique[1].trim();
  const m = query.match(/Variation\s*seed:\s*(\S+)/i);
  return m?.[1]?.trim() || undefined;
}

/** Parse "Generate 5 SPM ..." so retrieval can fetch at least one chunk per question. */
export function parseQuestionCountFromQuery(query: string): number | undefined {
  const m = query.match(/Generate\s+(\d+)\s+SPM/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export type GenerateRagResult = {
  answer: string;
  diagram?: GenerateRagDiagram;
  diagrams?: GenerateRagDiagram[];
  structuredDiagrams?: StructuredQuestionDiagram[];
  sources: RagGenerationSource[];
  /** One-line BM/EN-friendly summary for UI */
  sourceLabel: string;
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
};

export type GenerateRagDiagram = {
  type: "line-chart";
  questionIndex?: number;
  title?: string;
  subtitle?: string;
  equationLabel?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  points: Array<{ x: number; y: number; label?: string }>;
};

const SYSTEM_PROMPT_BASE = `You are a Malaysian SPM exam board item writer (Form 4/5). You MUST follow every rule below exactly — no exceptions.

MANDATORY CONTEXT USE:
- You MUST use ONLY the provided context excerpts when stating specific facts.
- If context is insufficient, you MUST state so in one short sentence only — then still complete the requested template.
{{LANGUAGE_RULE}}
- You MUST NOT copy long passages verbatim from the context; you MUST paraphrase into original question stems.

When generating objective (A–D) questions, you MUST use this EXACT layout for EVERY item (no extra sections, no preamble about "aras kognitif" unless the user explicitly asks):

Soalan 1
<soalan dalam satu atau dua ayat>
A. <pilihan>
B. <pilihan>
C. <pilihan>
D. <pilihan>

Jawapan: <satu huruf A/B/C/D sahaja>
Penjelasan: <satu ayat ringkas isi sahaja; jangan rujuk sumber>

Soalan 2
... (same pattern)

Strict bans (violation = invalid output):
- NEVER use "Rujuk", "rujuk", "#1", "#2", "doc=", "chunk=", "[1]", "konteks", "bersumber", "eksplisit", "lihat #", "berdasarkan konteks di".
- NEVER use emojis (no ✅ etc.), italics for meta-commentary, footnotes, or "Jawapan betul" — you MUST use the exact label "Jawapan:" only.
- NEVER invent exam paper numbers like "28." or "14." before the question unless the user pasted that number and asked you to keep it.
- NEVER use horizontal rules made of many dashes unless the user asked for separators; you MUST use a single blank line between soalan only.
- You MUST NOT explain your process or list command words; output questions and answers ONLY.

For every soalan stem (except pure-BM-only subjects like Sejarah), you MUST use bilingual format on two separate lines:
EN: <stem in English>
BM: <same meaning in Bahasa Melayu>
The BM line MUST start on a new line immediately after the EN line. Never place EN and BM on the same line.
For every MCQ option A–D (except pure-BM-only subjects), you MUST also use bilingual format under that letter:
A. EN: <English option>
BM: <same meaning in Bahasa Melayu>
B. EN: <English option>
BM: <same meaning in Bahasa Melayu>
(and likewise for C and D). The BM line for each option MUST start on a new line after that option's EN line. For pure numbers/matrices/symbols, EN and BM may be identical tokens.

When generating subjective / structured (non-MCQ) SPM questions, you MUST use this EXACT layout for EVERY item:

Soalan 1
EN: <stem in English>
BM: <same meaning in Bahasa Melayu — new line after EN>
Markah: <positive integer total marks for this question>
Jawapan: <concise model answer>
Marking points:
- Mark 1: [Core Idea 1] — <clear, specific credit criteria>
- Mark 2: [Core Idea 2] — <entirely separate criteria>

Soalan 2
... (same pattern)

Rules for Markah::
- First decide Markah from question demand (command word, type, required answer parts): identify/name one ≈ 1; state/list N ≈ N; explain/describe ≈ 3–4; compare/contrast ≈ 4; calculation = 3 per independent calc ask (single ask = 3; (a)+(b) both calculate = 6) unless the stem prints a different Markah. Do NOT default every question to 1.
- Then write that many distinct Marking points: (one bullet = one mark; NEVER bundle two independent ideas in one bullet). Markah: MUST equal the bullet count.
- You MUST calibrate depth from past-paper excerpts when present, NEVER to inflate marks beyond the demand.
- Marking points MUST be checkable and MUST sum logically to Markah: (SPM mark-scheme style).

${buildStrictMarkSchemeGenerationBlock()}

Rules for Jawapan, Penjelasan, and Marking points:
- You MUST write at Malaysian SPM Form 4/5 level only — KSSM textbook vocabulary, NEVER A-Level/STPM/university.
${buildKssmTextbookModelAnswerWordingBlock()}
${buildJawapanVerbFormatRulesForGeneration()}
- Penjelasan (MCQ): exactly one simple SPM-level sentence explaining why the correct option is right.`;

const LANGUAGE_RULE_DEFAULT =
  "You MUST respond in the same language as the user's request (Bahasa Melayu or English) unless asked otherwise.";

const LANGUAGE_RULE_FORCE_BM =
  "For this subject, you MUST respond entirely in Bahasa Melayu (standard SPM). If the user's request is in English or mixed, you MUST still write the whole answer in BM only.";

function parseForceBmSubjects(): Set<string> {
  const raw = process.env.RAG_FORCE_BM_SUBJECTS?.trim();
  const parts = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ["sejarah", "pendidikan islam", "pendidikan moral"];
  return new Set(parts);
}

function isForceBmSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase();
  if (!s) return false;
  return parseForceBmSubjects().has(s);
}

const BM_ONLY_SUBJECT_FORMAT_APPEND = `

BM-only subject rules (override any bilingual instruction above):
- Write every soalan stem, option, Jawapan, Penjelasan, Marking points, and model answer in Bahasa Melayu only.
- Do NOT use EN: or BM: prefixes. Do not include any English question stem.
- For MCQ: Soalan N → BM stem → A. B. C. D. → Jawapan: → Penjelasan:
- For subjective: Soalan N → BM stem → Markah: → Jawapan: → Marking points:`;

function systemPromptForSubject(subject: string | null | undefined): string {
  const rule = isForceBmSubject(subject) ? LANGUAGE_RULE_FORCE_BM : LANGUAGE_RULE_DEFAULT;
  const base = SYSTEM_PROMPT_BASE.replace("{{LANGUAGE_RULE}}", rule);
  const full = isForceBmSubject(subject) ? `${base}${BM_ONLY_SUBJECT_FORMAT_APPEND}` : base;
  return withStrictGenerationLanguage(full);
}

function systemPromptForNoRetrievalFallback(subject: string | null | undefined): string {
  const subjectLabel = subject?.trim() || "SPM";
  const base = systemPromptForSubject(subject).replace(
    `MANDATORY CONTEXT USE:
- You MUST use ONLY the provided context excerpts when stating specific facts.
- If context is insufficient, you MUST state so in one short sentence only — then still complete the requested template.
`,
    `You are generating from your own SPM expertise (no textbook excerpts were supplied for this request). Still follow the exact requested output template.
`,
  );
  return `${base}

You are a senior Malaysian SPM examination expert and experienced Form 4/5 ${subjectLabel} teacher / item writer.
- Write authentic SPM-style practice questions from your expert knowledge of the KSSM syllabus and typical SPM exam style.
- Do NOT say that context, RAG, syllabus chunks, or sources are missing.
- Do NOT apologise, disclaim, or explain that this is a fallback.
- Do NOT output placeholder, dummy, or temporary backup questions.
- Keep the exact output template so the client parser can consume it.
- Output only the requested question blocks, with no preamble before Soalan 1.`;
}

const SPM_EXPERT_FALLBACK_PROMPT = `You are a senior Malaysian SPM examination expert.
Generate authentic SPM practice questions from your expert subject knowledge only.
You MUST return ONLY the final question blocks in the exact requested format.
You MUST NEVER say you lack context, data, syllabus chunks, sources, or verification.
You MUST NEVER apologise or mention fallback / backup / placeholder content.
You MUST NEVER add preambles, notes, warnings, or explanations before Soalan 1.
Every soalan must be a real exam-style item a student could practise — never dummy text.`;

function looksParseableMcqAnswer(answer: string): boolean {
  const text = answer.trim();
  return (
    /(?:^|\n)\s*(?:Soalan|Question)\s+\d+\b/i.test(text) &&
    /(?:^|\n)\s*A[\.)]\s+/m.test(text) &&
    /(?:^|\n)\s*B[\.)]\s+/m.test(text) &&
    /(?:^|\n)\s*C[\.)]\s+/m.test(text) &&
    /(?:^|\n)\s*D[\.)]\s+/m.test(text) &&
    /(?:^|\n)\s*(?:Jawapan|Answer|Correct(?:\s+answer)?)\s*:\s*[A-D]\b/i.test(text)
  );
}

function looksUsableMcqAnswer(answer: string): boolean {
  const text = answer.trim();
  if (text.length < 80) return false;
  // Keep LLM text if it looks like an MCQ set even when labels are slightly off.
  return (
    /(?:^|\n)\s*(?:Soalan|Question)\s+\d+\b/i.test(text) &&
    /(?:^|\n)\s*[A-D][\.)]\s+\S+/m.test(text) &&
    /(?:Jawapan|Answer|Correct)\s*:/i.test(text)
  );
}

function looksParseableSubjectiveAnswer(answer: string): boolean {
  const text = answer.trim();
  return (
    /(?:^|\n)\s*(?:Soalan|Question)\s+\d+\b/i.test(text) &&
    /(?:^|\n)\s*Markah\s*:\s*\d+/i.test(text) &&
    /(?:^|\n)\s*(?:Jawapan|Answer)\s*:/i.test(text)
  );
}

function looksUsableSubjectiveAnswer(answer: string): boolean {
  const text = answer.trim();
  if (text.length < 80) return false;
  return (
    /(?:^|\n)\s*(?:Soalan|Question)\s+\d+\b/i.test(text) &&
    /(?:Jawapan|Answer|Marking points?|Markah)\s*:/i.test(text)
  );
}

function answerLooksUsableForQuery(query: string, answer: string): boolean {
  if (isMcqGenerationQuery(query)) {
    return looksParseableMcqAnswer(answer) || looksUsableMcqAnswer(answer);
  }
  if (isSubjectiveGenerationQuery(query)) {
    return looksParseableSubjectiveAnswer(answer) || looksUsableSubjectiveAnswer(answer);
  }
  return answer.trim().length > 40;
}

/** LLM-only SPM-expert regenerate — never returns hardcoded placeholder questions. */
async function generateSpmExpertFallbackAnswer(
  query: string,
  subject: string | null | undefined,
  reason: string,
): Promise<string> {
  console.warn("[rag/generate] SPM-expert LLM fallback", {
    subject: subject ?? null,
    reason,
  });
  return chatCompletion(
    [
      {
        role: "system",
        content: `${systemPromptForNoRetrievalFallback(subject)}\n\n${SPM_EXPERT_FALLBACK_PROMPT}`,
      },
      {
        role: "user",
        content: `User request:
${query}

As an SPM expert, write the full set of authentic practice questions now.
Follow the appropriate template from the system message (MCQ vs subjective).
Use general SPM / KSSM knowledge only. Output the final question blocks directly with no preamble.${graphJsonReminder(subject, query)}${mcqFormatReminder(query, subject)}${subjectiveGenerationReminder(query, [], subject)}`,
      },
    ],
    { subject, query: `${query} [spm-expert-fallback]` },
  );
}

/**
 * If the model output is unusable, regenerate once via SPM-expert LLM prompt.
 * Never invent Temporary / Placeholder dummy questions.
 */
async function ensureParseableOrSpmExpertFallback(
  query: string,
  subject: string | null | undefined,
  answer: string,
): Promise<string> {
  if (!isMcqGenerationQuery(query) && !isSubjectiveGenerationQuery(query)) {
    return answer;
  }
  if (answerLooksUsableForQuery(query, answer)) {
    return answer;
  }
  console.warn("[rag/generate] output unusable — regenerating with SPM-expert LLM", {
    subject: subject ?? null,
    length: answer.trim().length,
    preview: answer.trim().slice(0, 240),
  });
  const regenerated = await generateSpmExpertFallbackAnswer(
    query,
    subject,
    "unusable-primary-output",
  );
  if (answerLooksUsableForQuery(query, regenerated)) {
    return regenerated;
  }
  // Still imperfect — return the expert LLM text rather than placeholder junk.
  console.warn("[rag/generate] SPM-expert regenerate still imperfect — returning LLM text as-is", {
    preview: regenerated.trim().slice(0, 240),
  });
  return regenerated.trim() || answer;
}

function normalizeBilingualAnswer(answer: string): string {
  return answer.replace(/(EN:\s*[^\n]+?)\s+(BM:)/gi, "$1\n$2");
}

function promoteBiologyDiagramFlags(
  answer: string,
  query: string,
  subject: string | null | undefined,
): string {
  if (!shouldBiasBiologyDiagram(query, subject)) return answer;
  const yaCount = (answer.match(/^\s*Perlu rajah\s*:\s*Ya\b/gim) ?? []).length;
  if (yaCount > 0) return answer;

  let promoted = 0;
  return answer.replace(/(^\s*Perlu rajah\s*:\s*)Tidak\b/gim, (_m, prefix: string) => {
    if (promoted >= 2) return `${prefix}Tidak`;
    promoted += 1;
    return `${prefix}Ya`;
  });
}

function bilingualStemReminder(subject: string | null | undefined): string {
  if (isForceBmSubject(subject)) return "";
  return `

Each soalan stem must be bilingual on two lines:
EN: <English stem>
BM: <Bahasa Melayu stem — new line, not same line as EN>
Each MCQ option A–D must also be bilingual under that letter:
A. EN: <English option>
BM: <Bahasa Melayu option>
Then Jawapan:, Penjelasan:.`;
}

function isPhysicsSubject(subject: string | null | undefined): boolean {
  return /^physics$/i.test(subject?.trim() ?? "");
}

function isPhysicsGraphTopicQuery(query: string): boolean {
  return /\b(motion|graph|graphs|graf|plot|chart|linear|velocity|speed|acceleration|displacement|distance[- ]time|speed[- ]time|velocity[- ]time|acceleration[- ]time)\b/i.test(
    query,
  );
}

function shouldUseGraphJsonFlow(subject: string | null | undefined, query: string): boolean {
  return isPhysicsSubject(subject) && isPhysicsGraphTopicQuery(query);
}

function shouldBiasBiologyDiagram(query: string, subject?: string | null): boolean {
  return (
    /^biology$/i.test(subject?.trim() ?? "") &&
    /\b(cell|cells|organelle|osmosis|plasma membrane|microscope|plant cell|animal cell|vacuole|chloroplast|mitochondr|golgi|endoplasmic|nucleus|ribosome|membrane|turgid|plasmolysis|compare|comparison)\b/i.test(
      query,
    )
  );
}

function usesStructuredBiologyDiagramFlow(subject: string | null | undefined): boolean {
  return /^biology$/i.test(subject?.trim() ?? "");
}

function biologyDiagramBiasRule(query: string, subject?: string | null): string {
  if (!shouldBiasBiologyDiagram(query, subject)) return "";
  return `

Biology visual bias: for cell structure, organelle identification, microscope observation, osmosis, plasmolysis/turgidity, plasma-membrane transport, or plant-vs-animal-cell comparison questions, prefer "Perlu rajah: Ya" more often because a visual commonly helps students interpret the item. Use "Tidak" only when the stem is fully clear without any diagram.`;
}

function formatGeneratorContextBlock(chunk: RetrievedChunk, index: number): string {
  const meta: string[] = [];
  if (chunk.sourceType === "past_paper") {
    if (chunk.questionRef) meta.push(`ref=${chunk.questionRef}`);
    if (typeof chunk.maxMarks === "number") meta.push(`stored marks=${chunk.maxMarks}`);
  }
  const header = meta.length > 0 ? `[${index}] (${meta.join(", ")})\n` : `[${index}]\n`;
  return `${header}${chunk.content}`;
}

function mcqFormatReminder(query: string, subject?: string | null): string {
  if (!isMcqGenerationQuery(query)) return "";
  const isScience = Boolean(subject && isScienceDiagramSubject(subject));
  const scienceDiagramRule = isScience
    ? `

Science diagram rule: Do not add any "Perlu rajah" or diagram-needed line inside the MCQ blocks. The app will decide diagram rendering in a second pass after the questions are generated.`
    : "";
  const physicsDiagramBias = isPhysicsSubject(subject)
    ? `

Physics diagram-friendly stems (IMPORTANT):
- At least ~60% of Soalan MUST suit a rajah stimulus (ray/lens/mirror, circuit, force/vector, wave, heat curve, motion graph, pulley/apparatus).
- Prefer stems that refer to a diagram or labelled setup; do not make the whole set pure calculation with no visual.`
    : "";
  const mcqLine = isForceBmSubject(subject)
    ? "Soalan 1 → BM stem only (no EN:) → A. B. C. D. → Jawapan: <one letter> → Penjelasan:"
    : "Soalan 1 → EN: / BM: (two lines) → A–D each with EN: / BM: under the letter → Jawapan: <one letter> → Penjelasan:";

  return `

The user wants objective MCQ (A–D) questions ONLY. Use the MCQ template from the system message:
${mcqLine}
Do NOT use Markah:, Marking points:, or essay-style model answers for MCQ.
Output at least one full Soalan block before any other text.${scienceDiagramRule}${physicsDiagramBias}`;
}

function subjectiveGenerationReminder(
  query: string,
  hits: RetrievedChunk[],
  subject?: string | null,
): string {
  if (!isSubjectiveGenerationQuery(query)) return "";
  const marksGuide = buildPastPaperMarksGuidance(hits);
  const templateLine = isForceBmSubject(subject)
    ? "The user wants subjective (structured) questions. Use Soalan / BM stem only / Markah / Jawapan / Marking points (Bahasa Melayu only, no EN: line)."
    : "The user wants subjective (structured) questions. Use the subjective Soalan / EN / BM / Markah / Jawapan / Marking points template.";
  return `

${templateLine}
You MUST think like an SPM examiner: Question → decompose every distinct requirement → allocate whole marks → write marking points → only then write Jawapan. NEVER invent marks from textbook detail the stem did not ask. You MUST assign Markah: from question demand first (command word, type, number of independent parts — identify+roles for N items = 2N whole marks; never fuse name+role into one mark; never default all to 1), then write exactly that many distinct, non-redundant marking points. Each mark = one independently awardable requirement; you MUST NOT merge two stem requirements into one point. Use past-paper mark patterns in the excerpts to decide depth, NEVER to inflate marks.
${marksGuide ? `\n${marksGuide}\n` : "\n(No past-paper mark samples in context — you MUST use typical SPM weights: 2 marks for two-idea explain; 3–4 ONLY when three or four genuinely independent ideas are required.)\n"}`;
}

function graphJsonReminder(subject: string | null | undefined, query: string): string {
  if (!shouldUseGraphJsonFlow(subject, query)) return bilingualStemReminder(subject);
  const subjectLabel = isPhysicsSubject(subject) ? "Physics" : "Math";
  return `

Subject is **${subjectLabel}**: use bilingual stems for every soalan (EN: on one line, BM: on the next line), and bilingual options A–D (each letter has EN: then BM: on the next line), then Jawapan: and Penjelasan: as usual. Penjelasan should be in Bahasa Melayu when the rest is mixed EN/BM.
For graph-based or motion-graph questions, prefer returning a JSON field "rajah_spec" (deterministic shape spec) and optionally "rajah_svg". Supported rajah_spec kinds are:
- {"kind":"triangle","points":[{"x":0,"y":0,"label":"A"},{"x":4,"y":0,"label":"B"},{"x":1,"y":3,"label":"C"}],"title":"..."}
- {"kind":"cartesian_line","xMin":0,"xMax":10,"yMin":0,"yMax":20,"points":[{"x":0,"y":0,"label":"P"},{"x":5,"y":10,"label":"Q"}],"title":"..."}
For every generated question, decide whether a line graph, coordinate graph, or motion graph would help. If one or more generated questions need a graph, generate the questions FIRST using the normal Soalan/Jawapan/Penjelasan format. Then append this block AFTER all questions and explanations:
DIAGRAM_JSON_START
{"diagrams":[{"questionIndex":1,"type":"line-chart","title":"...","subtitle":"...","equationLabel":"...","xAxisLabel":"x","yAxisLabel":"y","points":[{"x":-2,"y":-3},{"x":-1,"y":-1},{"x":0,"y":1,"label":"y-intercept"},{"x":1,"y":3},{"x":2,"y":5}]},{"questionIndex":3,"type":"line-chart","title":"...","equationLabel":"...","points":[{"x":0,"y":0},{"x":1,"y":2},{"x":2,"y":4}]}]}
DIAGRAM_JSON_END
The DIAGRAM_JSON block must be valid JSON only, with no markdown fences and no comments. It is for the React chart renderer, not for students to read.
Only include diagrams for questions that actually need graphs. Include one diagram object per graph-based question. Set questionIndex to the matching Soalan number, so Soalan 1 uses questionIndex 1 and Soalan 4 uses questionIndex 4. Graphs may be attached to any Soalan, not only the first one. Do not put A-D answer choices inside the diagram JSON. Do not put the diagram JSON inside any question, option, answer, or explanation.
`;
}

function shouldPostProcessMathSvg(subject: string | null | undefined): boolean {
  return subject?.trim() === "Math";
}

function shouldPostProcessGraphDiagrams(subject: string | null | undefined, query: string): boolean {
  return shouldUseGraphJsonFlow(subject, query);
}

function isFinitePoint(point: unknown): point is { x: number; y: number; label?: string } {
  if (!point || typeof point !== "object") return false;
  const p = point as Record<string, unknown>;
  return typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y);
}

function normalizeDiagram(raw: unknown): GenerateRagDiagram | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const rawType = typeof obj.type === "string" ? obj.type : typeof obj.kind === "string" ? obj.kind : "";
  const type = rawType.toLowerCase().replace(/_/g, "-");
  if (type !== "line-chart" && type !== "cartesian-line") return undefined;

  const points = Array.isArray(obj.points)
    ? obj.points.filter(isFinitePoint).map((point) => ({
        x: point.x,
        y: point.y,
        label: typeof point.label === "string" ? point.label : undefined,
      }))
    : [];

  if (points.length < 2) return undefined;

  return {
    type: "line-chart",
    questionIndex: typeof obj.questionIndex === "number" && Number.isInteger(obj.questionIndex) && obj.questionIndex > 0 ? obj.questionIndex : undefined,
    title: typeof obj.title === "string" ? obj.title : undefined,
    subtitle: typeof obj.subtitle === "string" ? obj.subtitle : undefined,
    equationLabel: typeof obj.equationLabel === "string" ? obj.equationLabel : undefined,
    xAxisLabel: typeof obj.xAxisLabel === "string" ? obj.xAxisLabel : "x",
    yAxisLabel: typeof obj.yAxisLabel === "string" ? obj.yAxisLabel : "y",
    points,
  };
}

function normalizeDiagrams(raw: unknown): GenerateRagDiagram[] {
  const value =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).diagrams)
      ? (raw as Record<string, unknown>).diagrams
      : raw;
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => normalizeDiagram(item))
    .filter((diagram): diagram is GenerateRagDiagram => Boolean(diagram));
}

function extractDiagramBlock(answer: string): { answer: string; diagrams: GenerateRagDiagram[] } {
  const match = answer.match(/DIAGRAM_JSON_START\s*([\s\S]*?)\s*DIAGRAM_JSON_END/i);
  if (!match) return { answer, diagrams: [] };

  let diagrams: GenerateRagDiagram[] = [];
  try {
    diagrams = normalizeDiagrams(JSON.parse(match[1] ?? ""));
  } catch {
    diagrams = [];
  }

  return {
    answer: answer.replace(match[0], "").trim(),
    diagrams,
  };
}

function diagramsFromRajahSpec(answer: string): GenerateRagDiagram[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return [];
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const diagrams: GenerateRagDiagram[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const spec = (item as Record<string, unknown>).rajah_spec;
    const diagram = normalizeDiagram(spec);
    if (diagram) diagrams.push(diagram);
  }

  return diagrams;
}

async function buildGeneratedImages(
  input: GenerateRagInput,
  answer: string,
): Promise<GenerateRagResult["generatedImages"]> {
  const subject = input.subject?.trim() ?? "";
  if (shouldUseGraphJsonFlow(subject, input.query)) {
    return [];
  }
  if (!shouldGenerateEducationalDiagrams(subject, input.query, input.generateImage)) {
    if (input.generateImage && input.imagePrompt?.trim()) {
      const urls = await generateImage(input.imagePrompt.trim());
      return urls.map((url) => ({ url, prompt: input.imagePrompt!.trim() }));
    }
    return [];
  }

  const diagrams = await generateEducationalDiagramsForAnswer({
    subject,
    query: input.query,
    answer,
    imagePrompt: input.imagePrompt,
  });
  return diagrams.map((d) => ({
    url: d.url,
    prompt: d.prompt,
    questionIndex: d.questionIndex,
  }));
}

function buildGraphDiagrams(
  input: GenerateRagInput,
  answer: string,
  diagramsFromBlock: GenerateRagDiagram[],
): GenerateRagDiagram[] {
  if (!shouldPostProcessGraphDiagrams(input.subject, input.query)) return [];
  if (diagramsFromBlock.length > 0) return diagramsFromBlock;
  const fromRajahSpec = diagramsFromRajahSpec(answer);
  if (fromRajahSpec.length > 0) return fromRajahSpec;
  return [];
}

const ENGLISH_SPEAKING_SYSTEM = `You are an expert SPM English Speaking Test question writer for Malaysian Form 4/5 students (ages 16–17, CEFR B1–B2).
Generate ORIGINAL speaking practice prompts only — no textbook citations, no MCQ, no bilingual BM lines.
Write like an SPM oral examiner: warm, clear, natural spoken English.
Follow the user's output format exactly. Do not add preamble.

PART 1 STYLE (mandatory when generating Part 1):
- Short personal interview questions, one at a time.
- Simple conversational English a student can answer in 20–40 seconds.
- Everyday Malaysian teen life: school, home, hobbies, friends, food, sports, free time, technology, plans.
- Prefer stems like: Tell me about… / What do you usually… / Do you prefer… Why? / How do you… / Which… and why?
- Keep each question to one or two short sentences. No long multi-clause / brand-list questions.
- Avoid childish one-word prompts and IELTS/university abstraction.

QUALITY (mandatory):
- Honour the student's chosen topic category strictly (or vary freely if Random).
- Never vague, repetitive, or stock-copied. Every Unique run ID must produce freshly worded prompts.
- Part 1 = exactly 5 short interview questions.
- Part 2 = exactly 1 long cue-card task that supports 1.5–2 minutes of speech.
- Never generate Part 3 / group discussion tasks.`;

function extractTopicCategoryFromSpeakingQuery(query: string): string | null {
  const focused = query.match(/Focus on the topic category:\s*(.+?)(?:\.|$)/im);
  if (focused?.[1]?.trim()) return focused[1].trim();
  const topicFocus = query.match(/Topic focus:\s*(.+?)(?:\.|$)/im);
  if (topicFocus?.[1]?.trim()) return topicFocus[1].trim();
  const categoryLine = query.match(/Student-selected topic category:\s*(.+?)(?:\.|$)/im);
  if (categoryLine?.[1]?.trim()) return categoryLine[1].trim();
  return null;
}

function buildEnglishSpeakingUserContent(input: GenerateRagInput): string {
  const part = englishSpeakingPartFromQuery(input.query);
  const seed = parseVariationSeedFromQuery(input.query);
  const category = extractTopicCategoryFromSpeakingQuery(input.query);
  const partLabel =
    part === "part1"
      ? "Part 1 (Short Interview — exactly 5 questions)"
      : "Part 2 (Individual Long Turn — exactly 1 cue card, 1.5–2 minutes speaking)";
  const lines = [
    `SPM English Speaking — ${partLabel}.`,
    category
      ? `Student-selected topic category: ${category}. ALL prompts MUST fit this category (unless category is Random — then vary freely across SPM-appropriate themes for 16–17 year olds).`
      : "Vary topics realistically for Malaysian Form 4/5 students.",
    seed
      ? `Unique run ID: ${seed}. Treat this as a hard uniqueness key — wording MUST differ from any previous generation with a different ID.`
      : "Make this set distinctly different from typical default examples.",
    "Create original prompts. Do NOT copy past-paper wording or previous AI outputs.",
    "Do NOT generate Part 3 / group discussion.",
    part === "part1"
      ? "Part 1 questions must sound like a real SPM short interview — short, personal, conversational."
      : "Part 2 must support a full 1.5–2 minute long turn.",
    "",
    input.query.trim(),
    "",
    "Output the speaking prompts only, using the exact format specified above.",
  ];
  return lines.join("\n");
}

async function generateEnglishSpeaking(input: GenerateRagInput): Promise<GenerateRagResult> {
  const answerRaw = await chatCompletion(
    [
      { role: "system", content: ENGLISH_SPEAKING_SYSTEM },
      { role: "user", content: buildEnglishSpeakingUserContent(input) },
    ],
    {
      subject: input.subject,
      query: input.query,
      temperature: 1.2,
    },
  );

  const generatedImages = await buildGeneratedImages(input, answerRaw);
  return {
    answer: answerRaw.trim(),
    structuredDiagrams: [],
    sources: [],
    sourceLabel: "",
    sourcePageImages: [],
    generatedImages,
  };
}

async function packageGeneratedAnswer(
  input: GenerateRagInput,
  answerRaw: string,
  extras: Omit<GenerateRagResult, "answer" | "diagram" | "diagrams" | "structuredDiagrams" | "generatedImages">,
  opts?: {
    prebuiltGeneratedImages?: GenerateRagResult["generatedImages"];
    validatedPipelineRan?: boolean;
    validatedDiagramsApproved?: boolean;
  },
): Promise<GenerateRagResult> {
  const finalized = await finalizeGeneratedAnswer(
    {
      query: input.query,
      subject: input.subject,
      generateImage: input.generateImage,
      imagePrompt: input.imagePrompt,
      prebuiltGeneratedImages: opts?.prebuiltGeneratedImages,
      validatedPipelineRan: opts?.validatedPipelineRan,
      validatedDiagramsApproved: opts?.validatedDiagramsApproved,
    },
    answerRaw,
  );
  const answer = await ensureParseableOrSpmExpertFallback(
    input.query,
    input.subject,
    finalized.answer,
  );
  return {
    ...extras,
    answer,
    diagram: finalized.diagram,
    diagrams: finalized.diagrams,
    structuredDiagrams: finalized.structuredDiagrams,
    generatedImages: finalized.generatedImages,
  };
}

/** Retrieve RAG chunks for a generation query (shared by batch + progressive MCQ). */
export async function retrieveHitsForRagGeneration(
  input: GenerateRagInput,
): Promise<RetrievedChunk[]> {
  const questionCount = parseQuestionCountFromQuery(input.query);
  const topK = Math.max(input.topK ?? 8, questionCount ?? 0);
  const variationSeed = parseVariationSeedFromQuery(input.query);
  const hasChapterFilter = Boolean(input.chapterFilter?.trim());
  const hasChapterHint = Boolean(input.chapterHint?.trim());
  const hasExplicitTopic = /focused on(?:\s+topic)?:\s*\S/i.test(input.query);
  const generalSyllabusMode = !hasChapterFilter && !hasChapterHint && !hasExplicitTopic;

  const retrievalQuery = buildGenerationRetrievalQuery(
    input.query,
    input.subject,
    input.form,
    input.chapterHint,
  );

  // General (no-topic) mode: sample chunks spread across DIFFERENT chapters,
  // randomized each call. Keyword search with a generic query keeps hitting the
  // same few chunks, so every generated set ends up identical with the same source.
  const retrieval = generalSyllabusMode
    ? await retrieveGeneralSyllabusChunks({
        subject: input.subject ?? undefined,
        form: input.form ?? undefined,
        topK,
        variationSeed,
      })
    : await retrieveChunks({
        query: retrievalQuery,
        subject: input.subject ?? undefined,
        form: input.form ?? undefined,
        chapterHint: input.chapterHint ?? undefined,
        chapterFilter: input.chapterFilter ?? undefined,
        topK,
      });
  const hits = retrieval.chunks;
  console.info("[rag/generate] retrieval", {
    subject: input.subject ?? null,
    mode: generalSyllabusMode ? "general-sample" : "keyword",
    hitCount: hits.length,
    pastPaperHits: hits.filter((h) => h.sourceType === "past_paper").length,
    chapters: [...new Set(hits.map((h) => h.chapter ?? "(none)"))].slice(0, 10),
    retrievalQuery: generalSyllabusMode ? "general-sample" : retrievalQuery.slice(0, 160),
  });
  return hits;
}

/**
 * Generate questions from already-retrieved hits (batch `/rag/generate` and progressive MCQ step).
 * Does not change English-speaking / skipRetrieval behaviour — callers handle those first.
 */
export async function generateWithRagFromHits(
  input: GenerateRagInput,
  hits: RetrievedChunk[],
): Promise<GenerateRagResult> {
  if (hits.length === 0) {
    let answerRaw = await generateSpmExpertFallbackAnswer(
      input.query,
      input.subject,
      "no-retrieval-hits",
    );
    answerRaw = await ensureParseableOrSpmExpertFallback(input.query, input.subject, answerRaw);
    let validatedPipelineRan = false;
    let validatedDiagramsApproved = false;
    let prebuiltImages: GenerateRagResult["generatedImages"] | undefined;

    if (isValidatedDiagramPipelineEnabled(input.subject, input.generateImage)) {
      validatedPipelineRan = true;
      const pipeline = await runValidatedDiagramGenerationPipeline({
        query: input.query,
        subject: input.subject,
        hits: [],
        generateImage: input.generateImage,
        imagePrompt: input.imagePrompt,
        initialAnswerRaw: answerRaw,
      });
      answerRaw = pipeline.answerRaw;
      validatedDiagramsApproved = pipeline.validation?.approved === true;
      prebuiltImages = pipeline.generatedImages;
      if (isForceBmSubject(input.subject)) {
        answerRaw = await ensureParseableOrSpmExpertFallback(input.query, input.subject, answerRaw);
      }
    }

    return packageGeneratedAnswer(input, answerRaw, {
      sources: [],
      sourceLabel: "",
      sourcePageImages: [],
    }, { prebuiltGeneratedImages: prebuiltImages, validatedPipelineRan, validatedDiagramsApproved });
  }

  let answerRaw = await generateQuestionFromRagContext(hits, {
    query: input.query,
    subject: input.subject,
  });
  if (isForceBmSubject(input.subject)) {
    answerRaw = await ensureParseableOrSpmExpertFallback(input.query, input.subject, answerRaw);
  }

  const generationSources = chunksToGenerationSources(hits);
  let prebuiltImages: GenerateRagResult["generatedImages"] | undefined;
  let validatedPipelineRan = false;
  let validatedDiagramsApproved = false;

  if (isValidatedDiagramPipelineEnabled(input.subject, input.generateImage)) {
    validatedPipelineRan = true;
    const pipeline = await runValidatedDiagramGenerationPipeline({
      query: input.query,
      subject: input.subject,
      hits,
      generateImage: input.generateImage,
      imagePrompt: input.imagePrompt,
      initialAnswerRaw: answerRaw,
    });
    answerRaw = pipeline.answerRaw;
    validatedDiagramsApproved = pipeline.validation?.approved === true;
    prebuiltImages = pipeline.generatedImages;
    if (isForceBmSubject(input.subject)) {
      answerRaw = await ensureParseableOrSpmExpertFallback(input.query, input.subject, answerRaw);
    }
    console.info("[rag/generate] validated diagram pipeline", {
      attempts: pipeline.attempts,
      approved: validatedDiagramsApproved,
      imageCount: prebuiltImages.length,
    });
  }

  return packageGeneratedAnswer(
    input,
    answerRaw,
    {
      sources: generationSources,
      sourceLabel:
        formatSourcesSummary(generationSources) || generationSources[0]?.label?.trim() || "",
      sourcePageImages: [],
    },
    { prebuiltGeneratedImages: prebuiltImages, validatedPipelineRan, validatedDiagramsApproved },
  );
}

export async function generateWithRag(
  input: GenerateRagInput,
): Promise<GenerateRagResult> {
  if (
    input.englishSpeaking === true ||
    (input.skipRetrieval === true && input.subject?.trim().toLowerCase() === "english")
  ) {
    return generateEnglishSpeaking(input);
  }

  const hits = await retrieveHitsForRagGeneration(input);
  return generateWithRagFromHits(input, hits);
}
