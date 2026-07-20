/**
 * Canonical SPM gap-feedback system + user prompt builders.
 * Prompt text must stay byte-identical to the approved feedback template.
 */
import type { AnswerLanguage } from "../../gradingTextUtils";
import type { ModelAnswerVerbFamily } from "../../modelAnswerFeedbackFormatPolicy";
import {
  buildFeedbackCanonicalLanguageLine,
  FEEDBACK_LANGUAGE_RULE_FOOTER_LINES,
} from "../shared/languageRules";

/** Resolved in code — never inferred by the feedback LLM. */
export type FeedbackQuestionType = ModelAnswerVerbFamily | "calculation";

export type FeedbackBreakdownRow = {
  label: string;
  status: "AWARDED" | "NOT_AWARDED";
  reason: string;
};

export type FeedbackInputPayload = {
  question: string;
  questionType: FeedbackQuestionType;
  score: number;
  maxScore: number;
  language: AnswerLanguage;
  markBreakdown: FeedbackBreakdownRow[];
  studentEvidence: string;
  incorrectClaims: string[];
  markingNotes: string[];
};

export function buildCanonicalFeedbackSystemPrompt(
  questionType: FeedbackQuestionType,
  language: AnswerLanguage,
): string {
  const languageLine = buildFeedbackCanonicalLanguageLine(language);

  const typeRules =
    questionType === "calculation"
      ? [
          "If question type = CALCULATION:",
          "- Mention missing solution stages only.",
          "- Do not invent calculations.",
          "- improvements[]: ONLY the unawarded stage labels from markBreakdown — never invent, split, merge, or rename stages.",
        ].join("\n")
      : questionType === "state_or_identify"
        ? [
            "If question type = STATE / IDENTIFY / NAME:",
            "- Feedback: very short; focus on missing items; do not add explanations.",
            "- improvements[]: short missing labels only.",
          ].join("\n")
        : questionType === "explain_or_describe"
          ? [
              "If question type = EXPLAIN / DESCRIBE:",
              "- Feedback: mention missing reasoning or links; do not provide the full explanation.",
              "- improvements[]: missing concept labels only.",
            ].join("\n")
          : questionType === "compare_or_differentiate"
            ? [
                "If question type = COMPARE / DIFFERENTIATE:",
                "- Feedback: name which side or contrast point was missing; do not write the full model comparison.",
                "- improvements[]: missing contrast labels only.",
              ].join("\n")
            : [
                "If question type = DEFAULT:",
                "- Feedback: 1–2 short sentences; name missing marking points briefly.",
                "- Never invent criteria beyond markBreakdown.",
              ].join("\n");

  return [
    "SYSTEM PROMPT — SPM FEEDBACK GENERATION SERVICE",
    "",
    "ROLE:",
    "You are an SPM student feedback writer.",
    "",
    "Your ONLY responsibility is to convert finalized marking results into short, student-friendly feedback.",
    "",
    "You DO NOT:",
    "- decide marks",
    "- change scores",
    "- create new marking points",
    "- judge whether an answer deserves marks",
    "- provide the full model answer",
    "- add scientific facts not present in the binding marking points",
    "",
    "The score and marking decisions are FINAL.",
    "",
    "==================================================",
    "CORE PRINCIPLE",
    "==================================================",
    "",
    "LLM writes feedback.",
    "CODE decides marks.",
    "",
    "The assessment case and binding marking points are the only source of truth.",
    "",
    "Use ONLY:",
    "- awarded marking points",
    "- unawarded marking points",
    "- provided student evidence",
    "- provided incorrect claims",
    "- markingNotes when present",
    "",
    "Never use outside knowledge to create new requirements.",
    "",
    "==================================================",
    "OUTPUT FORMAT",
    "==================================================",
    "",
    "Return ONLY valid JSON:",
    "",
    "{",
    '  "feedback": "short student-friendly explanation",',
    '  "strengths": [',
    '    "awarded idea only"',
    "  ],",
    '  "improvements": [',
    '    "missing idea only"',
    "  ]",
    "}",
    "",
    "==================================================",
    "FEEDBACK RULES",
    "==================================================",
    "",
    "feedback:",
    "- Explain what the student did well and what is missing — ONLY when marks were awarded.",
    "- Maximum 2-3 short sentences.",
    "- Mention at most ONE important missing idea.",
    "- Do not rewrite the correct answer.",
    "- Do not list all marking points.",
    '- Do not include "The correct answer is..."',
    '- Do not include "Model answer:"',
    "- Do not mention marking scheme terminology.",
    "- If score is 0 / Awarded Points is (none): NEVER say the student is on the right track, close, partially correct, or made a good start.",
    "- If score is 0 and Student Evidence is empty, a lone number, or unrelated junk: say plainly that the answer did not address the question.",
    "- Feedback must match the score and student evidence — never invent partial progress.",
    "",
    "strengths:",
    "- Only include awarded marking points.",
    "- Convert them into simple student language.",
    "- Maximum 3 items.",
    "- If no marks awarded, return [].",
    "",
    "improvements:",
    "- Only include unawarded binding marking points.",
    "- Never include awarded points.",
    "- Never include extra advice outside the marking scheme.",
    "- Use short labels, not full explanations.",
    "- Maximum 3 items.",
    "- If full marks, return [].",
    "",
    "==================================================",
    "EVIDENCE RULES",
    "==================================================",
    "",
    "Student evidence:",
    "- Describe only what the student wrote.",
    "- Do not claim the student wrote something they did not write.",
    "",
    "Missing points:",
    "- Say what is missing.",
    "- Do not explain the complete solution.",
    "- Do not reveal all expected answers.",
    "",
    "Example:",
    "",
    "Bad:",
    '"You need to say that acid ionises in water to produce H+ ions."',
    "",
    "Good:",
    '"Explain the ionisation process."',
    "",
    "==================================================",
    "QUESTION TYPE RULES",
    "==================================================",
    "",
    typeRules,
    "",
    "==================================================",
    "LANGUAGE RULE",
    "==================================================",
    "",
    `Language: ${languageLine}`,
    "",
    ...FEEDBACK_LANGUAGE_RULE_FOOTER_LINES,
  ].join("\n");
}

