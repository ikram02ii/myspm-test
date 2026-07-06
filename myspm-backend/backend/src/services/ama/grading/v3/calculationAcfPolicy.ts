/**
 * Calculation ACF generation, normalization, and validation.
 *
 * Relation / supports convention (all markRule kinds):
 * - unit.supports lists PREREQUISITE unit ids that must be satisfied before this unit.
 * - relation.from = prerequisite, relation.to = dependent (the unit that depends on from).
 * - If unit B has supports: ["A"], there MUST be a relation { from: "A", to: "B" }.
 */

import type { AssessmentCaseFile, EvidenceRelation, EvidenceUnit, MarkRule } from "./types";
import {
  isChemistryCalculationSubject,
  resolveCalculationDomain,
  type CalculationDomain,
} from "./calculationSubjectPolicy";

export type { CalculationDomain } from "./calculationSubjectPolicy";
export { isChemistryCalculation, isChemistryCalculationSubject, resolveCalculationDomain } from "./calculationSubjectPolicy";

export type AcfValidationIssue = {
  code: string;
  message: string;
  unitId?: string;
  relationId?: string;
};

export type CalculationAcfPolicy = "answer_only" | "show_working";

/** SPM Chemistry calculation mark stages (1 mark each when maxScore is 3). */
export const CALCULATION_STAGE_LABELS = {
  formula: "Correct formula/equation",
  substitution: "Correct substitution/working",
  final: "Correct final answer with unit",
} as const;

/** @deprecated alias — chemistry-specific */
export const CHEMISTRY_CALCULATION_STAGE_LABELS = CALCULATION_STAGE_LABELS;

/** Generic calculation stages (Physics, Math, etc.). */
export const GENERIC_CALCULATION_STAGE_LABELS = {
  formula: "Correct formula or equation",
  substitution: "Correct substitution/working",
  final: "Correct final answer with appropriate units",
} as const;

const SHOWN_WORKING_RE =
  /\b(show(?:\s+your)?\s+(?:working|workings|calculation|steps|method)|with\s+working|tunjukkan\s+(?:kerja\s+)?kira(?:n)?|tunjuk\s+kerja|dengan\s+kerja\s+kira)\b/i;

const PROSE_DEFINITION_RE =
  /\b(defined as|definition of|is defined|ialah|didefinisikan|ditakrifkan|rate of reaction is|purata kadar|maksud(?:kan)?|erti(?:kan)?)\b/i;

export function questionRequiresShownWorking(question: string): boolean {
  return SHOWN_WORKING_RE.test(question);
}

export function isCalculationIntent(acf: Pick<AssessmentCaseFile, "intent">): boolean {
  return acf.intent.category === "calculate" || acf.intent.family === "calculation";
}

export function isProseDefinitionUnit(unit: EvidenceUnit): boolean {
  if (unit.type === "stage") return false;
  const content = unit.content.trim();
  if (!content) return false;
  if (PROSE_DEFINITION_RE.test(content)) return true;
  if (/\bis the\b/i.test(content) && !/[\d=+\-*/^→]|mol\/|dm3|cm3|kJ|J\/|g\/|s-|\/.+s\b/i.test(content)) {
    return true;
  }
  return false;
}

export function inferCalculationPolicy(
  question: string,
  maxScore = 2,
  _subject?: string,
): CalculationAcfPolicy {
  if (maxScore <= 1) return "answer_only";
  // SPM: 2+ marks expect formula/working/final stages (Chemistry, Physics, etc.).
  void question;
  return "show_working";
}

/** Credit-bearing stages for show-working calculations (weights sum to maxScore). */
export function showWorkingStagePlan(
  maxScore: number,
  domain: CalculationDomain = "general",
): Array<{ label: string; weight: number }> {
  if (domain === "chemistry") {
    if (maxScore <= 1) {
      return [{ label: CALCULATION_STAGE_LABELS.final, weight: 1 }];
    }
    if (maxScore === 2) {
      return [
        { label: CALCULATION_STAGE_LABELS.formula, weight: 1 },
        { label: CALCULATION_STAGE_LABELS.final, weight: 1 },
      ];
    }
    const extraOnFinal = Math.max(0, maxScore - 3);
    return [
      { label: CALCULATION_STAGE_LABELS.formula, weight: 1 },
      { label: CALCULATION_STAGE_LABELS.substitution, weight: 1 },
      { label: CALCULATION_STAGE_LABELS.final, weight: 1 + extraOnFinal },
    ];
  }

  if (maxScore <= 1) {
    return [{ label: GENERIC_CALCULATION_STAGE_LABELS.final, weight: 1 }];
  }
  if (maxScore === 2) {
    return [
      { label: GENERIC_CALCULATION_STAGE_LABELS.formula, weight: 1 },
      { label: GENERIC_CALCULATION_STAGE_LABELS.final, weight: 1 },
    ];
  }
  const extraOnFinal = Math.max(0, maxScore - 3);
  return [
    { label: GENERIC_CALCULATION_STAGE_LABELS.formula, weight: 1 },
    { label: GENERIC_CALCULATION_STAGE_LABELS.substitution, weight: 1 },
    { label: GENERIC_CALCULATION_STAGE_LABELS.final, weight: 1 + extraOnFinal },
  ];
}

