/**
 * Marking-point decomposition: turn a stem into independent assessable ideas
 * (one credit unit ≈ one mark), matching SPM examiner practice.
 *
 * Does NOT hardcode topic content — only structural rules from command words /
 * demand types and maxScore.
 */

import type { QuestionAnalysis, DemandType } from "../../types";

export type MarkingPointDemandKind =
  | "definition"
  | "fact_recall"
  | "reason_mechanism"
  | "contrast"
  | "importance_application"
  | "calculation_stage"
  | "general";

/** Map a demand / command signal to the kind of assessable idea it should produce. */
export function demandKindFromSignal(signal: string): MarkingPointDemandKind {
  const s = (signal || "").toLowerCase().trim();
  if (/\b(define|definition|takrif|meant\s+by)\b/.test(s)) return "definition";
  if (/\b(compare|contrast|differentiate|difference|bezakan|bandingkan|perbezaan)\b/.test(s)) {
    return "contrast";
  }
  if (/\b(calculate|kira|hitung)\b/.test(s)) return "calculation_stage";
  if (
    /\b(explain|describe|discuss|why|how|terangkan|huraikan|jelaskan|mengapa|bagaimana|account)\b/.test(s)
  ) {
    return "reason_mechanism";
  }
  if (/\b(important|importance|significance|peranan|kepentingan|useful|why\s+both)\b/.test(s)) {
    return "importance_application";
  }
  if (/\b(state|name|list|identify|give|nyatakan|namakan|senaraikan)\b/.test(s)) {
    return "fact_recall";
  }
  return "general";
}

function kindInstruction(kind: MarkingPointDemandKind): string {
  switch (kind) {
    case "definition":
      return "DEFINITION unit: one assessable defining idea (category + key distinguishing detail).";
    case "fact_recall":
      return "FACT / STATE unit: one explicit fact, term, or listed item required by the stem.";
    case "reason_mechanism":
      return "EXPLAIN unit: one complete idea with scientific reasoning (fact + because/so/therefore).";
    case "contrast":
      return "COMPARE unit: one clear difference (or one named side of a contrast) — not both sides fused into one mark when they can be awarded separately.";
    case "importance_application":
      return "IMPORTANCE / WHY unit: one assessable reason for significance, use, or consequence asked by the stem.";
    case "calculation_stage":
      return "CALCULATION: follow calculation stage policy (formula / substitution / working / final) — do not invent prose marking points.";
    default:
      return "GENERAL unit: one independently creditworthy idea required by the stem.";
  }
}

/**
 * Infer ordered demand kinds from compoundDemandTypes + stem text.
 * Falls back to a single kind from the leading command when not compound.
 */
export function inferMarkingPointDemandKinds(
  question: string,
  analysis?: Pick<QuestionAnalysis, "compoundDemandTypes" | "demandType" | "isCompoundQuestion" | "commandWord"> | null,
): MarkingPointDemandKind[] {
  const q = (question || "").trim();
  const kinds: MarkingPointDemandKind[] = [];

  const demandTypes = analysis?.compoundDemandTypes?.length
    ? analysis.compoundDemandTypes
    : analysis?.demandType
      ? [analysis.demandType]
      : [];

  for (const dt of demandTypes as DemandType[]) {
    const mapped = demandKindFromSignal(String(dt));
    if (!kinds.includes(mapped)) kinds.push(mapped);
  }

  // Stem also often encodes "importance / why both" without a separate DemandType.
  if (/\b(important|importance|significance|kepentingan|why\s+(?:both|they|it)|mengapa\s+(?:kedua|ia)\b)/i.test(q)) {
    if (!kinds.includes("importance_application")) kinds.push("importance_application");
  }

  // "difference between A and B" without an explicit compare demand detector hit.
  if (
    /\b(differences?\s+between|differentiate|compare|perbezaan\s+antara|bezakan)\b/i.test(q) &&
    !kinds.includes("contrast")
  ) {
    kinds.unshift("contrast");
  }

  if (kinds.length === 0) {
    kinds.push(demandKindFromSignal(analysis?.commandWord || q));
  }

  return kinds;
}

/**
 * Binding LLM guidance: decompose the stem into maxScore independent marking points.
 * Topic-agnostic — never embeds sample science content.
 */
export function buildMarkingPointDecompositionGuidance(
  question: string,
  maxScore: number,
  analysis?: Pick<
    QuestionAnalysis,
    "compoundDemandTypes" | "demandType" | "isCompoundQuestion" | "commandWord" | "questionType"
  > | null,
): string[] {
  const kinds = inferMarkingPointDemandKinds(question, analysis);
  const isCompound =
    Boolean(analysis?.isCompoundQuestion) ||
    kinds.length >= 2 ||
    /\b(?:and|dan)\b/i.test(question || "");

  const lines: string[] = [
    "MARKING-POINT DECOMPOSITION (binding — SPM examiner style):",
    "Transform the required answer into independent assessable ideas — NOT a single paragraph blob.",
    "Each credit unit MUST be one piece of knowledge or reasoning that can earn a mark on its own.",
    `Create exactly ${maxScore} credit-bearing unit(s), each creditWeight=1 (sum MUST equal ${maxScore}).`,
    "Do NOT split one idea into multiple marks. Do NOT merge two stem-required ideas into one mark.",
    "Store each unit separately (unique id + content + aliases) so partial credit and missing-point feedback work.",
  ];

  if (isCompound) {
    lines.push(
      "COMPOUND STEM: the question asks for more than one kind of response — cover EVERY demand as its own mark(s).",
      "Walk the stem left-to-right: each distinct required idea gets its own unit before writing any exemplar sentence.",
    );
  }

  lines.push("Demand → unit kind mapping for THIS stem:");
  for (const kind of kinds) {
    lines.push(`- ${kindInstruction(kind)}`);
  }

  if (kinds.includes("contrast") && maxScore >= 2) {
    lines.push(
      "When the stem asks to explain/state a difference between two named entities for ≥2 marks: prefer ONE unit per entity (or per named contrast), not one dual-side paragraph worth a single mark.",
    );
  }

  if (kinds.includes("importance_application") || kinds.includes("reason_mechanism")) {
    lines.push(
      "If the stem also asks why / importance / significance: that MUST be a separate credit unit from any definition or contrast units.",
    );
  }

  lines.push(
    "Model-answer exemplars MUST be written one-to-one with these units (same order) so students see how each mark is earned.",
  );

  return lines;
}
