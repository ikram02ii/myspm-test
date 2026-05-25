/**
 * Second-pass review: credit rubric rows only when the first matcher missed them
 * but the answer already meets SPM mark-scheme standard. No loose outside-rubric marks.
 */

import type {
  MarkBreakdownItem,
  QuestionAnalysis,
  RubricIdea,
  StudentIdea,
} from "./types";
import { studentAnswerExplicitlySupportsMarkPoint, type EvidenceOnlyMarkingOptions } from "./gradingEvidencePolicy";
import { formatSpmExamStandardMarkingBlock } from "./gradingExaminerPolicy";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { qwenGradingJson } from "./qwenGradingClient";
import { isStrictContextBindingQuestion } from "./gradingCategoryMarking";

export type ExaminerCreditPassInput = {
  question: string;
  studentAnswer: string;
  studentIdeas: StudentIdea[];
  rubricIdeas: RubricIdea[];
  markBreakdown: MarkBreakdownItem[];
  maxScore: number;
  subject: string;
  textbookContext?: string;
  questionAnalysis?: QuestionAnalysis | null;
  markingPolicyOptions?: EvidenceOnlyMarkingOptions;
};

export type ExaminerCreditPassResult = {
  markBreakdown: MarkBreakdownItem[];
  score: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  outsideRubricCount: number;
};

type RubricRowCredit = {
  rubricId?: string;
  award?: boolean;
  reason?: string;
  awardedOutsideRubric?: boolean;
};

function sumAwarded(breakdown: MarkBreakdownItem[]): number {
  return breakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
}

function rubricRowSummary(ideas: RubricIdea[], breakdown: MarkBreakdownItem[]): string {
  return ideas
    .map((idea) => {
      const row = breakdown.find((r) => r.rubricId === idea.id);
      const status = row?.awarded ? "AWARDED" : "NOT AWARDED";
      return [
        `- id=${idea.id} marks=${idea.marks} status=${status}`,
        `  idea: ${idea.idea}`,
        row?.reason ? `  matcher reason: ${row.reason}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export async function applyExaminerPriorityMarking(
  input: ExaminerCreditPassInput,
): Promise<ExaminerCreditPassResult> {
  const breakdown = input.markBreakdown.map((r) => ({ ...r }));
  let score = sumAwarded(breakdown);
  const maxScore = input.maxScore;

  if (score >= maxScore || !input.studentAnswer.trim()) {
    return buildResult(breakdown, score, 0);
  }

  const remaining = maxScore - score;
  const unawarded = breakdown.filter((r) => !r.awarded && r.marks > 0);
  if (unawarded.length === 0 && remaining <= 0) {
    return buildResult(breakdown, score, 0);
  }

  const strictCtx = isStrictContextBindingQuestion(input.question);
  const contextExcerpt = (input.textbookContext ?? "").trim().slice(0, 4000);

  const system = [
    formatSpmExamStandardMarkingBlock(input.markingPolicyOptions),
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON only:",
    `{`,
    `  "rubricRowCredits": [{ "rubricId": string, "award": boolean, "reason": string, "awardedOutsideRubric": false }]`,
    `}`,
    "Rules:",
    "- Review ONLY existing rubric row ids listed below.",
    "- Set award true only when the student already demonstrated that mark point at SPM exam standard (specificity + detail), not merely a related scientific idea.",
    "- awardedOutsideRubric must always be false.",
    "- Do NOT invent new mark points or award marks outside the rubric.",
    `- You may add at most ${remaining} additional mark(s) total.`,
    "- Do not award equation marks unless the equation is fully correct at SPM level.",
    "- Reject vague, generic, incomplete, or informal answers even if scientifically true.",
    "- Award only if the student answer text already contains the mark point — do not infer unstated science.",
    "- Never award because a diagram/figure shows the point if the student did not write it in their answer.",
    strictCtx
      ? "- CONTEXT-BOUND: credit only if consistent with the named source in the question."
      : "- Valid SPM paraphrases are allowed when the mark-point detail is clearly present.",
  ].join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Student ideas extracted:\n${input.studentIdeas.map((s, i) => `${i + 1}. ${s.idea}`).join("\n") || "(none)"}`,
    `Marks already awarded: ${score}/${maxScore}. You may add at most ${remaining} more.`,
    "Rubric rows:",
    rubricRowSummary(input.rubricIdeas, breakdown),
    contextExcerpt ? `Marking context (reference only):\n${contextExcerpt}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  let rubricRowCredits: RubricRowCredit[] = [];

  try {
    const parsed = await qwenGradingJson(system, user);
    rubricRowCredits = Array.isArray(parsed?.rubricRowCredits) ? parsed.rubricRowCredits : [];
  } catch {
    return buildResult(breakdown, score, 0);
  }

  let budget = remaining;

  for (const credit of rubricRowCredits) {
    if (budget <= 0) break;
    const rubricId = typeof credit.rubricId === "string" ? credit.rubricId.trim() : "";
    if (!rubricId || credit.award !== true) continue;
    const row = breakdown.find((r) => r.rubricId === rubricId);
    const rubricIdea = input.rubricIdeas.find((r) => r.id === rubricId);
    if (!row || row.awarded || !rubricIdea) continue;
    if (rubricIdea.kind === "equation" || rubricIdea.demandType === "equation") continue;
    if (!studentAnswerExplicitlySupportsMarkPoint(input.studentAnswer, rubricIdea, input.studentAnswer, input.question)) {
      continue;
    }

    const marks = Math.min(budget, row.marks, rubricIdea.marks);
    if (marks <= 0) continue;

    row.awarded = true;
    row.marks = marks;
    row.reason =
      (typeof credit.reason === "string" && credit.reason.trim()) ||
      "SPM exam-standard review: mark point clearly shown in the answer.";
    row.matchMethod = "llmVerifier";
    row.matchStrategy = "examStandardReview";
    row.awardedOutsideRubric = false;
    budget -= marks;
  }

  score = Math.min(maxScore, sumAwarded(breakdown));
  return buildResult(breakdown, score, 0);
}

function buildResult(
  markBreakdown: MarkBreakdownItem[],
  score: number,
  outsideRubricCount: number,
): ExaminerCreditPassResult {
  const matchedIdeas = markBreakdown.filter((r) => r.awarded).map((r) => r.idea);
  const missingIdeas = markBreakdown.filter((r) => !r.awarded).map((r) => r.idea);
  return { markBreakdown, score, matchedIdeas, missingIdeas, outsideRubricCount };
}
