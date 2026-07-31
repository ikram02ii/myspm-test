/**
 * OCR answer pipeline:
 *   1. Raw vision OCR (subject-profile prompt at call site)
 *   2. Normalize (LaTeX → plain; mode from subject profile)
 *   3. LLM repair (subject-profile rules)
 *   4. Light stem-line cleanup (never blocks / never topic-checks)
 */

import { removeQuestionStemFromOcrText } from "./ocrAnswerFilter";
import { normalizeOcrExtractedText } from "./ocrTextNormalize";
import { repairOcrTranscription } from "./ocrRepairService";
import { resolveOcrSubjectProfile } from "./ocrSubjectProfiles";

export type OcrPipelineInput = {
  rawOcrText: string;
  question?: string;
  subject?: string;
};

export type OcrPipelineStages = {
  rawOcr: string;
  afterMathParse: string;
  afterRepair: string;
  profileId: string;
};

export type OcrPipelineResult = {
  text: string;
  format: "plain";
  stages: OcrPipelineStages;
};

export async function runOcrPostProcessPipeline(input: OcrPipelineInput): Promise<OcrPipelineResult> {
  const profile = resolveOcrSubjectProfile(input.subject);
  const rawOcr = (input.rawOcrText || "").trim();
  const afterMathParse = normalizeOcrExtractedText(rawOcr, profile.normalizeMode);
  const afterRepair = await repairOcrTranscription({
    approximateText: afterMathParse,
    subject: input.subject,
  });

  // Strip obvious question lines when possible, but never blank the answer.
  const stemFilter = removeQuestionStemFromOcrText(afterRepair, input.question);
  const finalText =
    stemFilter.text.trim().length > 0 ? stemFilter.text.trim() : afterRepair.trim();

  return {
    text: finalText,
    format: "plain",
    stages: {
      rawOcr,
      afterMathParse,
      afterRepair,
      profileId: profile.id,
    },
  };
}
