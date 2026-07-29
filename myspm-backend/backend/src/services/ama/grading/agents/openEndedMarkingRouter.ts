/**
 * Open-ended marking router.
 *
 * Flow:
 *   1) Question Classification Agent — sole calc↔theory (and top-level) authority
 *   2) Deterministic stem helpers (command word / suggested marks)
 *   3) Build or load assessment case
 *   4) Dispatch calculation XOR theory agent from locked case intent
 *
 * Speaking and MCQ never enter this function.
 */

import type { GradeSubmissionInput } from "../../types";
import { analyzeQuestion } from "../shared/questionAnalysisService";
import { hasEmbeddedMarkScheme } from "../case/markSchemeInference";
import {
  getAssessmentCaseById,
  getOrCreateAssessmentCase,
} from "../case/assessmentCaseService";
import { recommendWholeMarkCountForStem } from "../extraction/markingPointDecomposition";
import { resolveCalculationMaxScore } from "../case/calculationAcfPolicy";
import { runCalculationMarkingAgent } from "./calculationMarkingAgent";
import {
  classifyQuestionTypeAgent,
  topLevelUsesCalculationAgent,
} from "./questionClassificationAgent";
import {
  parseClientQuestionTypeHint,
  resolveOpenEndedMarkingAgent,
} from "./resolveMarkingAgent";
import { buildOpenEndedAgentContext, type OpenEndedPipelineResult } from "./openEndedAgentContext";
import { runTheoryMarkingAgent } from "./theoryMarkingAgent";

export type PipelineResult = OpenEndedPipelineResult;

export async function runOpenEndedMarking(input: GradeSubmissionInput): Promise<PipelineResult> {
  const question = input.question.trim();
  const studentAnswer = input.studentAnswer.trim();
  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  let maxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const subject = input.subject?.trim() || "General";
  const form = input.form?.trim() || "General";

  const auditedExcerpt = (input.mergedGradingContextText ?? "").trim();
  const usedAuditedContext = auditedExcerpt.length > 0;

  // --- Step 1: Question Classification Agent (before any marking) ---
  const topLevel = await classifyQuestionTypeAgent({ question, subject });
  console.info("[grade] question classification agent", {
    questionType: topLevel.questionType,
    confidence: topLevel.confidence,
    reasoning: topLevel.reasoning.slice(0, 160),
  });

  let questionAnalysis = input.questionAnalysis ?? analyzeQuestion(question, subject);
  questionAnalysis = {
    ...questionAnalysis,
    topLevelQuestionType: topLevel.questionType,
    topLevelConfidence: topLevel.confidence,
    topLevelReasoning: topLevel.reasoning,
    questionType: topLevelUsesCalculationAgent(topLevel.questionType)
      ? "calculation"
      : questionAnalysis.questionType === "calculation"
        ? "general"
        : questionAnalysis.questionType,
  };

  const savedCaseId = input.rubricId?.trim() || "";
  const usedSavedCase = savedCaseId.length > 0;

  if (!usedSavedCase && !hasEmbeddedMarkScheme(question)) {
    const recommended = recommendWholeMarkCountForStem(question, questionAnalysis);
    if (recommended != null && recommended > maxScore) {
      console.info("[grade] raised maxScore to whole-mark allocation", {
        from: maxScore,
        to: recommended,
        commandWord: questionAnalysis.commandWord,
      });
      maxScore = recommended;
    }
    if (topLevelUsesCalculationAgent(topLevel.questionType)) {
      const resolved = resolveCalculationMaxScore(question, maxScore);
      if (resolved > maxScore) {
        console.info("[grade] raised calc maxScore for independent asks", {
          from: maxScore,
          to: resolved,
        });
        maxScore = resolved;
      } else if (maxScore < 3) {
        maxScore = 3;
      }
    }
  }

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
    console.warn("[grade] client questionType hint differs from case intent — case wins", {
      caseId: stored.caseId,
      agent,
      clientHint,
      clientQuestionType: clientHintRaw,
      intentFamily: stored.acf.intent.family,
      topLevel: topLevel.questionType,
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

  console.info("[grade] dispatch marking agent", {
    caseId: stored.caseId,
    agent,
    intent: stored.acf.intent.family,
    topLevel: topLevel.questionType,
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