export function formatFeedbackUserPrompt(payload: FeedbackInputPayload): string {
  const breakdownBlock =
    payload.markBreakdown.length > 0
      ? payload.markBreakdown
          .map((row, i) => {
            const reason = row.reason ? ` — ${row.reason}` : "";
            return `- Mark ${i + 1}: ${row.label} — ${row.status}${reason}`;
          })
          .join("\n")
      : "(none)";

  const awarded = payload.markBreakdown.filter((r) => r.status === "AWARDED").map((r) => r.label);
  const unawarded = payload.markBreakdown
    .filter((r) => r.status === "NOT_AWARDED")
    .map((r) => r.label);

  return [
    "INPUT DATA",
    "",
    `Question:\n${payload.question}`,
    "",
    `Score:\n${payload.score} / ${payload.maxScore}`,
    "",
    `Question Type:\n${payload.questionType}`,
    "",
    "markBreakdown (preferred source — feedback MUST follow this list only):",
    breakdownBlock,
    "",
    "Awarded Points:",
    awarded.length > 0 ? awarded.map((l) => `- ${l}`).join("\n") : "(none)",
    "",
    "Unawarded Points (only these may appear in improvements):",
    unawarded.length > 0
      ? unawarded.map((l) => `- ${l}`).join("\n")
      : "none — full marks on the scheme.",
    "",
    "Student Evidence:",
    payload.studentEvidence || "(empty)",
    "",
    "Incorrect Claims:",
    payload.incorrectClaims.length > 0
      ? payload.incorrectClaims.map((c) => `- ${c}`).join("\n")
      : "(none)",
    "",
    "Marking Notes:",
    payload.markingNotes.length > 0
      ? payload.markingNotes.map((n) => `- ${n}`).join("\n")
      : "(none)",
  ].join("\n");
}
