/**
 * Open-ended marking router (Phase 2).
 *
 * Loads / builds the assessment case, then dispatches to exactly one agent:
 * theory XOR calculation. Speaking and MCQ never enter this function.
 */

import type { GradeSubmissionInput } from "../../types";
import { analyzeQuestion } from "../analysis/questionAnalysisService";
import { applyLlmQuestionTypeToAnalysis } from "../analysis/questionTypeLlmClassifier";
import { hasEmbeddedMarkScheme } from "../analysis/markSchemeInference";
import {
  getAssessmentCaseById,
  getOrCreateAssessmentCase,
} from "../case/assessmentCaseService";
import { runCalculationMarkingAgent } from "./calculationMarkingAgent";
import {
  parseClientQuestionTypeHint,
  resolveOpenEndedMarkingAgent,
} from "./resolveMarkingAgent";
import { buildOpenEndedAgentContext, type OpenEndedPipelineResult } from "./openEndedAgentContext";
import { runTheoryMarkingAgent } from "./theoryMarkingAgent";

export type PipelineResult = OpenEndedPipelineResult;

/** @deprecated Prefer runOpenEndedMarking — kept for gradePipelineService alias. */
export async function gradeOpenEndedV3(input: GradeSubmissionInput): Promise<PipelineResult> {
  return runOpenEndedMarking(input);
}

export async function runOpenEndedMarking(input: GradeSubmissionInput): Promise<PipelineResult> {
  const question = input.question.trim();
  const studentAnswer = input.studentAnswer.trim();
  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const maxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const subject = input.subject?.trim() || "General";
  const form = input.form?.trim() || "General";

  const auditedExcerpt = (input.mergedGradingContextText ?? "").trim();
  const usedAuditedContext = auditedExcerpt.length > 0;

  const regexAnalysis = input.questionAnalysis ?? analyzeQuestion(question, subject);
  // Skip extra LLM when Jawapan/Marking points already define the scheme (practice AI items).
  const questionAnalysis = hasEmbeddedMarkScheme(question)
    ? regexAnalysis
    : await applyLlmQuestionTypeToAnalysis(regexAnalysis, question);

  const savedCaseId = input.rubricId?.trim() || "";
  const usedSavedCase = savedCaseId.length > 0;
  const stored = usedSavedCase
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
    throw new Error(
      usedSavedCase ? `Assessment case not found: ${savedCaseId}` : "Failed to build assessment case",
    );
  }

  if (usedSavedCase && stored.maxScore !== maxScore) {
    throw new Error(`Case maxScore ${stored.maxScore} does not match request ${maxScore}`);
  }

  const agent = resolveOpenEndedMarkingAgent(stored.acf);
  const clientHintRaw = input.questionType?.trim() || null;
  const clientHint = parseClientQuestionTypeHint(clientHintRaw);

  if (clientHint && clientHint !== agent) {
    console.warn("[grade:v3] client questionType hint differs from case intent — case wins", {
      caseId: stored.caseId,
      agent,
      clientHint,
      clientQuestionType: clientHintRaw,
      intentFamily: stored.acf.intent.family,
    });
  }

  const ctx = buildOpenEndedAgentContext({
    question,
    studentAnswer,
    maxScore,
    stored,
    usedSavedCase,
    usedAuditedContext,
    textbookExcerpt: auditedExcerpt || undefined,
    clientQuestionTypeHint: clientHintRaw,
    questionContext: input.questionContext?.trim() || undefined,
  });

  console.info("[grade:v3] dispatch marking agent", {
    caseId: stored.caseId,
    agent,
    intent: stored.acf.intent.family,
    units: stored.acf.units.length,
    markRule: stored.acf.markRule.kind,
    maSource: ctx.officialMa.source,
    usedSavedCase,
    clientQuestionType: clientHintRaw,
  });

  if (agent === "calculation") {
    return runCalculationMarkingAgent(ctx);
  }
  return runTheoryMarkingAgent(ctx);
}
