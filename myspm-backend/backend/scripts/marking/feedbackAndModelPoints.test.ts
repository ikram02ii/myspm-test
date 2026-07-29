/**
 * Root-level feedback truth + model-answer point split (topic-agnostic).
 * Run: npx tsx ./scripts/marking/feedbackAndModelPoints.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  feedbackClaimsFalseProgress,
  isNonResponsiveStudentAnswer,
  reconcileFeedbackToMarkingTruth,
  shouldUseDeterministicFeedback,
} from "../../src/services/ama/grading/feedback/feedbackTruthPolicy.ts";
import { splitModelAnswerIntoPoints } from "../../src/services/ama/grading/extraction/splitModelAnswerPoints.ts";
import { formatMarkSchemePointsAsModelAnswer } from "../../src/services/ama/grading/feedback/modelAnswerFeedbackFormatPolicy.ts";

describe("feedbackTruthPolicy (any subject)", () => {
  test("classifies many non-responsive shapes", () => {
    for (const junk of ["", "8", "12.5", "???", "...", "idk", "asdf", "ok", "✨"]) {
      assert.equal(isNonResponsiveStudentAnswer(junk), true, junk);
    }
    assert.equal(
      isNonResponsiveStudentAnswer("Ionic compounds form free ions in water"),
      false,
    );
    assert.equal(
      isNonResponsiveStudentAnswer("Osmosis is the movement of water across a membrane"),
      false,
    );
  });

  test("zero awards always replace LLM praise — any topic", () => {
    const cases = [
      {
        studentAnswer: "8",
        llm: "Your answer is on the right track, but it needs more detail about ionic compounds.",
      },
      {
        studentAnswer: "photosynthesis",
        llm: "Good start. Needs more detail on stomata and guard cells.",
      },
      {
        studentAnswer: "x",
        llm: "Almost there — explain Newton's third law more carefully.",
      },
    ];
    for (const c of cases) {
      const out = reconcileFeedbackToMarkingTruth({
        feedback: c.llm,
        strengths: ["fake strength"],
        improvements: ["point a", "point b"],
        score: 0,
        maxScore: 3,
        awardedCount: 0,
        missingCount: 3,
        studentAnswer: c.studentAnswer,
      });
      assert.equal(out.strengths.length, 0, c.studentAnswer);
      assert.equal(feedbackClaimsFalseProgress(out.feedback), false, c.llm);
      assert.match(out.feedback, /0\/3/);
      assert.doesNotMatch(out.feedback, /right track|good start|almost there|needs more detail/i);
    }
  });

  test("deterministic path triggers for zero awards", () => {
    assert.equal(
      shouldUseDeterministicFeedback({ score: 0, awardedCount: 0, studentAnswer: "8" }),
      true,
    );
    assert.equal(
      shouldUseDeterministicFeedback({
        score: 2,
        awardedCount: 2,
        studentAnswer: "full working theory answer here",
      }),
      false,
    );
  });

  test("partial awards keep factual score feedback when empty", () => {
    const out = reconcileFeedbackToMarkingTruth({
      feedback: "",
      strengths: ["ionic free ions"],
      improvements: ["covalent molecules"],
      score: 1,
      maxScore: 2,
      awardedCount: 1,
      missingCount: 1,
      studentAnswer: "ionic compounds have free ions",
    });
    assert.match(out.feedback, /1\/2/);
    assert.equal(out.strengths.length, 1);
  });
});

describe("splitModelAnswerIntoPoints (any stem)", () => {
  test("does not cut mid-sentence on semicolon inside a marking point", () => {
    const blob =
      "1. Ionic compounds dissociate into free-moving ions when dissolved in water, so these ions can move and carry electric current through the solution. 2. Covalent compounds do not form free ions; they exist as molecules, which means there are no charged particles to carry the electric current.";
    const points = splitModelAnswerIntoPoints(blob, 2);
    assert.equal(points.length, 2);
    assert.match(points[0]!, /Ionic compounds/i);
    assert.match(points[1]!, /Covalent compounds/i);
    assert.match(points[1]!, /molecules/i);
  });

  test("merges soft-wrapped continuation lines into previous point", () => {
    const blob = [
      "1. First complete explanation of process A with reasoning because it matters.",
      "2. Second complete explanation of process B",
      "which continues soft-wrapped onto the next line with more detail.",
    ].join("\n");
    const points = splitModelAnswerIntoPoints(blob, 2);
    assert.equal(points.length, 2);
    assert.match(points[1]!, /Second complete.*soft-wrapped/is);
  });

  test("biology-style blank-line points stay intact", () => {
    const blob = [
      "1. Osmosis is the net movement of water molecules from a high water potential region to a low water potential region through a partially permeable membrane.",
      "",
      "2. Diffusion is the net movement of particles from a high concentration region to a low concentration region.",
    ].join("\n");
    const points = splitModelAnswerIntoPoints(blob, 2);
    assert.equal(points.length, 2);
    assert.match(points[0]!, /Osmosis/i);
    assert.match(points[1]!, /Diffusion/i);
  });

  test("formatMarkSchemePointsAsModelAnswer never uses semicolon joiners", () => {
    const formatted = formatMarkSchemePointsAsModelAnswer(
      ["First complete idea about ions", "Second complete idea about molecules"],
      "Explain why ionic compounds conduct electricity but covalent compounds do not.",
    );
    assert.doesNotMatch(formatted, /; /);
    assert.equal(splitModelAnswerIntoPoints(formatted, 2).length, 2);
  });
});
