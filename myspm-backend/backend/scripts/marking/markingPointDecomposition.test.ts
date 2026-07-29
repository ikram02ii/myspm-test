/**
 * Marking-point decomposition rules (topic-agnostic).
 * Run: npx tsx ./scripts/marking/markingPointDecomposition.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  analyzeQuestion,
  suggestMaxMarksFromQuestionStructure,
} from "../../src/services/ama/grading/shared/questionAnalysisService.ts";
import {
  classifyAssessmentIntent,
  intentGuidanceForLlm,
} from "../../src/services/ama/grading/agents/classifyIntent.ts";
import {
  buildMarkingPointDecompositionGuidance,
  inferMarkingPointDemandKinds,
  planIdentifyPlusElaborationMarks,
  recommendWholeMarkCountForStem,
  stemLeadsWithIdentificationPlusElaboration,
} from "../../src/services/ama/grading/extraction/markingPointDecomposition.ts";

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

  test("'identify X and explain X' stems reserve a mark for naming each item", () => {
    const q =
      "Identify the two main external structures of a leaf and explain how each contributes to the leaf's primary functions. (4 marks)";
    const analysis = analyzeQuestion(q, "Biology");

    assert.equal(stemLeadsWithIdentificationPlusElaboration(q, analysis), true);
    const plan = planIdentifyPlusElaborationMarks(q, analysis);
    assert.ok(plan);
    assert.equal(plan!.itemCount, 2);
    assert.equal(plan!.recommendedMaxScore, 4);

    const guidance = buildMarkingPointDecompositionGuidance(q, 4, analysis).join("\n");
    assert.match(guidance, /IDENTIFY \+ ELABORATION STEM/i);
    assert.match(guidance, /naming the item correctly MUST earn that mark/i);
    assert.match(guidance, /WHOLE MARKS ONLY/i);

    const intent = classifyAssessmentIntent({ question: q, subject: "Biology", maxScore: 4 });
    const blob = intentGuidanceForLlm(intent, 4, q, "Biology").join("\n");
    assert.match(blob, /identification unit/i);
    assert.doesNotMatch(blob, /Extract exactly 4 independently creditworthy concept unit/i);
  });

  test("identify + state their roles allocates 4 whole marks (not fused 2)", () => {
    const q =
      "Identify the two types of meristematic tissues and state their roles in plant growth.";
    const analysis = analyzeQuestion(q, "Biology");

    assert.equal(stemLeadsWithIdentificationPlusElaboration(q, analysis), true);
    assert.equal(recommendWholeMarkCountForStem(q, analysis), 4);
    assert.equal(suggestMaxMarksFromQuestionStructure(q), 4);

    const plan = planIdentifyPlusElaborationMarks(q, analysis)!;
    assert.equal(plan.nameUnitCount, 2);
    assert.equal(plan.elaborationUnitCount, 2);

    const guidance = buildMarkingPointDecompositionGuidance(q, 4, analysis).join("\n");
    assert.match(guidance, /2 identification unit/i);
    assert.match(guidance, /2 role\/function\/explanation unit/i);
    assert.match(guidance, /WHOLE MARKS ONLY/i);
  });

  test("name three organelles and describe function of each → 6 whole marks", () => {
    const q =
      "Name three organelles found in a plant cell and describe the function of each.";
    assert.equal(recommendWholeMarkCountForStem(q, analyzeQuestion(q, "Biology")), 6);
    assert.equal(suggestMaxMarksFromQuestionStructure(q), 6);
  });

  test("pure recall 'state two' stays at 2 marks (no false role split)", () => {
    const q = "State two factors that affect the rate of reaction.";
    const analysis = analyzeQuestion(q, "Chemistry");
    assert.equal(stemLeadsWithIdentificationPlusElaboration(q, analysis), false);
    assert.equal(recommendWholeMarkCountForStem(q, analysis), null);
    assert.equal(suggestMaxMarksFromQuestionStructure(q), 2);
  });

  test("'State the function of X' alone is NOT identify+elaboration", () => {
    const q = "State the function of the stomata in a leaf.";
    const analysis = analyzeQuestion(q, "Biology");
    assert.equal(stemLeadsWithIdentificationPlusElaboration(q, analysis), false);
    assert.equal(recommendWholeMarkCountForStem(q, analysis), null);
  });

  test("pure explanation stems are unaffected (no false identification split)", () => {
    const q = "Explain how the greenhouse effect warms the Earth. (3 marks)";
    const analysis = analyzeQuestion(q, "Science");
    assert.equal(stemLeadsWithIdentificationPlusElaboration(q, analysis), false);
    const intent = classifyAssessmentIntent({ question: q, subject: "Science", maxScore: 3 });
    const blob = intentGuidanceForLlm(intent, 3, q, "Science").join("\n");
    assert.match(blob, /Extract exactly 3 independently creditworthy concept unit/i);
  });
});
