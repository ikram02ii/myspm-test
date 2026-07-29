/**
 * Calculation ACF generation, normalization, and validation.
 *
 * Relation / supports convention (all markRule kinds):
 * - unit.supports lists PREREQUISITE unit ids that must be satisfied before this unit.
 * - relation.from = prerequisite, relation.to = dependent (the unit that depends on from).
 * - If unit B has supports: ["A"], there MUST be a relation { from: "A", to: "B" }.
 */

import type { AssessmentCaseFile, EvidenceRelation, EvidenceUnit, MarkRule } from "../shared/types";
import {
  isChemistryCalculationSubject,
  resolveCalculationDomain,
  type CalculationDomain,
} from "./calculationSubjectPolicy";
import {
  allocateMarksAcrossParts,
  calculationPartLabels,
  countIndependentCalculationAsks,
  recommendCalculationMaxScore,
} from "./calculationPartDetect";

export type { CalculationDomain } from "./calculationSubjectPolicy";
export {
  isChemistryCalculation,
  isChemistryCalculationSubject,
  isPhysicsCalculation,
  isPhysicsCalculationSubject,
  resolveCalculationDomain,
} from "./calculationSubjectPolicy";
export {
  allocateMarksAcrossParts,
  calculationPartLabels,
  countIndependentCalculationAsks,
  parseParenMarksFromQuestion,
  recommendCalculationMaxScore,
  splitCalculationStemParts,
} from "./calculationPartDetect";

export type AcfValidationIssue = {
  code: string;
  message: string;
  unitId?: string;
  relationId?: string;
};

export type CalculationAcfPolicy = "answer_only" | "show_working";

/** Every calculation always uses exactly these three credit stages. */
export const CALCULATION_REQUIRED_STAGE_COUNT = 3;

/** Clamp calculation mark totals to at least 3 × independent calc asks. */
export function effectiveCalculationMaxScore(maxScore: number, partCount = 1): number {
  const n = Number.isFinite(maxScore) ? Math.floor(maxScore) : CALCULATION_REQUIRED_STAGE_COUNT;
  const floor = Math.max(1, Math.floor(partCount)) * CALCULATION_REQUIRED_STAGE_COUNT;
  return Math.max(floor, n);
}

/** Resolve Markah for a calculation stem: printed marks or N×3 independent asks. */
export function resolveCalculationMaxScore(question: string, requestedMax: number): number {
  const recommended = recommendCalculationMaxScore(question, requestedMax);
  const parts = countIndependentCalculationAsks(question);
  return effectiveCalculationMaxScore(recommended, parts);
}

/** SPM Chemistry calculation mark stages (always formula → working → final). */
export const CALCULATION_STAGE_LABELS = {
  formula: "Correct formula/equation",
  substitution: "Correct steps of solving (+, −, ×, ÷) — not the concluding answer",
  final: "Correct final answer with unit",
} as const;

/** Generic calculation stages (Math, etc.). */
export const GENERIC_CALCULATION_STAGE_LABELS = {
  formula: "Correct formula or equation",
  substitution: "Correct steps of solving (+, −, ×, ÷) — not the concluding answer",
  final: "Correct final answer with appropriate units",
} as const;

/** SPM Physics calculation mark stages (same three-stage shape as chemistry). */
export const PHYSICS_CALCULATION_STAGE_LABELS = {
  data: "Correct data extraction and SI unit conversion",
  formula: "Correct formula or equation stated",
  substitution: "Correct steps of solving (+, −, ×, ÷) — not the concluding answer",
  calculation: "Correct calculation working shown",
  final: "Correct final answer with SI unit",
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
  _maxScore = 3,
  _subject?: string,
): CalculationAcfPolicy {
  // All calculation questions use formula → steps of solving → final answer.
  void question;
  return "show_working";
}

export type CalculationStagePlanItem = {
  label: string;
  weight: number;
  partIndex: number;
  stageKey: "formula" | "substitution" | "final";
};

function labelsForDomain(domain: CalculationDomain): {
  formula: string;
  substitution: string;
  final: string;
} {
  if (domain === "chemistry") return CALCULATION_STAGE_LABELS;
  if (domain === "physics") return PHYSICS_CALCULATION_STAGE_LABELS;
  return GENERIC_CALCULATION_STAGE_LABELS;
}

