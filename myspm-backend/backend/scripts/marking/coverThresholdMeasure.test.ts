/**
 * Step 3 — cover-threshold measurement (72% vs 55% vs 60%) after Fix D atomicization/aliases.
 * Run: npx tsx ./scripts/marking/coverThresholdMeasure.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { finalizeAssessmentCase } from "../../src/services/ama/grading/v3/acfFinalizePolicy.ts";
import {
  coversAtRatio,
  diagnoseSyncEvidenceGate,
} from "../../src/services/ama/grading/v3/udmEvidenceGate.ts";
import type { AssessmentCaseFile, EvidenceUnit } from "../../src/services/ama/grading/v3/types.ts";

function baseUnit(id: string, content: string): EvidenceUnit {
  return { id, type: "fact", content, aliases: [], creditWeight: 1, required: false };
}

function makeAcf(question: string, units: EvidenceUnit[], family: "comparison" | "definition" = "comparison"): AssessmentCaseFile {
  return finalizeAssessmentCase({
    v: 3,
    question,
    subject: "Chemistry",
    form: "Form 5",
    maxScore: units.reduce((s, u) => s + u.creditWeight, 0),
    intent: {
      category: family === "comparison" ? "compare" : "define",
      family,
      assessedUnderstanding: "Test",
      isCompound: false,
      analysis: { questionType: "theory", demandType: family } as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "Test",
    units,
    relations: [],
    markRule: { kind: "count_distinct_units", maxMarks: 2, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
  });
}

const FIXTURES: Array<{
  id: string;
  student: string;
  quote: string;
  question: string;
  units: EvidenceUnit[];
  targetUnitId: string;
}> = [
  {
    id: "A-base-quantity",
    student: "physical quantity that cannot be derived from other physical quantities.",
    quote: "physical quantity that cannot be derived from other physical quantities",
    question: "Define base quantity.",
    units: [
      baseUnit("u1", "physical quantity that cannot be defined in terms of other quantities"),
    ],
    targetUnitId: "u1",
  },
  {
    id: "B-ionic-long",
    student:
      "because the ions are held together by strong electrostatic forces of attraction between the positive and negative ions in the giant ionic lattice, so a lot of heat energy is needed to break these forces.",
    quote:
      "ions are held together by strong electrostatic forces of attraction between the positive and negative ions in the giant ionic lattice",
    question: "Explain why ionic compounds have high melting points compared with covalent compounds.",
    units: [
      baseUnit(
        "u1",
        "Ionic compounds have strong electrostatic forces between oppositely charged ions arranged in giant lattice structures, requiring high energy to break these attractions.",
      ),
      baseUnit(
        "u2",
        "Covalent compounds have weak intermolecular forces between molecules, needing less energy to separate them.",
      ),
    ],
    targetUnitId: "u1",
  },
  {
    id: "B2-dual-side-blob",
    student:
      "ions are held together by strong electrostatic forces in the giant ionic lattice so high heat energy is needed.",
    quote: "strong electrostatic forces in the giant ionic lattice so high heat energy is needed",
    question: "Differentiate between ionic and covalent compounds.",
    units: [
      baseUnit(
        "u1",
        "Ionic compounds have strong electrostatic forces in a giant lattice while covalent compounds have weak intermolecular forces between molecules",
      ),
    ],
    targetUnitId: "u1_a", // after Fix D split
  },
  {
    id: "C-paraphrased-quote",
    student: "The melting point is high due to strong forces between ions in the lattice.",
    quote: "strong electrostatic attractions hold the ions tightly",
    question: "Explain ionic melting points.",
    units: [
      baseUnit(
        "u1",
        "Ionic compounds have strong electrostatic forces between oppositely charged ions arranged in giant lattice structures",
      ),
    ],
    targetUnitId: "u1",
  },
];

describe("cover threshold measurement after Fix D", () => {
  test("print delta at 0.72 / 0.60 / 0.55 and gate outcomes", () => {
    const ratios = [0.72, 0.6, 0.55];
    const rows: Array<Record<string, unknown>> = [];

    for (const fx of FIXTURES) {
      const finalized = makeAcf(fx.question, fx.units);
      const target =
        finalized.units.find((u) => u.id === fx.targetUnitId) ||
        finalized.units.find((u) => u.creditWeight > 0 && u.id.startsWith(fx.targetUnitId.split("_")[0]!)) ||
        finalized.units.find((u) => u.creditWeight > 0);

      assert.ok(target, `missing target for ${fx.id}`);

      const coverFlags = Object.fromEntries(
        ratios.map((r) => [
          `cover@${r}`,
          coversAtRatio(fx.quote, target!.content, r) ||
            target!.aliases.some((a) => a && coversAtRatio(fx.quote, a, r)) ||
            coversAtRatio(fx.student, target!.content, r) ||
            target!.aliases.some((a) => a && coversAtRatio(fx.student, a, r)),
        ]),
      );

      const gateNoFallback = diagnoseSyncEvidenceGate(fx.quote, fx.student, target!, {
        allowFullAnswerFallback: false,
      });
      const gateWithFallback = diagnoseSyncEvidenceGate(fx.quote, fx.student, target!, {
        allowFullAnswerFallback: true,
      });

      rows.push({
        id: fx.id,
        unitId: target!.id,
        unitContentPreview: target!.content.slice(0, 80),
        aliasCount: target!.aliases.length,
        ...coverFlags,
        gateNoFallback: { pass: gateNoFallback.pass, failReason: gateNoFallback.failReason },
        gateWithFallback: { pass: gateWithFallback.pass, failReason: gateWithFallback.failReason },
      });
    }

    console.info("[coverThresholdMeasure]", JSON.stringify(rows, null, 2));

    const passAt = (r: number) => rows.filter((row) => row[`cover@${r}`] === true).length;
    console.info("[coverThresholdMeasure:summary]", {
      total: rows.length,
      passAt72: passAt(0.72),
      passAt60: passAt(0.6),
      passAt55: passAt(0.55),
      delta60vs72: passAt(0.6) - passAt(0.72),
      delta55vs72: passAt(0.55) - passAt(0.72),
    });

    // Soft asserts: measurement script always succeeds.
    // P0: full-answer fallback is disabled — ungrounded quotes stay rejected.
    const a = rows.find((r) => r.id === "A-base-quantity")!;
    assert.equal(a["cover@0.72"], true, "core/alias cover should let Example A cover at 72%");
    const c = rows.find((r) => r.id === "C-paraphrased-quote")!;
    assert.equal(
      (c.gateNoFallback as { pass: boolean }).pass,
      false,
      "ungrounded paraphrased quote must fail without inventing evidence",
    );
    assert.equal(
      (c.gateWithFallback as { pass: boolean }).pass,
      false,
      "P0: full-answer fallback disabled — with/without flag must both reject ungrounded quotes",
    );
  });
});
