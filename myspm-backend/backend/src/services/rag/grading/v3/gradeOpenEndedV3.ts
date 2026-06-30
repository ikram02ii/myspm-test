import type { GradeSubmissionInput, MarkBreakdownItem } from "../../types";
import { analyzeQuestion } from "../questionAnalysisService";
import { resolveFeedbackLanguage } from "../gradingTextUtils";
import { detectAnswerLanguage } from "../gradingTextUtils";
import { applyLlmQuestionTypeToAnalysis } from "../questionTypeLlmClassifier";
import {
  displayMarkSchemeLabels,
  getAssessmentCaseById,
  getOrCreateAssessmentCase,
  getReferenceModelAnswer,
} from "./assessmentCaseService";
import { evaluateUnderstanding } from "./evaluateUnderstanding";
import { scoreFromDemonstration } from "./scoreFromDemonstration";
import { generateGapFeedback } from "./generateGapFeedback";
import { localizeModelAnswerForStudent } from "./localizeModelAnswer";
import { resolveQwenGradingConfig } from "../qwenGradingClient";

export type PipelineResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  matchedIdeas: string[];
  missingIdeas: string[];
  markBreakdown: MarkBreakdownItem[];
  strengths: string[];
  improvements: string[];
  model: string;
  studentIdeasDetected: string[];
  rubricIdeas: string[];
  acceptedConcepts: { rubricIdea: string; acceptedPhrases: string[] }[];
  contradictionCheckPassed: boolean;
  usedAuditedContext?: boolean;
};

export async function gradeOpenEndedV3(input: GradeSubmissionInput): Promise<PipelineResult> {
  const question = input.question.trim();
  const studentAnswer = input.studentAnswer.trim();
  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const maxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const subject = input.subject?.trim() || "General";
  const form = input.form?.trim() || "General";

  const auditedExcerpt = (input.mergedGradingContextText ?? "").trim();
  const usedAuditedContext = auditedExcerpt.length > 0;

  const regexAnalysis = input.questionAnalysis ?? analyzeQuestion(question, subject);
  const questionAnalysis = await applyLlmQuestionTypeToAnalysis(regexAnalysis, question);

  const savedCaseId = input.rubricId?.trim();
  const stored = savedCaseId
    ? await getAssessmentCaseById(savedCaseId)
    : await getOrCreateAssessmentCase({
        question,
        subject,
        form,
        maxScore,
        questionAnalysis,
        skipNearestCached: true,
        auditedContextExcerpt: auditedExcerpt || null,
        seedChunkContent: input.mergedGradingContextText ?? undefined,
        chapterFilter: input.chapterFilter?.trim() || undefined,
        chapterHint: input.chapterHint?.trim() || undefined,
      });

  if (!stored) {
    throw new Error(savedCaseId ? `Assessment case not found: ${savedCaseId}` : "Failed to build assessment case");
  }

  if (savedCaseId && stored.maxScore !== maxScore) {
    throw new Error(`Case maxScore ${stored.maxScore} does not match request ${maxScore}`);
  }

  const acf = stored.acf;
  const textbookExcerpt = auditedExcerpt || undefined;

  console.info("[grade:v3] evidence-centric grading", {
    caseId: stored.caseId,
    intent: acf.intent.family,
    units: acf.units.length,
    relations: acf.relations.length,
    markRule: acf.markRule.kind,
  });

  const udm = await evaluateUnderstanding({
    question,
    studentAnswer,
    acf,
    textbookExcerpt,
  });

  const { score, markBreakdown, matchedLabels, missingLabels, chainWalk } = scoreFromDemonstration(acf, udm);

  const feedbackLanguage = resolveFeedbackLanguage(studentAnswer, question);

  const { feedback, strengths, improvements } = await generateGapFeedback({
    question,
    studentAnswer,
    acf,
    udm,
    score,
    maxScore,
    language: feedbackLanguage,
    gradingContext: chainWalk ? { chainWalk } : undefined,
  });

  const rawModelAnswer =
    acf.referenceModelAnswer?.trim() ||
    getReferenceModelAnswer(stored.sourceRef) ||
    displayMarkSchemeLabels(acf).join("; ");

  const modelAnswer =
    rawModelAnswer && score < maxScore
      ? await localizeModelAnswerForStudent({
          referenceModelAnswer: rawModelAnswer,
          question,
          studentAnswer,
          maxScore,
          evidenceUnits: acf.units.filter((u) => u.creditWeight > 0).map((u) => u.content),
        })
      : undefined;

  const model = resolveQwenGradingConfig().model;

  return {
    score,
    feedback,
    modelAnswer,
    matchedIdeas: matchedLabels,
    missingIdeas: missingLabels,
    markBreakdown,
    strengths,
    improvements,
    model,
    studentIdeasDetected: udm.unitsDemonstrated.filter((d) => d.valid).map((d) => d.quote),
    rubricIdeas: displayMarkSchemeLabels(acf),
    acceptedConcepts: acf.units
      .filter((u) => u.creditWeight > 0)
      .map((u) => ({ rubricIdea: u.content, acceptedPhrases: u.aliases })),
    contradictionCheckPassed: udm.invalidClaims.length === 0,
    usedAuditedContext,
  };
}

/** Primary grading entry — replaces rubric-row pipeline. */
export const gradeWithPipelineV2 = gradeOpenEndedV3;

/** @deprecated kept for imports */
export async function extractStudentIdeas(
  question: string,
  studentAnswer: string,
  language: string,
  _analysis?: import("../../types").QuestionAnalysis,
): Promise<{ idea: string }[]> {
  return [{ idea: studentAnswer.trim() }];
}