function stagesForPartMarks(
  partMarks: number,
  labels: { formula: string; substitution: string; final: string },
  partPrefix: string,
  partIndex: number,
): CalculationStagePlanItem[] {
  const prefix = partPrefix ? `${partPrefix} ` : "";
  if (partMarks >= 3) {
    return [
      { label: `${prefix}${labels.formula}`, weight: 1, partIndex, stageKey: "formula" },
      {
        label: `${prefix}${labels.substitution}`,
        weight: partMarks - 2,
        partIndex,
        stageKey: "substitution",
      },
      { label: `${prefix}${labels.final}`, weight: 1, partIndex, stageKey: "final" },
    ];
  }
  if (partMarks === 2) {
    return [
      { label: `${prefix}${labels.formula}`, weight: 1, partIndex, stageKey: "formula" },
      { label: `${prefix}${labels.final}`, weight: 1, partIndex, stageKey: "final" },
    ];
  }
  return [
    {
      label: `${prefix}${labels.final}`,
      weight: Math.max(1, partMarks),
      partIndex,
      stageKey: "final",
    },
  ];
}

function threeStagePlan(
  maxScore: number,
  labels: { formula: string; substitution: string; final: string },
  partCount = 1,
  partLabels: string[] = [""],
): CalculationStagePlanItem[] {
  const parts = Math.max(1, Math.floor(partCount));
  const marks = effectiveCalculationMaxScore(maxScore, parts);
  const perPart = allocateMarksAcrossParts(marks, parts);
  const out: CalculationStagePlanItem[] = [];
  for (let i = 0; i < parts; i += 1) {
    const prefix = partLabels[i] ?? (parts > 1 ? `(${String.fromCharCode(97 + i)})` : "");
    out.push(...stagesForPartMarks(perPart[i]!, labels, prefix, i));
  }
  return out;
}

/**
 * Physics calculation stages — formula → steps → final per independent ask.
 */
export function physicsShowWorkingStagePlan(
  maxScore: number,
  partCount = 1,
  partLabels: string[] = [""],
): CalculationStagePlanItem[] {
  return threeStagePlan(maxScore, PHYSICS_CALCULATION_STAGE_LABELS, partCount, partLabels);
}

/** Credit-bearing stages — 3 per independent calc ask (weights sum to maxScore). */
export function showWorkingStagePlan(
  maxScore: number,
  domain: CalculationDomain = "general",
  partCount = 1,
  partLabels: string[] = [""],
): CalculationStagePlanItem[] {
  return threeStagePlan(maxScore, labelsForDomain(domain), partCount, partLabels);
}

/** Stage plan from the question stem (detects multi-part calc asks). */
export function buildCalculationStagePlan(params: {
  question: string;
  maxScore: number;
  domain: CalculationDomain;
}): CalculationStagePlanItem[] {
  const partCount = countIndependentCalculationAsks(params.question);
  const partLabels = calculationPartLabels(params.question);
  return showWorkingStagePlan(params.maxScore, params.domain, partCount, partLabels);
}

/**
 * Single source of truth for LLM prompts: always formula → steps of solving → final.
 */
export function buildCalculationStagePromptLines(params: {
  maxScore: number;
  domain: CalculationDomain;
  policy: CalculationAcfPolicy;
  creditUnits?: Array<{ content: string; creditWeight: number }>;
  question?: string;
}): string[] {
  const partCount = params.question ? countIndependentCalculationAsks(params.question) : 1;
  const maxScore = effectiveCalculationMaxScore(params.maxScore, partCount);
  const { domain, policy } = params;
  if (policy === "answer_only") {
    // Legacy path — prefer show_working three-stage schemes for all new cases.
    const finalLabel =
      params.creditUnits?.[0]?.content ??
      (domain === "chemistry"
        ? CALCULATION_STAGE_LABELS.final
        : domain === "physics"
          ? PHYSICS_CALCULATION_STAGE_LABELS.final
          : GENERIC_CALCULATION_STAGE_LABELS.final);
    return [
      `ANSWER-ONLY (${maxScore} mark${maxScore === 1 ? "" : "s"}): credit ONLY this stage:`,
      `1) ${finalLabel} — correct final value (working optional).`,
      "Do NOT invent formula/substitution marks — they are not on this scheme.",
    ];
  }

  const stages =
    params.creditUnits && params.creditUnits.length > 0
      ? params.creditUnits.map((u) => ({ label: u.content, weight: u.creditWeight }))
      : params.question
        ? buildCalculationStagePlan({ question: params.question, maxScore, domain })
        : showWorkingStagePlan(maxScore, domain, partCount);

  const subject =
    domain === "chemistry" ? "CHEMISTRY" : domain === "physics" ? "PHYSICS" : "GENERAL";

  const lines = [
    `${subject} calculation — ${partCount > 1 ? `${partCount} parts × ` : ""}${CALCULATION_REQUIRED_STAGE_COUNT} stages per ask (${maxScore} mark${maxScore === 1 ? "" : "s"}): credit ONLY these stages. NEVER invent extra stages.`,
    ...stages.map(
      (s, i) =>
        `${i + 1}) ${s.label} (${s.weight} mark${s.weight === 1 ? "" : "s"}) — credit only when clearly shown.`,
    ),
  ];

  lines.push(
    "Wrong formula is a major error — do not credit later stages of the SAME part when the equation is wrong.",
    "Working/steps stage: credit ONLY substitution and arithmetic (+, −, ×, ÷). Do NOT require the final answer with unit here.",
    "Final answer stage is a SEPARATE mark — stating the concluding value with unit. Working must not absorb that mark.",
    "Final answer alone without earlier stages earns ONLY the final stage (partial marks).",
    "Unit belongs inside the final-answer stage — NEVER treat unit as a separate mark.",
  );
  if (partCount > 1) {
    lines.push(
      "Multi-part: mark each part's formula / working / final independently. Do not require part (b) to restate part (a).",
    );
  }
  if (domain === "chemistry") {
    lines.push("Treat 75% and 0.75 as equivalent for substitution when that stage exists.");
  }

  return lines;
}

