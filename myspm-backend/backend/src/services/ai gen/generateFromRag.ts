import { chatCompletion, generateImage } from "./llmProvider";
import {
  generateEducationalDiagramsForAnswer,
  isScienceDiagramSubject,
  shouldGenerateEducationalDiagrams,
} from "./educationalDiagramService";
import type { StructuredQuestionDiagram } from "./structuredDiagramPlanner";
import {
  buildPastPaperMarksGuidance,
  isMcqGenerationQuery,
  isSubjectiveGenerationQuery,
} from "../rag/pastPaperMarksHints";
import { retrieveChunks } from "../rag/retrievalService";
import type { RetrievedChunk } from "../rag/types";
import { enrichMathAnswerWithSvg } from "./mathSvg";

export type GenerateRagInput = {
  /** Natural language: topic + what to generate (BM/EN). */
  query: string;
  subject?: string | null;
  topK?: number;
  generateImage?: boolean;
  imagePrompt?: string | null;
};

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

const SYSTEM_PROMPT_BASE = `You are an assistant for Malaysian SPM exam preparation.
Use ONLY the provided context excerpts when stating specific facts. If context is insufficient, say so in one short sentence.
{{LANGUAGE_RULE}}
Do not copy long passages verbatim from the context; paraphrase into original question stems.

When generating objective (A–D) questions, follow this EXACT layout for EVERY item (no extra sections, no preamble about "aras kognitif" unless the user explicitly asks):

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

Strict bans (violation = wrong answer):
- No "Rujuk", "rujuk", "#1", "#2", "doc=", "chunk=", "[1]", "konteks", "bersumber", "eksplisit", "lihat #", "berdasarkan konteks di".
- No emojis (no ✅ etc.), no italics used only for meta-commentary, no footnotes, no "Jawapan betul" — use the exact label "Jawapan:" only.
- No invented exam paper numbers like "28." or "14." before the question unless the user pasted that number and asked you to keep it.
- No horizontal rules made of many dashes unless the user asked for separators; use a single blank line between soalan only.
- Do not explain your process or list command words you used; output questions and answers only.

For every soalan stem (except pure-BM-only subjects like Sejarah), use bilingual format on two separate lines:
EN: <stem in English>
BM: <same meaning in Bahasa Melayu>
The BM line MUST start on a new line immediately after the EN line. Never place EN and BM on the same line.
Then A–D (option text may stay in English only if clearer; do not duplicate four long bilingual blocks).

When generating subjective / structured (non-MCQ) SPM questions, use this EXACT layout for EVERY item:

Soalan 1
EN: <stem in English>
BM: <same meaning in Bahasa Melayu — new line after EN>
Markah: <positive integer total marks for this question>
Jawapan: <concise model answer>
Marking points:
- <point 1>
- <point 2>

Soalan 2
... (same pattern)

Rules for Markah::
- Calibrate each Markah: using mark weights in the provided past-paper excerpts (e.g. [3 marks], 4 markah, similar question depth).
- Do not copy whole questions from context; invent new stems with similar mark allocation.
- Marking points must be checkable and sum logically to Markah: (scheme style like SPM mark schemes).`;

const LANGUAGE_RULE_DEFAULT =
  "Respond in the same language as the user's request (Bahasa Melayu or English) unless asked otherwise.";

const LANGUAGE_RULE_FORCE_BM =
  "For this subject, respond entirely in Bahasa Melayu (standard SPM). If the user's request is in English or mixed, still write the whole answer in BM only.";

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
  const rule = isForceBmSubject(subject) ? LANGUAGE_RULE_FORCE_BM : LANGUAGE_RULE_DEFAULT;
  return SYSTEM_PROMPT_BASE.replace("{{LANGUAGE_RULE}}", rule);
}

function systemPromptForNoRetrievalFallback(subject: string | null | undefined): string {
  const base = systemPromptForSubject(subject).replace(
    "Use ONLY the provided context excerpts when stating specific facts. If context is insufficient, say so in one short sentence.\n",
    "No context excerpts are available for this request. Use general Malaysian SPM knowledge and still follow the exact requested output template.\n",
  );
  return `${base}

Temporary fallback mode when no knowledge-base chunks are available:
- Do NOT say that context is missing, insufficient, or unavailable.
- Do NOT apologise or explain retrieval failure.
- Still fulfill generation requests using general SPM knowledge.
- Keep the exact output template requested by the user and the system prompt so the client parser can consume it.
- Output only the requested question blocks, with no preamble, disclaimer, or notes before Soalan 1.`;
}

const NO_RETRIEVAL_GENERAL_PROMPT = `You generate Malaysian SPM practice content from general subject knowledge only.
Return only the final question blocks in the exact requested format.
Never say you lack context, data, syllabus chunks, sources, or verification.
Never apologise.
Never add preambles, notes, warnings, or explanations before Soalan 1.`;

