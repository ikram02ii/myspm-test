/**
 * Open-ended marking pipeline facade.
 * Dispatches to theory XOR calculation agents via openEndedMarkingRouter.
 */
export {
  runOpenEndedMarking,
  type PipelineResult,
} from "./agents/openEndedMarkingRouter";

/** @deprecated no-op shim kept for gradeService v1 compatibility */
export async function extractStudentIdeas(
  _question: string,
  studentAnswer: string,
  _language?: string,
): Promise<{ idea: string }[]> {
  return [{ idea: studentAnswer.trim() }];
}
