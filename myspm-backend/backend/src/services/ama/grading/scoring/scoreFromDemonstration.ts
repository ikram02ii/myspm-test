import type { MarkBreakdownItem } from "../../types";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "../shared/types";
import { isCalculationIntent } from "../case/calculationAcfPolicy";
import { isFixedSetRecallStem } from "../case/acfFinalizePolicy";
import { revokeUnitsLackingExclusiveEvidence } from "../matching/coreConceptMatch";
import { scoreCalculationDemonstration } from "./scoreCalculation";
import {
  assertZeroCreditWeightInvariant,
  scoreCoverageChain,
  type ChainWalkResult,
} from "./coverageChainScorer";

export type ScoreResult = {
  score: number;
  markBreakdown: MarkBreakdownItem[];
  matchedLabels: string[];
  missingLabels: string[];
  chainWalk?: ChainWalkResult;
};

function creditUnits(acf: AssessmentCaseFile) {
  return acf.units.filter((u) => u.creditWeight > 0);
}

function unitAwarded(udm: UnderstandingDemonstration, unitId: string): boolean {
  return udm.unitsDemonstrated.some((d) => d.unitId === unitId && d.valid);
}

function breakdownForUnits(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  awardedUnitIds: Set<string>,
  chainWalk?: ChainWalkResult,
): MarkBreakdownItem[] {
  return creditUnits(acf).map((unit) => {
    const awarded = awardedUnitIds.has(unit.id);
    const demo = udm.unitsDemonstrated.find((d) => d.unitId === unit.id && d.valid);
    const blocked = chainWalk?.blockedUnits.includes(unit.id) ?? false;
    let reason: string;
    if (awarded) {
      reason = demo?.quote ? `Demonstrated: "${demo.quote}"` : "Understanding demonstrated.";
    } else if (blocked) {
      reason = "Mentioned but not credited — earlier link in the explanation chain is missing.";
    } else {
      reason = udm.unitsMissing.find((g) => g.id === unit.id)?.reason ?? "Not demonstrated in the answer.";
    }
    return {
      idea: unit.content,
      marks: unit.creditWeight,
      awarded,
      rubricId: unit.id,
      matchMethod: awarded ? "llmVerifier" : undefined,
      reason,
    };
  });
}

function validateZeroWeightNeverCredited(acf: AssessmentCaseFile, awardedUnitIds: Set<string>): void {
  for (const unit of acf.units) {
    if (unit.creditWeight === 0 && awardedUnitIds.has(unit.id)) {
      throw new Error(
        `[scoreFromDemonstration] zero-weight invariant violated: unit ${unit.id} was credited`,
      );
    }
    assertZeroCreditWeightInvariant(unit.id, unit.creditWeight, awardedUnitIds.has(unit.id) ? unit.creditWeight : 0);
  }
}

/**
 * Score = sum of independently demonstrated credit units only.
 * studentAnswer is required for the exclusive-anchor clamp (compare/multi-point schemes).
 */
