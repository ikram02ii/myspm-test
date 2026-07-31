/**
 * Stage 3: LLM repair of OCR output (symbols, units, line breaks).
 * Subject profiles add domain rules; shared rules stay here.
 *
 * Never receives the exam question — question context caused the model to invent answers.
 */

import { qwenGradingJson } from "../grading/shared/qwenGradingClient";
import { normalizeOcrExtractedText } from "./ocrTextNormalize";
import { resolveOcrSubjectProfile } from "./ocrSubjectProfiles";

function isEnvOff(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

export function ocrRepairEnabled(): boolean {
  return !isEnvOff("OCR_PIPELINE_REPAIR");
}

/** Content tokens used to detect repair hallucinations that rewrite the whole answer. */
function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}=+→⇌×/^.-]+/gu, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2),
  );
}

/**
 * True when repaired text still looks like a cleanup of the OCR input.
 * Rejects inventing a wholly different answer (e.g. states-of-matter prose for equations).
 */
export function repairLooksFaithful(original: string, repaired: string): boolean {
  const a = (original || "").trim();
  const b = (repaired || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;

  const aTok = contentTokens(a);
  const bTok = contentTokens(b);
  if (aTok.size === 0) return true;

  let overlap = 0;
  for (const t of aTok) {
    if (bTok.has(t)) overlap += 1;
  }
  const recall = overlap / aTok.size;
  // Allow light cleanup; block wholesale rewrite.
  if (recall < 0.35) return false;

  // Extreme length inflation usually means invented content.
  if (b.length > a.length * 3 + 40) return false;

  return true;
}

export async function repairOcrTranscription(params: {
  approximateText: string;
  subject?: string;
}): Promise<string> {
  const input = (params.approximateText || "").trim();
  if (!input || !ocrRepairEnabled()) return input;

  const profile = resolveOcrSubjectProfile(params.subject);

  const system = [
    "You clean up SPM student answer transcriptions from OCR.",
    "Return JSON only: { \"text\": string, \"changes\": string }.",
    "changes: one short sentence describing what you fixed, or \"none\".",
    "Shared rules:",
    "- You may ONLY edit the given approximate transcription.",
    "- Fix missing or wrong symbols (subscripts, superscripts in units, =, /, ×) when clearly OCR errors.",
    "- Restore labels and steps on separate lines as in typical exam working.",
    "- Remove stray LaTeX (\\(, \\), \\[, \\], $, \\frac, \\displaylines) and markdown.",
    "- Write fractions as 1/2 or (1/2), never '1 / (2)' or \\frac.",
    "- Do NOT solve the problem, change numbers, or add science not present in the input.",
    "- Do NOT invent, replace, or rewrite the answer into something else.",
    "- If the input is chemical equations, keep them as equations — never turn them into prose.",
    "- Keep the same language mix (BM/EN) as the input.",
    "- Output plain text suitable for a text box (no $ or \\( delimiters).",
    `OCR subject profile: ${profile.id}.`,
    ...profile.repairRules.map((rule) => `- ${rule}`),
  ].join("\n");

  const user = [
    params.subject ? `Subject: ${params.subject}` : null,
    "Approximate transcription after math parsing (edit this text only — do not invent a new answer):",
    input,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    if (!text) return input;
    const cleaned = normalizeOcrExtractedText(text, profile.normalizeMode);
    if (!repairLooksFaithful(input, cleaned)) return input;
    return cleaned;
  } catch {
    return input;
  }
}
