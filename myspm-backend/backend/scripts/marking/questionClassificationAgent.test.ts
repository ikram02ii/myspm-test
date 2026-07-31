/**
 * Question Classification Agent + intent routing tests (deterministic — no LLM).
 * Verifies theory stems with numbers are NOT routed to calculation without topLevel.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyzeQuestion } from "../../src/services/ama/grading/shared/questionAnalysisService.js";
import { classifyAssessmentIntent } from "../../src/services/ama/grading/agents/classifyIntent.js";
import {
  topLevelUsesCalculationAgent,
  looksLikeCalculationAnswerStructure,
  looksLikeNumericSolveStem,
  type TopLevelQuestionType,
} from "../../src/services/ama/grading/agents/questionClassificationAgent.js";
import {
  resolveOpenEndedMarkingAgent,
} from "../../src/services/ama/grading/agents/resolveMarkingAgent.js";
import type { AssessmentCaseFile, AssessmentIntent } from "../../src/services/ama/grading/shared/types.js";
import type { QuestionAnalysis } from "../../src/services/ama/types.js";

function withTopLevel(
  analysis: QuestionAnalysis,
  top: TopLevelQuestionType,
): QuestionAnalysis {
  return {
    ...analysis,
    topLevelQuestionType: top,
    topLevelConfidence: 0.9,
    topLevelReasoning: `test:${top}`,
    questionType: top === "calculation" ? "calculation" : analysis.questionType === "calculation" ? "general" : analysis.questionType,
  };
}

function acfFromAnalysis(analysis: QuestionAnalysis, question: string): AssessmentCaseFile {
  const intent = classifyAssessmentIntent({
    question,
    subject: "Biology",
    maxScore: 2,
    questionAnalysis: analysis,
  });
  return {
    v: 3,
    question,
    subject: "Biology",
    form: "Form 4",
    maxScore: 2,
    intent,
    assessedUnderstanding: intent.assessedUnderstanding,
    units: [],
    relations: [],
    markRule: { kind: "count_distinct_units" },
    chunkRefs: [],
    contextSource: "textbook",
  };
}

describe("topLevelUsesCalculationAgent", () => {
  test("only calculation lane uses calc agent", () => {
    assert.equal(topLevelUsesCalculationAgent("calculation"), true);
    assert.equal(topLevelUsesCalculationAgent("theory"), false);
    assert.equal(topLevelUsesCalculationAgent("diagram"), false);
    assert.equal(topLevelUsesCalculationAgent("structured"), false);
    assert.equal(topLevelUsesCalculationAgent("other"), false);
    assert.equal(topLevelUsesCalculationAgent(undefined), false);
  });
});

describe("classifyAssessmentIntent trusts top-level agent only for calc", () => {
  test("theory stem with numbers is NOT calculation without topLevel", () => {
    const q = "State TWO functions of the mitochondria in animal cells. (2 marks)";
    const analysis = analyzeQuestion(q, "Biology");
    // Deterministic analysis must not invent calculation from the digit "2".
    assert.notEqual(analysis.questionType, "calculation");

    const intent = classifyAssessmentIntent({
      question: q,
      subject: "Biology",
      maxScore: 2,
      questionAnalysis: analysis,
    });
    assert.notEqual(intent.family, "calculation");
    assert.notEqual(intent.category, "calculate");
  });

  test("theory topLevel keeps theory even if fine-grained type was calculation", () => {
    const q = "Explain why enzymes denature at high temperature.";
    const analysis = withTopLevel(
      { ...analyzeQuestion(q, "Biology"), questionType: "calculation" },
      "theory",
    );
    const intent = classifyAssessmentIntent({
      question: q,
      subject: "Biology",
      maxScore: 3,
      questionAnalysis: analysis,
    });
    assert.notEqual(intent.family, "calculation");
  });

  test("calculation topLevel routes to calculation family", () => {
    const q = "Calculate the average speed of the car.";
    const analysis = withTopLevel(analyzeQuestion(q, "Physics"), "calculation");
    const intent = classifyAssessmentIntent({
      question: q,
      subject: "Physics",
      maxScore: 3,
      questionAnalysis: analysis,
    });
    assert.equal(intent.family, "calculation");
    assert.equal(intent.category, "calculate");
  });

  test("diagram / structured topLevel do not use calculation family", () => {
    for (const top of ["diagram", "structured", "other"] as TopLevelQuestionType[]) {
      const q = "The diagram shows a plant cell. Label structure X.";
      const analysis = withTopLevel(analyzeQuestion(q, "Biology"), top);
      const intent = classifyAssessmentIntent({
        question: q,
        subject: "Biology",
        maxScore: 2,
        questionAnalysis: analysis,
      });
      assert.notEqual(intent.family, "calculation", top);
    }
  });

  test("command verb calculate alone does not force calculation without topLevel", () => {
    const q = "Calculate what is meant by osmosis in biology.";
    const analysis = analyzeQuestion(q, "Biology");
    // No topLevel → must not become calculation from the verb alone.
    const intent = classifyAssessmentIntent({
      question: q,
      subject: "Biology",
      maxScore: 2,
      questionAnalysis: analysis,
    });
    assert.notEqual(intent.family, "calculation");
  });
});

describe("resolveOpenEndedMarkingAgent uses topLevel when present", () => {
  test("routes theory topLevel to theory agent", () => {
    const q = "State the function of the mitochondria.";
    const stored = acfFromAnalysis(withTopLevel(analyzeQuestion(q, "Biology"), "theory"), q);
    assert.equal(resolveOpenEndedMarkingAgent(stored), "theory");
  });

  test("routes calculation topLevel to calculation agent", () => {
    const q = "Calculate the acceleration of the object.";
    const stored = acfFromAnalysis(withTopLevel(analyzeQuestion(q, "Physics"), "calculation"), q);
    assert.equal(resolveOpenEndedMarkingAgent(stored), "calculation");
  });
});

describe("analyzeQuestion no longer marks numeric theory as calculation", () => {
  const theoryStems = [
    "State TWO reasons why plant cells have a cell wall.",
    "List 3 differences between arteries and veins.",
    "Explain the role of chlorophyll in photosynthesis. (4 marks)",
    "Describe the structure of a leaf with reference to Figure 2.1.",
  ];

  for (const q of theoryStems) {
    test(`does not classify as calculation: ${q.slice(0, 48)}…`, () => {
      const analysis = analyzeQuestion(q, "Biology");
      assert.notEqual(analysis.questionType, "calculation");
      assert.notEqual(analysis.demandType, "calculation");
    });
  }
});

describe("process-based calc signals (no calculate keyword)", () => {
  test("formula + working + final scheme looks like calculation structure", () => {
    const q = [
      "A car travels 100 km in 2.0 hours. What is its average speed?",
      "Markah: 2",
      "Marking points:",
      "- Correct formula",
      "- Correct working / substitution",
      "- Correct final answer with unit",
    ].join("\n");
    assert.equal(looksLikeCalculationAnswerStructure(q), true);
  });

  test("numeric data + what is the value looks like numeric solve stem", () => {
    assert.equal(
      looksLikeNumericSolveStem(
        "A car travels 100 km in 2.0 hours. What is its average speed? (2 marks)",
      ),
      true,
    );
  });

  test("state two functions is NOT a numeric solve stem", () => {
    assert.equal(
      looksLikeNumericSolveStem("State TWO functions of the mitochondria in animal cells."),
      false,
    );
  });

  test("calculation topLevel without calculate verb still routes to calc family", () => {
    const q = "A car travels 100 km in 2.0 hours. What is its average speed?";
    const analysis = withTopLevel(analyzeQuestion(q, "Physics"), "calculation");
    const intent = classifyAssessmentIntent({
      question: q,
      subject: "Physics",
      maxScore: 2,
      questionAnalysis: analysis,
    });
    assert.equal(intent.family, "calculation");
    assert.equal(intent.category, "calculate");
  });
});

// Keep AssessmentIntent import used for typing in helpers
void (null as unknown as AssessmentIntent);
