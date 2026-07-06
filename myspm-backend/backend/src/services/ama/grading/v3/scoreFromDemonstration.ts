import type { MarkBreakdownItem } from "../../types";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";
import { isCalculationIntent } from "./calculationAcfPolicy";
import { isFixedSetRecallStem } from "./acfFinalizePolicy";
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

function relationAwarded(udm: UnderstandingDemonstration, relationId: string): boolean {
  return udm.relationsDemonstrated.some((d) => d.relationId === relationId);
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

export function scoreFromDemonstration(acf: AssessmentCaseFile, udm: UnderstandingDemonstration): ScoreResult {
  const max = acf.maxScore;
  const rule = acf.markRule;
  let score = 0;
  let awardedUnitIds = new Set<string>();
  let chainWalk: ChainWalkResult | undefined;

  if (isCalculationIntent(acf)) {
    const calc = scoreCalculationDemonstration(acf, udm);
    score = calc.score;
    awardedUnitIds = calc.awardedUnitIds;
  } else switch (rule.kind) {
    case "count_distinct_units": {
      const validDemonstrated = udm.unitsDemonstrated.filter((d) => d.valid);
      if (rule.openPool) {
        const demonstratedCredit = creditUnits(acf).filter((u) => unitAwarded(udm, u.id));
        score = Math.min(
          max,
          demonstratedCredit.reduce((sum, u) => sum + u.creditWeight, 0),
        );
        awardedUnitIds = new Set(demonstratedCredit.map((u) => u.id));
      } else {
        const credit = creditUnits(acf);
        const demonstrated = credit.filter((u) => unitAwarded(udm, u.id));
        score = Math.min(
          max,
          demonstrated.reduce((sum, u) => sum + u.creditWeight, 0),
        );
        awardedUnitIds = new Set(demonstrated.map((u) => u.id));
      }
      break;
    }

    case "coverage_chain": {
      chainWalk = scoreCoverageChain(acf, udm);
      score = chainWalk.score;
      awardedUnitIds = new Set(chainWalk.creditedUnits);
      break;
    }

    case "ordered_stages": {
      const stages = creditUnits(acf).filter((u) => u.type === "stage");
      const ordered = stages.length > 0 ? stages : creditUnits(acf);
      const hit = ordered.filter((u) => unitAwarded(udm, u.id));
      score = Math.min(max, hit.length);
      awardedUnitIds = new Set(hit.map((u) => u.id));
      break;
    }

    case "paired_entities": {
      const dimensions = creditUnits(acf).filter((u) => u.type === "dimension" || u.type === "claim");
      const pool = dimensions.length > 0 ? dimensions : creditUnits(acf);
      const hit = pool.filter((u) => unitAwarded(udm, u.id));
      score = Math.min(max, hit.length);
      awardedUnitIds = new Set(hit.map((u) => u.id));
      break;
    }

    case "claim_plus_reason": {
      const claims = creditUnits(acf).filter((u) => u.type === "claim");
      const justifications = creditUnits(acf).filter((u) => u.type === "justification");
      const claimHit = claims.filter((u) => unitAwarded(udm, u.id)).length;
      const justHit = justifications.filter((u) => unitAwarded(udm, u.id)).length;
      const justRelations = acf.relations.filter((r) => r.type === "justifies" && r.requiredForMarks);
      const relHit = justRelations.some((r) => relationAwarded(udm, r.id));

      if (claims.length === 0 && justifications.length === 0) {
        score = Math.min(max, udm.unitsDemonstrated.filter((d) => d.valid).length);
        awardedUnitIds = new Set(udm.unitsDemonstrated.filter((d) => d.valid).map((d) => d.unitId));
      } else if (claimHit >= 1 && (justHit >= 1 || relHit)) {
        score = max;
        for (const u of creditUnits(acf)) {
          if (unitAwarded(udm, u.id)) awardedUnitIds.add(u.id);
        }
      } else if (claimHit >= 1) {
        score = Math.min(max, Math.max(1, Math.floor(max / 2)));
        for (const u of claims) {
          if (unitAwarded(udm, u.id)) awardedUnitIds.add(u.id);
        }
      }
      break;
    }

    default:
      score = Math.min(max, udm.unitsDemonstrated.filter((d) => d.valid).length);
      awardedUnitIds = new Set(udm.unitsDemonstrated.filter((d) => d.valid).map((d) => d.unitId));
  }

  validateZeroWeightNeverCredited(acf, awardedUnitIds);

  if (
    !isCalculationIntent(acf) &&
    isFixedSetRecallStem(acf.question, acf.maxScore) &&
    udm.invalidClaims.length > 0
  ) {
    score = 0;
    awardedUnitIds.clear();
  }

  score = Math.max(0, Math.min(max, score));

  const markBreakdown = breakdownForUnits(acf, udm, awardedUnitIds, chainWalk);
  const matchedLabels = markBreakdown.filter((r) => r.awarded).map((r) => r.idea);
  const missingLabels = markBreakdown.filter((r) => !r.awarded).map((r) => r.idea);
  if (!chainWalk) {
    missingLabels.push(...udm.relationsMissing.map((g) => g.label));
  }

  return { score, markBreakdown, matchedLabels, missingLabels, chainWalk };
}
