/**
 * gradeSubmission orchestration: maxScore prep → vision facts → retrieval/audit
 * → v3 pipeline or legacy v1 → persist. Does not own scoring rules.
 */
import { randomUUID } from "node:crypto";
import { ragDb, ragGradingResultsTable } from "../../../lib/ragDb";
import { auditRetrievedContext } from "../retrieval/contextAuditService";
import { buildGradingContextFromChunks, retrieveChunks } from "../retrieval/retrievalService";
import { gradeWithPipelineV2, extractStudentIdeas } from "./gradePipelineService";
import { analyzeQuestion } from "./questionAnalysisService";
import type {
  DiagramContext,
  GradeSubmissionInput,
  GradeSubmissionResult,
  MarkBreakdownItem,
  RetrievedChunk,
} from "../types";
import { inferAdjustedMaxScore } from "./gradingChecks";
import { fixMissingIdeasAgainstStudentAnswer } from "./gradingFairness";
import { validateTopicConsistency } from "./gradingChecks";
import { applyScoreConsistencyRules, computeRetrievalConfidence } from "./gradingChecks";
import { resolveFeedbackLanguage } from "./gradingTextUtils";
import {
  generateDiagramContextWithQwen,
  renderDiagramContextForGrader,
  buildEnrichedRetrievalQuery,
} from "./diagramFactExtraction";
import {
  gradeWithLegacyPipeline,
  isMcqLetterOnlyExplanationRequest,
  briefIdeaFeedback,
  sanitizeFeedback,
} from "./legacy/gradeWithLegacyPipeline";
import { reconcileFeedbackToMarkingTruth } from "./v3/feedbackTruthPolicy";

function filterChunksByAudit(chunks: RetrievedChunk[], relevantChunkIds: string[]): RetrievedChunk[] {
  if (relevantChunkIds.length === 0) return [];
  const allowed = new Set(relevantChunkIds);
  return chunks.filter((chunk) => allowed.has(chunk.chunkId));
}

