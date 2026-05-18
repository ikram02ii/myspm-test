/**
 * Examiner-priority pass: credit scientifically correct answers even when
 * the deterministic matcher missed them; flag true outside-rubric awards.
 */

import { randomUUID } from "node:crypto";
import type {
  MarkBreakdownItem,
  QuestionAnalysis,
  RubricIdea,
  StudentIdea,
} from "./types";
import { formatExaminerMarkingPriorityBlock } from "./gradingExaminerPolicy";
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

type OutsideRubricCredit = {
  studentIdea?: string;
  marks?: number;
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
    formatExaminerMarkingPriorityBlock(),
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON only:",
    `{`,
    `  "rubricRowCredits": [{ "rubricId": string, "award": boolean, "reason": string, "awardedOutsideRubric": boolean }],`,
    `  "outsideRubricCredits": [{ "studentIdea": string, "marks": number, "reason": string, "awardedOutsideRubric": true }]`,
    `}`,
    "Rules:",
    "- rubricRowCredits: only for existing rubric row ids listed below; set award true when the student already demonstrated that mark point (meaning, not exact words). awardedOutsideRubric must be false when crediting an existing rubric row.",
    "- outsideRubricCredits: only when the student gave scientifically correct, relevant content that no rubric row captures; each entry must have awardedOutsideRubric true.",
    `- Do not award more than ${remaining} additional mark(s) in total across both arrays.`,
    "- Do not award equation marks unless the equation in the answer is fully correct at SPM level.",
    strictCtx
      ? "- CONTEXT-BOUND: outside-rubric credit only if consistent with the named source in the question."
      : "- Valid SPM alternatives not listed in the rubric are allowed.",
  ].join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Student ideas extracted:\n${input.studentIdeas.map((s, i) => `${i + 1}. ${s.idea}`).join("\n") || "(none)"}`,
    `Marks already awarded: ${score}/${maxScore}. You may add at most ${remaining} more.`,
    "Rubric rows:",
    rubricRowSummary(input.rubricIdeas, breakdown),
    contextExcerpt ? `Textbook context (reference only):\n${contextExcerpt}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  let rubricRowCredits: RubricRowCredit[] = [];
  let outsideRubricCredits: OutsideRubricCredit[] = [];

  try {
    const parsed = await qwenGradingJson(system, user);
    rubricRowCredits = Array.isArray(parsed?.rubricRowCredits) ? parsed.rubricRowCredits : [];
    outsideRubricCredits = Array.isArray(parsed?.outsideRubricCredits) ? parsed.outsideRubricCredits : [];
  } catch {
    return buildResult(breakdown, score, 0);
  }

  let outsideCount = 0;
  let budget = remaining;

  for (const credit of rubricRowCredits) {
    if (budget <= 0) break;
    const rubricId = typeof credit.rubricId === "string" ? credit.rubricId.trim() : "";
    if (!rubricId || credit.award !== true) continue;
    const row = breakdown.find((r) => r.rubricId === rubricId);
    const rubricIdea = input.rubricIdeas.find((r) => r.id === rubricId);
    if (!row || row.awarded || !rubricIdea) continue;
    if (rubricIdea.kind === "equation" || rubricIdea.demandType === "equation") continue;

    const marks = Math.min(budget, row.marks, rubricIdea.marks);
    if (marks <= 0) continue;

    row.awarded = true;
    row.marks = marks;
    row.reason =
      (typeof credit.reason === "string" && credit.reason.trim()) ||
      "Examiner review: scientifically correct for this mark point.";
    row.matchMethod = "llmVerifier";
    row.matchStrategy = "examinerPriority";
    row.awardedOutsideRubric = false;
    budget -= marks;
  }

  for (const credit of outsideRubricCredits) {
    if (budget <= 0) break;
    const idea =
      typeof credit.studentIdea === "string" && credit.studentIdea.trim()
        ? credit.studentIdea.trim()
        : "";
    if (!idea) continue;
    const rawMarks = typeof credit.marks === "number" ? Math.floor(credit.marks) : 1;
    const marks = Math.max(1, Math.min(budget, rawMarks));
    breakdown.push({
      rubricId: `outside-${randomUUID().slice(0, 8)}`,
      idea,
      awarded: true,
      marks,
      reason:
        (typeof credit.reason === "string" && credit.reason.trim()) ||
        "Scientifically correct point not listed in the rubric (teacher review suggested).",
      matchMethod: "llmVerifier",
      matchStrategy: "examinerOutsideRubric",
      awardedOutsideRubric: true,
    });
    outsideCount += 1;
    budget -= marks;
  }

  score = Math.min(maxScore, sumAwarded(breakdown));
  return buildResult(breakdown, score, outsideCount);
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
