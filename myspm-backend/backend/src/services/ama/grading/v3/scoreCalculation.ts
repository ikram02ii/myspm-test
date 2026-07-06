import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";
import { unitDemonstrated } from "./coverageChainScorer";
import { isCalculationIntent } from "./calculationAcfPolicy";
import type { MarkBreakdownItem } from "../../types";

export function scoreCalculationDemonstration(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
): { score: number; awardedUnitIds: Set<string> } {
  const max = acf.maxScore;
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const answerOnly = acf.markRule.calcPolicy === "answer_only";

  if (answerOnly) {
    const answerUnit =
      creditUnits.find((u) => u.id === "calc_final") ??
      creditUnits.sort((a, b) => b.creditWeight - a.creditWeight)[0];
    if (answerUnit && unitDemonstrated(udm, answerUnit.id)) {
      return { score: max, awardedUnitIds: new Set([answerUnit.id]) };
    }
    return { score: 0, awardedUnitIds: new Set() };
  }

  // Order the credit-bearing units into formula → working → final sequence.
  // Calculation ACFs may be either stage-typed (`calc_s1`, `calc_s2`, …) or the
  // LLM's content units (`u1`, `u2`, …); both encode the sequence in the trailing
  // id number, so sort on that and fall back to id order.
  const seqNum = (id: string): number => {
    const m = /(\d+)\s*$/.exec(id);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  const ordered = [...creditUnits].sort((a, b) => {
    const na = seqNum(a.id);
    const nb = seqNum(b.id);
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id);
  });

  // Show-working: credit each demonstrated stage (formula, substitution, final).
  // No bonus for final-only — full marks require formula/working stages.
  const demonstrated = new Set<string>();
  for (const unit of ordered) {
    if (unitDemonstrated(udm, unit.id)) demonstrated.add(unit.id);
  }

  // Implied-formula rule (3+ stages): working stages imply the formula stage was applied.
  if (ordered.length >= 3) {
    const formulaStage = ordered[0];
    const workingStageDemonstrated = ordered
      .slice(1, ordered.length - 1)
      .some((u) => demonstrated.has(u.id));
    if (formulaStage && workingStageDemonstrated) {
      demonstrated.add(formulaStage.id);
    }
  }

  // 2-stage plan (formula + final): a substituted arithmetic line earns the formula mark too.
  if (ordered.length === 2) {
    const formulaStage = ordered[0];
    const finalStage = ordered[1];
    if (formulaStage && finalStage && !demonstrated.has(formulaStage.id)) {
      const finalDemo = udm.unitsDemonstrated.find(
        (d) => d.unitId === finalStage.id && d.valid,
      );
      if (finalDemo?.quote && /[=×x\*\/]/.test(finalDemo.quote) && /\d/.test(finalDemo.quote)) {
        demonstrated.add(formulaStage.id);
      }
    }
  }

  let score = 0;
  const awardedUnitIds = new Set<string>();
  for (const unit of ordered) {
    if (!demonstrated.has(unit.id)) continue;
    score += unit.creditWeight;
    awardedUnitIds.add(unit.id);
  }

  return { score: Math.max(0, Math.min(max, score)), awardedUnitIds };
}

export function calculationMarkBreakdown(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  awardedUnitIds: Set<string>,
): MarkBreakdownItem[] {
  return acf.units
    .filter((u) => u.creditWeight > 0)
    .map((unit) => {
      const awarded = awardedUnitIds.has(unit.id);
      const demo = udm.unitsDemonstrated.find((d) => d.unitId === unit.id && d.valid);
      // Awarded without a direct demonstration quote ⇒ credited via the
      // implied-formula rule (the formula/method is evidenced by the working).
      const impliedFromWorking = awarded && !demo;
      return {
        idea: unit.content,
        marks: unit.creditWeight,
        awarded,
        rubricId: unit.id,
        matchMethod: awarded ? "llmVerifier" : undefined,
        reason: awarded
          ? demo?.quote
            ? `Demonstrated: "${demo.quote}"`
            : impliedFromWorking
              ? "Credited: the formula/method is applied in the substitution/working shown."
              : "Calculation step demonstrated."
          : udm.unitsMissing.find((g) => g.id === unit.id)?.reason ?? "Not demonstrated.",
      };
    });
}