/** Student-facing calculation exemplar — always Formula / Working / Final answer. */
export const CALCULATION_WORKED_EXEMPLAR_SECTIONS = [
  "Formula:",
  "Working:",
  "Final answer:",
] as const;

/** True when model answer uses any stage label (may still be incomplete). */
export function looksLikeStructuredCalculationModelAnswer(text: string): boolean {
  return /(?:^|\n)\s*(?:Formula|Working|Final answer|Data)\s*:/im.test((text || "").trim());
}

/** True when Formula, Working, and Final answer are all present with content. */
export function hasCompleteCalculationModelAnswerSections(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  const formula = t.match(/(?:^|\n)\s*Formula\s*:\s*(.+?)(?=(?:\n\s*(?:Working|Final answer|Data)\s*:)|$)/is);
  const working = t.match(/(?:^|\n)\s*Working\s*:\s*(.+?)(?=(?:\n\s*(?:Formula|Final answer|Data)\s*:)|$)/is);
  const finalAns = t.match(/(?:^|\n)\s*Final answer\s*:\s*(.+?)(?=(?:\n\s*(?:Formula|Working|Data)\s*:)|$)/is);
  return Boolean(
    formula?.[1]?.trim() &&
      working?.[1]?.trim() &&
      finalAns?.[1]?.trim(),
  );
}

/**
 * Labels for the student-facing worked model answer.
 * Always Formula + Working + Final answer (display exemplar), independent of maxScore stages.
 */
export function calculationModelAnswerSectionLabels(
  _maxScore: number,
  _domain: CalculationDomain,
  _policy: CalculationAcfPolicy,
): string[] {
  return [...CALCULATION_WORKED_EXEMPLAR_SECTIONS];
}