function unitMap(units: EvidenceUnit[]): Map<string, EvidenceUnit> {
  return new Map(units.map((u) => [u.id, u]));
}

/** Sum creditWeight for units with creditWeight > 0. */
export function sumCreditWeights(units: EvidenceUnit[]): number {
  return units.filter((u) => u.creditWeight > 0).reduce((sum, u) => sum + u.creditWeight, 0);
}

export function validateSupportsRelationDirection(
  units: EvidenceUnit[],
  relations: EvidenceRelation[],
): AcfValidationIssue[] {
  const issues: AcfValidationIssue[] = [];
  const relationPairs = new Set(relations.map((r) => `${r.from}->${r.to}`));

  for (const unit of units) {
    for (const prereqId of unit.supports ?? []) {
      const expected = `${prereqId}->${unit.id}`;
      const inverted = `${unit.id}->${prereqId}`;
      if (!relationPairs.has(expected)) {
        if (relationPairs.has(inverted)) {
          issues.push({
            code: "relation_direction_inverted",
            message: `Unit ${unit.id} supports [${prereqId}] but relation runs ${inverted} (expected ${expected})`,
            unitId: unit.id,
          });
        } else {
          issues.push({
            code: "relation_missing_for_support",
            message: `Unit ${unit.id} supports [${prereqId}] but no relation ${expected}`,
            unitId: unit.id,
          });
        }
      }
    }
  }

  for (const relation of relations) {
    const dependent = units.find((u) => u.id === relation.to);
    const prereq = units.find((u) => u.id === relation.from);
    if (!dependent || !prereq) continue;
    const supports = dependent.supports ?? [];
    if (supports.includes(relation.from)) continue;
    if (relation.requiredForMarks && dependent.creditWeight > 0) {
      issues.push({
        code: "relation_without_supports",
        message: `Relation ${relation.id} (${relation.from}->${relation.to}) is requiredForMarks but ${relation.to}.supports omits ${relation.from}`,
        relationId: relation.id,
        unitId: relation.to,
      });
    }
  }

  return issues;
}

export function validateCalculationAcf(acf: AssessmentCaseFile): AcfValidationIssue[] {
  if (!isCalculationIntent(acf)) return [];

  const issues: AcfValidationIssue[] = [];
  const weightSum = sumCreditWeights(acf.units);

  if (weightSum !== acf.maxScore) {
    issues.push({
      code: "weight_sum_mismatch",
      message: `Credit weights sum to ${weightSum} but maxScore is ${acf.maxScore}`,
    });
  }

  if (acf.markRule.openPool === true) {
    issues.push({
      code: "calc_open_pool",
      message: "Calculation questions must not use openPool=true",
    });
  }

  for (const unit of acf.units) {
    if (isProseDefinitionUnit(unit) && unit.creditWeight > 0) {
      issues.push({
        code: "prose_has_weight",
        message: `Prose definition unit ${unit.id} must have creditWeight=0`,
        unitId: unit.id,
      });
    }
  }

  for (const relation of acf.relations) {
    if (!relation.requiredForMarks) continue;
    const fromUnit = acf.units.find((u) => u.id === relation.from);
    if (fromUnit && isProseDefinitionUnit(fromUnit)) {
      issues.push({
        code: "prose_gates_credit",
        message: `Prose unit ${relation.from} must not gate credit via requiredForMarks relation ${relation.id}`,
        relationId: relation.id,
        unitId: relation.from,
      });
    }
  }

  issues.push(...validateSupportsRelationDirection(acf.units, acf.relations));
  return issues;
}

function demoteProseDefinitions(units: EvidenceUnit[]): EvidenceUnit[] {
  return units.map((unit) => {
    if (!isProseDefinitionUnit(unit)) return unit;
    return {
      ...unit,
      creditWeight: 0,
      required: false,
      requiredForCorrectness: false,
    };
  });
}