function requestedQuestionCount(query: string): number {
  const m = query.match(/\b(?:generate|buat|hasilkan)\s+(\d{1,2})\b/i);
  const n = m ? Number(m[1]) : 5;
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function fallbackTopicLabel(query: string): string {
  const m = query.match(/focused on topic:\s*(.+?)(?:\.\s|$)/i);
  return (m?.[1] ?? "the requested topic").trim();
}

function looksParseableMcqAnswer(answer: string): boolean {
  const text = answer.trim();
  return (
    /(?:^|\n)\s*Soalan\s+1\b/i.test(text) &&
    /(?:^|\n)\s*A\.\s+/m.test(text) &&
    /(?:^|\n)\s*B\.\s+/m.test(text) &&
    /(?:^|\n)\s*C\.\s+/m.test(text) &&
    /(?:^|\n)\s*D\.\s+/m.test(text) &&
    /(?:^|\n)\s*Jawapan\s*:\s*[A-D]\b/i.test(text) &&
    /(?:^|\n)\s*Penjelasan\s*:/i.test(text)
  );
}

function looksParseableSubjectiveAnswer(answer: string): boolean {
  const text = answer.trim();
  return (
    /(?:^|\n)\s*Soalan\s+1\b/i.test(text) &&
    /(?:^|\n)\s*Markah\s*:\s*\d+/i.test(text) &&
    /(?:^|\n)\s*Jawapan\s*:/i.test(text)
  );
}

function buildEmergencyMcqFallback(query: string, subject: string | null | undefined): string {
  const count = requestedQuestionCount(query);
  const topic = fallbackTopicLabel(query);
  const subjectLabel = subject?.trim() || "the subject";
  const items: string[] = [];

  for (let i = 1; i <= count; i += 1) {
    items.push(
      [
        `Soalan ${i}`,
        `EN: Temporary fallback practice item ${i} for ${subjectLabel} on ${topic}. Which option is the placeholder answer for this backup question set?`,
        `BM: Item latihan sandaran sementara ${i} bagi ${subjectLabel} untuk topik ${topic}. Pilihan manakah ialah jawapan placeholder bagi set soalan sandaran ini?`,
        "A. Placeholder answer",
        "B. Alternative placeholder",
        "C. Another placeholder",
        "D. Last placeholder",
        "Jawapan: A",
        "Penjelasan: Temporary fallback item returned because no matching knowledge-base chunks were available.",
      ].join("\n"),
    );
  }

  return items.join("\n\n");
}

function buildEmergencySubjectiveFallback(query: string, subject: string | null | undefined): string {
  const count = requestedQuestionCount(query);
  const topic = fallbackTopicLabel(query);
  const subjectLabel = subject?.trim() || "the subject";
  const items: string[] = [];

  for (let i = 1; i <= count; i += 1) {
    items.push(
      [
        `Soalan ${i}`,
        `EN: Temporary fallback structured item ${i} for ${subjectLabel} on ${topic}. State one relevant point for this backup question set.`,
        `BM: Item berstruktur sandaran sementara ${i} bagi ${subjectLabel} untuk topik ${topic}. Nyatakan satu poin yang berkaitan untuk set soalan sandaran ini.`,
        "Markah: 2",
        "Jawapan: Any simple relevant point for the requested topic.",
        "Marking points:",
        "- Accept one relevant point linked to the requested topic.",
        "- Award full marks only when the point is clear and topic-related.",
      ].join("\n"),
    );
  }

  return items.join("\n\n");
}

function ensureNoRetrievalParseableAnswer(
  query: string,
  subject: string | null | undefined,
  answer: string,
): string {
  if (isMcqGenerationQuery(query)) {
    return looksParseableMcqAnswer(answer) ? answer : buildEmergencyMcqFallback(query, subject);
  }
  if (isSubjectiveGenerationQuery(query)) {
    return looksParseableSubjectiveAnswer(answer) ? answer : buildEmergencySubjectiveFallback(query, subject);
  }
  return answer;
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
Then A–D, Jawapan:, Penjelasan:.`;
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
  const mcqLine = "Soalan 1 → EN: / BM: (two lines) → A. B. C. D. → Jawapan: <one letter> → Penjelasan:";

  return `

The user wants objective MCQ (A–D) questions ONLY. Use the MCQ template from the system message:
${mcqLine}
Do NOT use Markah:, Marking points:, or essay-style model answers for MCQ.
Output at least one full Soalan block before any other text.${scienceDiagramRule}`;
}

function subjectiveGenerationReminder(query: string, hits: RetrievedChunk[]): string {
  if (!isSubjectiveGenerationQuery(query)) return "";
  const marksGuide = buildPastPaperMarksGuidance(hits);
  return `

The user wants subjective (structured) questions. Use the subjective Soalan / EN / BM / Markah / Jawapan / Marking points template.
Assign each Markah: from past-paper mark patterns in the excerpts — not arbitrary defaults.
${marksGuide ? `\n${marksGuide}\n` : "\n(No past-paper mark samples in context — use typical SPM weights: 2–4 marks for short explain, 5–8 for KBAT/essay parts.)\n"}`;
}

function graphJsonReminder(subject: string | null | undefined, query: string): string {
  if (!shouldUseGraphJsonFlow(subject, query)) return bilingualStemReminder(subject);
  const subjectLabel = isPhysicsSubject(subject) ? "Physics" : "Math";
  return `

Subject is **${subjectLabel}**: use bilingual stems for every soalan (EN: on one line, BM: on the next line), then options A–D, then Jawapan: and Penjelasan: as usual. Penjelasan should be in Bahasa Melayu when the rest is mixed EN/BM.
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

export async function generateWithRag(
  input: GenerateRagInput,
): Promise<GenerateRagResult> {
  const topK = input.topK ?? 8;
  const retrieval = await retrieveChunks({
    query: input.query,
    subject: input.subject ?? undefined,
    topK,
  });
  const hits = retrieval.chunks;

  if (hits.length === 0) {
    let answerRaw = await chatCompletion([
      { role: "system", content: `${systemPromptForNoRetrievalFallback(input.subject)}\n\n${NO_RETRIEVAL_GENERAL_PROMPT}` },
      {
        role: "user",
        content: `User request:
${input.query}

Follow the appropriate template from the system message (MCQ vs subjective). Use general SPM knowledge only, and output the final question blocks directly with no preamble.${graphJsonReminder(input.subject, input.query)}${mcqFormatReminder(input.query, input.subject)}${subjectiveGenerationReminder(input.query, [])}`,
      },
    ], { subject: input.subject, query: input.query });
    answerRaw = ensureNoRetrievalParseableAnswer(input.query, input.subject, answerRaw);
    const answerWithSvg = shouldPostProcessMathSvg(input.subject)
      ? enrichMathAnswerWithSvg(answerRaw)
      : answerRaw;
    const { answer: answerRaw2, diagrams: diagramsFromBlock } = extractDiagramBlock(answerWithSvg);
    const answer = promoteBiologyDiagramFlags(
      normalizeBilingualAnswer(answerRaw2),
      input.query,
      input.subject,
    );
    const structuredDiagrams: StructuredQuestionDiagram[] = [];
    const diagrams = buildGraphDiagrams(input, answer, diagramsFromBlock);
    const diagram = diagrams[0];
    const generatedImages = await buildGeneratedImages(input, answer);
    return { answer, diagram, diagrams, structuredDiagrams, sources: [], sourcePageImages: [], generatedImages };
  }

  const contextBlocks = hits.map((h, i) => formatGeneratorContextBlock(h, i + 1));

  const userContent = `Below are short excerpts from the syllabus/material (numbered for your use only; never show these numbers or any reference to them in your reply):\n\n${contextBlocks.join("\n\n---\n\n")}\n\nUser request:\n${input.query}\n\nFollow the appropriate template from the system message (MCQ vs subjective).${graphJsonReminder(input.subject, input.query)}${mcqFormatReminder(input.query, input.subject)}${subjectiveGenerationReminder(input.query, hits)}`;

  const answerRaw = await chatCompletion([
    { role: "system", content: systemPromptForSubject(input.subject) },
    { role: "user", content: userContent },
  ], { subject: input.subject, query: input.query });
  const answerWithSvg = shouldPostProcessMathSvg(input.subject)
    ? enrichMathAnswerWithSvg(answerRaw)
    : answerRaw;
  const { answer: answerRaw2, diagrams: diagramsFromBlock } = extractDiagramBlock(answerWithSvg);
  const answer = promoteBiologyDiagramFlags(
    normalizeBilingualAnswer(answerRaw2),
    input.query,
    input.subject,
  );
  const structuredDiagrams: StructuredQuestionDiagram[] = [];
  const diagrams = buildGraphDiagrams(input, answer, diagramsFromBlock);
  const diagram = diagrams[0];

  const sourcePageImages: GenerateRagResult["sourcePageImages"] = [];
  const generatedImages = await buildGeneratedImages(input, answer);

  return {
    answer,
    diagram,
    diagrams,
    structuredDiagrams,
    sources: hits.map((h) => ({
      documentId: Number(h.textbookId) || 0,
      chunkIndex: h.chunkIndex,
      title: h.title ?? null,
      subject: h.subject ?? null,
      sourceType: h.sourceType,
      excerpt: h.content.slice(0, 400) + (h.content.length > 400 ? "…" : ""),
      distance: h.score ?? 0,
    })),
    sourcePageImages,
    generatedImages,
  };
}
