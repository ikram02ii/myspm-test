/**
 * Shared open-ended agent context + presentation (Phase 2).
 * Agents evaluate + reconcile + score; this module formats student-facing output.
 */

import type { MarkBreakdownItem } from "../../types";
import { resolveFeedbackLanguage } from "../shared/gradingTextUtils";
import {
  countModelAnswerPoints,
  formatMarkSchemePointsAsModelAnswer,
  modelAnswerPassesQualityCheck,
  normalizeModelAnswerPointSeparators,
} from "../feedback/modelAnswerFeedbackFormatPolicy";
import { resolveQwenGradingConfig } from "../shared/qwenGradingClient";
import {
  displayMarkSchemeLabels,
  getReferenceModelAnswer,
} from "../case/assessmentCaseService";
import {
  buildGradeDecisionLog,
  officialMarkingPointLabels,
  resolveOfficialModelAnswer,
  type GradeDecisionLog,
  type OfficialModelAnswerResolution,
} from "../case/artifactPolicy";
import { generateGapFeedback } from "../feedback/generateGapFeedback";
import { localizeModelAnswerForStudent } from "../feedback/localizeModelAnswer";
import { hasEmbeddedMarkScheme } from "../analysis/markSchemeInference";
import { normalizeCalculationModelAnswer } from "../extraction/normalizeCalculationModelAnswer";
import {
  buildStructuredMarkPointCards,
  formatMarkPointStatusSummary,
  formatPerPointModelAnswerForDisplay,
  resolvePerPointExemplars,
} from "../case/perPointModelAnswer";
import { splitModelAnswerIntoPoints } from "../extraction/splitModelAnswerPoints";
import type {
  AssessmentCaseFile,
  StoredAssessmentCase,
  UnderstandingDemonstration,
} from "../shared/types";
import type { OpenEndedMarkingAgentKind } from "./resolveMarkingAgent";

export type OpenEndedAgentContext = {
  question: string;
  studentAnswer: string;
  maxScore: number;
  acf: AssessmentCaseFile;
  caseId: string;
  textbookExcerpt?: string;
  usedAuditedContext: boolean;
  usedSavedCase: boolean;
  officialMa: OfficialModelAnswerResolution;
  referenceModelAnswer?: string;
  clientQuestionTypeHint?: string | null;
  /** Prior question steps / context for multi-part questions (do not penalise info established earlier). */
  questionContext?: string;
};

export type OpenEndedAgentScoreBundle = {
  score: number;
  markBreakdown: MarkBreakdownItem[];
  matchedLabels: string[];
  missingLabels: string[];
  udm: UnderstandingDemonstration;
  chainWalk?: import("../shared/types").GradingContext["chainWalk"];
};

export type ModelAnswerPointCard = {
  text: string;
  marks: number;
  /** Whether the student earned this marking point. */
  awarded?: boolean;
  rubricId?: string;
  reason?: string;
};

export type OpenEndedPipelineResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  /** One student-facing exemplar per credit unit — preferred over re-splitting modelAnswer. */
  modelAnswerPoints?: string[];
  /** Same points with credit weights for UI "1 mark" cards. */
  modelAnswerPointCards?: ModelAnswerPointCard[];
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
  decisionLog?: GradeDecisionLog;
};

export function buildOpenEndedAgentContext(params: {
  question: string;
  studentAnswer: string;
  maxScore: number;
  stored: StoredAssessmentCase;
  usedSavedCase: boolean;
  usedAuditedContext: boolean;
  textbookExcerpt?: string;
  clientQuestionTypeHint?: string | null;
  questionContext?: string;
}): OpenEndedAgentContext {
  const acf = params.stored.acf;
  const caseReference =
    acf.referenceModelAnswer?.trim() || getReferenceModelAnswer(params.stored.sourceRef) || "";
  const officialMa = resolveOfficialModelAnswer({
    question: params.question,
    acf,
    caseReference,
  });

  return {
    question: params.question,
    studentAnswer: params.studentAnswer,
    maxScore: params.maxScore,
    acf,
    caseId: params.stored.caseId,
    textbookExcerpt: params.textbookExcerpt,
    usedAuditedContext: params.usedAuditedContext,
    usedSavedCase: params.usedSavedCase,
    officialMa,
    referenceModelAnswer: officialMa.text || undefined,
    clientQuestionTypeHint: params.clientQuestionTypeHint ?? null,
    questionContext: params.questionContext,
  };
}