function stripProseFromLoadBearingRelations(
  units: EvidenceUnit[],
  relations: EvidenceRelation[],
): EvidenceRelation[] {
  const proseIds = new Set(units.filter(isProseDefinitionUnit).map((u) => u.id));
  return relations.map((relation) => {
    if (!relation.requiredForMarks) return relation;
    if (proseIds.has(relation.from) || proseIds.has(relation.to)) {
      return { ...relation, requiredForMarks: false };
    }
    return relation;
  });
}

function fixRelationDirection(units: EvidenceUnit[], relations: EvidenceRelation[]): EvidenceRelation[] {
  const out = [...relations];
  const pairIndex = new Map(out.map((r, i) => [`${r.from}->${r.to}`, i]));

  for (const unit of units) {
    for (const prereqId of unit.supports ?? []) {
      const expected = `${prereqId}->${unit.id}`;
      const inverted = `${unit.id}->${prereqId}`;
      if (pairIndex.has(expected)) continue;

      const invertedIdx = pairIndex.get(inverted);
      if (invertedIdx != null) {
        const invertedRel = out[invertedIdx]!;
        out[invertedIdx] = {
          ...invertedRel,
          from: prereqId,
          to: unit.id,
        };
        pairIndex.delete(inverted);
        pairIndex.set(expected, invertedIdx);
        continue;
      }

      const id = `r_auto_${prereqId}_${unit.id}`;
      const newRel: EvidenceRelation = {
        id,
        type: "sequence_next",
        from: prereqId,
        to: unit.id,
        requiredForMarks: unit.creditWeight > 0,
      };
      pairIndex.set(expected, out.length);
      out.push(newRel);
    }
  }

  return out;
}

export function mergeCreditUnitsToMaxScore(units: EvidenceUnit[], maxScore: number): EvidenceUnit[] {
  const credit = units.filter((u) => u.creditWeight > 0);
  const nonCredit = units.filter((u) => u.creditWeight === 0);
  if (credit.length === 0) return units;

  let sum = sumCreditWeights(credit);
  if (sum === maxScore) return units;

  if (sum > maxScore) {
    const sorted = [...credit].sort((a, b) => b.creditWeight - a.creditWeight);
    while (sum > maxScore && sorted.length > 1) {
      const removed = sorted.pop()!;
      sum -= removed.creditWeight;
      const mergeInto = sorted[sorted.length - 1]!;
      mergeInto.content = `${mergeInto.content}; ${removed.content}`.slice(0, 500);
      mergeInto.aliases = [...new Set([...mergeInto.aliases, ...removed.aliases])];
    }
    if (sum > maxScore && sorted.length === 1) {
      sorted[0]!.creditWeight = maxScore;
    }
    return [...nonCredit, ...sorted];
  }

  const last = credit[credit.length - 1]!;
  last.creditWeight += maxScore - sum;
  return units;
}

export function buildCalculationTemplate(params: {
  question: string;
  maxScore: number;
  policy: CalculationAcfPolicy;
  subject?: string;
}): { units: EvidenceUnit[]; relations: EvidenceRelation[]; markRule: MarkRule } {
  const maxScore = params.maxScore;
  const domain = resolveCalculationDomain(params.subject ?? "");
  const finalLabel =
    domain === "chemistry"
      ? CALCULATION_STAGE_LABELS.final
      : GENERIC_CALCULATION_STAGE_LABELS.final;

  if (params.policy === "answer_only") {
    return {
      units: [
        {
          id: "calc_final",
          type: "fact",
          content: finalLabel,
          aliases: ["final answer", "jawapan akhir", "nilai", "value"],
          creditWeight: maxScore,
          required: true,
        },
      ],
      relations: [],
      markRule: {
        kind: "count_distinct_units",
        maxMarks: maxScore,
        openPool: false,
        calcPolicy: "answer_only",
        calcDomain: domain,
      },
    };
  }

  const stagePlan = showWorkingStagePlan(maxScore, domain);
  const units: EvidenceUnit[] = [];
  const relations: EvidenceRelation[] = [];

  for (let i = 0; i < stagePlan.length; i += 1) {
    const id = `calc_s${i + 1}`;
    const prevId = i > 0 ? `calc_s${i}` : null;
    const step = stagePlan[i]!;
    units.push({
      id,
      type: "stage",
      content: step.label,
      aliases: [],
      creditWeight: step.weight,
      required: i === 0,
      supports: prevId ? [prevId] : undefined,
    });
    if (prevId) {
      relations.push({
        id: `calc_r${i}`,
        type: "sequence_next",
        from: prevId,
        to: id,
        requiredForMarks: true,
      });
    }
  }

  return {
    units,
    relations,
    markRule: {
      kind: "ordered_stages",
      maxMarks: maxScore,
      openPool: false,
      calcPolicy: "show_working",
      calcDomain: domain,
    },
  };
}