export async function gradeSubmission(input: GradeSubmissionInput): Promise<GradeSubmissionResult> {
  const question = input.question?.trim();
  const studentAnswer = input.studentAnswer?.trim();
  if (!question) throw new Error("question is required");
  if (!studentAnswer) throw new Error("studentAnswer is required");

  const questionAnalysis = input.questionAnalysis ?? analyzeQuestion(question, input.subject?.trim() ?? null);

  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const clientMaxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const rubricVersion = input.rubricVersion?.trim() || "v1";
  const submissionId = input.submissionId?.trim() || `sub-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const savedRubricSkipInfer = typeof input.rubricId === "string" && input.rubricId.trim().length > 0;
  const mcqLetterSkipInfer = isMcqLetterOnlyExplanationRequest(question, studentAnswer, clientMaxScore);
  const scoreAdjustment = savedRubricSkipInfer
    ? {
        originalMaxScore: clientMaxScore,
        adjustedMaxScore: clientMaxScore,
        maxScoreAdjustedReason: "Saved rubric supplied; maxScore inference skipped.",
      }
    : mcqLetterSkipInfer
    ? {
        originalMaxScore: clientMaxScore,
        adjustedMaxScore: clientMaxScore,
        maxScoreAdjustedReason: "MCQ letter-only explanation; maxScore inference skipped.",
      }
    : inferAdjustedMaxScore(question, clientMaxScore, questionAnalysis);
  const maxScore = scoreAdjustment.adjustedMaxScore;

  // Vision: extract visual facts only. Never awards marks.
  // Facts enrich retrieval + context; theory/calc agents still score the written answer.
  let diagramContextStructured: DiagramContext | undefined;
  let diagramContextWarning: string | undefined;
  if (input.diagramImageUrl?.trim() || input.diagramImageBase64?.trim()) {
    try {
      const vision = await generateDiagramContextWithQwen({
        question,
        subject: input.subject,
        imageUrl: input.diagramImageUrl,
        imageBase64: input.diagramImageBase64,
      });
      diagramContextStructured = vision.diagram;
      console.info("[rag][grade] vision extract (facts only — not a marking agent)", {
        submissionId,
        model: vision.model,
        diagramType: vision.diagram.diagramType,
        labelCount: vision.diagram.labels.length,
        confidence: vision.diagram.confidence,
        rawLength: vision.rawText.length,
      });
    } catch (error) {
      diagramContextWarning = error instanceof Error ? error.message : "Failed to generate diagram context.";
      console.warn("[rag][grade] diagram context failed", {
        submissionId,
        warning: diagramContextWarning,
      });
    }
  }

  // Back-compat: callers that still expect a string get a deterministic
  // rendering of the structured form.
  const diagramContext = diagramContextStructured
    ? renderDiagramContextForGrader(diagramContextStructured)
    : undefined;

  const retrievalQuery = buildEnrichedRetrievalQuery(question, diagramContextStructured);
  const retrieval = await retrieveChunks({
    query: retrievalQuery,
    subject: input.subject?.trim(),
    form: input.form?.trim(),
    topK: input.topK,
  });
  console.info("[rag][grade] retrieved chunks", {
    count: retrieval.chunks.length,
    submissionId,
  });

  const contextAudit = await auditRetrievedContext(question, retrieval.chunks);
  const filteredChunks = filterChunksByAudit(retrieval.chunks, contextAudit.relevantChunkIds);
  const effectiveChunks = filteredChunks.length > 0 ? filteredChunks : [];
  const context = buildGradingContextFromChunks(question, effectiveChunks);

  const lowConfidence = !contextAudit.isSufficientContext || filteredChunks.length === 0;
  const warning = lowConfidence ? "Insufficient textbook context for reliable grading." : null;

  console.info("[rag][grade] context audit", {
    submissionId,
    originalCount: retrieval.chunks.length,
    filteredCount: filteredChunks.length,
    effectiveChunkCount: effectiveChunks.length,
    relevanceScore: contextAudit.relevanceScore,
    isSufficientContext: contextAudit.isSufficientContext,
    lowConfidence,
    originalMaxScore: scoreAdjustment.originalMaxScore,
    adjustedMaxScore: maxScore,
    maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
  });

  const pipelineEnv = (process.env["RAG_GRADE_PIPELINE"] || "v3").trim().toLowerCase();
  const useEvidencePipeline = !["v1", "legacy", "off", "false", "0"].includes(pipelineEnv);
  if (useEvidencePipeline) {
    const gradedV2 = await gradeWithPipelineV2({
      ...input,
      question,
      studentAnswer,
      maxScore,
      questionAnalysis,
      diagramContextStructured: diagramContextStructured ?? null,
      mergedGradingContextText: context.mergedContextText,
      auditedRetrievedChunks: effectiveChunks,
      pipelineContextAudit: contextAudit,
      gradingLowConfidence: lowConfidence,
      gradingContextWarning: warning,
    });

    // Pipeline v2 already reconciles marks; second pass inflated partial transport answers.
    const v2Reconciled = {
      missingIdeas: gradedV2.missingIdeas,
      matchedIdeas: gradedV2.matchedIdeas,
      markBreakdown: gradedV2.markBreakdown,
      score: gradedV2.score,
      contradictionCheckPassed: gradedV2.contradictionCheckPassed,
    };

    const scoreConsistency = applyScoreConsistencyRules({
      score: v2Reconciled.score,
      maxScore,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      missingIdeas: v2Reconciled.missingIdeas,
      studentAnswer,
      questionAnalysis,
    });
    const finalScoreV2 = scoreConsistency.score;

    const retrievalConfidence = computeRetrievalConfidence({
      audit: contextAudit,
      approvedChunkCount: filteredChunks.length,
      lowConfidenceFlag: lowConfidence,
    });

    const answerLangV2 = resolveFeedbackLanguage(studentAnswer, question);
    const mcqLetterV2 = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore);
    let feedbackOut = sanitizeFeedback(gradedV2.feedback, { maxSentences: mcqLetterV2 ? 8 : undefined });

    const topicV2 = validateTopicConsistency({
      question,
      studentAnswer,
      feedback: feedbackOut,
      modelAnswer: gradedV2.modelAnswer,
      missingIdeas: v2Reconciled.missingIdeas,
      matchedIdeas: v2Reconciled.matchedIdeas,
      rubricIdeas: gradedV2.rubricIdeas,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      score: finalScoreV2,
      maxScore,
      language: answerLangV2,
    });
    feedbackOut = topicV2.feedback;
    const modelAnswerOut = topicV2.modelAnswer ?? gradedV2.modelAnswer;

    const truth = reconcileFeedbackToMarkingTruth({
      feedback: feedbackOut,
      strengths:
        v2Reconciled.matchedIdeas.length > 0 ? v2Reconciled.matchedIdeas : gradedV2.strengths ?? [],
      improvements: finalScoreV2 === maxScore ? [] : v2Reconciled.missingIdeas,
      score: finalScoreV2,
      maxScore,
      awardedCount: (v2Reconciled.markBreakdown ?? gradedV2.markBreakdown ?? []).filter(
        (r: MarkBreakdownItem) => r.awarded,
      ).length,
      studentAnswer,
      language: answerLangV2 === "malay" ? "malay" : "english",
    });
    feedbackOut = truth.feedback;

    if (process.env.NODE_ENV === "development") {
      const bd: MarkBreakdownItem[] = (v2Reconciled.markBreakdown ?? gradedV2.markBreakdown ?? []) as MarkBreakdownItem[];
      console.info("[rag][grade] v2 diagnostics", {
        submissionId,
        question: question.slice(0, 200),
        commandWord: questionAnalysis.commandWord,
        questionType: questionAnalysis.questionType,
        originalMaxScore: scoreAdjustment.originalMaxScore,
        adjustedMaxScore: maxScore,
        maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
        retrievalChunkCount: retrieval.chunks.length,
        auditApprovedChunkCount: filteredChunks.length,
        effectiveChunkCount: effectiveChunks.length,
        pipelineUsedAuditedContext: gradedV2.usedAuditedContext === true,
        rubricPointCount: bd.length,
        studentIdeasDetected: gradedV2.studentIdeasDetected,
        matchedRubricIds: bd.filter((r) => r.awarded && r.rubricId).map((r) => r.rubricId),
        missingRubricIds: bd.filter((r) => !r.awarded && r.rubricId).map((r) => r.rubricId),
        contradictionCheckPassed: v2Reconciled.contradictionCheckPassed,
        topicConsistencyPassed: topicV2.topicConsistencyPassed,
        scoreAfterConsistency: finalScoreV2,
        retrievalConfidence,
        decisionLog: gradedV2.decisionLog,
        rubricId: input.rubricId?.trim() || null,
      });
    }

    await ragDb!.insert(ragGradingResultsTable).values({
      submissionId,
      userId: input.userId ?? null,
      subject: input.subject?.trim() || null,
      form: input.form?.trim() || null,
      rubricVersion,
      score: finalScoreV2,
      maxScore,
      feedback: feedbackOut,
    });

    return {
      submissionId,
      score: finalScoreV2,
      maxScore,
      feedback: feedbackOut,
      model: gradedV2.model,
      modelAnswer: modelAnswerOut,
      modelAnswerPoints: gradedV2.modelAnswerPoints,
      modelAnswerPointCards: gradedV2.modelAnswerPointCards,
      matchedIdeas: v2Reconciled.matchedIdeas,
      missingIdeas: v2Reconciled.missingIdeas,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      strengths: truth.strengths,
      improvements: truth.improvements,
      originalMaxScore: scoreAdjustment.originalMaxScore,
      adjustedMaxScore: maxScore,
      maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
      studentIdeasDetected: gradedV2.studentIdeasDetected,
      rubricIdeas: gradedV2.rubricIdeas,
      acceptedConcepts: gradedV2.acceptedConcepts,
      contradictionCheckPassed: v2Reconciled.contradictionCheckPassed,
      outsideRubricAwardCount:
        "outsideRubricAwardCount" in gradedV2
          ? (gradedV2 as { outsideRubricAwardCount?: number }).outsideRubricAwardCount
          : undefined,
      topicConsistencyPassed: topicV2.topicConsistencyPassed,
      topicConsistencyWarning: topicV2.topicConsistencyWarning,
      questionAnalysis,
      retrievalConfidence,
      diagramContext,
      diagramContextStructured,
      diagramContextWarning,
      contextUsed: retrieval.chunks.length,
      filteredContextUsed: effectiveChunks.length,
      lowConfidence,
      warning: warning ?? undefined,
      contextAudit,
      context,
      decisionLog: gradedV2.decisionLog,
    };
  }

  const graded = await gradeWithLegacyPipeline({
    question,
    studentAnswer,
    subject: input.subject,
    contextText: context.mergedContextText,
    diagramContext: diagramContextStructured,
    maxScore,
    rubricVersion,
    warning,
    questionAnalysis,
  });

  const mcqLetterExplainMode = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore);
  const answerLang = resolveFeedbackLanguage(studentAnswer, question);
  const studentIdeasList = await extractStudentIdeas(question, studentAnswer, answerLang);
  const studentIdeaStrings = studentIdeasList.map((i) => i.idea);

  const reconciled = await fixMissingIdeasAgainstStudentAnswer({
    question,
    subject: input.subject?.trim() || "General",
    studentAnswer,
    missingIdeas: graded.parsed.missingIdeas ?? [],
    matchedIdeas: graded.parsed.matchedIdeas ?? [],
    markBreakdown: graded.parsed.markBreakdown,
    rubricIdeas: undefined,
    score: graded.parsed.score,
    maxScore,
  });

  const scoreConsistencyV1 = applyScoreConsistencyRules({
    score: reconciled.score,
    maxScore,
    markBreakdown: reconciled.markBreakdown ?? graded.parsed.markBreakdown,
    missingIdeas: reconciled.missingIdeas,
    studentAnswer,
    questionAnalysis,
  });
  const finalScore = scoreConsistencyV1.score;
  const finalMatched = reconciled.matchedIdeas;
  const finalMissing = reconciled.missingIdeas;
  const finalBreakdown = reconciled.markBreakdown ?? graded.parsed.markBreakdown;
  const modelFeedback = sanitizeFeedback(graded.parsed.feedback, {
    maxSentences: mcqLetterExplainMode ? 8 : undefined,
  });
  const finalFeedback = reconciled.contradictionCheckPassed
    ? modelFeedback
    : briefIdeaFeedback(finalScore, maxScore, finalMatched, finalMissing, answerLang);

  const retrievalConfidenceV1 = computeRetrievalConfidence({
    audit: contextAudit,
    approvedChunkCount: filteredChunks.length,
    lowConfidenceFlag: lowConfidence,
  });

  const rubricIdeaStrings = (finalBreakdown ?? []).map((r) => r.idea);
  const acceptedConceptsV1 = (finalBreakdown ?? []).map((r) => ({
    rubricIdea: r.idea,
    acceptedPhrases: [] as string[],
  }));

  let feedbackV1 = finalFeedback;
  let modelAnswerV1 = graded.parsed.modelAnswer;
  const topicV1 = validateTopicConsistency({
    question,
    studentAnswer,
    feedback: feedbackV1,
    modelAnswer: modelAnswerV1,
    missingIdeas: finalMissing,
    matchedIdeas: finalMatched,
    rubricIdeas: rubricIdeaStrings,
    markBreakdown: finalBreakdown,
    score: finalScore,
    maxScore,
    language: answerLang,
  });
  feedbackV1 = topicV1.feedback;
  modelAnswerV1 = topicV1.modelAnswer ?? modelAnswerV1;

  const truthV1 = reconcileFeedbackToMarkingTruth({
    feedback: feedbackV1,
    strengths: finalMatched.length > 0 ? finalMatched : graded.parsed.strengths ?? [],
    improvements: finalScore === maxScore ? [] : finalMissing,
    score: finalScore,
    maxScore,
    awardedCount: (finalBreakdown ?? []).filter((r) => r.awarded).length,
    missingCount: finalMissing.length,
    studentAnswer,
    language: answerLang === "malay" ? "malay" : "english",
  });
  feedbackV1 = truthV1.feedback;

  if (process.env.NODE_ENV === "development") {
    console.info("[rag][grade] v1 diagnostics", {
      submissionId,
      question: question.slice(0, 200),
      commandWord: questionAnalysis.commandWord,
      questionType: questionAnalysis.questionType,
      originalMaxScore: scoreAdjustment.originalMaxScore,
      adjustedMaxScore: maxScore,
      maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
      retrievalChunkCount: retrieval.chunks.length,
      auditApprovedChunkCount: filteredChunks.length,
      effectiveChunkCount: effectiveChunks.length,
      contradictionCheckPassed: reconciled.contradictionCheckPassed,
      topicConsistencyPassed: topicV1.topicConsistencyPassed,
      retrievalConfidence: retrievalConfidenceV1,
    });
  }

  await ragDb!.insert(ragGradingResultsTable).values({
    submissionId,
    userId: input.userId ?? null,
    subject: input.subject?.trim() || null,
    form: input.form?.trim() || null,
    rubricVersion,
    score: finalScore,
    maxScore,
    feedback: feedbackV1,
  });

  return {
    submissionId,
    score: finalScore,
    maxScore,
    feedback: feedbackV1,
    model: graded.model,
    modelAnswer: modelAnswerV1,
    matchedIdeas: finalMatched,
    missingIdeas: finalMissing,
    markBreakdown: finalBreakdown,
    strengths: truthV1.strengths,
    improvements: truthV1.improvements,
    originalMaxScore: scoreAdjustment.originalMaxScore,
    adjustedMaxScore: maxScore,
    maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
    studentIdeasDetected: studentIdeaStrings,
    rubricIdeas: rubricIdeaStrings,
    acceptedConcepts: acceptedConceptsV1,
    contradictionCheckPassed: reconciled.contradictionCheckPassed,
    topicConsistencyPassed: topicV1.topicConsistencyPassed,
    topicConsistencyWarning: topicV1.topicConsistencyWarning,
    questionAnalysis,
    retrievalConfidence: retrievalConfidenceV1,
    diagramContext,
    diagramContextStructured,
    diagramContextWarning,
    contextUsed: retrieval.chunks.length,
    filteredContextUsed: effectiveChunks.length,
    lowConfidence,
    warning: warning ?? undefined,
    contextAudit,
    context,
  };
}
