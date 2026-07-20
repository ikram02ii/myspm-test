/**
 * Feedback canonical language strings (B4).
 * Text must stay byte-identical to the approved gap-feedback LANGUAGE RULE section.
 */
import type { AnswerLanguage } from "../../gradingTextUtils";

/** Language label line for the feedback system prompt (after `Language: `). */
export function buildFeedbackCanonicalLanguageLine(language: AnswerLanguage): string {
  if (language === "malay") {
    return "Bahasa Melayu (SPM Form 4/5 classroom BM). Do NOT use full English sentences.";
  }
  if (language === "mixed") {
    return "English (student wrote mixed language; default to English). Do NOT switch into full Bahasa Melayu sentences.";
  }
  return "English (SPM Form 4/5 school English). Do NOT use full Bahasa Melayu sentences.";
}

/** Trailing lines under LANGUAGE RULE in the canonical feedback system prompt. */
export const FEEDBACK_LANGUAGE_RULE_FOOTER_LINES = [
  "All output fields must use this language.",
  "",
  "Use:",
  "- SPM Form 4/5 vocabulary",
  "- simple student-friendly wording",
  "- short sentences",
] as const;
