/**
 * Artifact policy contract tests (deterministic — no LLM).
 * Run: npm run test:marking
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveOfficialModelAnswer,
  resolveStagePlanId,
  officialMarkingPointLabels,
} from "../../src/services/ama/grading/case/artifactPolicy.js";
import type { AssessmentCaseFile, AssessmentIntent } from "../../src/services/ama/grading/shared/types.js";

function calcIntent(): AssessmentIntent {
  return {
    category: "calculate",
    family: "calculation",
    assessedUnderstanding: "Calculation",
    isCompound: false,
    analysis: { questionType: "calculation", demandType: "calculation" } as AssessmentIntent["analysis"],
  };
}

function theoryIntent(): AssessmentIntent {
  return {
    category: "state",
    family: "recall",
    assessedUnderstanding: "Recall",
    isCompound: false,
    analysis: { questionType: "recall", demandType: "recall" } as AssessmentIntent["analysis"],
  };
}

function baseAcf(overrides: Partial<AssessmentCaseFile>): AssessmentCaseFile {
  return {
    v: 3,
    question: overrides.question ?? "Calculate the mass.",
    subject: overrides.subject ?? "Chemistry",
    form: overrides.form ?? "Form 4",
    maxScore: overrides.maxScore ?? 2,
    intent: overrides.intent ?? calcIntent(),
    assessedUnderstanding: overrides.assessedUnderstanding ?? "Calculation",
    units: overrides.units ?? [
      { id: "u1", type: "stage", content: "Correct formula/equation", aliases: [], creditWeight: 1, required: true },
      { id: "u2", type: "stage", content: "Correct final answer with unit", aliases: [], creditWeight: 1, required: true },
    ],
    relations: overrides.relations ?? [],
    markRule: overrides.markRule ?? { kind: "ordered_stages", calcPolicy: "show_working" },
    referenceModelAnswer: overrides.referenceModelAnswer,
    chunkRefs: [],
    contextSource: "textbook",
  };
}

describe("resolveOfficialModelAnswer — calculation ownership", () => {
  test("structured case MA beats prose Jawapan", () => {
    const caseMa = "Formula: n = m / M\nFinal answer: 2.0 mol";
    const question = [
      "EN: Calculate the number of moles.",
      "Markah: 2",
      "Jawapan: Number of moles is 2. This uses the mole formula from the textbook.",
      "Marking points:",
      "- Mark 1: formula",
      "- Mark 2: final",
    ].join("\n");
    const resolved = resolveOfficialModelAnswer({
      question,
      acf: baseAcf({ question, referenceModelAnswer: caseMa }),
      caseReference: caseMa,
    });
    assert.equal(resolved.source, "case_structured");
    assert.match(resolved.text, /^Formula:/m);
    assert.doesNotMatch(resolved.text, /textbook/);
  });

  test("unstructured case still beats Jawapan for calc", () => {
    const caseMa = "2.0 mol";
    const question = [
      "Calculate moles.",
      "Jawapan: Long prose answer that is not staged.",
      "Marking points:",
      "- a",
    ].join("\n");
    const resolved = resolveOfficialModelAnswer({
      question,
      acf: baseAcf({ question, maxScore: 1, referenceModelAnswer: caseMa }),
      caseReference: caseMa,
    });
    assert.equal(resolved.source, "case_reference");
    assert.equal(resolved.text, "2.0 mol");
  });

  test("structured Jawapan used only when case empty", () => {
    const jawapan = "Formula: n = m / M\nFinal answer: 1 mol";
    const question = `Calculate.\nJawapan: ${jawapan}\nMarking points:\n- x`;
    const resolved = resolveOfficialModelAnswer({
      question,
      acf: baseAcf({ question, referenceModelAnswer: undefined }),
      caseReference: "",
    });
    assert.equal(resolved.source, "jawapan_structured");
    assert.match(resolved.text, /Final answer:/);
  });
});

describe("resolveOfficialModelAnswer — theory ownership", () => {
  test("case reference beats Jawapan", () => {
    const question = [
      "State the meaning of an acid.",
      "Jawapan: Draft generation answer that should yield.",
      "Marking points:",
      "- Mark 1: ionises in water",
    ].join("\n");
    const caseMa = "An acid ionises in water to produce hydrogen ions.";
    const resolved = resolveOfficialModelAnswer({
      question,
      acf: baseAcf({
        question,
        intent: theoryIntent(),
        maxScore: 1,
        units: [
          {
            id: "u1",
            type: "fact",
            content: "Ionises in water to produce H+",
            aliases: [],
            creditWeight: 1,
            required: true,
          },
        ],
        markRule: { kind: "count_distinct_units" },
        referenceModelAnswer: caseMa,
      }),
      caseReference: caseMa,
    });
    assert.equal(resolved.source, "case_reference");
    assert.equal(resolved.text, caseMa);
  });

  test("Jawapan seeds only when case empty", () => {
    const question = "State X.\nJawapan: Seed from generation.\nMarking points:\n- a";
    const resolved = resolveOfficialModelAnswer({
      question,
      acf: baseAcf({
        question,
        intent: theoryIntent(),
        maxScore: 1,
        units: [
          { id: "u1", type: "fact", content: "a", aliases: [], creditWeight: 1, required: true },
        ],
        markRule: { kind: "count_distinct_units" },
      }),
      caseReference: "",
    });
    assert.equal(resolved.source, "jawapan");
    assert.match(resolved.text, /Seed from generation/);
  });
});

describe("stage plan + marking points", () => {
  test("stagePlanId is stable for chem 2-mark show_working", () => {
    const acf = baseAcf({ maxScore: 2, subject: "Chemistry" });
    const id = resolveStagePlanId(acf);
    assert.ok(id);
    assert.match(id!, /^chemistry:show_working:2:/);
    assert.match(id!, /formula/);
    assert.match(id!, /final/);
    assert.doesNotMatch(id!, /substitution/);
  });

  test("officialMarkingPointLabels ignores zero-weight units", () => {
    const labels = officialMarkingPointLabels(
      baseAcf({
        units: [
          { id: "u1", type: "stage", content: "Formula", aliases: [], creditWeight: 1, required: true },
          { id: "u2", type: "fact", content: "Hint only", aliases: [], creditWeight: 0, required: false },
        ],
      }),
    );
    assert.deepEqual(labels, ["Formula"]);
  });
});
