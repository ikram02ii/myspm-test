/**
 * Open-ended marking pipeline facade.
 * Dispatches to theory XOR calculation agents via openEndedMarkingRouter.
 */
export {
  runOpenEndedMarking,
  gradeOpenEndedV3,
  gradeOpenEndedV3 as gradeWithPipelineV2,
  type PipelineResult,
} from "./v3/openEndedMarkingRouter";

/** @deprecated no-op shim kept for gradeService v1 compatibility */
export async function extractStudentIdeas(
  _question: string,
  studentAnswer: string,
  _language?: string,
): Promise<{ idea: string }[]> {
  return [{ idea: studentAnswer.trim() }];
}
