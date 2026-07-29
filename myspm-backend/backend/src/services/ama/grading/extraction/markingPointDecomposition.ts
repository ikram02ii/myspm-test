/**
 * Marking-point decomposition: turn a stem into independent assessable ideas
 * (one credit unit ≈ one mark), matching SPM examiner practice.
 *
 * Hard rule for this product: there are NO half-marks. If a stem asks for two
 * independently assessable ideas (e.g. name + role), those MUST be two whole
 * marks — never fused into one unit the student can only half-satisfy for 0.
 *
 * Does NOT hardcode topic content — only structural rules from command words /
 * demand types, item counts, and maxScore.
 */

import type { QuestionAnalysis, DemandType } from "../../types";
import { parseStemRequiredItemCount } from "../case/acfFinalizePolicy";

export type MarkingPointDemandKind =
  | "definition"
  | "fact_recall"
  | "reason_mechanism"
  | "contrast"
  | "importance_application"
  | "calculation_stage"
  | "general";

/**
 * Direct map for QuestionAnalysis DemandType enum values. These are fed in via
 * compoundDemandTypes and are NOT command words, so the command-word regexes below
 * miss them (e.g. "explanation" has no \bexplain\b boundary). Without this, compound
 * stems collapse to "general" units and lose their EXPLAIN/FACT/CONTRAST shape.
 */
const DEMAND_TYPE_TO_KIND: Readonly<Record<string, MarkingPointDemandKind>> = {
  explanation: "reason_mechanism",
  recall: "fact_recall",
  definition: "definition",
  comparison: "contrast",
  application: "importance_application",
  example: "fact_recall",
  essay: "reason_mechanism",
  calculation: "calculation_stage",
  equation: "fact_recall",
  diagram_label: "fact_recall",
};

