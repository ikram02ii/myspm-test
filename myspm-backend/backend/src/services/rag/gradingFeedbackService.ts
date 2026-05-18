import type { QuestionAnalysis } from "./types";
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
    "Return JSON only: { \"feedback\": string }.",
    "feedback must be 1–3 short sentences, simple Form 4/5 language matching the student's language style.",
    "Mention what was correct using the matched points; mention gaps only from missing points.",
    "Do NOT introduce new science topics not in the question stem.",
    "Do NOT say something is missing if it appears in the student answer.",
    "Do NOT demand specific examples (e.g. one chemical) unless the question explicitly asked for that detail.",
    "The score is final — your wording must agree with it (do not imply a different mark).",
  ].join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Language: ${lang}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Score: ${input.score} / ${input.maxScore}`,
    input.questionAnalysis
      ? `Question demand summary: command=${input.questionAnalysis.commandWord}, type=${input.questionAnalysis.questionType}, openEnded=${input.questionAnalysis.isOpenEnded}`
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
