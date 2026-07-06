/**
 * Question-shape flags shared by fairness / legacy helpers.
 */

import type { QuestionAnalysis, QuestionAnalysisQuestionType } from "../types";

export type PipelineGradingContext = {
  questionAnalysis: QuestionAnalysis;
  questionType: QuestionAnalysisQuestionType;
  isCompareQ: boolean;
  isSeqQ: boolean;
  isRecallQ: boolean;
  isDefinitionQ: boolean;
  isCauseEffectQ: boolean;
  isCalculationQ: boolean;
  isEquationQ: boolean;
  requiresCausalLink: boolean;
  comparisonSubjects: string[];
};
