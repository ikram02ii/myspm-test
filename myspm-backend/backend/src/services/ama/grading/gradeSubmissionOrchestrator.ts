/**
 * gradeSubmission orchestration: maxScore prep → vision facts → retrieval/audit
 * → v3 pipeline or legacy v1 → persist. Does not own scoring rules.
 */
import { randomUUID } from "node:crypto";
import { ragDb, ragGradingResultsTable } from "../../../lib/ragDb";
import { auditRetrievedContext } from "../retrieval/contextAuditService";
import { buildGradingContextFromChunks, retrieveChunks } from "../retrieval/retrievalService";
import { gradeWithPipelineV2, extractStudentIdeas } from "./gradePipelineService";
import { analyzeQuestion } from "./analysis/questionAnalysisService";
import type {
  DiagramContext,
  GradeSubmissionInput,
  GradeSubmissionResult,
  MarkBreakdownItem,
  RetrievedChunk,
} from "../types";
import { inferAdjustedMaxScore } from "./shared/gradingChecks";
import { fixMissingIdeasAgainstStudentAnswer } from "./matching/gradingFairness";
import { applyScoreConsistencyRules, computeRetrievalConfidence } from "./shared/gradingChecks";
import { validateGradeResult } from "./validators/validateGradeResult";
import { resolveFeedbackLanguage } from "./shared/gradingTextUtils";
import {
  generateDiagramContextWithQwen,
  renderDiagramContextForGrader,
  buildEnrichedRetrievalQuery,
} from "./extraction/diagramFactExtraction";
import { gradingNeedsVisionExtract } from "./shared/gradingPolicy";
import { hasEmbeddedMarkScheme } from "./analysis/markSchemeInference";
import {
  gradeWithLegacyPipeline,
  isMcqLetterOnlyExplanationRequest,
  briefIdeaFeedback,
  sanitizeFeedback,
} from "./legacy/gradeWithLegacyPipeline";
import { reconcileFeedbackToMarkingTruth } from "./feedback/feedbackTruthPolicy";

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
  // Skip VL when an image is decorative (attached) but the stem does not need the figure —
  // generated questions often send diagramImageUrl even for non-diagram items.
  const gradeStartedAt = Date.now();
  const selfContainedScheme = hasEmbeddedMarkScheme(question);
  const hasDiagramImage = Boolean(input.diagramImageUrl?.trim() || input.diagramImageBase64?.trim());
  const needsVision = hasDiagramImage && gradingNeedsVisionExtract(question);

  let diagramContextStructured: DiagramContext | undefined;
  let diagramContextWarning: string | undefined;

  // Run vision + retrieval in parallel when vision is needed (was sequential → slow).
  // Retrieval uses the stem alone; diagram facts enrich grader context, not the chunk query.
  const visionPromise = needsVision
    ? generateDiagramContextWithQwen({
        question,
        subject: input.subject,
        imageUrl: input.diagramImageUrl,
        imageBase64: input.diagramImageBase64,
      })
        .then((vision) => {
          console.info("[rag][grade] vision extract (facts only — not a marking agent)", {
            submissionId,
            model: vision.model,
            diagramType: vision.diagram.diagramType,
            labelCount: vision.diagram.labels.length,
            confidence: vision.diagram.confidence,
            rawLength: vision.rawText.length,
          });
          return vision;
        })
        .catch((error: unknown) => {
          diagramContextWarning =
            error instanceof Error ? error.message : "Failed to generate diagram context.";
          console.warn("[rag][grade] diagram context failed", {
            submissionId,
            warning: diagramContextWarning,
          });
          return null;
        })
    : Promise.resolve(null);

  if (hasDiagramImage && !needsVision) {
    console.info("[rag][grade] vision extract skipped (image attached but stem does not require figure)", {
      submissionId,
    });
  }

  // Embedded Jawapan / Marking points: skip chunk retrieval + LLM audit (often filters to 0 anyway).
  const retrievalPromise = selfContainedScheme
    ? Promise.resolve({ chunks: [] as RetrievedChunk[] })
    : retrieveChunks({
        query: buildEnrichedRetrievalQuery(question, undefined),
        subject: input.subject?.trim(),
        form: input.form?.trim(),
        topK: input.topK,
      });

  const [visionResult, retrieval] = await Promise.all([visionPromise, retrievalPromise]);
  console.info("[rag][grade] stage timing", {
    submissionId,
    stage: "vision_retrieval",
    elapsedMs: Date.now() - gradeStartedAt,
    selfContainedScheme,
    needsVision,
  });

  if (visionResult) {
    diagramContextStructured = visionResult.diagram;
  }

  // Back-compat: callers that still expect a string get a deterministic
  // rendering of the structured form.
  const diagramContext = diagramContextStructured
    ? renderDiagramContextForGrader(diagramContextStructured)
    : undefined;

  console.info("[rag][grade] retrieved chunks", {
    count: retrieval.chunks.length,
    submissionId,
    skipped: selfContainedScheme,
  });

  const contextAudit = selfContainedScheme
    ? {
        relevanceScore: 1,
        isSufficientContext: true,
        relevantChunkIds: [] as string[],
        irrelevantChunkIds: [] as string[],
        reason: "Self-contained mark scheme in question; textbook retrieval/audit skipped.",
      }
    : await auditRetrievedContext(question, retrieval.chunks);
  const filteredChunks = filterChunksByAudit(retrieval.chunks, contextAudit.relevantChunkIds);
  const effectiveChunks = filteredChunks.length > 0 ? filteredChunks : [];
  const context = buildGradingContextFromChunks(question, effectiveChunks);

  const lowConfidence = selfContainedScheme
    ? false
    : !contextAudit.isSufficientContext || filteredChunks.length === 0;
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
    selfContainedScheme,
    elapsedMs: Date.now() - gradeStartedAt,
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
    console.info("[rag][grade] stage timing", {
      submissionId,
      stage: "pipeline_v2_complete",
      elapsedMs: Date.now() - gradeStartedAt,
      selfContainedScheme,
    });

    // Pipeline v2 already reconciles marks; second pass inflated partial transport answers.
    const v2Reconciled = {
      missingIdeas: gradedV2.missingIdeas,
      matchedIdeas: gradedV2.matchedIdeas,
      markBreakdown: gradedV2.markBreakdown,
      score: gradedV2.score,
      contradictionCheckPassed: gradedV2.contradictionCheckPassed,
    };

    const retrievalConfidence = computeRetrievalConfidence({
      audit: contextAudit,
      approvedChunkCount: filteredChunks.length,
      lowConfidenceFlag: lowConfidence,
    });

    const answerLangV2 = resolveFeedbackLanguage(studentAnswer, question);
    const mcqLetterV2 = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore);
    let feedbackOut = sanitizeFeedback(gradedV2.feedback, { maxSentences: mcqLetterV2 ? 8 : undefined });

    const validatedV2 = validateGradeResult({
      score: v2Reconciled.score,
      maxScore,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      missingIdeas: v2Reconciled.missingIdeas,
      matchedIdeas: v2Reconciled.matchedIdeas,
      studentAnswer,
      question,
      feedback: feedbackOut,
      modelAnswer: gradedV2.modelAnswer,
      rubricIdeas: gradedV2.rubricIdeas,
      questionAnalysis,
      language: answerLangV2,
      acf: null,
    });
    const finalScoreV2 = validatedV2.score;
    feedbackOut = validatedV2.feedback;
    const modelAnswerOut = validatedV2.modelAnswer ?? gradedV2.modelAnswer;

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
        topicConsistencyPassed: validatedV2.topicConsistencyPassed,
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
      topicConsistencyPassed: validatedV2.topicConsistencyPassed,
      topicConsistencyWarning: validatedV2.topicConsistencyWarning,
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
  const finalScorePreValidate = scoreConsistencyV1.score;
  const finalMatched = reconciled.matchedIdeas;
  const finalMissing = reconciled.missingIdeas;
  const finalBreakdown = reconciled.markBreakdown ?? graded.parsed.markBreakdown;
  const modelFeedback = sanitizeFeedback(graded.parsed.feedback, {
    maxSentences: mcqLetterExplainMode ? 8 : undefined,
  });
  const finalFeedback = reconciled.contradictionCheckPassed
    ? modelFeedback
    : briefIdeaFeedback(finalScorePreValidate, maxScore, finalMatched, finalMissing, answerLang);

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

  const validatedV1 = validateGradeResult({
    score: finalScorePreValidate,
    maxScore,
    markBreakdown: finalBreakdown,
    missingIdeas: finalMissing,
    matchedIdeas: finalMatched,
    studentAnswer,
    question,
    feedback: finalFeedback,
    modelAnswer: graded.parsed.modelAnswer,
    rubricIdeas: rubricIdeaStrings,
    questionAnalysis,
    language: answerLang,
    acf: null,
  });
  const finalScore = validatedV1.score;
  let feedbackV1 = validatedV1.feedback;
  let modelAnswerV1 = validatedV1.modelAnswer ?? graded.parsed.modelAnswer;

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
      topicConsistencyPassed: validatedV1.topicConsistencyPassed,
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
    topicConsistencyPassed: validatedV1.topicConsistencyPassed,
    topicConsistencyWarning: validatedV1.topicConsistencyWarning,
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
