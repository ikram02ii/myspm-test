/**
 * Post-process and validate ACF for all question types (not just calculations).
 * Fixes weight-sum drift, wrong mark rules, and open-pool misuse before save/cache use.
 */

import {
  isCalculationIntent,
  mergeCreditUnitsToMaxScore,
  showWorkingStagePlan,
  resolveCalculationDomain,
  sumCreditWeights,
  type AcfValidationIssue,
} from "./calculationAcfPolicy";
import type { AssessmentCaseFile, AssessmentIntentFamily, EvidenceRelation, EvidenceUnit, MarkRule } from "../shared/types";

const ELECTRON_ARRANGEMENT_ALIASES = [
  "2.8.1",
  "2-8-1",
  "2, 8, 1",
  "2,8,1",
  "2 8 1",
  "2 electrons in the first shell, 8 in the second shell and 1 in the third shell",
  "2 electrons in the first shell, 8 in the second, 1 in the third",
  "2 in first shell, 8 in second, 1 in third",
];

/** Near-synonym / BM–EN aliases for common SPM wording mismatches. */
const NEAR_SYNONYM_ALIAS_GROUPS: Array<{ match: RegExp; aliases: string[] }> = [
  {
    match: /\b(defined|derived|ditakrif|diperoleh)\b/i,
    aliases: ["defined", "derived", "ditakrifkan", "diperoleh", "in terms of", "from other"],
  },
  {
    match: /\b(electrostatic|elektrostatik)\b/i,
    aliases: ["electrostatic", "elektrostatik", "ionic forces", "daya ion", "attraction between ions"],
  },
  {
    match: /\b(intermolecular|daya antarmolekul|antara\s*molekul)\b/i,
    aliases: ["intermolecular", "antara molekul", "daya antarmolekul", "between molecules"],
  },
  {
    match: /\b(lattice|jejaringan|rangkaian)\b/i,
    aliases: ["lattice", "giant lattice", "jejaringan", "rangkaian ion"],
  },
  {
    match: /\b(melting\s*point|takat\s*lebur)\b/i,
    aliases: ["melting point", "takat lebur", "high melting", "takat lebur tinggi"],
  },
];

const DUAL_SIDE_SPLIT_RE =
  /\b(?:while|whereas|whilst|but|however|compared\s+with|compared\s+to|in\s+contrast|on\s+the\s+other\s+hand|sebaliknya|manakala|sedangkan)\b/i;

