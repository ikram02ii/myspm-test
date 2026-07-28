/**
 * Per-point model answer + marking-point grading tests.
 * Run: npx tsx ./scripts/marking/perPointModelAnswer.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  buildStructuredMarkPointCards,
  formatMarkPointStatusSummary,
  formatPerPointModelAnswerForDisplay,
  resolvePerPointExemplars,
  splitReferenceIntoPointExemplars,
} from "../../src/services/ama/grading/case/perPointModelAnswer.ts";
import type { AssessmentCaseFile } from "../../src/services/ama/grading/shared/types.ts";

function theoryAcf(units: Array<{ id: string; content: string; marks?: number }>): AssessmentCaseFile {
  const maxScore = units.reduce((s, u) => s + (u.marks ?? 1), 0);
  return {
    v: 3,
    question: "Compare ionic and covalent bonding.",
    subject: "Chemistry",
    form: "Form 5",
    maxScore,
    intent: {
      category: "compare",
      family: "comparison",
      assessedUnderstanding: "Comparison",
      isCompound: false,
      analysis: { questionType: "theory", demandType: "compare" } as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "Comparison",
    units: units.map((u) => ({
      id: u.id,
      type: "fact" as const,
      content: u.content,
      aliases: [],
      creditWeight: u.marks ?? 1,
      required: false,
    })),
    relations: [],
    markRule: { kind: "count_distinct_units", maxMarks: maxScore, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
    referenceModelAnswer:
      "• Ionic compounds have strong electrostatic forces in a giant lattice.\n• Covalent compounds have weak intermolecular forces between molecules.",
  };
}

describe("perPointModelAnswer", () => {
  test("splits stored reference into one exemplar per unit", () => {
    const q = "Compare ionic and covalent bonding.";
    const ref =
      "• Ionic compounds have strong electrostatic forces in a giant lattice.\n• Covalent compounds have weak intermolecular forces between molecules.";
    const split = splitReferenceIntoPointExemplars(ref, 2, q);
    assert.equal(split.length, 2);
    assert.match(split[0]!, /ionic/i);
    assert.match(split[1]!, /covalent/i);
  });

  test("resolvePerPointExemplars aligns with credit units", () => {
    const acf = theoryAcf([
      { id: "u1", content: "Ionic strong electrostatic forces" },
      { id: "u2", content: "Covalent weak intermolecular forces" },
    ]);
    const rows = resolvePerPointExemplars({ acf, question: acf.question });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.unitId, "u1");
    assert.equal(rows[1]!.unitId, "u2");
    assert.match(rows[0]!.exemplar, /ionic/i);
  });

  test("formatPerPointModelAnswerForDisplay produces splittable bullets", () => {
    const acf = theoryAcf([
      { id: "u1", content: "Point A" },
      { id: "u2", content: "Point B" },
    ]);
    const rows = resolvePerPointExemplars({ acf, question: acf.question });
    const display = formatPerPointModelAnswerForDisplay(rows, acf.question);
    assert.match(display, /^1\./m);
    assert.equal(display.split(/\n\s*\n+/).filter(Boolean).length, 2);
  });

  test("structured cards carry marks and award status for feedback", () => {
    const acf = theoryAcf([
      { id: "u1", content: "Ionic strong electrostatic forces", marks: 1 },
      { id: "u2", content: "Covalent weak intermolecular forces", marks: 2 },
    ]);
    const cards = buildStructuredMarkPointCards({
      acf,
      question: acf.question,
      markBreakdown: [
        {
          idea: "Ionic strong electrostatic forces",
          marks: 1,
          awarded: true,
          reason: "ok",
          rubricId: "u1",
        },
        {
          idea: "Covalent weak intermolecular forces",
          marks: 2,
          awarded: false,
          reason: "missing",
          rubricId: "u2",
        },
      ],
    });
    assert.equal(cards.length, 2);
    assert.equal(cards[0]!.awarded, true);
    assert.equal(cards[0]!.marks, 1);
    assert.equal(cards[1]!.awarded, false);
    assert.equal(cards[1]!.marks, 2);

    const summary = formatMarkPointStatusSummary(cards, "english");
    assert.match(summary, /✓/);
    assert.match(summary, /✗/);
    assert.match(summary, /2 marks/);
  });
});
