import type { ContextAuditResult, MarkBreakdownItem, QuestionAnalysis } from "./types";
import { studentAnswerCoversIdea } from "./gradingFairnessMatch";

export type RetrievalConfidence = "high" | "medium" | "low";

export function computeRetrievalConfidence(params: {
  audit: ContextAuditResult;
  approvedChunkCount: number;
  lowConfidenceFlag: boolean;
}): RetrievalConfidence {
  if (params.approvedChunkCount === 0) return "low";
  if (params.audit.isSufficientContext && !params.lowConfidenceFlag) return "high";
  if (params.approvedChunkCount >= 2 && params.audit.relevanceScore >= 0.35) return "medium";
  return "low";
}

export type GradingValidationResult = {
  contradictionCheckPassed: boolean;
  topicConsistencyPassed: boolean;
  topicConsistencyWarning?: string;
  retrievalConfidence: RetrievalConfidence;
  scoreAfterConsistency: number;
  missingIdeasAfterContradiction: string[];
  matchedIdeasAfterContradiction: string[];
  markBreakdownAfterContradiction?: MarkBreakdownItem[];
};

/**
 * Deterministic score alignment with rubric rows (code-owned, not LLM).
 */
export function repairScoreFromBreakdown(
  markBreakdown: MarkBreakdownItem[] | undefined,
  maxScore: number,
  currentScore: number,
): number {
  if (!markBreakdown || markBreakdown.length === 0) return Math.max(0, Math.min(maxScore, currentScore));
  const summed = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  return Math.max(0, Math.min(maxScore, Math.round(summed)));
}

/**
 * Align reported score with the sum of awarded rubric marks, and catch obvious
 * full-mark inconsistencies when missing rows remain.
 */
export function applyScoreConsistencyRules(params: {
  score: number;
  maxScore: number;
  markBreakdown?: MarkBreakdownItem[];
  missingIdeas: string[];
  studentAnswer: string;
  questionAnalysis?: QuestionAnalysis | null;
}): { score: number; reason?: string } {
  let score = params.score;
  const { markBreakdown, maxScore, missingIdeas, studentAnswer } = params;
  if (!markBreakdown || markBreakdown.length === 0) return { score };

  const fromBreakdown = repairScoreFromBreakdown(markBreakdown, maxScore, score);
  if (fromBreakdown !== score) {
    return { score: fromBreakdown, reason: "Score aligned to sum of awarded rubric marks." };
  }

  if (score >= maxScore && missingIdeas.length > 0) {
    const anyMissingStill = missingIdeas.some((m) => !studentAnswerCoversIdea(studentAnswer, m));
    if (anyMissingStill && fromBreakdown < score) {
      return { score: fromBreakdown, reason: "Full marks inconsistent with missing rubric rows; aligned to breakdown sum." };
    }
  }

  return { score };
}