/** Map a demand / command signal to the kind of assessable idea it should produce. */
export function demandKindFromSignal(signal: string): MarkingPointDemandKind {
  const s = (signal || "").toLowerCase().trim();
  const enumKind = DEMAND_TYPE_TO_KIND[s];
  if (enumKind) return enumKind;
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

/** Demand kinds that require reasoning/detail beyond naming an item. */
const ELABORATION_KINDS: readonly MarkingPointDemandKind[] = [
  "reason_mechanism",
  "importance_application",
  "contrast",
  "definition",
];

/** Command words whose lead demand is "name the item(s)" (recall). */
const IDENTIFICATION_COMMANDS: ReadonlySet<string> = new Set([
  "identify",
  "name",
  "state",
  "list",
]);

/**
 * Second demand asks for role / function / purpose / contribution of the named
 * item(s) — not merely another recall list. Requires a conjunction so
 * "State the function of X" alone does NOT trigger identify+elaboration.
 */
const PAIRED_ROLE_FUNCTION_RE =
  /\b(?:and|dan)\b[\s\S]{0,100}?\b(?:(?:explain|describe|discuss|terangkan|huraikan|jelaskan|mengapa|bagaimana)|(?:(?:state|give|nyatakan|beri|namakan)\s+)?(?:their|its|the|each|ofa|of\s+each)?\s*(?:roles?|functions?|purpose|fungsi|peranan|tujuan|contribution|contributions)|(?:roles?|functions?|purpose|fungsi|peranan|tujuan)\s+(?:of\s+each|of\s+(?:the\s+)?(?:item|structure|tissue|organ|part|type)|in\b)|(?:how\s+each|how\s+they|how\s+it)\s+\w+)/i;

function hasPairedRoleOrFunctionDemand(question: string): boolean {
  return PAIRED_ROLE_FUNCTION_RE.test(question || "");
}

/**
 * True when the stem LEADS with an identification command (identify/name/state/list)
 * AND also asks for elaboration (explain/describe/why/role/function/…).
 *
 * These stems must credit the identification of each named item on its own —
 * otherwise a student who correctly names the items but omits the elaboration
 * scores 0, because every mark was folded into an elaboration unit (and this
 * product has no 0.5 marks).
 */
export function stemLeadsWithIdentificationPlusElaboration(
  question: string,
  analysis?: Pick<
    QuestionAnalysis,
    "compoundDemandTypes" | "demandType" | "isCompoundQuestion" | "commandWord"
  > | null,
): boolean {
  const cmd = (analysis?.commandWord || "").toLowerCase().trim();
  if (!IDENTIFICATION_COMMANDS.has(cmd)) return false;
  const kinds = inferMarkingPointDemandKinds(question, analysis);
  if (kinds.some((k) => ELABORATION_KINDS.includes(k))) return true;
  return hasPairedRoleOrFunctionDemand(question);
}

/**
 * Whole-mark allocation for identify/name/list + elaboration stems.
 *
 * Because there are no half-marks: each named item needs ONE mark for the name
 * and ONE mark for its role/function/explanation → recommendedMaxScore = 2 × N.
 */
export type WholeMarkAllocation = {
  isIdentifyPlusElaboration: boolean;
  itemCount: number;
  nameUnitCount: number;
  elaborationUnitCount: number;
  /** Total whole marks the stem should carry. */
  recommendedMaxScore: number;
};

export function planIdentifyPlusElaborationMarks(
  question: string,
  analysis?: Pick<
    QuestionAnalysis,
    "compoundDemandTypes" | "demandType" | "isCompoundQuestion" | "commandWord"
  > | null,
): WholeMarkAllocation | null {
  if (!stemLeadsWithIdentificationPlusElaboration(question, analysis)) return null;
  const parsed = parseStemRequiredItemCount(question);
  const itemCount = parsed != null && parsed >= 1 ? parsed : 1;
  const nameUnitCount = itemCount;
  const elaborationUnitCount = itemCount;
  return {
    isIdentifyPlusElaboration: true,
    itemCount,
    nameUnitCount,
    elaborationUnitCount,
    recommendedMaxScore: Math.min(10, Math.max(2, nameUnitCount + elaborationUnitCount)),
  };
}

/** Convenience: recommended whole-mark total, or null when not this stem shape. */
export function recommendWholeMarkCountForStem(
  question: string,
  analysis?: Pick<
    QuestionAnalysis,
    "compoundDemandTypes" | "demandType" | "isCompoundQuestion" | "commandWord"
  > | null,
): number | null {
  return planIdentifyPlusElaborationMarks(question, analysis)?.recommendedMaxScore ?? null;
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
      return "IMPORTANCE / ROLE / FUNCTION unit: one assessable role, function, purpose, or significance asked by the stem.";
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

  // "Identify/name … and state their roles/functions" — role/function is elaboration,
  // even when the second command word is still "state" (which alone would be recall).
  if (hasPairedRoleOrFunctionDemand(q) && !kinds.includes("importance_application")) {
    kinds.push("importance_application");
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
  const allocation = planIdentifyPlusElaborationMarks(question, analysis ?? null);

  const lines: string[] = [
    "MARKING-POINT DECOMPOSITION (binding — SPM examiner style):",
    "Transform the required answer into independent assessable ideas — NOT a single paragraph blob.",
    "Each credit unit MUST be one piece of knowledge or reasoning that can earn a mark on its own.",
    "WHOLE MARKS ONLY: there are no 0.5 marks. NEVER fuse two stem-required ideas into one unit — a student who supplies only half of a fused unit would wrongly score zero.",
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

  if (allocation) {
    lines.push(
      "IDENTIFY + ELABORATION STEM (name/identify/list + explain/role/function):",
      `This stem asks for ${allocation.itemCount} named item(s). Allocate whole marks as: ${allocation.nameUnitCount} identification unit(s) + ${allocation.elaborationUnitCount} role/function/explanation unit(s) = ${allocation.recommendedMaxScore} (use exactly ${maxScore} units for this case).`,
      "For EACH item: create a SEPARATE identification unit whose coreConcept is JUST the item's name (no function, role, reason, or mechanism) — naming the item correctly MUST earn that mark on its own.",
      "Then create a SEPARATE role/function/explanation unit for that item. NEVER fold the item name into the elaboration unit as the only way to earn a mark.",
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
      "If the stem also asks why / importance / significance / role / function: that MUST be a separate credit unit from any identification, definition, or contrast units.",
    );
  }

  lines.push(
    "Model-answer exemplars MUST be written one-to-one with these units (same order) so students see how each mark is earned.",
  );

  return lines;
}
