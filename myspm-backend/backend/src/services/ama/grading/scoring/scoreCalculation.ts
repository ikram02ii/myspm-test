import type { AssessmentCaseFile, UnderstandingDemonstration } from "../shared/types";
import { unitDemonstrated } from "./coverageChainScorer";
import { isPhysicsCalculation } from "../case/calculationSubjectPolicy";
import {
  calculationPartIdPrefix,
  findFormulaStageUnitIds,
} from "../extraction/calculationNumericMatch";

function stageSortKey(id: string): [number, number] {
  const part = /^calc_p(\d+)_s(\d+)$/.exec(id);
  if (part) return [Number(part[1]), Number(part[2])];
  const single = /^calc_s(\d+)$/.exec(id);
  if (single) return [1, Number(single[1])];
  const m = /(\d+)\s*$/.exec(id);
  return [1, m ? Number(m[1]) : Number.POSITIVE_INFINITY];
}

export function scoreCalculationDemonstration(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
): { score: number; awardedUnitIds: Set<string> } {
  const max = acf.maxScore;
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  // Misconfigured multi-mark answer_only schemes must not award full marks for a
  // bare final — fall through to per-stage scoring.
  const answerOnly =
    acf.markRule.calcPolicy === "answer_only" && max <= 1 && creditUnits.length <= 1;

  if (answerOnly) {
    const answerUnit =
      creditUnits.find((u) => u.id === "calc_final") ??
      creditUnits.sort((a, b) => b.creditWeight - a.creditWeight)[0];
    if (answerUnit && unitDemonstrated(udm, answerUnit.id)) {
      if (process.env.GRADE_CALC_TRACE === "1") {
        console.info("[grade:calcTrace]", {
          decision: "award",
          policy: "answer_only",
          score: max,
          unitId: answerUnit.id,
        });
      }
      return { score: max, awardedUnitIds: new Set([answerUnit.id]) };
    }
    return { score: 0, awardedUnitIds: new Set() };
  }

  const ordered = [...creditUnits].sort((a, b) => {
    const [pa, sa] = stageSortKey(a.id);
    const [pb, sb] = stageSortKey(b.id);
    if (pa !== pb) return pa - pb;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  // Show-working: credit each demonstrated stage (formula, substitution, final).
  const demonstrated = new Set<string>();
  for (const unit of ordered) {
    if (unitDemonstrated(udm, unit.id)) demonstrated.add(unit.id);
  }

  const creditMeta = ordered.map((u) => ({ id: u.id, content: u.content }));
  const formulaStageIds = findFormulaStageUnitIds(creditMeta);

  // Physics: wrong formula — no credit for that formula or later stages in the SAME part.
  if (isPhysicsCalculation(acf)) {
    for (const formulaStageId of formulaStageIds) {
      const formulaStage = ordered.find((u) => u.id === formulaStageId);
      const formulaExplicitlyWrong =
        formulaStage != null &&
        udm.unitsDemonstrated.some((d) => d.unitId === formulaStage.id && d.valid === false);
      if (!formulaExplicitlyWrong || !formulaStage) continue;
      demonstrated.delete(formulaStage.id);
      const partPrefix = calculationPartIdPrefix(formulaStage.id);
      const formulaIdx = ordered.findIndex((u) => u.id === formulaStage.id);
      for (const unit of ordered.slice(formulaIdx + 1)) {
        if (partPrefix && calculationPartIdPrefix(unit.id) !== partPrefix) continue;
        if (!partPrefix && calculationPartIdPrefix(unit.id)) continue;
        demonstrated.delete(unit.id);
      }
    }
  }

  let score = 0;
  const awardedUnitIds = new Set<string>();
  for (const unit of ordered) {
    if (!demonstrated.has(unit.id)) continue;
    score += unit.creditWeight;
    awardedUnitIds.add(unit.id);
    if (process.env.GRADE_CALC_TRACE === "1") {
      console.info("[grade:calcTrace]", {
        decision: "award",
        policy: "show_working",
        unitId: unit.id,
        weight: unit.creditWeight,
        contentPreview: unit.content.slice(0, 80),
      });
    }
  }

  for (const unit of ordered) {
    if (awardedUnitIds.has(unit.id)) continue;
    if (process.env.GRADE_CALC_TRACE === "1") {
      console.info("[grade:calcTrace]", {
        decision: "deduct",
        policy: "show_working",
        unitId: unit.id,
        weight: unit.creditWeight,
        contentPreview: unit.content.slice(0, 80),
      });
    }
  }

  return { score: Math.max(0, Math.min(max, score)), awardedUnitIds };
}
