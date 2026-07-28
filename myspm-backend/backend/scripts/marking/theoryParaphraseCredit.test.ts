/**
 * Theory reconcile: paraphrases must not be wiped to 0 by distinctive-token revoke.
 * Run: npx tsx ./scripts/marking/theoryParaphraseCredit.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { diagnoseSyncEvidenceGate } from "../../src/services/ama/grading/v3/udmEvidenceGate.ts";
import { reconcileUnderstandingDemonstration } from "../../src/services/ama/grading/v3/reconcileTheoryDemonstration.ts";
import { scoreFromDemonstration } from "../../src/services/ama/grading/v3/scoreFromDemonstration.ts";
import type {
  AssessmentCaseFile,
  EvidenceUnit,
  UnderstandingDemonstration,
} from "../../src/services/ama/grading/v3/types.ts";

function unit(id: string, content: string, aliases: string[], coreConcept?: string): EvidenceUnit {
  return {
    id,
    type: "fact",
    content,
    aliases,
    coreConcept,
    creditWeight: 1,
    required: false,
  };
}

function theoryAcf(units: EvidenceUnit[]): AssessmentCaseFile {
  return {
    v: 3,
    question: "Explain why metals conduct electricity.",
    subject: "Chemistry",
    form: "Form 4",
    maxScore: units.length,
    intent: {
      category: "explain",
      family: "theory",
      assessedUnderstanding: "Explanation",
      isCompound: false,
      analysis: { questionType: "cause_effect", demandType: "explain" } as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "Explanation",
    units,
    relations: [],
    markRule: { kind: "count_distinct_units", maxMarks: units.length, openPool: false },
    chunkRefs: [],
    contextSource: "llm_fallback",
  };
}

describe("theory paraphrase credit", () => {
  test("sync gate passes when core/alias cover without exact rubric sentence", () => {
    const u = unit(
      "u1",
      "Metals have delocalised electrons that move freely and carry charge",
      ["free electrons", "mobile electrons", "delocalised electrons"],
      "delocalised electrons",
    );
    const diag = diagnoseSyncEvidenceGate(
      "they have free electrons that can move",
      "Metals conduct because they have free electrons that can move.",
      u,
    );
    assert.equal(diag.pass, true, `expected sync pass, got ${diag.failReason}`);
  });

  test("reconcile does not wipe a single meaning-verified paraphrase tick", async () => {
    const acf = theoryAcf([
      unit(
        "u1",
        "Metals have delocalised electrons that move freely and carry charge",
        ["free electrons", "mobile electrons"],
        "delocalised / free electrons",
      ),
    ]);
    const raw: UnderstandingDemonstration = {
      unitsDemonstrated: [
        {
          unitId: "u1",
          quote: "they have free electrons that can move",
          valid: true,
        },
      ],
      relationsDemonstrated: [],
      unitsMissing: [],
      relationsMissing: [],
      invalidClaims: [],
    };

    const udm = await reconcileUnderstandingDemonstration({
      question: acf.question,
      studentAnswer: "Metals conduct because they have free electrons that can move.",
      acf,
      udm: raw,
    });

    assert.equal(
      udm.unitsDemonstrated.some((d) => d.unitId === "u1" && d.valid),
      true,
      "paraphrase tick must survive revokeOverCredits",
    );
    const scored = scoreFromDemonstration(acf, udm);
    assert.equal(scored.score, 1);
  });
});
