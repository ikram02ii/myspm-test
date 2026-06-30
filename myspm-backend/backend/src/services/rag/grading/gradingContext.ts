/**
 * Single source of truth for question-shape flags used across pipeline stages.
 */

import type { QuestionAnalysis, QuestionAnalysisQuestionType } from "../types";
import { extractComparisonSubjectsFromQuestion } from "./gradingComparisonSubjects";

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

export function buildPipelineGradingContext(questionAnalysis: QuestionAnalysis, question: string): PipelineGradingContext {
  const questionType = questionAnalysis.questionType;
  const isCompareQ = questionType === "compare_contrast";
  const isSeqQ = questionType === "sequence_order";
  const isRecallQ =
    questionType === "fixed_answer" ||
    questionAnalysis.demandType === "recall" ||
    ["state", "name", "list", "identify", "define"].includes(questionAnalysis.commandWord);
  const isDefinitionQ = questionAnalysis.demandType === "definition";
  const isCauseEffectQ = questionType === "cause_effect" || questionAnalysis.demandType === "explanation";
  const isCalculationQ = questionType === "calculation" || questionAnalysis.demandType === "calculation";
  const isEquationQ =
    questionAnalysis.isEquationQuestion === true || questionAnalysis.demandType === "equation";

  const parsedSubjects = isCompareQ ? extractComparisonSubjectsFromQuestion(question) : [];
  const comparisonSubjects = parsedSubjects.length >= 2 ? parsedSubjects : [];

  return {
    questionAnalysis,
    questionType,
    isCompareQ,
    isSeqQ,
    isRecallQ,
    isDefinitionQ,
    isCauseEffectQ,
    isCalculationQ,
    isEquationQ,
    requiresCausalLink: questionAnalysis.requiresCausalLink === true,
    comparisonSubjects,
  };
}

export function formatGradingContextForPrompt(ctx: PipelineGradingContext): string {
  return [
    `Question type (binding for all stages): ${ctx.questionType}`,
    `Command word: ${ctx.questionAnalysis.commandWord}`,
    `Demand type: ${ctx.questionAnalysis.demandType}`,
    `Expected answer style: ${ctx.questionAnalysis.expectedAnswerStyle}`,
    ctx.isCompareQ && ctx.comparisonSubjects.length >= 2
      ? `Compared entities (student must name each explicitly for paired marks): ${ctx.comparisonSubjects.join(" | ")}`
      : null,
    ctx.requiresCausalLink ? "Stem requires causal links (because/so that/kerana) where rubric rows say so." : null,
    ctx.isSeqQ ? "Sequence/order question: stage order matters." : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