export function scoreFromDemonstration(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer = "",
): ScoreResult {
  const max = acf.maxScore;
  const rule = acf.markRule;
  const credit = creditUnits(acf);

  // Hard clamp against holistic LLM awards for independent-unit theory schemes.
  // Skip when: calculation, coverage_chain / ordered_stages, or no student text (unit harness).
  const skipCompetitiveClamp =
    isCalculationIntent(acf) ||
    rule.kind === "coverage_chain" ||
    rule.kind === "ordered_stages" ||
    !studentAnswer.trim();
  const clampedDemonstrated = skipCompetitiveClamp
    ? udm.unitsDemonstrated
    : revokeUnitsLackingExclusiveEvidence(studentAnswer, credit, udm.unitsDemonstrated);
  const clampedUdm: UnderstandingDemonstration = {
    ...udm,
    unitsDemonstrated: clampedDemonstrated,
    unitsMissing: credit
      .filter((u) => !clampedDemonstrated.some((d) => d.unitId === u.id && d.valid))
      .map((u) => ({
        id: u.id,
        kind: "unit" as const,
        label: u.content,
        reason:
          udm.unitsMissing.find((g) => g.id === u.id)?.reason ??
          "Required marking point not found in the student's answer.",
      })),
  };

  let score = 0;
  let awardedUnitIds = new Set<string>();
  let chainWalk: ChainWalkResult | undefined;

  if (isCalculationIntent(acf)) {
    const calc = scoreCalculationDemonstration(acf, clampedUdm);
    score = calc.score;
    awardedUnitIds = calc.awardedUnitIds;
  } else {
    switch (rule.kind) {
      case "count_distinct_units": {
        if (rule.openPool) {
          const demonstratedCredit = credit.filter((u) => unitAwarded(clampedUdm, u.id));
          score = Math.min(
            max,
            demonstratedCredit.reduce((sum, u) => sum + u.creditWeight, 0),
          );
          awardedUnitIds = new Set(demonstratedCredit.map((u) => u.id));
        } else {
          const demonstrated = credit.filter((u) => unitAwarded(clampedUdm, u.id));
          score = Math.min(
            max,
            demonstrated.reduce((sum, u) => sum + u.creditWeight, 0),
          );
          awardedUnitIds = new Set(demonstrated.map((u) => u.id));
        }
        break;
      }

      case "coverage_chain": {
        chainWalk = scoreCoverageChain(acf, clampedUdm);
        score = chainWalk.score;
        awardedUnitIds = new Set(chainWalk.creditedUnits);
        break;
      }

      case "ordered_stages": {
        const stages = credit.filter((u) => u.type === "stage");
        const ordered = stages.length > 0 ? stages : credit;
        const hit = ordered.filter((u) => unitAwarded(clampedUdm, u.id));
        score = Math.min(max, hit.length);
        awardedUnitIds = new Set(hit.map((u) => u.id));
        break;
      }

      case "paired_entities": {
        const dimensions = credit.filter((u) => u.type === "dimension" || u.type === "claim");
        const pool = dimensions.length > 0 ? dimensions : credit;
        const hit = pool.filter((u) => unitAwarded(clampedUdm, u.id));
        score = Math.min(max, hit.length);
        awardedUnitIds = new Set(hit.map((u) => u.id));
        break;
      }

      case "claim_plus_reason": {
        const demonstratedCredit = credit.filter((u) => unitAwarded(clampedUdm, u.id));
        score = Math.min(
          max,
          demonstratedCredit.reduce((sum, u) => sum + u.creditWeight, 0),
        );
        awardedUnitIds = new Set(demonstratedCredit.map((u) => u.id));
        break;
      }

      default:
        score = Math.min(max, clampedUdm.unitsDemonstrated.filter((d) => d.valid).length);
        awardedUnitIds = new Set(
          clampedUdm.unitsDemonstrated.filter((d) => d.valid).map((d) => d.unitId),
        );
    }
  }

  validateZeroWeightNeverCredited(acf, awardedUnitIds);

  if (
    !isCalculationIntent(acf) &&
    isFixedSetRecallStem(acf.question, acf.maxScore) &&
    clampedUdm.invalidClaims.length > 0
  ) {
    for (const claim of clampedUdm.invalidClaims) {
      const claimNorm = (claim.text || "").toLowerCase();
      if (!claimNorm) continue;
      for (const unit of credit) {
        if (!awardedUnitIds.has(unit.id)) continue;
        const demo = clampedUdm.unitsDemonstrated.find((d) => d.unitId === unit.id && d.valid);
        const hay = `${demo?.quote || ""} ${unit.content}`.toLowerCase();
        const claimTokens = claimNorm.split(/\W+/).filter((t) => t.length >= 4);
        const overlaps =
          claimTokens.length > 0 &&
          claimTokens.filter((t) => hay.includes(t)).length / claimTokens.length >= 0.5;
        if (overlaps || hay.includes(claimNorm)) {
          awardedUnitIds.delete(unit.id);
        }
      }
    }
    score = Math.min(
      max,
      credit.filter((u) => awardedUnitIds.has(u.id)).reduce((sum, u) => sum + u.creditWeight, 0),
    );
  }

  score = Math.max(0, Math.min(max, score));

  // Re-align awarded set after any wipe so breakdown matches final score.
  const markBreakdown = breakdownForUnits(acf, clampedUdm, awardedUnitIds, chainWalk);
  const matchedLabels = markBreakdown.filter((r) => r.awarded).map((r) => r.idea);
  const missingLabels = markBreakdown.filter((r) => !r.awarded).map((r) => r.idea);
  if (!chainWalk) {
    missingLabels.push(...clampedUdm.relationsMissing.map((g) => g.label));
  }

  // Final invariant: score must equal sum of awarded breakdown marks.
  const breakdownSum = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  score = Math.max(0, Math.min(max, breakdownSum));

  return { score, markBreakdown, matchedLabels, missingLabels, chainWalk };
}
