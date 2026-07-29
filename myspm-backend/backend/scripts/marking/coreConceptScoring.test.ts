/**
 * Generic, deterministic core-concept scoring tests (no LLM, temperature-0).
 *
 * These verify the STRUCTURAL fix — short-but-correct answers earn credit,
 * wrong/vague short answers do not, length-scaling behaves, enumeration vs
 * explain routing is type-driven, and the fixed-set stem detector is generic.
 *
 * No specific production question/answer is reused; cases are synthetic and
 * span multiple subjects and question types on purpose.
 *
 * Run: npx tsx ./scripts/marking/coreConceptScoring.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  coversCoreConcept,
  deriveCoreConcept,
  studentCoversUnitCore,
} from "../../src/services/ama/grading/matching/coreConceptMatch.ts";
import {
  isEnumerationStem,
  isFixedSetRecallStem,
} from "../../src/services/ama/grading/case/acfFinalizePolicy.ts";
import type {
  AssessmentCaseFile,
  AssessmentIntentCategory,
  AssessmentIntentFamily,
  EvidenceUnit,
} from "../../src/services/ama/grading/shared/types.ts";

function unit(partial: Partial<EvidenceUnit> & { content: string }): EvidenceUnit {
  return {
    id: partial.id ?? "u1",
    type: partial.type ?? "fact",
    content: partial.content,
    coreConcept: partial.coreConcept,
    aliases: partial.aliases ?? [],
    creditWeight: partial.creditWeight ?? 1,
    required: partial.required ?? false,
  };
}

function acf(params: {
  question: string;
  maxScore: number;
  family: AssessmentIntentFamily;
  category: AssessmentIntentCategory;
  markKind: AssessmentCaseFile["markRule"]["kind"];
  questionType?: string;
  requiresExamples?: boolean;
}): AssessmentCaseFile {
  return {
    v: 3,
    question: params.question,
    subject: "Generic",
    form: "Form 4",
    maxScore: params.maxScore,
    intent: {
      category: params.category,
      family: params.family,
      assessedUnderstanding: "",
      isCompound: false,
      analysis: {
        questionType: params.questionType ?? "theory",
        requiresExamples: params.requiresExamples ?? false,
      } as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "",
    units: [],
    relations: [],
    markRule: { kind: params.markKind, maxMarks: params.maxScore, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
  };
}

describe("coreConcept derivation (backward-compat fallback)", () => {
  test("prefers explicit coreConcept", () => {
    assert.equal(deriveCoreConcept(unit({ content: "long text", coreConcept: "cannot be derived", aliases: ["x"] })), "cannot be derived");
  });
  test("falls back to shortest alias when coreConcept absent", () => {
    assert.equal(deriveCoreConcept(unit({ content: "long content sentence", aliases: ["kilogram", "kg"] })), "kg");
  });
  test("falls back to content when no coreConcept and no aliases", () => {
    assert.equal(deriveCoreConcept(unit({ content: "the only text" })), "the only text");
  });
});

describe("length-scaled core-concept coverage", () => {
  test("short concept present verbatim → credit", () => {
    // Physics-style: SI unit token.
    assert.equal(coversCoreConcept("mass is measured in kg", "kg"), true);
  });
  test("short concept ABSENT → no credit even though answer is short", () => {
    // Wrong unit token: grams is not the kilogram concept.
    assert.equal(coversCoreConcept("mass is in grams", "kilogram"), false);
  });
  test("long concept allows partial expression", () => {
    // Biology-style phrase; student expresses most content words.
    assert.equal(coversCoreConcept("the total length of the path travelled", "total length of path travelled"), true);
  });
  test("unrelated short answer does not match a long concept", () => {
    assert.equal(coversCoreConcept("the speed", "rate of change of distance"), false);
  });
  test("vague generic word does not match a specific concept", () => {
    assert.equal(coversCoreConcept("it is a quantity", "cannot be derived from other quantities"), false);
  });
});

describe("studentCoversUnitCore uses coreConcept then aliases", () => {
  const massUnit = unit({
    id: "mass",
    content: "The SI base unit of mass is the kilogram (kg).",
    coreConcept: "kilogram",
    aliases: ["kg"],
  });
  const currentUnit = unit({
    id: "current",
    content: "The SI base unit of electric current is the ampere (A).",
    coreConcept: "ampere",
    aliases: ["A"],
  });

  test("keyword-only answer credits the named concept via alias", () => {
    assert.equal(studentCoversUnitCore("kg", massUnit), true);
  });
  test("keyword-only answer does NOT credit an unnamed concept", () => {
    assert.equal(studentCoversUnitCore("kg", currentUnit), false);
  });
  test("wrong keyword credits neither concept", () => {
    assert.equal(studentCoversUnitCore("grams", massUnit), false);
    assert.equal(studentCoversUnitCore("volts", currentUnit), false);
  });
});

describe("enumeration stem detection is type-driven (generic)", () => {
  test("state/name/list recall → enumeration", () => {
    const a = acf({ question: "State two examples of vector quantities.", maxScore: 2, family: "recall", category: "state", markKind: "count_distinct_units", requiresExamples: true });
    assert.equal(isEnumerationStem(a), true);
  });
  test("list stem (different subject wording) → enumeration", () => {
    const a = acf({ question: "List three organelles found in a plant cell.", maxScore: 3, family: "recall", category: "list", markKind: "count_distinct_units" });
    assert.equal(isEnumerationStem(a), true);
  });
  test("explanation → NOT enumeration (verifier path unchanged)", () => {
    const a = acf({ question: "Explain why ionic compounds have high melting points.", maxScore: 2, family: "explanation", category: "explain", markKind: "count_distinct_units" });
    assert.equal(isEnumerationStem(a), false);
  });
  test("coverage_chain mark rule → NOT enumeration", () => {
    const a = acf({ question: "Describe how a nerve impulse is transmitted.", maxScore: 3, family: "process", category: "describe", markKind: "coverage_chain" });
    assert.equal(isEnumerationStem(a), false);
  });
  test("comparison → NOT enumeration", () => {
    const a = acf({ question: "Compare speed and velocity.", maxScore: 2, family: "comparison", category: "compare", markKind: "count_distinct_units" });
    assert.equal(isEnumerationStem(a), false);
  });
});

describe("fixed-set stem detection is generic (no topic strings)", () => {
  test("closed count equal to marks → fixed set", () => {
    assert.equal(isFixedSetRecallStem("State the two subatomic particles found in the nucleus. (2 marks)", 2), true);
    assert.equal(isFixedSetRecallStem("Name three noble gases. (3 marks)", 3), true);
  });
  test("compare/difference stem → NOT fixed set even with a count", () => {
    assert.equal(isFixedSetRecallStem("State one difference between mass and weight. (2 marks)", 2), false);
  });
  test("count not equal to marks → NOT fixed set", () => {
    assert.equal(isFixedSetRecallStem("List three examples of forces. (2 marks)", 2), false);
  });
});
