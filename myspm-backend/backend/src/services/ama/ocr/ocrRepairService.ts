/**
 * Stage 3: LLM repair of OCR + math-parser output (symbols, units, line breaks).
 * Does not solve the question or add facts not implied by the transcription.
 */

import { qwenGradingJson } from "../grading/qwenGradingClient";
import { parseOcrMathStructure } from "./ocrTextNormalize";

function isEnvOff(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

export function ocrRepairEnabled(): boolean {
  return !isEnvOff("OCR_PIPELINE_REPAIR");
}

export async function repairOcrTranscription(params: {
  approximateText: string;
  question?: string;
  subject?: string;
}): Promise<string> {
  const input = (params.approximateText || "").trim();
  if (!input || !ocrRepairEnabled()) return input;

  const system = [
    "You clean up SPM student answer transcriptions from OCR.",
    "Return JSON only: { \"text\": string, \"changes\": string }.",
    "changes: one short sentence describing what you fixed, or \"none\".",
    "Rules:",
    "- Fix missing or wrong symbols (subscripts, superscripts in units, =, /, ×).",
    "- Restore labels and calculation steps on separate lines as in typical exam working.",
    "- Remove stray LaTeX ($, \\frac, \\displaylines) and markdown.",
    "- Do NOT solve the problem, change numbers, or add science not present in the input.",
    "- Do NOT invent content to match the question if the transcription is clearly about a different topic.",
    "- Keep the same language mix (BM/EN) as the input.",
    "- Output plain text suitable for a text box (no $ delimiters).",
  ].join("\n");

  const user = [
    params.subject ? `Subject: ${params.subject}` : null,
    params.question
      ? `Question being answered (context only — never copy diagram labels or figure details into the transcription):\n${params.question}`
      : null,
    "Approximate transcription after math parsing:",
    input,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    if (!text) return input;
    return parseOcrMathStructure(text);
  } catch {
    return input;
  }
}
