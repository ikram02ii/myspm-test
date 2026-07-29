/**
 * Artifact ownership for the open-ended marking agents.
 *
 * Single place that decides which source wins for:
 * - official model answer
 * - official marking-point labels
 * - calculation stage-plan identity
 *
 * Presentation (localize / UI) and generation Jawapan must yield to these rules.
 */

import { extractJawapanText } from "../case/markSchemeInference";
import { formatMarkSchemePointsAsModelAnswer } from "../feedback/modelAnswerFeedbackFormatPolicy";
import {
  inferCalculationPolicy,
  isCalculationIntent,
  looksLikeStructuredCalculationModelAnswer,
  resolveCalculationDomain,
  showWorkingStagePlan,
} from "./calculationAcfPolicy";
import type { AssessmentCaseFile } from "../shared/types";

export type ModelAnswerSource =
  | "case_structured"
  | "case_reference"
  | "jawapan_structured"
  | "jawapan"
  | "mark_scheme_format"
  | "none";

export type OfficialModelAnswerResolution = {
  text: string;
  source: ModelAnswerSource;
};

export type GradeDecisionLog = {
  caseId: string;
  intentFamily: string;
  intentCategory: string;
  isCalculation: boolean;
  /** Phase 2: which open-ended agent awarded marks. */
  markingAgent: "theory" | "calculation";
  maSource: ModelAnswerSource;
  stagePlanId: string | null;
  markingPointCount: number;
  usedSavedCase: boolean;
  /** Client questionType hint when provided (diagnostics; does not override case). */
  clientQuestionTypeHint?: string | null;
};

/**
 * Stable id for the calc stage plan actually in force (policy tables, not LLM).
 * Example: `chemistry:show_working:2` or `physics:answer_only:1`.
 */
export function resolveStagePlanId(acf: AssessmentCaseFile): string | null {
  if (!isCalculationIntent(acf)) return null;
  const domain = resolveCalculationDomain(acf.subject);
  const policy =
    acf.markRule.calcPolicy ??
    inferCalculationPolicy(acf.question, acf.maxScore, acf.subject);
  const stages =
    policy === "answer_only"
      ? [{ label: "final", weight: acf.maxScore }]
      : showWorkingStagePlan(acf.maxScore, domain);
  const stageKey = stages.map((s) => `${s.label}:${s.weight}`).join("|");
  return `${domain}:${policy}:${acf.maxScore}:${stageKey}`;
}

/** Credit-bearing marking point labels from the assessment case only. */
export function officialMarkingPointLabels(acf: AssessmentCaseFile): string[] {
  return acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content);
}

/**
 * Resolve the official model answer for display and for evaluator reference.
 *
 * Ownership rules:
 * - Calculation: case reference wins. Generation Jawapan may win only if it is
 *   already structured (Formula/Working/Final) and the case has no structured MA.
 * - Theory: case reference wins when present; Jawapan seeds only if case is empty.
 * - Last resort: format official marking-point labels (never invent new criteria).
 */
export function resolveOfficialModelAnswer(params: {
  question: string;
  acf: AssessmentCaseFile;
  /** Case reference and/or sourceRef fallback already merged by caller. */
  caseReference: string;
}): OfficialModelAnswerResolution {
  const caseRef = params.caseReference.trim();
  const jawapan = extractJawapanText(params.question)?.trim() || "";
  const points = officialMarkingPointLabels(params.acf);
  const isCalc = isCalculationIntent(params.acf);

  if (isCalc) {
    if (looksLikeStructuredCalculationModelAnswer(caseRef)) {
      return { text: caseRef, source: "case_structured" };
    }
    if (looksLikeStructuredCalculationModelAnswer(jawapan)) {
      return { text: jawapan, source: "jawapan_structured" };
    }
    if (caseRef) {
      return { text: caseRef, source: "case_reference" };
    }
    if (jawapan) {
      return { text: jawapan, source: "jawapan" };
    }
    const formatted = formatMarkSchemePointsAsModelAnswer(points, params.question);
    return formatted
      ? { text: formatted, source: "mark_scheme_format" }
      : { text: "", source: "none" };
  }

  // Theory / diagram-text: locked case exemplar beats generation draft.
  if (caseRef) {
    return { text: caseRef, source: "case_reference" };
  }
  if (jawapan) {
    return { text: jawapan, source: "jawapan" };
  }
  const formatted = formatMarkSchemePointsAsModelAnswer(points, params.question);
  return formatted
    ? { text: formatted, source: "mark_scheme_format" }
    : { text: "", source: "none" };
}

export function buildGradeDecisionLog(params: {
  caseId: string;
  acf: AssessmentCaseFile;
  maSource: ModelAnswerSource;
  usedSavedCase: boolean;
  markingAgent: "theory" | "calculation";
  clientQuestionTypeHint?: string | null;
}): GradeDecisionLog {
  return {
    caseId: params.caseId,
    intentFamily: params.acf.intent.family,
    intentCategory: params.acf.intent.category,
    isCalculation: isCalculationIntent(params.acf),
    markingAgent: params.markingAgent,
    maSource: params.maSource,
    stagePlanId: resolveStagePlanId(params.acf),
    markingPointCount: params.acf.units.filter((u) => u.creditWeight > 0).length,
    usedSavedCase: params.usedSavedCase,
    clientQuestionTypeHint: params.clientQuestionTypeHint ?? null,
  };
}
