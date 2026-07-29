/**
 * Multi-part calculation ask detection + mark allocation.
 * Run: npx tsx ./scripts/marking/calculationPartDetect.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  buildCalculationTemplate,
  finalizeCalculationAssessmentCase,
  resolveCalculationMaxScore,
  sumCreditWeights,
} from "../../src/services/ama/grading/case/calculationAcfPolicy.ts";
import {
  countIndependentCalculationAsks,
  recommendCalculationMaxScore,
} from "../../src/services/ama/grading/case/calculationPartDetect.ts";
import type { AssessmentCaseFile, AssessmentIntent } from "../../src/services/ama/grading/shared/types.ts";

describe("countIndependentCalculationAsks", () => {
  test("single calculate ask → 1", () => {
    assert.equal(
      countIndependentCalculationAsks(
        "A car accelerates from rest to 20 m/s in 10 s. Calculate the acceleration.",
      ),
      1,
    );
  });

  test("(a)+(b) both calculate → 2", () => {
    const q = [
      "A car accelerates uniformly from rest to 20 m/s in 10 seconds.",
      "(a) Calculate the acceleration of the car.",
      "(b) Calculate the distance travelled by the car.",
    ].join("\n");
    assert.equal(countIndependentCalculationAsks(q), 2);
  });

  test("calculate A and B quantities → 2", () => {
    assert.equal(
      countIndependentCalculationAsks(
        "Calculate the acceleration and the distance travelled by the car.",
      ),
      2,
    );
  });

  test("mixed state + calculate → 1 calc ask", () => {
    assert.equal(
      countIndependentCalculationAsks(
        "(a) State the formula for acceleration.\n(b) Calculate the acceleration.",
      ),
      1,
    );
  });
});

describe("recommendCalculationMaxScore", () => {
  test("single ask → 3", () => {
    assert.equal(
      recommendCalculationMaxScore("Calculate the acceleration of the car."),
      3,
    );
  });

  test("two calc parts → 6", () => {
    const q =
      "(a) Calculate the acceleration.\n(b) Calculate the distance travelled.";
    assert.equal(recommendCalculationMaxScore(q), 6);
  });

  test("printed Markah wins over part count", () => {
    const q =
      "(a) Calculate the acceleration.\n(b) Calculate the distance.\nMarkah: 4";
    assert.equal(recommendCalculationMaxScore(q), 4);
  });

  test("paren marks on stem win", () => {
    const q =
      "(a) Calculate the acceleration.\n(b) Calculate the distance. (6 marks)";
    assert.equal(recommendCalculationMaxScore(q), 6);
  });
});

describe("multi-part calculation ACF template", () => {
  test("two-part physics builds 6 stages totaling 6 marks", () => {
    const q =
      "(a) Calculate the acceleration of the car.\n(b) Calculate the distance travelled.";
    const maxScore = resolveCalculationMaxScore(q, 2);
    assert.equal(maxScore, 6);
    const template = buildCalculationTemplate({
      question: q,
      maxScore,
      policy: "show_working",
      subject: "Physics",
    });
    const credit = template.units.filter((u) => u.creditWeight > 0);
    assert.equal(credit.length, 6);
    assert.equal(sumCreditWeights(credit), 6);
    assert.equal(credit[0]?.id, "calc_p1_s1");
    assert.equal(credit[3]?.id, "calc_p2_s1");
    assert.ok(credit[0]?.content.startsWith("(a)"));
    assert.ok(credit[3]?.content.startsWith("(b)"));
  });

  test("finalizeCalculationAssessmentCase raises 2-mark two-part stem to 6", () => {
    const q =
      "(a) Calculate the acceleration.\n(b) Calculate the distance travelled.";
    const intent: AssessmentIntent = {
      category: "calculate",
      family: "calculation",
      assessedUnderstanding: "Calculation",
      isCompound: false,
      analysis: { questionType: "calculation", demandType: "calculation" } as AssessmentIntent["analysis"],
    };
    const acf: AssessmentCaseFile = {
      v: 3,
      question: q,
      subject: "Physics",
      form: "Form 4",
      maxScore: 2,
      intent,
      assessedUnderstanding: "Calculation",
      units: [],
      relations: [],
      markRule: { kind: "ordered_stages", maxMarks: 2, openPool: false },
      chunkRefs: [],
      contextSource: "llm_fallback",
    };
    const out = finalizeCalculationAssessmentCase(acf);
    assert.equal(out.maxScore, 6);
    assert.equal(out.units.filter((u) => u.creditWeight > 0).length, 6);
  });
});
