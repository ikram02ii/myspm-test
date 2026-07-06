/**
 * Audit calculation marking failure modes (deterministic — no LLM).
 * Run: npm run test:calculation-grading-audit
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  finalizeCalculationAssessmentCase,
} from "../src/services/ama/grading/v3/calculationAcfPolicy.js";
import {
  detectUnitMismatch,
  extractComparableFinalAnswer,
  quoteLooksLikeFormula,
  studentAnswerMatchesReference,
} from "../src/services/ama/grading/v3/calculationNumericMatch.js";
import {
  buildCalcAuditFixtures,
  reconcileCalculationDemonstration,
} from "../src/services/ama/grading/v3/reconcileCalculationDemonstration.js";
import { scoreFromDemonstration } from "../src/services/ama/grading/v3/scoreFromDemonstration.js";
import type { AssessmentCaseFile, AssessmentIntent } from "../src/services/ama/grading/v3/types.js";

function calcIntent(): AssessmentIntent {
  return {
    category: "calculate",
    family: "calculation",
    assessedUnderstanding: "Calculation",
    isCompound: false,
    analysis: { questionType: "calculation", demandType: "calculation" } as AssessmentIntent["analysis"],
  };
}

function baseAcf(overrides: Partial<AssessmentCaseFile>): AssessmentCaseFile {
  return finalizeCalculationAssessmentCase({
    v: 3,
    question: overrides.question ?? "Calculate X. (2 marks)",
    subject: "Chemistry",
    form: "Form 5",
    maxScore: overrides.maxScore ?? 2,
    intent: calcIntent(),
    assessedUnderstanding: "Calculation",
    units: overrides.units ?? [],
    relations: overrides.relations ?? [],
    markRule: overrides.markRule ?? {
      kind: "ordered_stages",
      maxMarks: overrides.maxScore ?? 2,
      openPool: false,
      calcPolicy: "show_working",
    },
    chunkRefs: [],
    contextSource: "llm_fallback",
    referenceModelAnswer: overrides.referenceModelAnswer,
    ...overrides,
  });
}

describe("calculation numeric match", () => {
  test("rejects same number with wrong unit", () => {
    assert.equal(studentAnswerMatchesReference("2 g", "2 mol"), false);
    assert.ok(detectUnitMismatch("2 g", "2 mol")?.includes("mol"));
  });

  test("accepts matching value and unit", () => {
    assert.equal(studentAnswerMatchesReference("2 mol", "2 mol"), true);
    assert.equal(studentAnswerMatchesReference("n = 2 mol", "2 mol"), true);
  });

  test("formula shape detection", () => {
    assert.equal(quoteLooksLikeFormula("n = V/24"), true);
    assert.equal(quoteLooksLikeFormula("58.5"), false);
  });

  test("extracts final from long reference blob", () => {
    const ref =
      "Formula: Mass = n × Mr\nWorking: n = 1 mol\nFinal answer: 58.5 g";
    assert.equal(extractComparableFinalAnswer(ref), "58.5 g");
    assert.equal(studentAnswerMatchesReference("58.5 g", ref), true);
    assert.equal(studentAnswerMatchesReference("Mass = 1 × 58.5 = 58.5 g", ref), true);
  });

  test("accepts 1 mol vs 1.0 mol reference", () => {
    assert.equal(studentAnswerMatchesReference("1 mol", "Final answer: 1.0 mol"), true);
  });
});

describe("calculation grading audit fixtures", () => {
  const fixtures = buildCalcAuditFixtures();

  for (const fixture of fixtures) {
    test(`${fixture.id}: ${fixture.description}`, () => {
      const acf = baseAcf({
        question: fixture.question,
        maxScore: fixture.maxScore,
        referenceModelAnswer: fixture.referenceModelAnswer,
      });

      const beforeScore = scoreFromDemonstration(acf, fixture.llmUdm).score;

      const reconciled = reconcileCalculationDemonstration({
        question: fixture.question,
        studentAnswer: fixture.studentAnswer,
        acf,
        udm: fixture.llmUdm,
        referenceModelAnswer: fixture.referenceModelAnswer,
      });

      const afterScore = scoreFromDemonstration(acf, reconciled).score;

      if (fixture.category === "wrong_final" || fixture.category === "unit_error") {
        assert.ok(
          afterScore <= beforeScore,
          `expected reconcile to lower or keep score (before=${beforeScore}, after=${afterScore})`,
        );
      }

      assert.equal(
        afterScore,
        fixture.expectedScore,
        `fixture ${fixture.id}: expected ${fixture.expectedScore}, got ${afterScore}`,
      );
    });
  }
});

describe("audit summary", () => {
  test("reports failure categories covered", () => {
    const fixtures = buildCalcAuditFixtures();
    const categories = new Set(fixtures.map((f) => f.category));
    assert.ok(categories.has("wrong_final"));
    assert.ok(categories.has("missing_formula"));
    assert.ok(categories.has("unit_error"));
    assert.ok(categories.has("valid_working"));
  });
});