/** Generation prompt: calc Markah = 3 per independent calc ask (printed marks win). */
export function buildCalculationMarkSchemeGenerationBlock(): string {
  return [
    "CALCULATION QUESTIONS (Chemistry / Physics / Math — binding):",
    "- Each INDEPENDENT calculation ask (e.g. (a) find acceleration, (b) find distance) gets formula + steps of solving + final answer = 3 marks.",
    "- Single-ask calculation: Markah = 3. Two independent calc parts: Markah = 6 (unless the stem prints a different total — then use the printed Markah).",
    "- Stages per ask MUST be: (1) formula/equation, (2) steps of solving (+, −, ×, ÷ only — NOT the concluding answer), (3) final answer with unit (SEPARATE 1 mark).",
    "- For multi-part, list marking points grouped by part: (a) formula, (a) working, (a) final, (b) formula, (b) working, (b) final.",
    "- Working/steps marking point MUST NOT include or require writing the final answer — that is its own mark.",
    "- Do NOT create 1-mark answer-only or 2-mark formula+final schemes for a full calc ask.",
    "- Unit is part of the final-answer mark — NEVER a separate Markah bullet.",
    "- Markah: MUST equal the bullet count.",
  ].join("\n");
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
  const partCount = countIndependentCalculationAsks(params.question);
  const maxScore = effectiveCalculationMaxScore(params.maxScore, partCount);
  const domain = resolveCalculationDomain(params.subject ?? "");
  const finalLabel =
    domain === "chemistry"
      ? CALCULATION_STAGE_LABELS.final
      : domain === "physics"
        ? PHYSICS_CALCULATION_STAGE_LABELS.final
        : GENERIC_CALCULATION_STAGE_LABELS.final;

  // Prefer three-stage show_working for all calculations; answer_only kept for legacy only.
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

  const stagePlan = buildCalculationStagePlan({
    question: params.question,
    maxScore,
    domain,
  });
  const units: EvidenceUnit[] = [];
  const relations: EvidenceRelation[] = [];

  // Stage index within each part (1-based) for stable ids: calc_s1.. or calc_p1_s1..
  const stageIndexInPart = new Map<number, number>();
  let prevIdInPart: string | null = null;
  let prevPartIndex = -1;

  for (let i = 0; i < stagePlan.length; i += 1) {
    const step = stagePlan[i]!;
    if (step.partIndex !== prevPartIndex) {
      prevIdInPart = null;
      prevPartIndex = step.partIndex;
    }
    const localIdx = (stageIndexInPart.get(step.partIndex) ?? 0) + 1;
    stageIndexInPart.set(step.partIndex, localIdx);

    const id =
      partCount > 1 ? `calc_p${step.partIndex + 1}_s${localIdx}` : `calc_s${localIdx}`;
    units.push({
      id,
      type: "stage",
      content: step.label,
      aliases: [],
      creditWeight: step.weight,
      required: localIdx === 1,
      supports: prevIdInPart ? [prevIdInPart] : undefined,
    });
    if (prevIdInPart) {
      relations.push({
        id: partCount > 1 ? `calc_p${step.partIndex + 1}_r${localIdx - 1}` : `calc_r${localIdx - 1}`,
        type: "sequence_next",
        from: prevIdInPart,
        to: id,
        requiredForMarks: true,
      });
    }
    prevIdInPart = id;
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

function isCalcTemplateUnitId(id: string): boolean {
  return id === "calc_final" || /^calc_s\d+$/.test(id) || /^calc_p\d+_s\d+$/.test(id);
}

export function normalizeCalculationAcf(
  acf: Pick<AssessmentCaseFile, "question" | "maxScore" | "subject" | "units" | "relations" | "markRule">,
): Pick<AssessmentCaseFile, "units" | "relations" | "markRule"> {
  const domain = resolveCalculationDomain(acf.subject);
  const partCount = countIndependentCalculationAsks(acf.question);
  const maxScore = effectiveCalculationMaxScore(acf.maxScore, partCount);
  const policy = inferCalculationPolicy(acf.question, maxScore, acf.subject);
  const template = buildCalculationTemplate({
    question: acf.question,
    maxScore,
    policy,
    subject: acf.subject,
  });

  let units = demoteProseDefinitions([...acf.units]);
  let relations = stripProseFromLoadBearingRelations(units, [...acf.relations]);

  const creditAfterDemotion = units.filter((u) => u.creditWeight > 0);
  const weightSum = sumCreditWeights(units);
  const usesCalcTemplateIds = creditAfterDemotion.every((u) => isCalcTemplateUnitId(u.id));
  const hasProseGating = relations.some(
    (r) =>
      r.requiredForMarks &&
      units.some((u) => u.id === r.from && isProseDefinitionUnit(u)),
  );

  const expectedStageCount = buildCalculationStagePlan({
    question: acf.question,
    maxScore,
    domain,
  }).length;
  const tooManyWeightedSteps =
    policy === "show_working"
      ? creditAfterDemotion.length > expectedStageCount
      : creditAfterDemotion.length > 1;
  const wrongStageCount =
    policy === "show_working" && creditAfterDemotion.length !== expectedStageCount;

  if (
    weightSum !== maxScore ||
    hasProseGating ||
    tooManyWeightedSteps ||
    wrongStageCount ||
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
      markRule: { ...template.markRule, maxMarks: maxScore },
    };
  }

  units = mergeCreditUnitsToMaxScore(units, maxScore);
  relations = fixRelationDirection(units, relations);

  const markRule: MarkRule = {
    kind: policy === "answer_only" ? "count_distinct_units" : "ordered_stages",
    maxMarks: maxScore,
    openPool: false,
    calcPolicy: policy,
    calcDomain: domain,
  };

  return { units, relations, markRule };
}

export function finalizeCalculationAssessmentCase(acf: AssessmentCaseFile): AssessmentCaseFile {
  if (!isCalculationIntent(acf)) return acf;

  const domain = resolveCalculationDomain(acf.subject);
  const maxScore = resolveCalculationMaxScore(acf.question, acf.maxScore);
  const normalized = normalizeCalculationAcf({ ...acf, maxScore });

  const next: AssessmentCaseFile = {
    ...acf,
    ...normalized,
    maxScore,
    assessedUnderstanding:
      normalized.markRule.calcPolicy === "answer_only"
        ? (domain === "chemistry"
            ? CALCULATION_STAGE_LABELS.final
            : domain === "physics"
              ? PHYSICS_CALCULATION_STAGE_LABELS.final
              : GENERIC_CALCULATION_STAGE_LABELS.final) + "."
        : buildCalculationStagePlan({ question: acf.question, maxScore, domain })
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
      maxScore,
      policy: inferCalculationPolicy(acf.question, maxScore, acf.subject),
      subject: acf.subject,
    });
    return {
      ...next,
      maxScore,
      units: [...next.units.filter((u) => u.creditWeight === 0 && isProseDefinitionUnit(u)), ...template.units],
      relations: template.relations,
      markRule: { ...template.markRule, maxMarks: maxScore },
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
