/**
 * Question-generation post-processing (diagrams, marks hints) — separate from marking agent.
 */

import { generateImage } from "./llmProvider";
import {
  generateEducationalDiagramsForAnswer,
  isScienceDiagramSubject,
  shouldGenerateEducationalDiagrams,
} from "./educationalDiagramService";
import {
  buildPastPaperMarksGuidance,
  isMcqGenerationQuery,
  isSubjectiveGenerationQuery,
} from "../rag/retrieval/pastPaperMarksHints";
import type { RetrievedChunk } from "../rag/types";
import { enrichMathAnswerWithSvg } from "./mathSvg";

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

export type GenerateImageItem = {
  url: string;
  prompt: string;
  questionIndex?: number;
};

export type FinalizeGenerateAnswerInput = {
  query: string;
  subject?: string | null;
  generateImage?: boolean;
  imagePrompt?: string | null;
};

export type FinalizeGenerateAnswerResult = {
  answer: string;
  diagram?: GenerateRagDiagram;
  diagrams?: GenerateRagDiagram[];
  generatedImages: GenerateImageItem[];
};

function normalizeBilingualAnswer(answer: string): string {
  return answer.replace(/(EN:\s*[^\n]+?)\s+(BM:)/gi, "$1\n$2");
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
    questionIndex:
      typeof obj.questionIndex === "number" && Number.isInteger(obj.questionIndex) && obj.questionIndex > 0
        ? obj.questionIndex
        : undefined,
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
  const wantsGraph = /\b(graph|graphs|plot|chart|line|linear|coordinate|cartesian|diagram|rajah|graf|motion)\b/i.test(
    query,
  );
  if (!wantsGraph) return undefined;

  const match = query.match(/y\s*=\s*([+-]?\s*(?:\d+(?:\.\d+)?)?)\s*x\s*([+-]\s*\d+(?:\.\d+)?)?/i);
  const m = match ? numberFromToken(match[1]) : null;
  const c = match ? (numberFromToken(match[2]) ?? 0) : 0;

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

function shouldPostProcessMathSvg(subject: string | null | undefined): boolean {
  return subject?.trim() === "Math";
}

function buildMathDiagrams(
  input: FinalizeGenerateAnswerInput,
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

async function buildGeneratedImages(
  input: FinalizeGenerateAnswerInput,
  answer: string,
): Promise<GenerateImageItem[]> {
  const subject = input.subject?.trim() ?? "";
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

export function formatGeneratorContextBlock(chunk: RetrievedChunk, index: number): string {
  const meta: string[] = [];
  if (chunk.chapter?.trim()) meta.push(`chapter=${chunk.chapter.trim()}`);
  if (chunk.sourceType === "past_paper") {
    if (chunk.questionRef) meta.push(`ref=${chunk.questionRef}`);
    if (typeof chunk.maxMarks === "number") meta.push(`stored marks=${chunk.maxMarks}`);
  }
  const header = meta.length > 0 ? `[${index}] (${meta.join(", ")})\n` : `[${index}]\n`;
  return `${header}${chunk.content}`;
}

export function buildGenerationReminders(
  query: string,
  subject: string | null | undefined,
  hits: RetrievedChunk[],
  opts?: { includeMathDiagramJson?: boolean },
): string {
  const parts: string[] = [];

  if (isMcqGenerationQuery(query)) {
    const isScience = Boolean(subject && isScienceDiagramSubject(subject));
    const scienceDiagramRule = isScience
      ? `

Science diagram rule: After the BM: line and BEFORE the first A. option line, add exactly one line:
Perlu rajah: Tidak
or
Perlu rajah: Ya
Use Ya only if a diagram genuinely helps answer that question. Most questions should be Perlu rajah: Tidak.`
      : "";
    parts.push(`
The user wants objective MCQ (A–D) questions ONLY. Use the MCQ template from the system message.
Do NOT use Markah:, Marking points:, or essay-style model answers for MCQ.${scienceDiagramRule}`);
  }

  if (isSubjectiveGenerationQuery(query)) {
    const marksGuide = buildPastPaperMarksGuidance(hits);
    parts.push(`
The user wants subjective (structured) questions. Use Markah: calibrated from past-paper excerpts.
${marksGuide ? `\n${marksGuide}\n` : ""}`);
  }

  if (opts?.includeMathDiagramJson !== false && subject?.trim() === "Math") {
    parts.push(`
For Math graph questions, append after all Soalan blocks:
DIAGRAM_JSON_START
{"diagrams":[{"questionIndex":1,"type":"line-chart","title":"...","xAxisLabel":"x","yAxisLabel":"y","points":[{"x":0,"y":0},{"x":1,"y":2},{"x":2,"y":4}]}]}
DIAGRAM_JSON_END
(valid JSON only; one object per graph-based question)`);
  }

  return parts.join("");
}

export async function finalizeGeneratedAnswer(
  input: FinalizeGenerateAnswerInput,
  answerRaw: string,
): Promise<FinalizeGenerateAnswerResult> {
  const withSvg = shouldPostProcessMathSvg(input.subject) ? enrichMathAnswerWithSvg(answerRaw) : answerRaw;
  const { answer: stripped, diagrams: diagramsFromBlock } = extractDiagramBlock(withSvg);
  const answer = normalizeBilingualAnswer(stripped);
  const diagrams = buildMathDiagrams(input, answer, diagramsFromBlock);
  const diagram = diagrams[0];
  const generatedImages = await buildGeneratedImages(input, answer);

  return { answer, diagram, diagrams: diagrams.length > 0 ? diagrams : undefined, generatedImages };
}
