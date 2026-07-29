/**
 * Calculation ACF generation tests (deterministic — no LLM).
 * Run: npm run test:calculation-acf
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  buildCalculationTemplate,
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  PHYSICS_CALCULATION_STAGE_LABELS,
  finalizeCalculationAssessmentCase,
  inferCalculationPolicy,
  isProseDefinitionUnit,
  normalizeCalculationAcf,
  physicsShowWorkingStagePlan,
  questionRequiresShownWorking,
  showWorkingStagePlan,
  sumCreditWeights,
  validateAcfTopology,
  validateCalculationAcf,
} from "../../src/services/ama/grading/case/calculationAcfPolicy.js";
import { reconcileCalculationDemonstration } from "../../src/services/ama/grading/matching/reconcileCalculationDemonstration.js";
import { scoreFromDemonstration } from "../../src/services/ama/grading/scoring/scoreFromDemonstration.js";
import type { AssessmentCaseFile, AssessmentIntent, EvidenceRelation, EvidenceUnit } from "../../src/services/ama/grading/shared/types.js";

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
  { q: "Calculate the mass of sodium chloride produced. (1 mark)", marks: 1 },
  { q: "Calculate the average rate of reaction. (2 marks)", marks: 2 },
  { q: "Calculate the volume of gas at r.t.p. Show your working. (2 marks)", marks: 2 },
  { q: "Hitung kadar tindak balas purata. (3 markah)", marks: 3 },
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
    test(`chemistry template always has 3 stages (requested ${sample.marks} marks)`, () => {
      const policy = inferCalculationPolicy(sample.q, sample.marks, "Chemistry");
      assert.equal(policy, "show_working");
      const template = buildCalculationTemplate({
        question: sample.q,
        maxScore: sample.marks,
        policy,
        subject: "Chemistry",
      });
      const expectedMarks = Math.max(3, sample.marks);
      assert.equal(template.markRule.calcDomain, "chemistry");
      assert.equal(sumCreditWeights(template.units), expectedMarks);
      assert.equal(template.markRule.openPool, false);
      assert.equal(template.markRule.calcPolicy, "show_working");
      const labels = template.units.filter((u) => u.creditWeight > 0).map((u) => u.content);
      assert.deepEqual(labels, [
        CALCULATION_STAGE_LABELS.formula,
        CALCULATION_STAGE_LABELS.substitution,
        CALCULATION_STAGE_LABELS.final,
      ]);
    });
  }

  test("physics always uses formula + steps + final (promotes 2→3)", () => {
    const q = "Calculate the velocity of the object. (2 marks)";
    assert.equal(inferCalculationPolicy(q, 2, "Physics"), "show_working");
    const template = buildCalculationTemplate({
      question: q,
      maxScore: 2,
      policy: "show_working",
      subject: "Physics",
    });
    assert.equal(template.markRule.calcDomain, "physics");
    assert.equal(template.markRule.calcPolicy, "show_working");
    const credit = template.units.filter((u) => u.creditWeight > 0);
    assert.equal(credit.length, 3);
    assert.equal(credit[0]?.id, "calc_s1");
    assert.equal(credit[0]?.content, PHYSICS_CALCULATION_STAGE_LABELS.formula);
    assert.equal(credit[1]?.content, PHYSICS_CALCULATION_STAGE_LABELS.substitution);
    assert.equal(credit[2]?.content, PHYSICS_CALCULATION_STAGE_LABELS.final);
    assert.equal(credit[2]?.creditWeight, 1);
    assert.equal(sumCreditWeights(template.units), 3);
  });

  test("physics 4-mark stage plan: formula + working(2) + final", () => {
    const plan = physicsShowWorkingStagePlan(4);
    assert.deepEqual(
      plan.map((s) => ({ label: s.label, weight: s.weight })),
      [
        { label: PHYSICS_CALCULATION_STAGE_LABELS.formula, weight: 1 },
        { label: PHYSICS_CALCULATION_STAGE_LABELS.substitution, weight: 2 },
        { label: PHYSICS_CALCULATION_STAGE_LABELS.final, weight: 1 },
      ],
    );
    const template = buildCalculationTemplate({
      question: "Calculate the orbital speed. (4 marks)",
      maxScore: 4,
      policy: "show_working",
      subject: "Physics",
    });
    assert.equal(sumCreditWeights(template.units), 4);
    assert.equal(template.units.filter((u) => u.creditWeight > 0).length, 3);
    const finalUnit = template.units.find((u) => u.content === PHYSICS_CALCULATION_STAGE_LABELS.final);
    assert.equal(finalUnit?.creditWeight, 1);
  });

  test("physics 5-mark keeps three stages with extra weight on working", () => {
    const plan = physicsShowWorkingStagePlan(5);
    assert.equal(plan.length, 3);
    assert.equal(plan[0]?.label, PHYSICS_CALCULATION_STAGE_LABELS.formula);
    assert.equal(plan[1]?.weight, 3);
    assert.equal(plan[plan.length - 1]?.weight, 1);
  });

  test("physics 4-mark final-only earns 1 mark (not 2)", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the orbital speed of a satellite. (4 marks)",
        maxScore: 4,
        subject: "Physics",
      }),
    );
    assert.equal(acf.markRule.calcDomain, "physics");
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_s3", quote: "7.9 km/s", valid: true }],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    });
    assert.equal(result.score, 1);
  });

  test("physics wrong formula strips downstream marks", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the force. (4 marks)",
        maxScore: 4,
        subject: "Physics",
      }),
    );
    const udm = reconcileCalculationDemonstration({
      question: acf.question,
      studentAnswer: "F = ma\nF = 2 × 5 = 10 N\n10 N",
      acf,
      referenceModelAnswer: "20 N",
      udm: {
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "F = mv", valid: false },
          { unitId: "calc_s2", quote: "F = 2 × 5", valid: true },
          { unitId: "calc_s3", quote: "10 N", valid: true },
        ],
        relationsDemonstrated: [],
        unitsMissing: [],
        relationsMissing: [],
        invalidClaims: [{ text: "F = mv", reason: "Wrong formula — should be F = ma" }],
      },
    });
    const scored = scoreFromDemonstration(acf, udm);
    assert.equal(scored.score, 0);
  });

  test("answer-only final does not earn formula/working marks (hallucinated quotes stripped)", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the mass of NaCl produced. (3 marks)",
        maxScore: 3,
        subject: "Chemistry",
      }),
    );
    const udm = reconcileCalculationDemonstration({
      question: acf.question,
      studentAnswer: "58.5 g",
      acf,
      referenceModelAnswer: "58.5 g",
      udm: {
        unitsDemonstrated: [
          // LLM invents formula/working from the model answer — not in student text
          { unitId: "calc_s1", quote: "Mass = n × Mr", valid: true },
          { unitId: "calc_s2", quote: "Mass = 1 × 58.5 = 58.5", valid: true },
          { unitId: "calc_s3", quote: "58.5 g", valid: true },
        ],
        relationsDemonstrated: [],
        unitsMissing: [],
        relationsMissing: [],
        invalidClaims: [],
      },
    });
    const scored = scoreFromDemonstration(acf, udm);
    assert.equal(scored.score, 1, "only final stage should score when working is absent");
    const awarded = scored.markBreakdown.filter((row) => row.awarded).map((row) => row.rubricId);
    assert.deepEqual(awarded, ["calc_s3"]);
  });

  test("misconfigured answer_only on multi-mark ACF scores by stages not full marks", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the moles. (3 marks)",
        maxScore: 3,
        subject: "Chemistry",
      }),
    );
    // Force a bad policy that should not award full marks for final-only.
    acf.markRule = { ...acf.markRule, calcPolicy: "answer_only" };
    const scored = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_s3", quote: "2 mol", valid: true }],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    });
    assert.equal(scored.score, 1);
    assert.ok(scored.score < acf.maxScore);
  });

  test("physics partial credit: correct method, wrong arithmetic on final", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the force. (3 marks)",
        maxScore: 3,
        subject: "Physics",
      }),
    );
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [
        { unitId: "calc_s1", quote: "F = ma", valid: true },
        { unitId: "calc_s2", quote: "F = 2 × 5", valid: true },
        { unitId: "calc_s3", quote: "10 N", valid: false },
      ],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [{ text: "10 N", reason: "Arithmetic error in final value" }],
    });
    assert.equal(result.score, 2);
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

    assert.equal(sumCreditWeights(normalized.units), 3);
    assert.equal(normalized.markRule.openPool, false);
    assert.equal(normalized.markRule.calcPolicy, "show_working");
    assert.equal(normalized.units.filter((u) => u.creditWeight > 0).length, 3);

    const finalized = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the average rate. (2 marks)",
        maxScore: 2,
        units: badUnits,
        relations: badRelations,
      }),
    );
    assert.equal(finalized.maxScore, 3);
    assert.equal(validateCalculationAcf(finalized).length, 0);
  });

  test("replaces LLM fact-shaped credit units (u1/u2) with calc_s template", () => {
    const llmUnits: EvidenceUnit[] = [
      {
        id: "u1",
        type: "fact",
        content: "Relative formula mass of NaCl = 58.5 g/mol",
        aliases: [],
        creditWeight: 1,
        required: true,
      },
      {
        id: "u2",
        type: "fact",
        content: "Mass of NaCl = 58.5 g",
        aliases: [],
        creditWeight: 1,
        required: true,
      },
    ];

    const normalized = normalizeCalculationAcf({
      question: "Calculate the mass of NaCl when 1 mole is formed. (2 marks)",
      maxScore: 2,
      subject: "Chemistry",
      units: llmUnits,
      relations: [],
      markRule: { kind: "ordered_stages", maxMarks: 2, openPool: false, calcPolicy: "show_working" },
    });

    const credit = normalized.units.filter((u) => u.creditWeight > 0);
    assert.equal(credit.length, 3);
    assert.equal(credit[0]?.id, "calc_s1");
    assert.equal(credit[1]?.id, "calc_s2");
    assert.equal(credit[2]?.id, "calc_s3");
    assert.equal(credit[0]?.content, CALCULATION_STAGE_LABELS.formula);
    assert.equal(credit[1]?.content, CALCULATION_STAGE_LABELS.substitution);
    assert.equal(credit[2]?.content, CALCULATION_STAGE_LABELS.final);
  });

  test("relation direction fixed when supports present", () => {
    const units: EvidenceUnit[] = [
      {
        id: "calc_s1",
        type: "stage",
        content: CALCULATION_STAGE_LABELS.formula,
        aliases: [],
        creditWeight: 1,
        required: true,
      },
      {
        id: "calc_s2",
        type: "stage",
        content: CALCULATION_STAGE_LABELS.substitution,
        aliases: [],
        creditWeight: 1,
        required: false,
        supports: ["calc_s1"],
      },
      {
        id: "calc_s3",
        type: "stage",
        content: CALCULATION_STAGE_LABELS.final,
        aliases: [],
        creditWeight: 1,
        required: false,
        supports: ["calc_s2"],
      },
    ];
    const relations: EvidenceRelation[] = [
      { id: "r1", type: "sequence_next", from: "calc_s2", to: "calc_s1", requiredForMarks: true },
    ];

    const normalized = normalizeCalculationAcf({
      question: "Calculate X. Show your working. (3 marks)",
      maxScore: 3,
      subject: "Chemistry",
      units,
      relations,
      markRule: { kind: "ordered_stages", maxMarks: 3, openPool: false, calcPolicy: "show_working" },
    });

    const issues = validateAcfTopology(
      baseAcf({
        question: "Calculate X. Show your working. (3 marks)",
        maxScore: 3,
        units: normalized.units,
        relations: normalized.relations,
        markRule: normalized.markRule,
      }),
    );
    assert.equal(issues.filter((i) => i.code === "relation_direction_inverted").length, 0);
    assert.ok(normalized.relations.some((r) => r.from === "calc_s1" && r.to === "calc_s2"));
  });

  test("1-mark stem promotes to 3-stage scheme; final alone earns 1", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({ question: "Calculate the mass. (1 mark)", maxScore: 1 }),
    );
    assert.equal(acf.maxScore, 3);
    assert.equal(acf.markRule.calcPolicy, "show_working");
    assert.equal(acf.units.filter((u) => u.creditWeight > 0).length, 3);
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_s3", quote: "58.5 g", valid: true }],
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

    // Written-only policy: working + final WITHOUT the formula/equation stage
    // must NOT auto-credit the formula stage (previously the "implied-formula"
    // rule made this 3/3). The student never wrote the formula → 2/3.
    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [
          { unitId: "calc_s2", quote: "0.5 mol × (3/2)", valid: true },
          { unitId: "calc_s3", quote: "0.75 mol", valid: true },
        ],
      }).score,
      2,
    );

    // A genuinely written formula still earns its mark on its own.
    assert.equal(
      scoreFromDemonstration(acf, {
        ...baseUdm,
        unitsDemonstrated: [{ unitId: "calc_s1", quote: "n = V/24", valid: true }],
      }).score,
      1,
    );
  });

  test("2-mark calculation promotes to formula + steps + final", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({ question: "Calculate the mass. (2 marks)", maxScore: 2 }),
    );
    assert.equal(acf.maxScore, 3);
    assert.deepEqual(
      acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content),
      [
        CALCULATION_STAGE_LABELS.formula,
        CALCULATION_STAGE_LABELS.substitution,
        CALCULATION_STAGE_LABELS.final,
      ],
    );
  });

  test("prose definition never gates numeric credit", () => {
    const acf = finalizeCalculationAssessmentCase(
      baseAcf({
        question: "Calculate the average rate. (3 marks)",
        maxScore: 3,
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
            question: "Calculate the average rate. (3 marks)",
            maxScore: 3,
            policy: "show_working",
            subject: "Chemistry",
          }).units,
        ],
      }),
    );
    assert.ok(!acf.relations.some((r) => r.from === "def" && r.requiredForMarks));
    const result = scoreFromDemonstration(acf, {
      unitsDemonstrated: [{ unitId: "calc_s3", quote: "0.04 g/s", valid: true }],
      relationsDemonstrated: [],
      unitsMissing: [{ id: "def", kind: "unit", label: "def", reason: "not stated" }],
      relationsMissing: [],
      invalidClaims: [],
    });
    assert.equal(result.score, 1);
  });
});
