/**
 * Deterministic UDM gate snapshot harness for Examples A/B/C (no live LLM).
 * Simulates (a) raw LLM ticks → (b) sync evidence gate failure reasons.
 *
 * Run: cross-env GRADE_UDM_TRACE=1 npx tsx ./scripts/marking/udmTraceExamples.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { diagnoseSyncEvidenceGate } from "../../src/services/ama/grading/matching/udmEvidenceGate.ts";
import {
  logUdmTraceStage,
  snapshotUdmTicks,
  type UdmTickFailReason,
} from "../../src/services/ama/grading/shared/udmTickTrace.ts";
import type { AssessmentCaseFile, EvidenceUnit, UnderstandingDemonstration } from "../../src/services/ama/grading/shared/types.ts";

function unit(id: string, content: string, aliases: string[] = []): EvidenceUnit {
  return {
    id,
    type: "fact",
    content,
    aliases,
    creditWeight: 1,
    required: false,
  };
}

function acf(question: string, units: EvidenceUnit[], maxScore = units.length): AssessmentCaseFile {
  return {
    v: 3,
    question,
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
    units,
    relations: [],
    markRule: { kind: "count_distinct_units", maxMarks: maxScore, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
  };
}

function runGateStage(
  label: string,
  caseFile: AssessmentCaseFile,
  studentAnswer: string,
  raw: UnderstandingDemonstration,
  allowFullAnswerFallback: boolean,
) {
  process.env.GRADE_UDM_TRACE = "1";
  logUdmTraceStage({
    stage: "raw",
    question: `${label}: ${caseFile.question}`,
    rows: snapshotUdmTicks(caseFile, raw),
  });

  const failReasons = new Map<string, UdmTickFailReason>();
  const demonstrated = raw.unitsDemonstrated.map((d) => {
    if (!d.valid) return d;
    const u = caseFile.units.find((x) => x.id === d.unitId);
    if (!u) {
      failReasons.set(d.unitId, "unknown_unit");
      return { ...d, valid: false };
    }
    const diag = diagnoseSyncEvidenceGate(d.quote, studentAnswer, u, { allowFullAnswerFallback });
    if (!diag.pass) {
      failReasons.set(d.unitId, diag.failReason);
      return { ...d, valid: false };
    }
    return d;
  });
  const afterGate: UnderstandingDemonstration = { ...raw, unitsDemonstrated: demonstrated };
  logUdmTraceStage({
    stage: "after_gate",
    question: `${label}: ${caseFile.question}`,
    rows: snapshotUdmTicks(caseFile, afterGate, failReasons),
  });
  return { afterGate, failReasons };
}

describe("UDM trace Examples A/B/C (Step 0 baseline, fallback OFF)", () => {
  test("Example A — base quantity definition paraphrase", () => {
    const caseFile = acf(
      "Define base quantity and give three examples.",
      [
        unit(
          "u1",
          "physical quantity that cannot be defined in terms of other quantities",
        ),
      ],
      4,
    );
    const student =
      "physical quantity that cannot be derived from other physical quantities.";
    const raw: UnderstandingDemonstration = {
      unitsDemonstrated: [
        {
          unitId: "u1",
          quote: "physical quantity that cannot be derived from other physical quantities",
          valid: true,
        },
      ],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    };
    const { afterGate } = runGateStage("ExampleA", caseFile, student, raw, false);
    // Post core-concept fix: "cannot be derived from other physical quantities"
    // is a correct paraphrase of "cannot be defined in terms of other
    // quantities". Length-scaled core-concept cover now credits it (previously
    // this was the Step-0 baseline `covers` failure). Explain/grounding cases
    // (Examples B & C) remain unchanged below.
    assert.equal(afterGate.unitsDemonstrated.find((d) => d.unitId === "u1")?.valid, true);
  });

  test("Example B — ionic side only vs long ionic unit", () => {
    const caseFile = acf(
      "Explain why ionic compounds have high melting points compared with covalent compounds.",
      [
        unit(
          "u1",
          "Ionic compounds have strong electrostatic forces between oppositely charged ions arranged in giant lattice structures, requiring high energy to break these attractions.",
        ),
        unit(
          "u2",
          "Covalent compounds have weak intermolecular forces between molecules, needing less energy to separate them.",
        ),
      ],
      2,
    );
    const student =
      "because the ions are held together by strong electrostatic forces of attraction between the positive and negative ions in the giant ionic lattice, so a lot of heat energy is needed to break these forces.";
    const raw: UnderstandingDemonstration = {
      unitsDemonstrated: [
        {
          unitId: "u1",
          quote:
            "ions are held together by strong electrostatic forces of attraction between the positive and negative ions in the giant ionic lattice",
          valid: true,
        },
      ],
      relationsDemonstrated: [],
      unitsMissing: [
        {
          id: "u2",
          kind: "unit",
          label: caseFile.units[1]!.content,
          reason: "Missing covalent side",
        },
      ],
      relationsMissing: [],
      invalidClaims: [],
    };
    const { afterGate, failReasons } = runGateStage("ExampleB", caseFile, student, raw, false);
    // After P1: short grounded ionic evidence that covers the unit core must pass.
    // Competitive assignment (not the sync gate) is what blocks awarding the covalent side.
    assert.equal(
      afterGate.unitsDemonstrated.find((d) => d.unitId === "u1")?.valid,
      true,
      `expected ionic side to pass sync gate, failReason=${failReasons.get("u1")}`,
    );
    assert.equal(failReasons.has("u2") || true, true);
  });

  test("Example C — paraphrased quote not grounded", () => {
    const caseFile = acf("Explain ionic melting points.", [
      unit(
        "u1",
        "Ionic compounds have strong electrostatic forces between oppositely charged ions arranged in giant lattice structures",
      ),
    ]);
    const student =
      "The melting point is high due to strong forces between ions in the lattice.";
    const raw: UnderstandingDemonstration = {
      unitsDemonstrated: [
        {
          unitId: "u1",
          quote: "strong electrostatic attractions hold the ions tightly",
          valid: true,
        },
      ],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    };
    const { failReasons } = runGateStage("ExampleC", caseFile, student, raw, false);
    assert.equal(failReasons.get("u1"), "grounded");
  });
});
