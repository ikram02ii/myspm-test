/**
 * Calculation ACF generation tests (deterministic — no LLM).
 * Run: npm run test:calculation-acf
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  buildCalculationTemplate,
  CALCULATION_STAGE_LABELS,
  finalizeCalculationAssessmentCase,
  inferCalculationPolicy,
  isProseDefinitionUnit,
  normalizeCalculationAcf,
  questionRequiresShownWorking,
  showWorkingStagePlan,
  sumCreditWeights,
  validateAcfTopology,
  validateCalculationAcf,
} from "../src/services/rag/grading/v3/calculationAcfPolicy.js";
import { scoreFromDemonstration } from "../src/services/rag/grading/v3/scoreFromDemonstration.js";
import type { AssessmentCaseFile, AssessmentIntent, EvidenceRelation, EvidenceUnit } from "../src/services/rag/grading/v3/types.js";

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
  return {
    v: 3,
    question: overrides.question ?? "Calculate the average rate of reaction.",
    subject: "Chemistry",
    form: "Form 5",
    maxScore: overrides.maxScore ?? 2,
    intent: calcIntent(),
    assessedUnderstanding: "Calculation",
    units: overrides.units ?? [],
    relations: overrides.relations ?? [],
    markRule: overrides.markRule ?? { kind: "coverage_chain", maxMarks: overrides.maxScore ?? 2, openPool: true },
    chunkRefs: [],
    contextSource: "llm_fallback",
    ...overrides,
  };
}

const CALC_QUESTIONS = [
  { q: "Calculate the mass of sodium chloride produced. (1 mark)", marks: 1, policy: "answer_only" as const },
  { q: "Calculate the average rate of reaction. (2 marks)", marks: 2, policy: "show_working" as const },
  { q: "Calculate the volume of gas at r.t.p. Show your working. (2 marks)", marks: 2, policy: "show_working" as const },
  { q: "Hitung kadar tindak balas purata. (3 markah)", marks: 3, policy: "show_working" as const },
];

describe("calculation ACF policy", () => {
  test("detects show-your-working stems", () => {
    assert.equal(questionRequiresShownWorking("Show your working."), true);
    assert.equal(questionRequiresShownWorking("Tunjukkan kerja kira."), true);
    assert.equal(questionRequiresShownWorking("Calculate the value."), false);
  });

  test("detects prose definition units", () => {
    assert.equal(
      isProseDefinitionUnit({
        id: "d1",
        type: "fact",
        content: "The average rate of reaction is defined as change in mass per unit time",
        aliases: [],
        creditWeight: 1,
        required: true,
      }),
      true,
    );
  });

  for (const sample of CALC_QUESTIONS) {
    test(`chemistry template for ${sample.marks} mark (${sample.policy})`, () => {
      const policy = inferCalculationPolicy(sample.q, sample.marks, "Chemistry");
      assert.equal(policy, sample.policy);
      const template = buildCalculationTemplate({
        question: sample.q,
        maxScore: sample.marks,
        policy,
        subject: "Chemistry",
      });
      assert.equal(template.markRule.calcDomain, "chemistry");
      assert.equal(sumCreditWeights(template.units), sample.marks);
      assert.equal(template.markRule.openPool, false);
      assert.equal(template.markRule.calcPolicy, policy);
      if (sample.policy === "answer_only") {
        assert.equal(template.units.filter((u) => u.creditWeight > 0).length, 1);
        assert.equal(template.units[0]?.content, CALCULATION_STAGE_LABELS.final);
      }
      if (sample.marks === 3) {
        const labels = template.units.filter((u) => u.creditWeight > 0).map((u) => u.content);
        assert.deepEqual(labels, [
          CALCULATION_STAGE_LABELS.formula,
          CALCULATION_STAGE_LABELS.substitution,
          CALCULATION_STAGE_LABELS.final,
        ]);
      }
    });
  }

  test("physics 2-mark without show working uses answer_only (generic rules)", () => {
    const q = "Calculate the velocity of the object. (2 marks)";
    assert.equal(inferCalculationPolicy(q, 2, "Physics"), "answer_only");
    const template = buildCalculationTemplate({
      question: q,
      maxScore: 2,
      policy: "answer_only",
      subject: "Physics",
    });
    assert.equal(template.markRule.calcDomain, "general");
    assert.equal(template.units.filter((u) => u.creditWeight > 0).length, 1);
  });

  test("normalizes bad LLM-like calculation ACF (3 weights / 2 marks + prose gate)", () => {
    const badUnits: EvidenceUnit[] = [
      {
        id: "def",
        type: "fact",
        content: "Average rate of reaction is defined as change in quantity per time",
        aliases: [],
        creditWeight: 0,
        required: true,
      },
      { id: "f1", type: "stage", content: "Formula", aliases: [], creditWeight: 1, required: true },
      { id: "f2", type: "stage", content: "Substitution", aliases: [], creditWeight: 1, required: true },
      { id: "f3", type: "stage", content: "Final answer", aliases: [], creditWeight: 1, required: true, supports: ["f2"] },
    ];
    const badRelations: EvidenceRelation[] = [
      { id: "r0", type: "causes", from: "def", to: "f1", requiredForMarks: true },
      { id: "r1", type: "sequence_next", from: "f2", to: "f1", requiredForMarks: true },
    ];

    const normalized = normalizeCalculationAcf({
      question: "Calculate the average rate. (2 marks)",
      maxScore: 2,
      subject: "Chemistry",
      units: badUnits,
      relations: badRelations,
      markRule: { kind: "coverage_chain", maxMarks: 2, openPool: true },
    });

    assert.equal(sumCreditWeights(normalized.units), 2);
    assert.equal(normalized.markRule.openPool, false);
    assert.equal(normalized.markRule.calcPolicy, "show_working");
    assert.equal(normalized.units.filter((u) => u.creditWeight > 0).length, 2);

    const finalized = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the average rate. (2 marks)",
        maxScore: 2,
        units: badUnits,
        relations: badRelations,
      }),
    );
    assert.equal(validateCalculationAcf(finalized).length, 0);
  });

  test("relation direction fixed when supports present", () => {
    const units: EvidenceUnit[] = [
      { id: "a", type: "stage", content: "Method", aliases: [], creditWeight: 1, required: true },
      { id: "b", type: "stage", content: "Answer", aliases: [], creditWeight: 1, required: false, supports: ["a"] },
    ];
    const relations: EvidenceRelation[] = [
      { id: "r1", type: "sequence_next", from: "b", to: "a", requiredForMarks: true },
    ];

    const normalized = normalizeCalculationAcf({
      question: "Calculate X. Show your working. (2 marks)",
      maxScore: 2,
      subject: "Chemistry",
      units,
      relations,
      markRule: { kind: "ordered_stages", maxMarks: 2, openPool: false, calcPolicy: "show_working" },
    });

    const issues = validateAcfTopology(
      baseAcf({ question: "Calculate X. Show your working. (2 marks)", units: normalized.units, relations: normalized.relations, markRule: normalized.markRule }),
    );
    assert.equal(issues.filter((i) => i.code === "relation_direction_inverted").length, 0);
    assert.ok(normalized.relations.some((r) => r.from === "a" && r.to === "b"));
  });

  test("answer-only scoring: 1-mark final answer alone earns full marks", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({ question: "Calculate the mass. (1 mark)", maxScore: 1 }),
    );
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_final", quote: "58.5 g", valid: true }],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    });
    assert.equal(result.score, 1);
  });

  test("3-mark sequential scoring: formula → substitution → final", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({ question: "Calculate the moles of gas. (3 marks)", maxScore: 3 }),
    );
    assert.equal(acf.markRule.calcPolicy, "show_working");
    assert.deepEqual(
      acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content),
      showWorkingStagePlan(3, "chemistry").map((s) => s.label),
    );

    const baseUdm = {
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    };

    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [{ unitId: "calc_s1", quote: "n = V/24", valid: true }],
      }).score,
      1,
    );
    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "n = V/24", valid: true },
          { unitId: "calc_s2", quote: "n = 48/24 = 2", valid: true },
        ],
      }).score,
      2,
    );
    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "n = V/24", valid: true },
          { unitId: "calc_s2", quote: "n = 48/24 = 2", valid: true },
          { unitId: "calc_s3", quote: "2 mol", valid: true },
        ],
      }).score,
      3,
    );
    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [{ unitId: "calc_s3", quote: "2 mol", valid: true }],
      }).score,
      1,
    );
  });

  test("2-mark calculation: formula + final only", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({ question: "Calculate the mass. (2 marks)", maxScore: 2 }),
    );
    assert.deepEqual(
      acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content),
      [CALCULATION_STAGE_LABELS.formula, CALCULATION_STAGE_LABELS.final],
    );
  });

  test("prose definition never gates numeric credit", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the average rate. (1 mark)",
        maxScore: 1,
        units: [
          {
            id: "def",
            type: "fact",
            content: "Average rate is defined as change in mass divided by time",
            aliases: [],
            creditWeight: 0,
            required: true,
          },
          ...buildCalculationTemplate({
            question: "Calculate the average rate. (1 mark)",
            maxScore: 1,
            policy: "answer_only",
            subject: "Chemistry",
          }).units,
        ],
      }),
    );
    assert.ok(!acf.relations.some((r) => r.from === "def" && r.requiredForMarks));
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_final", quote: "0.04 g/s", valid: true }],
      relationsDemonstrated: [],
      unitsMissing: [{ id: "def", kind: "unit", label: "def", reason: "not stated" }],
      relationsMissing: [],
      invalidClaims: [],
    });
    assert.equal(result.score, 1);
  });
});
