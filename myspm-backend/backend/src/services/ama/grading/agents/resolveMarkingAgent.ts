/**
 * Marking-agent kind resolution.
 *
 * Assessment-case intent is the authority for open-ended routing.
 * That intent is produced from the Question Classification Agent's top-level
 * type (calculation vs theory/diagram/structured/other) — not stem regex.
 * Optional client `questionType` is diagnostics only.
 */

import { isCalculationIntent } from "../case/calculationAcfPolicy";
import type { AssessmentCaseFile } from "../shared/types";

export type OpenEndedMarkingAgentKind = "theory" | "calculation";

/** All product marking lanes (MCQ/speaking stay outside /rag/grade). */
export type MarkingAgentKind =
  | "mcq"
  | "theory"
  | "calculation"
  | "speaking"
  | "vision_extract";

/**
 * Resolve which open-ended agent runs for this assessment case.
 * Client hint is recorded by the caller; it does not flip calc ↔ theory here.
 */
export function resolveOpenEndedMarkingAgent(
  acf: AssessmentCaseFile,
): OpenEndedMarkingAgentKind {
  // Prefer explicit top-level classification when present on the locked case.
  const top = acf.intent.analysis?.topLevelQuestionType;
  if (top === "calculation") return "calculation";
  if (top === "theory" || top === "diagram" || top === "structured" || top === "other") {
    return "theory";
  }
  return isCalculationIntent(acf) ? "calculation" : "theory";
}

/** Soft parse of mobile/generation questionType for logs only. */
export function parseClientQuestionTypeHint(
  questionType: string | null | undefined,
): OpenEndedMarkingAgentKind | null {
  const t = (questionType ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/calculation|calculate|kiraan|hitung|(?:^|[^a-z])calc(?:[^a-z]|$)/i.test(t)) {
    return "calculation";
  }
  if (/theory|open_?ended|subjective|recall|explain|describe|compare|diagram|structured/i.test(t)) {
    return "theory";
  }
  return null;
}
