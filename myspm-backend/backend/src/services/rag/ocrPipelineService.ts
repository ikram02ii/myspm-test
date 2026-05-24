/**
 * OCR answer pipeline:
 *   1. Raw vision OCR (approximate)
 *   2. Math parser (structure / LaTeX cleanup)
 *   3. LLM repair (symbols, units, line breaks)
 *   4. Rubric-oriented validator (topic + plausibility vs question)
 */

import { parseOcrMathStructure } from "./ocrTextNormalize";
import { repairOcrTranscription } from "./ocrRepairService";
import { validateOcrAnswerAgainstQuestion, type OcrAnswerValidation } from "./ocrAnswerValidateService";

export type OcrPipelineInput = {
  rawOcrText: string;
  question?: string;
  subject?: string;
};

export type OcrPipelineStages = {
  rawOcr: string;
  afterMathParse: string;
  afterRepair: string;
  validation?: OcrAnswerValidation;
};

export type OcrPipelineResult = {
  text: string;
  format: "plain";
  stages: OcrPipelineStages;
  validationWarning?: string;
  validationPassed: boolean;
};

export async function runOcrPostProcessPipeline(input: OcrPipelineInput): Promise<OcrPipelineResult> {
  const rawOcr = (input.rawOcrText || "").trim();
  const afterMathParse = parseOcrMathStructure(rawOcr);
  const afterRepair = await repairOcrTranscription({
    approximateText: afterMathParse,
    question: input.question,
    subject: input.subject,
  });

  let validation: OcrAnswerValidation | undefined;
  if (input.question?.trim()) {
    validation = await validateOcrAnswerAgainstQuestion({
      question: input.question,
      studentAnswer: afterRepair,
      subject: input.subject,
    });
  }

  const validationPassed = validation?.passed ?? true;

  return {
    text: afterRepair,
    format: "plain",
    stages: {
      rawOcr,
      afterMathParse,
      afterRepair,
      validation,
    },
    validationPassed,
    validationWarning: validation?.warning,
  };
}
