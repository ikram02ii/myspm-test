import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";
import { unitDemonstrated } from "./coverageChainScorer";
import { isCalculationIntent } from "./calculationAcfPolicy";
import { isPhysicsCalculation } from "./calculationSubjectPolicy";
import { findFormulaStageUnitId } from "./calculationNumericMatch";

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

  const creditMeta = ordered.map((u) => ({ id: u.id, content: u.content }));
  const formulaStageId = findFormulaStageUnitId(creditMeta);
  const formulaStage = formulaStageId ? ordered.find((u) => u.id === formulaStageId) : undefined;
  const formulaExplicitlyWrong =
    formulaStage != null &&
    udm.unitsDemonstrated.some((d) => d.unitId === formulaStage.id && d.valid === false);

  // Written-only policy: each stage — including the formula/equation stage — is
  // credited ONLY when the student actually demonstrated it. We do NOT infer the
  // formula/equation mark from later working or a correct final answer: a
  // balanced equation or stated formula is a distinct artifact the student must
  // write to earn that mark. (Subject-agnostic; the evaluator/gate still credits
  // a genuinely written formula, e.g. "v = s/t", on its own.)

  // Physics: wrong formula — no credit for formula or any later stage.
  if (isPhysicsCalculation(acf) && formulaExplicitlyWrong && formulaStage) {
    demonstrated.delete(formulaStage.id);
    const formulaIdx = ordered.findIndex((u) => u.id === formulaStage.id);
    for (const unit of ordered.slice(formulaIdx + 1)) {
      demonstrated.delete(unit.id);
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