export function normalizeCalculationAcf(
  acf: Pick<AssessmentCaseFile, "question" | "maxScore" | "subject" | "units" | "relations" | "markRule">,
): Pick<AssessmentCaseFile, "units" | "relations" | "markRule"> {
  const domain = resolveCalculationDomain(acf.subject);
  const policy = inferCalculationPolicy(acf.question, acf.maxScore, acf.subject);
  const template = buildCalculationTemplate({
    question: acf.question,
    maxScore: acf.maxScore,
    policy,
    subject: acf.subject,
  });

  let units = demoteProseDefinitions([...acf.units]);
  let relations = stripProseFromLoadBearingRelations(units, [...acf.relations]);

  const creditAfterDemotion = units.filter((u) => u.creditWeight > 0);
  const weightSum = sumCreditWeights(units);
  const usesCalcTemplateIds = creditAfterDemotion.every(
    (u) => u.id === "calc_final" || /^calc_s\d+$/.test(u.id),
  );
  const hasProseGating = relations.some(
    (r) =>
      r.requiredForMarks &&
      units.some((u) => u.id === r.from && isProseDefinitionUnit(u)),
  );

  const expectedStageCount = showWorkingStagePlan(acf.maxScore, domain).length;
  const tooManyWeightedSteps =
    policy === "show_working"
      ? creditAfterDemotion.length > expectedStageCount
      : creditAfterDemotion.length > 1;

  if (
    weightSum !== acf.maxScore ||
    hasProseGating ||
    tooManyWeightedSteps ||
    !usesCalcTemplateIds ||
    (policy === "answer_only" && creditAfterDemotion.length !== 1)
  ) {
    units = [
      ...units.filter((u) => u.creditWeight === 0 || isProseDefinitionUnit(u)),
      ...template.units,
    ];
    relations = template.relations;
    return {
      units: demoteProseDefinitions(units),
      relations,
      markRule: { ...template.markRule, maxMarks: acf.maxScore },
    };
  }

  units = mergeCreditUnitsToMaxScore(units, acf.maxScore);
  relations = fixRelationDirection(units, relations);

  const markRule: MarkRule = {
    kind: policy === "answer_only" ? "count_distinct_units" : "ordered_stages",
    maxMarks: acf.maxScore,
    openPool: false,
    calcPolicy: policy,
    calcDomain: domain,
  };

  return { units, relations, markRule };
}

export function finalizeCalculationAssessmentCase(acf: AssessmentCaseFile): AssessmentCaseFile {
  if (!isCalculationIntent(acf)) return acf;

  const domain = resolveCalculationDomain(acf.subject);
  const normalized = normalizeCalculationAcf(acf);

  const next: AssessmentCaseFile = {
    ...acf,
    ...normalized,
    assessedUnderstanding:
      normalized.markRule.calcPolicy === "answer_only"
        ? (domain === "chemistry"
            ? CALCULATION_STAGE_LABELS.final
            : GENERIC_CALCULATION_STAGE_LABELS.final) + "."
        : showWorkingStagePlan(acf.maxScore, domain)
            .map((s) => s.label)
            .join("; ") + ".",
  };

  const issues = validateCalculationAcf(next);
  const hardFailures = issues.filter((i) =>
    ["weight_sum_mismatch", "prose_gates_credit", "calc_open_pool"].includes(i.code),
  );
  if (hardFailures.length > 0) {
    const template = buildCalculationTemplate({
      question: acf.question,
      maxScore: acf.maxScore,
      policy: inferCalculationPolicy(acf.question, acf.maxScore, acf.subject),
      subject: acf.subject,
    });
    return {
      ...next,
      units: [...next.units.filter((u) => u.creditWeight === 0 && isProseDefinitionUnit(u)), ...template.units],
      relations: template.relations,
      markRule: { ...template.markRule, maxMarks: acf.maxScore },
    };
  }

  return next;
}

export function validateAcfTopology(acf: AssessmentCaseFile): AcfValidationIssue[] {
  const issues = validateSupportsRelationDirection(acf.units, acf.relations);
  if (isCalculationIntent(acf)) {
    issues.push(...validateCalculationAcf(acf));
  }
  return issues;
}