function normalizeStem(question: string): string {
  return (question || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Stem text without trailing mark-count annotations — avoids "(2 marks)" matching item counts. */
function stemWithoutMarkAnnotation(question: string): string {
  return normalizeStem(question)
    .replace(/\(\s*\d+\s*marks?\s*\)\s*$/i, "")
    .replace(/\[\s*\d+\s*marks?\s*\]\s*$/i, "")
    .trim();
}

/** How many distinct items the stem requires (e.g. "three", or "X, Y and Z"). */
export function parseStemRequiredItemCount(question: string): number | null {
  const q = stemWithoutMarkAnnotation(question);
  const wordCount =
    q.match(/\b(three|3|tiga)\b/) ? 3
    : q.match(/\b(two|2|dua)\b/) ? 2
    : q.match(/\b(four|4|empat)\b/) ? 4
    : q.match(/\b(five|5|lima)\b/) ? 5
    : null;
  if (wordCount) return wordCount;

  const andList = q.match(
    /\b(?:a|an|the)\s+[\w-]+(?:\s*,\s*(?:a|an|the)?\s*[\w-]+)*\s+and\s+(?:a|an|the)?\s*[\w-]+\b/,
  );
  if (andList) {
    const parts = andList[0].split(/\s+and\s+|\s*,\s*/).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 5) return parts.length;
  }
  return null;
}

/**
 * Command words that mark a stem as a COMPARISON / difference question. These
 * are independent-unit scored (each side earns its own mark), so an invalid
 * claim about one side must never wipe the other — hence they are excluded from
 * the fixed-set treatment. Purely structural (command words), no topic strings.
 */
const COMPARE_DIFFERENCE_STEM_RE =
  /\b(differ|different|difference|distinguish|bezakan|beza|bandingkan|banding|compare|contrast|versus|vs)\b/i;

/**
 * A "fixed set" stem names a specific, closed number of required items equal to
 * the total marks (e.g. "state the two ...", "name three ..."). Fully generic:
 * driven only by the stem's item-count structure and command word, never by any
 * subject or topic string.
 */
export function isFixedSetRecallStem(question: string, maxScore: number): boolean {
  if (COMPARE_DIFFERENCE_STEM_RE.test(question)) return false;
  const required = parseStemRequiredItemCount(question);
  return required != null && maxScore >= 1 && required === maxScore;
}

/**
 * Enumeration-type stem: the student earns credit by naming/stating/listing
 * discrete items or examples, rather than constructing a reasoned explanation.
 * Detected structurally from intent family/category, question type, example
 * demand, and closed item counts — never from specific question text. For such
 * stems a single correct core-concept match per unit is sufficient for credit.
 */
export function isEnumerationStem(acf: AssessmentCaseFile): boolean {
  const { family, category, analysis } = acf.intent;
  if (family === "comparison" || family === "explanation" || family === "process" || family === "humanities") {
    return false;
  }
  if (acf.markRule.kind === "coverage_chain" || acf.markRule.kind === "ordered_stages") return false;

  if (family === "recall" && (category === "state" || category === "name" || category === "list" || category === "identify")) {
    return true;
  }
  if (analysis?.questionType === "open_ended_example") return true;
  if (analysis?.requiresExamples === true) return true;
  if (parseStemRequiredItemCount(acf.question) != null && acf.markRule.kind === "count_distinct_units") return true;
  return false;
}

function shouldUseIndependentUnits(family: AssessmentIntentFamily): boolean {
  return (
    family === "definition" ||
    family === "explanation" ||
    family === "description" ||
    family === "recall" ||
    family === "comparison" ||
    family === "general"
  );
}

function stripLoadBearingRelations(relations: EvidenceRelation[]): EvidenceRelation[] {
  return relations.map((r) => ({ ...r, requiredForMarks: false }));
}

function normalizeCreditUnitWeights(units: EvidenceUnit[], maxScore: number): EvidenceUnit[] {
  const credit = units.filter((u) => u.creditWeight > 0);
  if (credit.length === 0) return units;

  for (const unit of credit) {
    if (unit.creditWeight > maxScore) unit.creditWeight = maxScore;
  }

  let sum = sumCreditWeights(units);
  if (sum === maxScore) return units;

  if (sum > maxScore) {
    return mergeCreditUnitsToMaxScore(units, maxScore);
  }

  if (credit.length === 1 && maxScore <= 3) {
    if (maxScore === 1) {
      credit[0]!.creditWeight = 1;
      return units;
    }
    // One unit for a multi-mark question: cap at 1 mark so vague single hits cannot earn full marks.
    credit[0]!.creditWeight = 1;
    return units;
  }

  const perUnit = Math.floor(maxScore / credit.length);
  let remainder = maxScore - perUnit * credit.length;
  for (const unit of credit) {
    unit.creditWeight = perUnit + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return units;
}

function enrichElectronArrangementAliases(units: EvidenceUnit[]): EvidenceUnit[] {
  return units.map((unit) => {
    const c = unit.content.toLowerCase();
    if (!/electron|elektron|shell|petala|2,\s*8|1s/.test(c) && !/2,\s*8,\s*1/.test(c)) {
      return unit;
    }
    return {
      ...unit,
      aliases: [...new Set([...unit.aliases, ...ELECTRON_ARRANGEMENT_ALIASES])],
    };
  });
}

function padCreditUnitsToMaxScore(
  units: EvidenceUnit[],
  maxScore: number,
  assessedUnderstanding: string,
): EvidenceUnit[] {
  let sum = sumCreditWeights(units);
  if (sum >= maxScore) return units;
  const out = [...units];
  let padIdx = 0;
  while (sum < maxScore) {
    padIdx += 1;
    out.push({
      id: `mark-pad-${padIdx}`,
      type: "fact",
      content: `Additional distinct mark point: ${assessedUnderstanding.slice(0, 160)}`,
      aliases: [],
      creditWeight: 1,
      required: false,
    });
    sum += 1;
  }
  return out;
}

function enrichDefinitionAliases(_question: string, units: EvidenceUnit[]): EvidenceUnit[] {
  return units.map((unit) => {
    const extra: string[] = [unit.content];
    for (const group of NEAR_SYNONYM_ALIAS_GROUPS) {
      if (group.match.test(unit.content) || unit.aliases.some((a) => group.match.test(a))) {
        extra.push(...group.aliases);
      }
    }
    return {
      ...unit,
      aliases: [...new Set([...unit.aliases, ...extra].map((a) => a.trim()).filter(Boolean))],
    };
  });
}

/**
 * Split credit units that encode both sides of a comparison into two atomic units.
 * E.g. "Ionic … while covalent …" → two 1-mark units (weights rebalanced later).
 */
export function splitDualSideComparisonUnits(units: EvidenceUnit[]): EvidenceUnit[] {
  const out: EvidenceUnit[] = [];
  for (const unit of units) {
    if (unit.creditWeight <= 0) {
      out.push(unit);
      continue;
    }
    if (!DUAL_SIDE_SPLIT_RE.test(unit.content)) {
      out.push(unit);
      continue;
    }
    const parts = unit.content
      .split(DUAL_SIDE_SPLIT_RE)
      .map((p) => p.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim())
      .filter((p) => p.split(/\s+/).length >= 4);
    if (parts.length < 2) {
      out.push(unit);
      continue;
    }
    const [left, right] = parts;
    const weightLeft = Math.max(1, Math.floor(unit.creditWeight / 2));
    const weightRight = Math.max(1, unit.creditWeight - weightLeft);
    out.push({
      ...unit,
      id: `${unit.id}_a`,
      content: left!,
      creditWeight: weightLeft,
      aliases: [...unit.aliases],
    });
    out.push({
      ...unit,
      id: `${unit.id}_b`,
      content: right!,
      creditWeight: weightRight,
      aliases: [...unit.aliases],
    });
  }
  return out;
}

function applyMarkRuleDefaults(
  acf: AssessmentCaseFile,
  fixedSet: boolean,
): MarkRule {
  const family = acf.intent.family;
  const openPoolAllowed =
    !fixedSet &&
    family === "recall" &&
    !isFixedSetRecallStem(acf.question, acf.maxScore);

  if (isCalculationIntent(acf)) {
    return acf.markRule;
  }

  if (shouldUseIndependentUnits(family)) {
    return {
      kind: "count_distinct_units",
      maxMarks: acf.maxScore,
      openPool: openPoolAllowed,
    };
  }

  return { ...acf.markRule, maxMarks: acf.maxScore, openPool: openPoolAllowed ? true : false };
}

export function validateGeneralAcf(acf: AssessmentCaseFile): AcfValidationIssue[] {
  if (isCalculationIntent(acf)) return [];

  const issues: AcfValidationIssue[] = [];
  const weightSum = sumCreditWeights(acf.units);

  if (weightSum !== acf.maxScore) {
    issues.push({
      code: "weight_sum_mismatch",
      message: `Credit weights sum to ${weightSum} but maxScore is ${acf.maxScore}`,
    });
  }

  if (acf.markRule.openPool && isFixedSetRecallStem(acf.question, acf.maxScore)) {
    issues.push({
      code: "fixed_set_open_pool",
      message: "Fixed-set recall/compare stems must not use openPool=true",
    });
  }

  if (acf.markRule.kind === "paired_entities" && acf.intent.family === "comparison") {
    issues.push({
      code: "abstract_comparison",
      message: "Comparison questions should use count_distinct_units, not paired_entities",
    });
  }

  return issues;
}

export function isStoredAcfUsable(acf: AssessmentCaseFile): boolean {
  return validateGeneralAcf(acf).length === 0 && validateCalculationUsable(acf);
}

function validateCalculationUsable(acf: AssessmentCaseFile): boolean {
  if (!isCalculationIntent(acf)) return true;
  const credit = acf.units.filter((u) => u.creditWeight > 0);
  if (sumCreditWeights(acf.units) !== acf.maxScore) return false;
  if (!credit.every((u) => u.id === "calc_final" || /^calc_s\d+$/.test(u.id))) return false;
  if (acf.markRule.calcPolicy === "show_working") {
    const domain = resolveCalculationDomain(acf.subject);
    const expected = showWorkingStagePlan(acf.maxScore, domain).length;
    if (credit.length !== expected) return false;
  }
  if (acf.markRule.calcPolicy === "answer_only" && acf.maxScore >= 2) return false;
  if (acf.markRule.calcPolicy === "answer_only" && credit.length !== 1) return false;
  return true;
}

export function finalizeAssessmentCase(acf: AssessmentCaseFile): AssessmentCaseFile {
  if (isCalculationIntent(acf)) {
    return acf;
  }

  const fixedSet = isFixedSetRecallStem(acf.question, acf.maxScore);
  let units = [...acf.units];
  let relations = [...acf.relations];

  if (shouldUseIndependentUnits(acf.intent.family)) {
    relations = stripLoadBearingRelations(relations);
  }

  units = normalizeCreditUnitWeights(units, acf.maxScore);
  units = splitDualSideComparisonUnits(units);
  units = normalizeCreditUnitWeights(units, acf.maxScore);
  units = padCreditUnitsToMaxScore(units, acf.maxScore, acf.assessedUnderstanding);
  units = enrichElectronArrangementAliases(units);
  units = enrichDefinitionAliases(acf.question, units);

  if (fixedSet) {
    const credit = units.filter((u) => u.creditWeight > 0);
    for (const unit of credit) {
      unit.required = true;
    }
  }

  const markRule = applyMarkRuleDefaults({ ...acf, units, relations }, fixedSet);

  return {
    ...acf,
    units,
    relations,
    markRule,
  };
}
