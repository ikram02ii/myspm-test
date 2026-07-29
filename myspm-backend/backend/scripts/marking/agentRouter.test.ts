/**
 * Marking-agent router tests (deterministic).
 * Run: npm run test:marking
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseClientQuestionTypeHint,
  resolveOpenEndedMarkingAgent,
} from "../../src/services/ama/grading/agents/resolveMarkingAgent.js";
import type { AssessmentCaseFile, AssessmentIntent } from "../../src/services/ama/grading/shared/types.js";

function intent(partial: Partial<AssessmentIntent> & Pick<AssessmentIntent, "category" | "family">): AssessmentIntent {
  return {
    assessedUnderstanding: "x",
    isCompound: false,
    analysis: { questionType: partial.family, demandType: partial.family } as AssessmentIntent["analysis"],
    ...partial,
  };
}

function acf(intentVal: AssessmentIntent): AssessmentCaseFile {
  return {
    v: 3,
    question: "q",
    subject: "Chemistry",
    form: "Form 4",
    maxScore: 2,
    intent: intentVal,
    assessedUnderstanding: "x",
    units: [],
    relations: [],
    markRule: { kind: "count_distinct_units" },
    chunkRefs: [],
    contextSource: "textbook",
  };
}

describe("resolveOpenEndedMarkingAgent", () => {
  test("routes calculation intent to calculation agent", () => {
    assert.equal(
      resolveOpenEndedMarkingAgent(
        acf(intent({ category: "calculate", family: "calculation" })),
      ),
      "calculation",
    );
  });

  test("routes recall intent to theory agent", () => {
    assert.equal(
      resolveOpenEndedMarkingAgent(acf(intent({ category: "state", family: "recall" }))),
      "theory",
    );
  });

  test("routes calculation topLevel on analysis to calculation agent", () => {
    assert.equal(
      resolveOpenEndedMarkingAgent(
        acf(
          intent({
            category: "calculate",
            family: "calculation",
            analysis: {
              questionType: "calculation",
              demandType: "calculation",
              topLevelQuestionType: "calculation",
            } as AssessmentIntent["analysis"],
          }),
        ),
      ),
      "calculation",
    );
  });

  test("routes theory topLevel even if family wrongly calculation", () => {
    assert.equal(
      resolveOpenEndedMarkingAgent(
        acf(
          intent({
            category: "calculate",
            family: "calculation",
            analysis: {
              questionType: "calculation",
              demandType: "calculation",
              topLevelQuestionType: "theory",
            } as AssessmentIntent["analysis"],
          }),
        ),
      ),
      "theory",
    );
  });
});

describe("parseClientQuestionTypeHint", () => {
  test("parses calculation hints", () => {
    assert.equal(parseClientQuestionTypeHint("calculation"), "calculation");
    assert.equal(parseClientQuestionTypeHint("Calculate_working"), "calculation");
  });

  test("parses theory hints", () => {
    assert.equal(parseClientQuestionTypeHint("theory"), "theory");
    assert.equal(parseClientQuestionTypeHint("open_ended"), "theory");
  });

  test("unknown returns null", () => {
    assert.equal(parseClientQuestionTypeHint("speaking_part1"), null);
    assert.equal(parseClientQuestionTypeHint(""), null);
  });
});
