/**
 * Always-on transparency logs for marking decisions (P0).
 * One structured log per grade: units, evidence kept/rejected, marks awarded.
 */

import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";
import type { MarkBreakdownItem } from "../../types";
import type { UdmTickFailReason } from "./udmTickTrace";

export type UnitDecisionLog = {
  unitId: string;
  content: string;
  creditWeight: number;
  awarded: boolean;
  evidenceQuote: string;
  reason: string;
};

export function buildUnitDecisionLogs(params: {
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  markBreakdown: MarkBreakdownItem[];
  failReasons?: Map<string, UdmTickFailReason>;
}): UnitDecisionLog[] {
  const credit = params.acf.units.filter((u) => u.creditWeight > 0);
  return credit.map((unit) => {
    const row = params.markBreakdown.find((r) => r.rubricId === unit.id);
    const demo = params.udm.unitsDemonstrated.find((d) => d.unitId === unit.id);
    const awarded = Boolean(row?.awarded);
    const fail = params.failReasons?.get(unit.id);
    let reason = row?.reason || "";
    if (!awarded && fail) {
      reason =
        fail === "grounded"
          ? "Rejected: quote not found as contiguous text in the student answer."
          : fail === "covers"
            ? "Rejected: evidence does not cover this marking unit (or belongs to another unit)."
            : fail === "verifier"
              ? "Rejected: meaning check failed for this unit."
              : fail === "distinctive"
                ? "Rejected: missing distinctive evidence for this unit."
                : fail === "unknown_unit"
                  ? "Rejected: unknown unit id."
                  : reason || "Rejected.";
    }
    if (awarded && !reason) {
      reason = demo?.quote
        ? `Awarded: grounded evidence "${demo.quote.slice(0, 120)}"`
        : "Awarded: unit demonstrated.";
    }
    return {
      unitId: unit.id,
      content: unit.content.slice(0, 200),
      creditWeight: unit.creditWeight,
      awarded,
      evidenceQuote: (demo?.quote || "").slice(0, 200),
      reason,
    };
  });
}

export function logMarkingDecision(params: {
  caseId?: string;
  agent: "theory" | "calculation";
  questionType: string;
  intentFamily: string;
  maxScore: number;
  score: number;
  studentAnswerPreview: string;
  units: UnitDecisionLog[];
}): void {
  const awarded = params.units.filter((u) => u.awarded);
  const rejected = params.units.filter((u) => !u.awarded);
  console.info("[grade:decision]", {
    caseId: params.caseId ?? null,
    agent: params.agent,
    questionType: params.questionType,
    intentFamily: params.intentFamily,
    maxScore: params.maxScore,
    score: params.score,
    studentAnswerPreview: params.studentAnswerPreview.slice(0, 160),
    markingUnits: params.units.map((u) => ({
      id: u.unitId,
      weight: u.creditWeight,
      content: u.content,
    })),
    evidenceFound: awarded.map((u) => ({
      unitId: u.unitId,
      quote: u.evidenceQuote,
      reason: u.reason,
    })),
    evidenceRejected: rejected.map((u) => ({
      unitId: u.unitId,
      quote: u.evidenceQuote,
      reason: u.reason,
    })),
    marksPerUnit: params.units.map((u) => ({
      unitId: u.unitId,
      awarded: u.awarded,
      marks: u.awarded ? u.creditWeight : 0,
    })),
  });
}
