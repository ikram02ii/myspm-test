/**
 * Fixed-set wipe scoping: unrelated correct points must survive invalidClaims.
 * Run: npx tsx ./scripts/marking/fixedSetWipe.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { scoreFromDemonstration } from "../../src/services/ama/grading/scoring/scoreFromDemonstration.ts";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "../../src/services/ama/grading/shared/types.ts";

function fixedSetAcf(): AssessmentCaseFile {
  return {
    v: 3,
    question: "State three subatomic particles found in an atom. (3 marks)",
    subject: "Chemistry",
    form: "Form 4",
    maxScore: 3,
    intent: {
      category: "state",
      family: "recall",
      assessedUnderstanding: "Subatomic particles",
      isCompound: false,
      analysis: { questionType: "theory", demandType: "state" } as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "Subatomic particles",
    units: [
      { id: "u1", type: "fact", content: "proton", aliases: ["proton"], creditWeight: 1, required: true },
      { id: "u2", type: "fact", content: "neutron", aliases: ["neutron"], creditWeight: 1, required: true },
      { id: "u3", type: "fact", content: "electron", aliases: ["electron"], creditWeight: 1, required: true },
    ],
    relations: [],
    markRule: { kind: "count_distinct_units", maxMarks: 3, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
  };
}

describe("fixed-set wipe scoping", () => {
  test("invalid claim about electron does not wipe proton+neutron awards", () => {
    const acf = fixedSetAcf();
    const udm: UnderstandingDemonstration = {
      unitsDemonstrated: [
        { unitId: "u1", quote: "proton", valid: true },
        { unitId: "u2", quote: "neutron", valid: true },
        { unitId: "u3", quote: "electron in nucleus", valid: true },
      ],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [{ text: "electron in nucleus", reason: "electrons are not in the nucleus" }],
    };
    const scored = scoreFromDemonstration(acf, udm);
    assert.equal(scored.score, 2);
    assert.ok(scored.markBreakdown.find((r) => r.rubricId === "u1")?.awarded);
    assert.ok(scored.markBreakdown.find((r) => r.rubricId === "u2")?.awarded);
    assert.equal(scored.markBreakdown.find((r) => r.rubricId === "u3")?.awarded, false);
  });
});
