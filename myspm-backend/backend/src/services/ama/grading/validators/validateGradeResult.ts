/**
 * Post-score validators — catch impossible scores before feedback/return.
 * Thin wrappers over existing consistency / calc policy rules (no behaviour change).
 */

import type { MarkBreakdownItem, QuestionAnalysis } from "../../types";
import {
  applyScoreConsistencyRules,
  validateTopicConsistency,
} from "../shared/gradingChecks";
import { isCalculationIntent } from "../case/calculationAcfPolicy";
import type { AssessmentCaseFile } from "../shared/types";

export type GradeValidationInput = {
  score: number;
  maxScore: number;
  markBreakdown?: MarkBreakdownItem[];
  missingIdeas: string[];
  matchedIdeas?: string[];
  studentAnswer: string;
  question: string;
  feedback: string;
  modelAnswer?: string;
  rubricIdeas?: string[];
  questionAnalysis?: QuestionAnalysis | null;
  language: "english" | "malay" | "mixed";
  acf?: AssessmentCaseFile | null;
};

export type GradeValidationResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
  reasons: string[];
  topicConsistencyPassed: boolean;
  topicConsistencyWarning?: string;
};

/**
 * Clamp score to [0, max], align to breakdown, run topic consistency, and
 * defensively block calc show_working full marks when stages are incomplete.
 */
export function validateGradeResult(input: GradeValidationInput): GradeValidationResult {
  const reasons: string[] = [];
  let score = Math.max(0, Math.min(input.maxScore, Math.floor(Number(input.score) || 0)));
  if (score !== input.score) {
    reasons.push(`Score clamped to ${score}/${input.maxScore}.`);
  }

  const consistency = applyScoreConsistencyRules({
    score,
    maxScore: input.maxScore,
    markBreakdown: input.markBreakdown,
    missingIdeas: input.missingIdeas,
    studentAnswer: input.studentAnswer,
    questionAnalysis: input.questionAnalysis,
  });
  if (consistency.reason) reasons.push(consistency.reason);
  score = consistency.score;

  const acf = input.acf;
  if (acf && isCalculationIntent(acf) && acf.markRule.calcPolicy === "show_working") {
    const breakdown = input.markBreakdown ?? [];
    const awarded = breakdown.filter((r) => r.awarded);
    const creditCount = acf.units.filter((u) => u.creditWeight > 0).length;
    if (score >= input.maxScore && creditCount > 1 && awarded.length < creditCount) {
      const aligned = awarded.reduce((sum, r) => sum + (r.marks > 0 ? Math.floor(r.marks) : 0), 0);
      if (aligned < score) {
        reasons.push(
          `Calc show_working: full marks without all stages — aligned to ${aligned} from breakdown.`,
        );
        score = Math.max(0, Math.min(input.maxScore, aligned));
      }
    }
  }

  const topic = validateTopicConsistency({
    question: input.question,
    studentAnswer: input.studentAnswer,
    feedback: input.feedback,
    modelAnswer: input.modelAnswer,
    missingIdeas: input.missingIdeas,
    matchedIdeas: input.matchedIdeas ?? [],
    rubricIdeas: input.rubricIdeas,
    markBreakdown: input.markBreakdown,
    score,
    maxScore: input.maxScore,
    language: input.language,
  });

  if (process.env.GRADE_VALIDATE_TRACE === "1" && reasons.length > 0) {
    console.info("[grade:validate]", { score, maxScore: input.maxScore, reasons });
  }

  return {
    score,
    feedback: topic.feedback,
    modelAnswer: topic.modelAnswer,
    missingIdeas: topic.missingIdeas,
    matchedIdeas: topic.matchedIdeas,
    markBreakdown: topic.markBreakdown,
    reasons,
    topicConsistencyPassed: topic.topicConsistencyPassed,
    topicConsistencyWarning: topic.topicConsistencyWarning,
  };
}

export { applyScoreConsistencyRules, validateTopicConsistency };
