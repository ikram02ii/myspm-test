/**
 * Diagram / image / figure questions: vision context builds the rubric only;
 * marks require explicit wording in the student's written answer.
 */

import type { DiagramContext } from "./types";

const VISUAL_QUESTION_RE =
  /\b(diagram|figure|fig\.?\s*\d|graph|chart|table|image|photo|micrograph|microscopy|flowchart|flow\s*chart|apparatus|rajah|graf|jadual|gambar|labelled|labeled|label\s+[A-P]\b|structure\s+shown|based\s+on\s+the\s+(?:diagram|figure|graph|table|image)|refer\s+to\s+the\s+(?:diagram|figure|graph|table)|according\s+to\s+the\s+(?:diagram|figure|graph|table)|rujuk\s+rajah|berdasarkan\s+rajah|lihat\s+rajah|dalam\s+rajah|pada\s+rajah)\b/i;

/** Practice-set stems: diagram intended for this item (mobile may also send diagramImageUrl). */
const PRACTICE_DIAGRAM_FLAG_RE =
  /(?:Perlu rajah|Diagram needed|Need diagram|Rajah diperlukan)\s*:\s*(?:ya|yes|y)\b/i;

export const VISUAL_FIGURE_REVOKE_REASON =
  "Marks require the scientific point in your written words — describing or pointing at the diagram/figure is not credited.";

export const DIAGRAM_IMAGE_EVIDENCE_LINES = [
  "DIAGRAM / IMAGE / FIGURE QUESTIONS (mandatory when the stem or an attached figure applies):",
  "1. Use the diagram, labelled figure, graph, table, microscopy image, flowchart, apparatus drawing, or chemical/biological structure ONLY to understand the question and to shape expected rubric points.",
  "2. The diagram must NEVER be treated as evidence that the student knows a concept — vision labels, arrows, and summaries are not the student's answer.",
  "3. Award marks ONLY for concepts explicitly stated or clearly conveyed in the student's written answer text (typed or OCR).",
  "4. Do NOT infer structure names, functions, labels, relationships, processes, values read from a graph, or scientific terms from the figure if they are absent from the student's response.",
  "5. If the student only points at or describes the figure without naming the required term/mechanism/value in words, withhold the mark.",
  "6. For label-the-diagram tasks: credit a label only when the student wrote that name/term in their answer (BM/EN synonyms OK) — not because the figure shows it.",
  "7. For graph/table reading: credit a value/trend only when the student stated it in their answer — do not award for a correct read you see on the figure alone.",
] as const;

export function questionReferencesVisual(question: string): boolean {
  return VISUAL_QUESTION_RE.test((question || "").trim());
}

export function practiceQuestionIncludesDiagram(question: string): boolean {
  return PRACTICE_DIAGRAM_FLAG_RE.test((question || "").trim());
}

/** True when this item is diagram/graph/figure-based (stem, practice flag, or attached image). */
export function gradingUsesVisualFigure(params: {
  question: string;
  diagramContextStructured?: DiagramContext | null;
  diagramImageUrl?: string | null;
  diagramImageBase64?: string | null;
}): boolean {
  const q = (params.question || "").trim();
  return (
    Boolean(params.diagramContextStructured) ||
    Boolean(params.diagramImageUrl?.trim()) ||
    Boolean(params.diagramImageBase64?.trim()) ||
    questionReferencesVisual(q) ||
    practiceQuestionIncludesDiagram(q)
  );
}

export function formatDiagramImageEvidenceBlock(): string {
  return DIAGRAM_IMAGE_EVIDENCE_LINES.join("\n");
}

/** Shown next to structured diagram JSON — clarifies role for the grader/verifier. */
export function formatDiagramContextRubricOnlyPreamble(confidence?: number): string {
  const lines = [
    "ATTACHED FIGURE (rubric context only — NOT student evidence):",
    "- Use this block to know what the question refers to and what mark points are reasonable.",
    "- Do NOT award marks because a label, structure, or value appears here unless the student wrote it in their answer.",
    "- Do NOT copy names, functions, or relationships from this block into matchedIdeas unless the same wording appears in the student answer.",
  ];
  if (typeof confidence === "number" && confidence < 0.5) {
    lines.push("- Vision confidence is low: rely on the student's words when the figure is ambiguous; never guess credit from the image.");
  }
  return lines.join("\n");
}
