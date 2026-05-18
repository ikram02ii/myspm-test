import { chatCompletion, generateImage } from "./llmProvider";
import { retrieveChunks } from "../rag/retrievalService";
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
Then A–D (option text may stay in English only if clearer; do not duplicate four long bilingual blocks).`;

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

function normalizeBilingualAnswer(answer: string): string {
  return answer.replace(/(EN:\s*[^\n]+?)\s+(BM:)/gi, "$1\n$2");
}

function bilingualStemReminder(subject: string | null | undefined): string {
  if (isForceBmSubject(subject)) return "";
  return `

Each soalan stem must be bilingual on two lines:
EN: <English stem>
BM: <Bahasa Melayu stem — new line, not same line as EN>
Then A–D, Jawapan:, Penjelasan:.`;
}

function mathBilingualReminder(subject: string | null | undefined): string {
  if (subject?.trim() !== "Math") return bilingualStemReminder(subject);
  return `

Subject is **Math**: use bilingual stems for every soalan (EN: on one line, BM: on the next line), then options A–D, then Jawapan: and Penjelasan: as usual. Penjelasan should be in Bahasa Melayu when the rest is mixed EN/BM.
If the user requests a diagram, prefer returning a JSON field "rajah_spec" (deterministic shape spec) and optionally "rajah_svg". Supported rajah_spec kinds are:
- {"kind":"triangle","points":[{"x":0,"y":0,"label":"A"},{"x":4,"y":0,"label":"B"},{"x":1,"y":3,"label":"C"}],"title":"..."}
- {"kind":"cartesian_line","xMin":0,"xMax":10,"yMin":0,"yMax":20,"points":[{"x":0,"y":0,"label":"P"},{"x":5,"y":10,"label":"Q"}],"title":"..."}
For every generated question, decide whether a line graph or coordinate graph would help. If one or more generated questions need a graph, generate the questions FIRST using the normal Soalan/Jawapan/Penjelasan format. Then append this block AFTER all questions and explanations:
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

function numberFromToken(token: string | undefined): number | null {
  if (token === undefined) return null;
  const normalized = token.replace(/\s+/g, "");
  if (normalized === "" || normalized === "+") return 1;
  if (normalized === "-") return -1;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function lineDiagramFromQuery(query: string): GenerateRagDiagram | undefined {
  const wantsGraph = /\b(graph|graphs|plot|chart|line|linear|coordinate|cartesian|diagram|rajah|graf|motion)\b/i.test(query);
  if (!wantsGraph) return undefined;

  const match = query.match(/y\s*=\s*([+-]?\s*(?:\d+(?:\.\d+)?)?)\s*x\s*([+-]\s*\d+(?:\.\d+)?)?/i);
  const m = match ? numberFromToken(match[1]) : null;
  const c = match ? numberFromToken(match[2]) ?? 0 : 0;

  const xs = [-2, -1, 0, 1, 2, 3];
  const hasEquation = m !== null;
  const gradient = m ?? 2;
  const cleanEquation = hasEquation
    ? `y = ${gradient === 1 ? "" : gradient === -1 ? "-" : gradient}x${c === 0 ? "" : c > 0 ? ` + ${c}` : ` - ${Math.abs(c)}`}`
    : "sample linear graph";

  return {
    type: "line-chart",
    questionIndex: 1,
    title: hasEquation ? `Graph of ${cleanEquation}` : "Graph for Soalan 1",
    subtitle: hasEquation ? "Generated from the Math query" : "Fallback graph for a graph-based Math question",
    equationLabel: hasEquation ? cleanEquation : "linear relationship",
    xAxisLabel: "x",
    yAxisLabel: "y",
    points: xs.map((x) => ({
      x,
      y: gradient * x + c,
      label: x === 0 ? "y-intercept" : undefined,
    })),
  };
}

function buildMathDiagrams(
  input: GenerateRagInput,
  answer: string,
  diagramsFromBlock: GenerateRagDiagram[],
): GenerateRagDiagram[] {
  if (!shouldPostProcessMathSvg(input.subject)) return [];
  if (diagramsFromBlock.length > 0) return diagramsFromBlock;
  const fromRajahSpec = diagramsFromRajahSpec(answer);
  if (fromRajahSpec.length > 0) return fromRajahSpec;
  const fallback = lineDiagramFromQuery(input.query);
  return fallback ? [fallback] : [];
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
    const answerRaw = await chatCompletion([
      { role: "system", content: systemPromptForSubject(input.subject) },
      {
        role: "user",
        content: `${input.query}\n\n(Note: No knowledge-base chunks were retrieved. Answer from general knowledge and clearly label uncertainty.)${mathBilingualReminder(input.subject)}`,
      },
    ], { subject: input.subject, query: input.query });
    const answerWithSvg = shouldPostProcessMathSvg(input.subject)
      ? enrichMathAnswerWithSvg(answerRaw)
      : answerRaw;
    const { answer: answerRaw2, diagrams: diagramsFromBlock } = extractDiagramBlock(answerWithSvg);
    const answer = normalizeBilingualAnswer(answerRaw2);
    const diagrams = buildMathDiagrams(input, answer, diagramsFromBlock);
    const diagram = diagrams[0];
    const generatedImages: GenerateRagResult["generatedImages"] = [];
    if (input.generateImage) {
      const prompt =
        input.imagePrompt?.trim() ||
        `Create a clean education-style diagram for this math question context: ${input.query}`;
      const urls = await generateImage(prompt);
      generatedImages.push(...urls.map((url) => ({ url, prompt })));
    }
    return { answer, diagram, diagrams, sources: [], sourcePageImages: [], generatedImages };
  }

  const contextBlocks = hits.map((h, i) => {
    const n = i + 1;
    return `[${n}]\n${h.content}`;
  });

  const userContent = `Below are short excerpts from the syllabus/material (numbered for your use only; never show these numbers or any reference to them in your reply):\n\n${contextBlocks.join("\n\n---\n\n")}\n\nUser request:\n${input.query}\n\nFollow the Soalan / A–D / Jawapan: / Penjelasan: template from the system message.${mathBilingualReminder(input.subject)}`;

  const answerRaw = await chatCompletion([
    { role: "system", content: systemPromptForSubject(input.subject) },
    { role: "user", content: userContent },
  ], { subject: input.subject, query: input.query });
  const answerWithSvg = shouldPostProcessMathSvg(input.subject)
    ? enrichMathAnswerWithSvg(answerRaw)
    : answerRaw;
  const { answer: answerRaw2, diagrams: diagramsFromBlock } = extractDiagramBlock(answerWithSvg);
  const answer = normalizeBilingualAnswer(answerRaw2);
  const diagrams = buildMathDiagrams(input, answer, diagramsFromBlock);
  const diagram = diagrams[0];

  const sourcePageImages: GenerateRagResult["sourcePageImages"] = [];
  const generatedImages: GenerateRagResult["generatedImages"] = [];
  if (input.generateImage) {
    const prompt =
      input.imagePrompt?.trim() ||
      `Create a clean education-style diagram for this ${input.subject ?? "SPM"} question context: ${input.query}`;
    const urls = await generateImage(prompt);
    generatedImages.push(...urls.map((url) => ({ url, prompt })));
  }

  return {
    answer,
    diagram,
    diagrams,
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
