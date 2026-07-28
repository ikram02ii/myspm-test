/**
 * Marking-agent kind resolution (Phase 2).
 *
 * Assessment-case intent is the authority for open-ended routing.
 * Optional client `questionType` is a hint for diagnostics only — it must not
 * override a locked case's calculation vs theory family.
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
  return isCalculationIntent(acf) ? "calculation" : "theory";
}

/** Soft parse of mobile/generation questionType for logs only. */
export function parseClientQuestionTypeHint(
  questionType: string | null | undefined,
): OpenEndedMarkingAgentKind | null {
  const t = (questionType ?? "").trim().toLowerCase();
  if (!t) return null;
  // Inline regexes avoid shared RegExp lastIndex surprises across calls.
  if (/calculation|calculate|kiraan|hitung|(?:^|[^a-z])calc(?:[^a-z]|$)/i.test(t)) {
    return "calculation";
  }
  if (/theory|open_?ended|subjective|recall|explain|describe|compare/i.test(t)) {
    return "theory";
  }
  return null;
}
