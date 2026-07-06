import type { GradeSubmissionInput, MarkBreakdownItem } from "../../types";
import { analyzeQuestion } from "../questionAnalysisService";
import { resolveFeedbackLanguage } from "../gradingTextUtils";
import { applyLlmQuestionTypeToAnalysis } from "../questionTypeLlmClassifier";
import { studentAnswerCoversIdea } from "../gradingFairness";
import {
  displayMarkSchemeLabels,
  getAssessmentCaseById,
  getOrCreateAssessmentCase,
  getReferenceModelAnswer,
} from "./assessmentCaseService";
import { evaluateUnderstanding } from "./evaluateUnderstanding";
import { evaluateCalculationUnderstanding } from "./evaluateCalculationUnderstanding";
import { reconcileUnderstandingDemonstration } from "./reconcileUdmDemonstration";
import { reconcileCalculationDemonstration } from "./reconcileCalculationDemonstration";
import { isCalculationIntent } from "./calculationAcfPolicy";
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

  const isCalc = isCalculationIntent(acf);
  const referenceModelAnswer =
    acf.referenceModelAnswer?.trim() || getReferenceModelAnswer(stored.sourceRef) || undefined;

  const rawUdm = isCalc
    ? await evaluateCalculationUnderstanding({
        question,
        studentAnswer,
        acf,
        textbookExcerpt,
        referenceModelAnswer,
      })
    : await evaluateUnderstanding({
        question,
        studentAnswer,
        acf,
        textbookExcerpt,
      });

  const udm = isCalc
    ? reconcileCalculationDemonstration({
        question,
        studentAnswer,
        acf,
        udm: rawUdm,
        referenceModelAnswer,
      })
    : await reconcileUnderstandingDemonstration({
        question,
        studentAnswer,
        acf,
        udm: rawUdm,
      });

  const scoreResult = scoreFromDemonstration(acf, udm);
  let { score, markBreakdown } = scoreResult;
  const { matchedLabels, missingLabels, chainWalk } = scoreResult;

  // Partial credit floor: if score is 0 but the answer is scientifically
  // on-topic (overlaps any rubric unit) and has no wrong claims, award 1 mark.
  // This prevents "osmosis is when water moves through a membrane" from
  // scoring 0/2 instead of 1/2 — reserve 0 for genuinely wrong/empty answers.
  if (
    !isCalc &&
    score === 0 &&
    maxScore >= 2 &&
    udm.invalidClaims.length === 0 &&
    studentAnswer.trim().split(/\s+/).filter(Boolean).length >= 4 &&
    acf.units
      .filter((u) => u.creditWeight > 0)
      .some(
        (u) =>
          studentAnswerCoversIdea(studentAnswer, u.content) ||
          u.aliases.some((a) => a && studentAnswerCoversIdea(studentAnswer, a)),
      )
  ) {
    score = 1;
    // Mark the first unawarded rubric unit as partially credited in the breakdown.
    const firstMissed = markBreakdown.find((r) => !r.awarded);
    if (firstMissed) {
      markBreakdown = markBreakdown.map((r) =>
        r === firstMissed
          ? { ...r, awarded: true, marks: 1, reason: "Partial credit — scientifically relevant answer" }
          : r,
      );
    }
  }

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
