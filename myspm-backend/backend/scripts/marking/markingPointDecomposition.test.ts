/**
 * Marking-point decomposition rules (topic-agnostic).
 * Run: npx tsx ./scripts/marking/markingPointDecomposition.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { analyzeQuestion } from "../../src/services/ama/grading/questionAnalysisService.ts";
import { classifyAssessmentIntent, intentGuidanceForLlm } from "../../src/services/ama/grading/v3/classifyIntent.ts";
import {
  buildMarkingPointDecompositionGuidance,
  inferMarkingPointDemandKinds,
} from "../../src/services/ama/grading/v3/markingPointDecomposition.ts";

describe("markingPointDecomposition", () => {
  test("maps command-word signals to demand kinds without topic content", () => {
    const kinds = inferMarkingPointDemandKinds(
      "Explain the difference between alpha and beta particles, and state why both ideas matter in radiation safety. (3 marks)",
      analyzeQuestion(
        "Explain the difference between alpha and beta particles, and state why both ideas matter in radiation safety. (3 marks)",
        "Physics",
      ),
    );
    assert.ok(kinds.includes("contrast") || kinds.includes("reason_mechanism"));
    assert.ok(kinds.includes("importance_application") || kinds.includes("fact_recall"));
    // No hardcoded topic strings in guidance
    const guidance = buildMarkingPointDecompositionGuidance(
      "Explain the difference between alpha and beta particles, and state why both ideas matter in radiation safety. (3 marks)",
      3,
      analyzeQuestion(
        "Explain the difference between alpha and beta particles, and state why both ideas matter in radiation safety. (3 marks)",
        "Physics",
      ),
    ).join("\n");
    assert.match(guidance, /exactly 3 credit-bearing/i);
    assert.match(guidance, /Do NOT merge/i);
    assert.doesNotMatch(guidance, /\baccuracy\b/i);
    assert.doesNotMatch(guidance, /\btrue\/accepted value\b/i);
  });

  test("intent guidance embeds decomposition for compound stems", () => {
    const q =
      "Define osmosis and diffusion, and explain one difference between them. (3 marks)";
    const intent = classifyAssessmentIntent({ question: q, subject: "Biology", maxScore: 3 });
    const lines = intentGuidanceForLlm(intent, 3, q, "Biology");
    const blob = lines.join("\n");
    assert.match(blob, /MARKING-POINT DECOMPOSITION/i);
    assert.match(blob, /exactly 3 credit-bearing/i);
    assert.match(blob, /COMPOUND STEM|independent assessable/i);
  });

  test("single-demand stems still get exact maxScore unit count rule", () => {
    const q = "State two factors that affect the rate of reaction. (2 marks)";
    const intent = classifyAssessmentIntent({ question: q, subject: "Chemistry", maxScore: 2 });
    const blob = intentGuidanceForLlm(intent, 2, q, "Chemistry").join("\n");
    assert.match(blob, /exactly 2 credit-bearing/i);
  });
});
