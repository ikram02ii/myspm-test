/**
 * Evidence-centric open-ended grading (v3).
 * Replaces the rubric-row matching pipeline.
 */
export {
  gradeOpenEndedV3,
  gradeWithPipelineV2,
  type PipelineResult,
} from "./v3/gradeOpenEndedV3";

/** @deprecated no-op shim kept for gradeService compatibility */
export async function extractStudentIdeas(
  _question: string,
  studentAnswer: string,
): Promise<{ idea: string }[]> {
  return [{ idea: studentAnswer.trim() }];
}

export {
  getAssessmentCaseById,
  getOrCreateAssessmentCase,
  saveGeneratedAssessmentCase,
  buildAssessmentCasePackage,
  getReferenceModelAnswer,
  displayMarkSchemeLabels,
  evidenceUnitsToRubricIdeas,
  getRubricById,
  getOrCreateRubric,
} from "./v3/assessmentCaseService";

export {
  buildCandidateChunkPool,
  mergeChunksExcerpt,
  questionDraftContextChunks,
  resolveGroundingChunksForQuestion,
} from "./v3/groundingChunks";

export type { AssessmentCaseFile, StoredAssessmentCase } from "./v3/types";
