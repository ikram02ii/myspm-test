/**
 * Examiner question-decomposition workflow tests (deterministic fallback path).
 * Run: npx tsx ./scripts/marking/examinerQuestionDecomposition.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { analyzeQuestion } from "../../src/services/ama/grading/shared/questionAnalysisService.ts";
import {
  buildFallbackExaminerDecomposition,
  formatExaminerDecompositionForPrompt,
  unitsFromExaminerDecomposition,
} from "../../src/services/ama/grading/extraction/examinerQuestionDecomposition.ts";

describe("examinerQuestionDecomposition", () => {
  test("meristem-style stem → 4 whole marks: 2 name + 2 role (never fused)", () => {
    const q =
      "Identify the two types of meristematic tissues and state their roles in plant growth.";
    const analysis = analyzeQuestion(q, "Biology");
    const decomp = buildFallbackExaminerDecomposition({
      question: q,
      maxScore: 2,
      analysis,
    });

    assert.equal(decomp.recommendedMaxScore, 4);
    assert.equal(decomp.markingPoints.length, 4);
    assert.equal(
      decomp.markingPoints.reduce((s, p) => s + p.marks, 0),
      decomp.recommendedMaxScore,
    );
    assert.ok(decomp.requirements.length >= 2);

    const namePoints = decomp.markingPoints.filter((p) => p.demandKind === "fact_recall");
    const rolePoints = decomp.markingPoints.filter((p) => p.demandKind === "importance_application");
    assert.equal(namePoints.length, 2);
    assert.equal(rolePoints.length, 2);

    const units = unitsFromExaminerDecomposition(decomp);
    assert.equal(units.length, 4);
    assert.ok(units.every((u) => u.creditWeight === 1));

    const prompt = formatExaminerDecompositionForPrompt(decomp);
    assert.match(prompt, /BINDING EXAMINER QUESTION DECOMPOSITION/i);
    assert.match(prompt, /Recommended total marks: 4/);
    assert.match(prompt, /Question → decomposition/i);
  });

  test("leaf identify+explain stem → 4 independent marking points", () => {
    const q =
      "Identify the two main external structures of a leaf and explain how each contributes to the leaf's primary functions.";
    const decomp = buildFallbackExaminerDecomposition({
      question: q,
      maxScore: 4,
      analysis: analyzeQuestion(q, "Biology"),
    });
    assert.equal(decomp.recommendedMaxScore, 4);
    assert.equal(decomp.markingPoints.length, 4);
  });

  test("pure recall does not invent role marks", () => {
    const q = "State two factors that affect the rate of reaction.";
    const decomp = buildFallbackExaminerDecomposition({
      question: q,
      maxScore: 2,
      analysis: analyzeQuestion(q, "Chemistry"),
    });
    assert.equal(decomp.recommendedMaxScore, 2);
    assert.equal(decomp.markingPoints.length, 2);
    assert.ok(decomp.markingPoints.every((p) => p.demandKind === "fact_recall"));
  });

  test("marking-point count always equals recommendedMaxScore sum", () => {
    const q = "Name three organelles found in a plant cell and describe the function of each.";
    const decomp = buildFallbackExaminerDecomposition({
      question: q,
      maxScore: 3,
      analysis: analyzeQuestion(q, "Biology"),
    });
    assert.equal(decomp.recommendedMaxScore, 6);
    assert.equal(decomp.markingPoints.length, 6);
    assert.equal(
      decomp.markingPoints.reduce((s, p) => s + p.marks, 0),
      6,
    );
  });
});
