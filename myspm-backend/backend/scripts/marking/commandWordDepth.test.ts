/**
 * Command-word depth alignment: the question command word must set the required
 * answer depth consistently across intent classification, marking-point
 * generation guidance, per-intent evaluation depth, and model-answer depth.
 *
 * These are deterministic (no LLM) checks that lock the SPM/LPM principle:
 * identification questions are not held to explanation-level detail, and
 * explanation questions still require reasoning.
 *
 * Run: npx tsx ./scripts/marking/commandWordDepth.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  classifyAssessmentIntent,
  answerDepthDirectiveForIntent,
  intentGuidanceForLlm,
  COMMAND_WORD_DEPTH_POLICY_LINES,
} from "../../src/services/ama/grading/agents/classifyIntent.ts";
import { hasTwoDistinctDemandsJoinedByAnd } from "../../src/services/ama/grading/shared/gradingPolicy.ts";
import { classifyModelAnswerVerbFamily } from "../../src/services/ama/grading/feedback/modelAnswerFeedbackFormatPolicy.ts";
import type {
  AssessmentIntent,
  AssessmentIntentFamily,
} from "../../src/services/ama/grading/shared/types.ts";

function familyOf(question: string, maxScore = 2): AssessmentIntentFamily {
  return classifyAssessmentIntent({ question, maxScore }).family;
}

function intentOf(family: AssessmentIntentFamily): AssessmentIntent {
  return {
    category: "state",
    family,
    assessedUnderstanding: "",
    isCompound: false,
    analysis: {} as AssessmentIntent["analysis"],
  };
}

describe("command-word intent classification", () => {
  test("State / List / Name / Identify map to the recall family", () => {
    assert.equal(familyOf("State two examples of vector quantities."), "recall");
    assert.equal(familyOf("List the products of photosynthesis."), "recall");
    assert.equal(familyOf("Name the gas released during respiration."), "recall");
    assert.equal(familyOf("Identify the type of chemical bond in sodium chloride."), "recall");
  });

  test("Explain / Why map to the explanation family", () => {
    assert.equal(familyOf("Explain why ionic compounds have high melting points."), "explanation");
    assert.equal(familyOf("Why does a metal expand when heated?"), "explanation");
  });

  test("Describe maps to the reasoning-capable tier (describe/explain), never recall", () => {
    // SPM groups Describe with Explain: both may require description, reasoning, or
    // mechanism where the stem asks for it — so either family is depth-appropriate,
    // but a Describe stem must NEVER collapse to bare recall.
    const describeTier: AssessmentIntentFamily[] = ["description", "explanation"];
    assert.ok(describeTier.includes(familyOf("Describe the structure of a plant cell.")));
    assert.ok(describeTier.includes(familyOf("Describe how oxygen moves from the alveolus into the blood.")));
  });

  test("Compare / Differentiate map to the comparison family", () => {
    assert.equal(familyOf("Compare the properties of metals and non-metals."), "comparison");
    assert.equal(familyOf("Differentiate between speed and velocity."), "comparison");
  });

  test("Define maps to the definition family", () => {
    assert.equal(familyOf("Define momentum."), "definition");
  });
});

describe("per-intent answer-depth directive", () => {
  test("recall depth forbids requiring explanation/elaboration", () => {
    const text = answerDepthDirectiveForIntent(intentOf("recall")).join("\n");
    assert.match(text, /State \/ Name \/ List \/ Identify/i);
    assert.match(text, /earns the mark on its own/i);
    assert.match(text, /Do NOT require any explanation/i);
  });

  test("explanation depth requires reason/mechanism/relationship", () => {
    const text = answerDepthDirectiveForIntent(intentOf("explanation")).join("\n");
    assert.match(text, /Explain \/ Why \/ How/i);
    assert.match(text, /required reason, mechanism, or relationship/i);
  });

  test("recall and explanation directives are not identical", () => {
    const recall = answerDepthDirectiveForIntent(intentOf("recall")).join("\n");
    const explanation = answerDepthDirectiveForIntent(intentOf("explanation")).join("\n");
    assert.notEqual(recall, explanation);
  });

  test("comparison depth credits each side independently", () => {
    const text = answerDepthDirectiveForIntent(intentOf("comparison")).join("\n");
    assert.match(text, /each side's contrast independently/i);
  });

  test("unknown family falls back to a generic depth directive", () => {
    const text = answerDepthDirectiveForIntent(intentOf("general")).join("\n");
    assert.match(text, /do NOT demand more than the question asks/i);
  });
});

describe("generation guidance depth by command word", () => {
  test("recall generation guidance does not force explanation-level concept units", () => {
    const text = intentGuidanceForLlm(intentOf("recall"), 2, "State two examples of vector quantities.").join("\n");
    assert.doesNotMatch(text, /independently creditworthy concept unit/i);
  });

  test("explanation generation guidance requires concept units, not bare facts", () => {
    const text = intentGuidanceForLlm(
      intentOf("explanation"),
      2,
      "Explain why ionic compounds have high melting points.",
    ).join("\n");
    assert.match(text, /independently creditworthy concept unit/i);
  });
});

describe("model-answer depth by command word", () => {
  test("State/List/Name → state_or_identify depth", () => {
    assert.equal(classifyModelAnswerVerbFamily("State two examples of vector quantities."), "state_or_identify");
    assert.equal(classifyModelAnswerVerbFamily("List the products of photosynthesis."), "state_or_identify");
  });

  test("Explain/Describe → explain_or_describe depth", () => {
    assert.equal(
      classifyModelAnswerVerbFamily("Explain why ionic compounds have high melting points."),
      "explain_or_describe",
    );
    assert.equal(classifyModelAnswerVerbFamily("Describe the structure of a plant cell."), "explain_or_describe");
  });

  test("Compare → compare_or_differentiate depth", () => {
    assert.equal(
      classifyModelAnswerVerbFamily("Compare the properties of metals and non-metals."),
      "compare_or_differentiate",
    );
  });
});

describe("combined requirement questions (identify + explain)", () => {
  test("two distinct command-word demands joined by 'and' are detected", () => {
    assert.equal(
      hasTwoDistinctDemandsJoinedByAnd("Identify the organ and explain its function."),
      true,
    );
  });

  test("a single-demand stem is not treated as combined", () => {
    assert.equal(hasTwoDistinctDemandsJoinedByAnd("State two examples of vector quantities."), false);
  });
});

describe("cross-cutting command-word depth policy", () => {
  test("policy encodes the four SPM/LPM marking principles", () => {
    const text = COMMAND_WORD_DEPTH_POLICY_LINES.join("\n");
    assert.match(text, /follow the question command word/i);
    assert.match(text, /only what the question asks/i);
    assert.match(text, /Do NOT require explanations, reasons, functions, or mechanisms unless/i);
    assert.match(text, /Do NOT reduce marks because a student did not add detail/i);
  });
});