export async function presentOpenEndedAgentResult(params: {
  ctx: OpenEndedAgentContext;
  agent: OpenEndedMarkingAgentKind;
  scored: OpenEndedAgentScoreBundle;
}): Promise<OpenEndedPipelineResult> {
  const { ctx, agent, scored } = params;
  const isCalc = agent === "calculation";
  const { score, markBreakdown, matchedLabels, missingLabels, udm, chainWalk } = scored;

  const decisionLog = buildGradeDecisionLog({
    caseId: ctx.caseId,
    acf: ctx.acf,
    maSource: ctx.officialMa.source,
    usedSavedCase: ctx.usedSavedCase,
    markingAgent: agent,
    clientQuestionTypeHint: ctx.clientQuestionTypeHint,
  });

  const feedbackLanguage = resolveFeedbackLanguage(ctx.studentAnswer, ctx.question);
  const { feedback, strengths, improvements } = await generateGapFeedback({
    question: ctx.question,
    studentAnswer: ctx.studentAnswer,
    acf: ctx.acf,
    udm,
    score,
    maxScore: ctx.maxScore,
    markBreakdown,
    language: feedbackLanguage,
    gradingContext: chainWalk ? { chainWalk } : undefined,
  });

  const markSchemePoints = officialMarkingPointLabels(ctx.acf);
  const perPointExemplars = resolvePerPointExemplars({
    acf: ctx.acf,
    question: ctx.question,
    referenceModelAnswer: ctx.officialMa.text,
  });
  const perPointExemplarTexts = perPointExemplars.map((p) => p.exemplar);
  const perPointModelAnswerBase = !isCalc
    ? formatPerPointModelAnswerForDisplay(perPointExemplars, ctx.question)
    : "";

  const localized =
    ctx.officialMa.text && score < ctx.maxScore && !hasEmbeddedMarkScheme(ctx.question)
      ? await localizeModelAnswerForStudent({
          referenceModelAnswer: isCalc ? ctx.officialMa.text : perPointModelAnswerBase || ctx.officialMa.text,
          question: ctx.question,
          maxScore: ctx.maxScore,
          evidenceUnits: isCalc ? [] : perPointExemplarTexts.length > 0 ? perPointExemplarTexts : markSchemePoints,
          preserveCalculationSections: isCalc,
        })
      : "";

  let modelAnswer = localized.trim() ? localized.trim() : undefined;

  // Always surface a model answer — even at full marks — so students can check
  // their working against the reference. At full marks we use the deterministic
  // official/reference answer (no extra localization LLM call); the localized
  // student-friendly polish above only runs when marks were lost.
  if (!modelAnswer) {
    if (isCalc && ctx.officialMa.text) {
      modelAnswer = ctx.officialMa.text;
    } else if (perPointModelAnswerBase) {
      modelAnswer = perPointModelAnswerBase;
    } else if (ctx.officialMa.text) {
      modelAnswer = modelAnswerPassesQualityCheck(ctx.officialMa.text, ctx.maxScore, ctx.question)
        ? ctx.officialMa.text
        : formatMarkSchemePointsAsModelAnswer(markSchemePoints, ctx.question) ||
          ctx.officialMa.text;
    }
  }

  if (!isCalc && modelAnswer) {
    modelAnswer = normalizeModelAnswerPointSeparators(modelAnswer);
    const expectedPoints = Math.max(markSchemePoints.length, ctx.maxScore);
    const counted = countModelAnswerPoints(modelAnswer);
    if (expectedPoints > 1 && counted < 2 && markSchemePoints.length > 1) {
      modelAnswer =
        formatMarkSchemePointsAsModelAnswer(markSchemePoints, ctx.question) || modelAnswer;
      modelAnswer = normalizeModelAnswerPointSeparators(modelAnswer);
    }
  }

  if (isCalc && modelAnswer) {
    if (modelAnswer.includes(";") && !modelAnswer.includes("\n") && !/\\n/.test(modelAnswer)) {
      modelAnswer = modelAnswer
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n");
    }
    modelAnswer = normalizeCalculationModelAnswer(modelAnswer);
  }

  let localizedTexts: string[] | undefined;
  if (!isCalc && modelAnswer && perPointExemplars.length > 0) {
    const fromLocalized = splitModelAnswerIntoPoints(
      modelAnswer,
      Math.max(ctx.maxScore, perPointExemplars.length),
    );
    if (fromLocalized.length === perPointExemplars.length) {
      localizedTexts = fromLocalized;
    }
  }

  const structuredCards = buildStructuredMarkPointCards({
    acf: ctx.acf,
    question: ctx.question,
    referenceModelAnswer: ctx.officialMa.text,
    markBreakdown,
    localizedTexts,
  });

  const modelAnswerPointCards: ModelAnswerPointCard[] =
    structuredCards.length > 0
      ? structuredCards.map((c) => ({
          text: c.text,
          marks: c.marks,
          awarded: c.awarded,
          rubricId: c.rubricId,
          reason: c.reason,
        }))
      : !isCalc && modelAnswer
        ? splitModelAnswerIntoPoints(modelAnswer, Math.max(markSchemePoints.length, ctx.maxScore)).map(
            (text, i) => ({
              text,
              marks: markBreakdown[i]?.marks ?? 1,
              awarded: markBreakdown[i]?.awarded,
              rubricId: markBreakdown[i]?.rubricId,
              reason: markBreakdown[i]?.reason,
            }),
          )
        : [];

  const modelAnswerPoints =
    modelAnswerPointCards.length > 0 ? modelAnswerPointCards.map((c) => c.text) : undefined;

  if (!isCalc && modelAnswerPoints && modelAnswerPoints.length > 0) {
    modelAnswer = formatMarkSchemePointsAsModelAnswer(modelAnswerPoints, ctx.question);
  }

  // Prepend deterministic ✓/✗ mark-point summary so feedback always names missing ideas.
  const statusSummary = formatMarkPointStatusSummary(structuredCards, feedbackLanguage);
  const feedbackWithStatus =
    statusSummary && feedback.trim()
      ? `${statusSummary}\n\n${feedback.trim()}`
      : statusSummary || feedback;

  return {
    score,
    feedback: feedbackWithStatus,
    modelAnswer,
    modelAnswerPoints,
    modelAnswerPointCards: modelAnswerPointCards.length > 0 ? modelAnswerPointCards : undefined,
    matchedIdeas: matchedLabels,
    missingIdeas: missingLabels,
    markBreakdown,
    strengths,
    improvements,
    model: resolveQwenGradingConfig().model,
    studentIdeasDetected: udm.unitsDemonstrated.filter((d) => d.valid).map((d) => d.quote),
    rubricIdeas: displayMarkSchemeLabels(ctx.acf),
    acceptedConcepts: ctx.acf.units
      .filter((u) => u.creditWeight > 0)
      .map((u) => ({ rubricIdea: u.content, acceptedPhrases: u.aliases })),
    contradictionCheckPassed: udm.invalidClaims.length === 0,
    usedAuditedContext: ctx.usedAuditedContext,
    decisionLog,
  };
}
