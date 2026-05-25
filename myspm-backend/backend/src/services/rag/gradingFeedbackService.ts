import type { QuestionAnalysis } from "./types";
import { formatFeedbackEvidenceOnlyBlock } from "./gradingEvidencePolicy";
import {
  formatDiagramImageEvidenceBlock,
  gradingUsesVisualFigure,
} from "./gradingDiagramPolicy";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { qwenGradingJson, resolveQwenGradingConfig } from "./qwenGradingClient";

export type PostScoreFeedbackInput = {
  question: string;
  studentAnswer: string;
  score: number;
  maxScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  rubricIdeas?: string[];
  questionAnalysis?: QuestionAnalysis | null;
  subject: string;
  language: "english" | "malay" | "mixed";
  usesVisualFigure?: boolean;
};

export type PostScoreFeedbackResult = {
  feedback: string;
  /** SPM model answer — only when the student did not earn full marks. */
  modelAnswer?: string;
};

/**
 * After marks are fixed in code, generate SPM Form 4/5 student feedback (and model answer if not full marks).
 * Must not contradict the score or claim the student wrote ideas that are not in their answer.
 */
export async function buildPostScoreFeedback(
  input: PostScoreFeedbackInput,
): Promise<PostScoreFeedbackResult> {
  const lang =
    input.language === "malay" ? "Malay" : input.language === "mixed" ? "Mixed English/Malay" : "English";
  const notFullMark = input.score < input.maxScore;
  const usesVisual =
    input.usesVisualFigure ??
    gradingUsesVisualFigure({ question: input.question });

  const system = [
    "Write feedback for a Malaysian SPM student after their answer has already been marked.",
    formatSpmStudentFriendlyRulesBlock(),
    formatFeedbackEvidenceOnlyBlock(),
    usesVisual ? formatDiagramImageEvidenceBlock() : null,
    "Return JSON only: { \"feedback\": string, \"modelAnswer\": string | null }.",
    [
      "FEEDBACK (feedback field):",
      "- 2–4 short sentences at SPM Form 4/5 level — clear, calm, like a helpful teacher.",
      "- Match the student's language style (English, Malay, or mixed).",
      "- Start with what they did well OR why marks were limited (based on the final score only).",
      "- For partial marks: say which type of point was missing or unclear — do not list rubric jargon.",
      "- For zero marks: encourage them to write the science in their own words; never say they were correct.",
      "- Never claim they mentioned a term or idea unless it appears in the student answer below.",
      "- Do NOT include a model answer inside feedback — use modelAnswer field only.",
    ].join("\n"),
    notFullMark
      ? [
          "MODEL ANSWER (modelAnswer field — required because score < maxScore):",
          "- Write a complete, exam-ready SPM model answer for THIS question only.",
          "- Use simple school language; bilingual EN/BM only if the question stem is bilingual.",
          "- Cover all mark points the student missed (see gaps / rubric below).",
          "- Do NOT mention diagrams unless the question is about labelling; give the words an examiner expects written.",
          usesVisual
            ? "- This is a diagram/figure question: the model answer must NAME structures/functions/values in words — not 'see the diagram'."
            : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      : "MODEL ANSWER: set modelAnswer to null (student earned full marks).",
    "The score is final — wording must agree with it.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Language: ${lang}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Score: ${input.score} / ${input.maxScore}`,
    usesVisual ? "This question uses a diagram/figure (marks need written scientific wording)." : null,
    input.questionAnalysis
      ? `Question demand: command=${input.questionAnalysis.commandWord}, type=${input.questionAnalysis.questionType}, demandType=${input.questionAnalysis.demandType}`
      : null,
    `Points credited: ${input.matchedIdeas.join(" | ") || "(none)"}`,
    `Gaps / mark points missed: ${input.missingIdeas.join(" | ") || "(none)"}`,
    input.rubricIdeas?.length ? `Mark scheme ideas: ${input.rubricIdeas.join(" | ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
    let modelAnswer: string | undefined;
    if (notFullMark) {
      const raw = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
      if (raw.length > 0) modelAnswer = raw;
    }
    if (feedback.length > 0) {
      return { feedback, modelAnswer };
    }
  } catch {
    // fall through
  }
  return { feedback: "" };
}

export function formatFeedbackWithModelAnswer(params: {
  feedback: string;
  modelAnswer?: string;
  score: number;
  maxScore: number;
  language: "english" | "malay" | "mixed";
}): { feedback: string; modelAnswer?: string } {
  const fb = params.feedback.trim();
  if (params.score >= params.maxScore || !params.modelAnswer?.trim()) {
    return { feedback: fb, modelAnswer: undefined };
  }
  const label =
    params.language === "malay"
      ? "Jawapan model"
      : params.language === "mixed"
        ? "Model answer / Jawapan model"
        : "Model answer";
  return {
    feedback: fb,
    modelAnswer: `${label}:\n${params.modelAnswer.trim()}`,
  };
}

export function resolveGradingModelLabel(suffix: string): string {
  try {
    return `${resolveQwenGradingConfig().model}${suffix}`;
  } catch {
    return `qwen-unknown${suffix}`;
  }
}
