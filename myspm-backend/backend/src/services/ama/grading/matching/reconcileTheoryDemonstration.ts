/**
 * Theory evidence validation after LLM evaluateUnderstanding.
 *
 * Pipeline (P0):
 *   LLM proposes ticks → gate already ran inside evaluate → here we only
 *   REVOKE unsupported ticks and competitively assign. No mark recovery,
 *   no partial-credit floor, no meaning-LLM rescue awards.
 */

import { stripUnsubstantiatedDemonstrations } from "./udmEvidenceGate";
import {
  studentAnswerContainsDistinctiveRubricToken,
  studentAnswerCoversIdea,
} from "./gradingFairness";
import { isCalculationIntent } from "../case/calculationAcfPolicy";
import {
  assignDemonstrationsCompetitively,
  quoteStrictlyGroundedInStudentAnswer,
  studentCoversUnitCore,
} from "./coreConceptMatch";
import type { AssessmentCaseFile, EvidenceUnit, UnderstandingDemonstration } from "../shared/types";

function studentShowsUnitEvidence(studentText: string, unit: EvidenceUnit): boolean {
  const text = (studentText || "").trim();
  if (!text) return false;
  if (studentAnswerContainsDistinctiveRubricToken(text, unit.content, unit.aliases)) return true;
  if (studentCoversUnitCore(text, unit)) return true;
  if (studentAnswerCoversIdea(text, unit.content)) return true;
  return (unit.aliases ?? []).some((a) => Boolean(a) && studentAnswerCoversIdea(text, a));
}

function isCompareDifferenceStem(question: string): boolean {
  return /\b(difference|bezakan|bandingkan|compare|differentiate)\b.*\b(between|antara|dan)\b/i.test(question);
}

function mentionsBothCompareSides(studentAnswer: string, units: EvidenceUnit[]): boolean {
  if (units.length < 2) return true;
  return (
    units.filter(
      (u) =>
        studentAnswerContainsDistinctiveRubricToken(studentAnswer, u.content, u.aliases) ||
        u.aliases.some((a) => studentAnswerContainsDistinctiveRubricToken(studentAnswer, a, [])),
    ).length >= 2
  );
}

/**
 * Revoke ticks that lack grounded evidence for their unit.
 * Applies to every awarded tick (including single-point) — no soft floors.
 */
function revokeUnsupportedCredits(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): UnderstandingDemonstration {
  const creditById = new Map(acf.units.filter((u) => u.creditWeight > 0).map((u) => [u.id, u]));
  let demonstrated = udm.unitsDemonstrated.map((d) => {
    if (!d.valid) return d;
    const unit = creditById.get(d.unitId);
    if (!unit) return { ...d, valid: false };

    const quote = d.quote.trim();
    const grounded = quote.length > 0 && quoteStrictlyGroundedInStudentAnswer(quote, studentAnswer);
    if (!grounded) {
      return { ...d, valid: false };
    }
    if (!studentShowsUnitEvidence(quote, unit)) {
      return { ...d, valid: false };
    }
    return d;
  });

  const validCount = () => demonstrated.filter((d) => d.valid && creditById.has(d.unitId)).length;

  // Compare/difference stem: both sides must be explicitly named for 2+ ticks.
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  if (
    isCompareDifferenceStem(acf.question) &&
    validCount() >= 2 &&
    !mentionsBothCompareSides(studentAnswer, creditUnits)
  ) {
    const first = demonstrated.find((d) => d.valid);
    if (first) {
      demonstrated = demonstrated.map((d) =>
        d.unitId === first.unitId ? d : d.valid ? { ...d, valid: false } : d,
      );
    }
  }

  const assigned = assignDemonstrationsCompetitively({
    studentAnswer,
    creditUnits,
    demonstrated,
  });

  return {
    ...udm,
    unitsDemonstrated: assigned,
    unitsMissing: creditUnits
      .filter((u) => !assigned.some((d) => d.unitId === u.id && d.valid))
      .map((u) => ({
        id: u.id,
        kind: "unit" as const,
        label: u.content,
        reason: "Required marking point not found in the student's answer.",
      })),
  };
}

export async function reconcileUnderstandingDemonstration(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
}): Promise<UnderstandingDemonstration> {
  if (isCalculationIntent(params.acf)) return params.udm;

  const revoked = revokeUnsupportedCredits(params.acf, params.udm, params.studentAnswer);
  return stripUnsubstantiatedDemonstrations(params.acf, revoked, params.studentAnswer);
}
