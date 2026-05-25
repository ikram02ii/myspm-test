import type { QuestionAnalysis } from "./types";
import { formatFeedbackEvidenceOnlyBlock } from "./gradingEvidencePolicy";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { qwenGradingJson, resolveQwenGradingConfig } from "./qwenGradingClient";

export type PostScoreFeedbackInput = {
  question: string;
  studentAnswer: string;
  score: number;
  maxScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  questionAnalysis?: QuestionAnalysis | null;
  subject: string;
  language: "english" | "malay" | "mixed";
};

/**
 * After marks are fixed in code, generate short SPM-style feedback only.
 * Must not contradict the score or demand content the question did not ask for.
 */
export async function buildPostScoreFeedback(input: PostScoreFeedbackInput): Promise<string> {
  const lang =
    input.language === "malay" ? "Malay" : input.language === "mixed" ? "Mixed English/Malay" : "English";
  const system = [
    "Write feedback for a Malaysian SPM student after their answer has already been marked.",
    formatSpmStudentFriendlyRulesBlock(),
    formatFeedbackEvidenceOnlyBlock(),
    "Return JSON only: { \"feedback\": string }.",
    "feedback must be 1–3 short sentences, simple Form 4/5 language matching the student's language style.",
    "Mention only matched points that reflect wording actually in the student answer; gaps only from missing points.",
    "Never say the student mentioned a concept unless it appears in the student answer text below.",
    "If marks were withheld for vagueness, say the required point was not stated clearly — do not invent what they meant.",
    "Do NOT introduce new science topics not in the question stem.",
    "Do NOT say something is missing if it appears in the student answer.",
    "Do NOT demand specific examples (e.g. one chemical) unless the question explicitly asked for that detail.",
    [
      "OPEN-ENDED ROW FEEDBACK:",
      "When a mark point is open-ended (any valid member of a category is acceptable), never name a specific answer in feedback as if it were the only correct answer. Instead, describe the category the student needed to provide an instance of.",
      "If the student gave a valid answer that was not awarded due to a matching failure, do not tell them their answer was wrong.",
    ].join("\n"),
    [
      "FEEDBACK RULES BY DEMAND TYPE:",
      "recall: State the correct answer directly if missing. One sentence.",
      "definition: Identify which part of the definition was missing — the concept, the mechanism, or both. Do not restate the full definition.",
      "explanation: Name the specific mechanism step that was missing and where it fits in the chain. Do not restate steps the student got right.",
      "comparison: State which side or criterion was missing or incorrect. Address both sides if both have gaps.",
      "calculation: Separate method feedback from accuracy feedback. Never say the answer is wrong if only arithmetic was wrong and the method was correct.",
      "example: Describe the category the student needed to give an instance of. Never name a single answer as the only correct one.",
      "application: Describe the type of reasoning expected without giving the answer.",
      "equation: If incomplete, name the missing species. If unbalanced, name the unbalanced element and side. Never use praise when incomplete or unbalanced.",
      "essay: Separate content feedback from language feedback.",
      "GENERAL: Never introduce science not in the question stem. Never say something is missing if it appears in the student answer. The score is final.",
    ].join("\n"),
    "The score is final — your wording must agree with it (do not imply a different mark).",
  ].join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Language: ${lang}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Score: ${input.score} / ${input.maxScore}`,
    input.questionAnalysis
      ? `Question demand summary: command=${input.questionAnalysis.commandWord}, type=${input.questionAnalysis.questionType}, demandType=${input.questionAnalysis.demandType}, openEnded=${input.questionAnalysis.isOpenEnded}, isEquationQuestion=${input.questionAnalysis.isEquationQuestion}, equationType=${input.questionAnalysis.equationType ?? "null"}`
      : null,
    `Points credited: ${input.matchedIdeas.join(" | ") || "(none listed)"}`,
    `Gaps for improvement: ${input.missingIdeas.join(" | ") || "(none)"}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const fb = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
    if (fb.length > 0) return fb;
  } catch {
    // fall through
  }
  return "";
}

export function resolveGradingModelLabel(suffix: string): string {
  try {
    return `${resolveQwenGradingConfig().model}${suffix}`;
  } catch {
    return `qwen-unknown${suffix}`;
  }
}
