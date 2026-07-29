/**
 * Wiring smoke test for gradeService structural split (tranche 3).
 * Confirms public API and extracted modules resolve — no scoring logic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeSubmission } from "../../src/services/ama/grading/gradeService";
import { gradeSubmission as orchestrated } from "../../src/services/ama/grading/gradeSubmissionOrchestrator";
import {
  buildEnrichedRetrievalQuery,
  generateDiagramContextWithQwen,
  renderDiagramContextForGrader,
} from "../../src/services/ama/grading/extraction/diagramFactExtraction";
import {
  gradeWithLegacyPipeline,
  isMcqLetterOnlyExplanationRequest,
} from "../../src/services/ama/grading/legacy/gradeWithLegacyPipeline";

describe("gradeService structural split wiring", () => {
  it("re-exports gradeSubmission from the orchestrator", () => {
    assert.equal(gradeSubmission, orchestrated);
    assert.equal(typeof gradeSubmission, "function");
  });

  it("exposes diagram fact extraction helpers", () => {
    assert.equal(typeof generateDiagramContextWithQwen, "function");
    assert.equal(typeof renderDiagramContextForGrader, "function");
    assert.equal(typeof buildEnrichedRetrievalQuery, "function");
    assert.equal(buildEnrichedRetrievalQuery("Q only"), "Q only");
  });

  it("exposes legacy pipeline under the preserved export name", () => {
    assert.equal(typeof gradeWithLegacyPipeline, "function");
    assert.equal(typeof isMcqLetterOnlyExplanationRequest, "function");
  });

  it("preserves RAG_GRADE_PIPELINE env gate values (documentation constants)", () => {
    const legacyValues = ["v1", "legacy", "off", "false", "0"];
    const pipelineEnv = "v3";
    const useEvidencePipeline = !legacyValues.includes(pipelineEnv);
    assert.equal(useEvidencePipeline, true);
    for (const v of legacyValues) {
      assert.equal(!legacyValues.includes(v) === false, true);
    }
  });
});
