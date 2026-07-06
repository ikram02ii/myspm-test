/**
 * Calculation answer verification tests (deterministic — no LLM).
 * Run: npm run test:calculation-verify
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  inferCalculationPolicy,
  isCalculationIntent,
} from "../src/services/ama/grading/v3/calculationAcfPolicy.js";
import {
  applyVerificationToAcf,
  computeEmpiricalFormulaFromComposition,
  normalizeFormula,
  parseEmpiricalCompositionQuestion,
  reverseCheckEmpiricalFormula,
  verifyCalculationReferenceAnswer,
} from "../src/services/ama/grading/v3/calculationAnswerVerification.js";
import type { AssessmentCaseFile, AssessmentIntent } from "../src/services/ama/grading/v3/types.js";

const EMPIRICAL_QUESTION =
  "Determine the empirical formula of a compound containing 60% carbon, 13.3% hydrogen and 26.7% oxygen. " +
  "Given relative atomic masses C=12, H=1, O=16. (2 marks)";

function calcIntent(): AssessmentIntent {
  return {
    category: "calculate",
    family: "calculation",
    assessedUnderstanding: "Calculation",
    isCompound: false,
    analysis: { questionType: "calculation", demandType: "calculation" } as AssessmentIntent["analysis"],
  };
}

const ALL_CALC_STEMS = [
  "Calculate the mass of sodium chloride produced. (1 mark)",
  "Calculate the concentration of the solution in mol dm-3. (2 marks)",
  "Calculate the average rate of reaction. Show your working. (3 marks)",
  "Calculate the volume of gas collected at rtp. (2 marks)",
  EMPIRICAL_QUESTION,
];

describe("calculation answer verification", () => {
  test("parses empirical composition question with atomic mass overrides", () => {
    const parsed = parseEmpiricalCompositionQuestion(EMPIRICAL_QUESTION);
    assert.ok(parsed);
    assert.equal(parsed.kind, "empirical_formula");
    assert.deepEqual(
      parsed.elements.map((e) => ({ symbol: e.symbol, percent: e.percent, atomicMass: e.atomicMass })),
      [
        { symbol: "C", percent: 60, atomicMass: 12 },
        { symbol: "H", percent: 13.3, atomicMass: 1 },
        { symbol: "O", percent: 26.7, atomicMass: 16 },
      ],
    );
  });

  test("computes C3H8O from stated composition", () => {
    const parsed = parseEmpiricalCompositionQuestion(EMPIRICAL_QUESTION)!;
    const formula = computeEmpiricalFormulaFromComposition(parsed);
    assert.equal(formula, "C3H8O");
  });

  test("reverse-check accepts C3H8O and rejects chunk-style CH2O", () => {
    const parsed = parseEmpiricalCompositionQuestion(EMPIRICAL_QUESTION)!;

    const correct = reverseCheckEmpiricalFormula(parsed, "The empirical formula is C3H8O.");
    assert.equal(correct.pass, true);
    assert.equal(correct.applicable, true);

    const wrong = reverseCheckEmpiricalFormula(parsed, "CH2O");
    assert.equal(wrong.pass, false);
    assert.match(wrong.detail ?? "", /Composition mismatch/i);
    assert.match(wrong.detail ?? "", /60/);
    assert.equal(wrong.expectedFormula, "C3H8O");
  });

  test("verifyCalculationReferenceAnswer corrects CH2O to verified C3H8O without LLM", async () => {
    const result = await verifyCalculationReferenceAnswer({
      question: EMPIRICAL_QUESTION,
      subject: "Chemistry",
      form: "Form 5",
      candidateAnswer: "CH2O",
      textbookExcerpt: "Worked example from textbook: empirical formula CH2O for a different compound.",
      maxRetries: 2,
    });

    assert.equal(result.status, "verified");
    assert.equal(result.verificationMethod, "reverse_check");
    assert.ok(result.verifiedAt);
    assert.equal(normalizeFormula(result.answer ?? ""), "C3H8O");
  });

  test("applyVerificationToAcf strips unverified reference answer on pending_review", () => {
    const acf: Pick<AssessmentCaseFile, "referenceModelAnswer" | "verifiedAt" | "verificationMethod"> = {
      referenceModelAnswer: "CH2O",
    };

    const pending = applyVerificationToAcf(acf, {
      status: "pending_review",
      verificationMethod: "pending_review",
      verificationNote: "Composition mismatch",
    });

    assert.equal(pending.referenceModelAnswer, undefined);
    assert.equal(pending.verificationMethod, "pending_review");
    assert.equal(pending.verificationNote, "Composition mismatch");
  });

  test("verification applies to all calculation intent questions (answer_only and show_working)", () => {
    for (const sample of ALL_CALC_STEMS) {
      const policy = inferCalculationPolicy(sample, 2, "Chemistry");
      assert.ok(policy === "answer_only" || policy === "show_working", sample);

      const acf = {
        intent: calcIntent(),
        markRule: { kind: "count_distinct_units" as const, maxMarks: 2, calcPolicy: policy },
      };
      assert.equal(isCalculationIntent(acf), true, sample);
    }
  });
});
