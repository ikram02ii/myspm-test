/**
 * Stage 4: Light validation that OCR text plausibly answers the question (topic + completeness).
 * Full rubric marking still happens at POST /api/rag/grade.
 */

import { qwenGradingJson } from "./qwenGradingClient";

export type OcrAnswerValidation = {
  passed: boolean;
  warning?: string;
  topicAligned: boolean;
  structureOk: boolean;
};

function isEnvOff(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

export function ocrValidationEnabled(): boolean {
  return !isEnvOff("OCR_PIPELINE_VALIDATE");
}

export async function validateOcrAnswerAgainstQuestion(params: {
  question: string;
  studentAnswer: string;
  subject?: string;
}): Promise<OcrAnswerValidation> {
  const question = (params.question || "").trim();
  const answer = (params.studentAnswer || "").trim();

  if (!question || !answer || !ocrValidationEnabled()) {
    return { passed: true, topicAligned: true, structureOk: true };
  }

  const system = [
    "Validate whether scanned student working plausibly answers an SPM question.",
    "Return JSON only: { \"passed\": boolean, \"topicAligned\": boolean, \"structureOk\": boolean, \"warning\": string }.",
    "passed: true only if topicAligned AND structureOk are true.",
    "topicAligned: false if the working is clearly a different topic (e.g. rate calculation for a lab-safety question).",
    "structureOk: false if empty, gibberish, or only unrelated labels with no attempt at the question.",
    "warning: one short student-friendly sentence if passed is false; empty string if passed is true.",
    "Do not grade marks — only topical fit and whether the text looks like intentional exam working.",
  ].join("\n");

  const user = [
    params.subject ? `Subject: ${params.subject}` : null,
    `Question:\n${question}`,
    `OCR transcription (student answer):\n${answer}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const topicAligned =
      typeof parsed?.topicAligned === "boolean"
        ? parsed.topicAligned
        : typeof parsed?.topicAligned === "string"
          ? /^(true|yes|1)$/i.test(parsed.topicAligned)
          : true;
    const structureOk =
      typeof parsed?.structureOk === "boolean"
        ? parsed.structureOk
        : typeof parsed?.structureOk === "string"
          ? /^(true|yes|1)$/i.test(parsed.structureOk)
          : true;
    const passed =
      typeof parsed?.passed === "boolean"
        ? parsed.passed
        : topicAligned && structureOk;
    const warning = typeof parsed?.warning === "string" ? parsed.warning.trim() : "";
    return {
      passed: passed && topicAligned && structureOk,
      topicAligned,
      structureOk,
      warning: warning || undefined,
    };
  } catch {
    return { passed: true, topicAligned: true, structureOk: true };
  }
}
