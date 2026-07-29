import type { MarkBreakdownItem } from "../../types";
import { qwenGradingJson } from "../shared/qwenGradingClient";
import { withStrictFeedbackLanguage } from "../shared/gradingMandatoryLanguage";
import { sanitizeLearnerFeedback } from "../shared/gradingEvidencePolicy";
import { classifyModelAnswerVerbFamily } from "./modelAnswerFeedbackFormatPolicy";
import { resolveFeedbackLanguage, type AnswerLanguage } from "../shared/gradingTextUtils";
import {
  buildCanonicalFeedbackSystemPrompt,
  formatFeedbackUserPrompt,
  type FeedbackBreakdownRow,
  type FeedbackInputPayload,
  type FeedbackQuestionType,
} from "../prompts/feedback/gapFeedbackPrompt";
import { chainWalkToFeedbackGaps } from "../scoring/coverageChainScorer";
import { isCalculationIntent } from "../case/calculationAcfPolicy";
import {
  reconcileFeedbackToMarkingTruth,
  shouldUseDeterministicFeedback,
} from "./feedbackTruthPolicy";
import { hasEmbeddedMarkScheme } from "../case/markSchemeInference";
import type { AssessmentCaseFile, GradingContext, UnderstandingDemonstration } from "../shared/types";

export type {
  FeedbackBreakdownRow,
  FeedbackInputPayload,
  FeedbackQuestionType,
} from "../prompts/feedback/gapFeedbackPrompt";

type FeedbackGap = { kind: "unit" | "relation"; label: string; reason: string };

function gapsFromMarkBreakdown(markBreakdown: MarkBreakdownItem[]): FeedbackGap[] {
  return markBreakdown
    .filter((row) => !row.awarded)
    .map((row) => ({
      kind: "unit" as const,
      label: row.idea,
      reason: row.reason || "Not demonstrated in the answer.",
    }));
}

function awardedLabelsFromBreakdown(markBreakdown: MarkBreakdownItem[]): string[] {
  return markBreakdown.filter((row) => row.awarded).map((row) => row.idea);
}

function briefGapLabel(label: string): string {
  const trimmed = label.replace(/^Mark\s+\d+\s*:\s*/i, "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return trimmed;
  return `${words.slice(0, 8).join(" ")}…`;
}

function sanitizeImprovementsToMarkScheme(
  improvements: string[],
  missingLabels: string[],
): string[] {
  if (missingLabels.length === 0) return [];
  if (improvements.length === 0) return missingLabels.slice(0, 3);

  const kept = improvements.filter((item) => {
    const lower = item.toLowerCase();
    return missingLabels.some(
      (label) =>
        lower.includes(label.toLowerCase().slice(0, Math.min(24, label.length))) ||
        label.toLowerCase().includes(lower.slice(0, Math.min(24, lower.length))),
    );
  });

  return kept.length > 0
    ? kept.slice(0, 3).map(briefGapLabel)
    : missingLabels.slice(0, 3).map(briefGapLabel);
}

function resolveFeedbackQuestionType(
  question: string,
  isCalc: boolean,
): FeedbackQuestionType {
  if (isCalc) return "calculation";
  return classifyModelAnswerVerbFamily(question);
}

function formatBreakdownRows(
  markBreakdown: MarkBreakdownItem[],
): FeedbackBreakdownRow[] {
  return markBreakdown.map((row) => ({
    label: row.idea,
    status: row.awarded ? ("AWARDED" as const) : ("NOT_AWARDED" as const),
    reason: (row.reason || "").trim(),
  }));
}

function formatGapsAsBreakdown(gaps: FeedbackGap[]): FeedbackBreakdownRow[] {
  return gaps.map((g) => ({
    label: g.label,
    status: "NOT_AWARDED" as const,
    reason: g.reason,
  }));
}

function buildMarkingNotes(params: {
  isCalc: boolean;
  stageCount: number;
  maxScore: number;
  unawardedCount: number;
  chainGaps: ReturnType<typeof chainWalkToFeedbackGaps> | null;
}): string[] {
  const notes: string[] = [];

  if (params.isCalc) {
    notes.push(
      `CALCULATION: Exactly ${params.stageCount} marking stage(s) for this ${params.maxScore}-mark question.`,
      "CALCULATION: improvements[] may ONLY use the unawarded stage labels listed in markBreakdown.",
      "CALCULATION: NEVER invent, split, merge, or rename stages. NEVER invent stages not listed.",
      "CALCULATION: NEVER split a combined stage (e.g. final answer with unit) into separate marks.",
    );
  } else {
    notes.push(
      `THEORY: improvements[] length MUST be ≤ ${params.unawardedCount} (unawarded binding points only).`,
      "THEORY: NEVER invent extra marking criteria beyond markBreakdown.",
    );
  }

  if (params.chainGaps) {
    const credited = params.chainGaps.creditedLabels.join(" | ") || "(none)";
    notes.push(`CHAIN credited (scored): ${credited}`);
    if (params.chainGaps.blockedLabels.length > 0) {
      notes.push(
        `CHAIN blocked (mentioned, NOT credited): ${params.chainGaps.blockedLabels.join(" | ")}`,
      );
    }
    if (params.chainGaps.missingChainLabels.length > 0) {
      notes.push(
        `CHAIN missing: ${params.chainGaps.missingChainLabels.join(" | ")}`,
      );
    }
    if (params.chainGaps.relationGapLabels.length > 0) {
      notes.push(
        `CHAIN relation gaps: ${params.chainGaps.relationGapLabels.join(" | ")}`,
      );
    }
    notes.push(
      "CHAIN: Never describe blocked points as credited. Only credited units received marks.",
    );
  }

  return notes;
}

/** Build structured feedback payload from finalized marking results (code-owned). */
export function buildFeedbackInputPayload(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  score: number;
  maxScore: number;
  markBreakdown?: MarkBreakdownItem[];
  language?: AnswerLanguage;
  gradingContext?: GradingContext;
}): { payload: FeedbackInputPayload; missingLabels: string[]; awardedLabels: string[] } {
  const chainWalk = params.gradingContext?.chainWalk;
  const chainGaps =
    chainWalk && params.acf.markRule.kind === "coverage_chain"
      ? chainWalkToFeedbackGaps(params.acf, params.udm, chainWalk)
      : null;

  const demonstrated = chainWalk
    ? chainWalk.creditedUnits
        .map((id) => params.udm.unitsDemonstrated.find((d) => d.unitId === id && d.valid))
        .filter((d): d is NonNullable<typeof d> => d != null)
    : params.udm.unitsDemonstrated.filter((d) => d.valid);

  const bindingBreakdown =
    params.markBreakdown && params.markBreakdown.length > 0 ? params.markBreakdown : undefined;

  const gaps: FeedbackGap[] = bindingBreakdown
    ? gapsFromMarkBreakdown(bindingBreakdown)
    : chainGaps
      ? [
          ...chainGaps.blockedLabels.map((label) => ({
            kind: "unit" as const,
            label,
            reason: "Chain broken before this point — not credited.",
          })),
          ...chainGaps.missingChainLabels.map((label) => ({
            kind: "unit" as const,
            label,
            reason: "Not demonstrated in the answer.",
          })),
          ...chainGaps.relationGapLabels.map((label) => ({
            kind: "relation" as const,
            label,
            reason: "Required link not demonstrated.",
          })),
        ]
      : [...params.udm.unitsMissing, ...params.udm.relationsMissing];

  const missingLabels = gaps.map((g) => g.label);
  const awardedLabels = bindingBreakdown
    ? awardedLabelsFromBreakdown(bindingBreakdown)
    : demonstrated.map((d) => d.quote).slice(0, 5);

  const markBreakdownRows = bindingBreakdown
    ? formatBreakdownRows(bindingBreakdown)
    : [
        ...awardedLabels.map((label) => ({
          label,
          status: "AWARDED" as const,
          reason: "",
        })),
        ...formatGapsAsBreakdown(gaps),
      ];

  const isCalc = isCalculationIntent(params.acf);
  const language =
    params.language ?? resolveFeedbackLanguage(params.studentAnswer, params.question);
  const questionType = resolveFeedbackQuestionType(params.question, isCalc);

  const payload: FeedbackInputPayload = {
    question: params.question,
    questionType,
    score: params.score,
    maxScore: params.maxScore,
    language,
    markBreakdown: markBreakdownRows,
    studentEvidence: params.studentAnswer,
    incorrectClaims: params.udm.invalidClaims.map((c) => `"${c.text}": ${c.reason}`),
    markingNotes: buildMarkingNotes({
      isCalc,
      stageCount: markBreakdownRows.length || params.maxScore,
      maxScore: params.maxScore,
      unawardedCount: missingLabels.length,
      chainGaps,
    }),
  };

  return { payload, missingLabels, awardedLabels };
}

export async function generateGapFeedback(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  score: number;
  maxScore: number;
  markBreakdown?: MarkBreakdownItem[];
  language?: AnswerLanguage;
  gradingContext?: GradingContext;
}): Promise<{ feedback: string; strengths: string[]; improvements: string[] }> {
  const { payload, missingLabels, awardedLabels } = buildFeedbackInputPayload(params);
  const isCalc = payload.questionType === "calculation";
  const lang = payload.language === "malay" ? "malay" : "english";
  const improvementsFallback =
    params.score >= params.maxScore ? [] : missingLabels.slice(0, 3).map(briefGapLabel);

  // Root rule: when nothing was awarded (or answer is non-responsive), do NOT call the
  // feedback LLM — it invents "right track / needs more detail" for junk answers.
  // Also skip for AI practice items that already ship a full mark scheme (faster marking).
  if (
    hasEmbeddedMarkScheme(params.question) ||
    shouldUseDeterministicFeedback({
      score: params.score,
      awardedCount: awardedLabels.length,
      studentAnswer: params.studentAnswer,
    })
  ) {
    return reconcileFeedbackToMarkingTruth({
      feedback: "",
      strengths: awardedLabels.slice(0, 3),
      improvements: improvementsFallback,
      score: params.score,
      maxScore: params.maxScore,
      awardedCount: awardedLabels.length,
      missingCount: missingLabels.length,
      studentAnswer: params.studentAnswer,
      language: lang,
    });
  }

  const system = withStrictFeedbackLanguage(
    buildCanonicalFeedbackSystemPrompt(payload.questionType, payload.language),
  );
  const user = formatFeedbackUserPrompt(payload);

  try {
    const parsed = await qwenGradingJson(system, user, {
      temperature: isCalc ? 0 : 0.15,
    });
    const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
    const strengths = Array.isArray(parsed?.strengths)
      ? (parsed.strengths as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const improvements = Array.isArray(parsed?.improvements)
      ? (parsed.improvements as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    if (feedback.length > 0) {
      return reconcileFeedbackToMarkingTruth({
        feedback: sanitizeLearnerFeedback(feedback),
        strengths: strengths.slice(0, 3),
        improvements:
          params.score >= params.maxScore
            ? []
            : sanitizeImprovementsToMarkScheme(improvements, missingLabels),
        score: params.score,
        maxScore: params.maxScore,
        awardedCount: awardedLabels.length,
        missingCount: missingLabels.length,
        studentAnswer: params.studentAnswer,
        language: lang,
      });
    }
  } catch {
    /* fallback */
  }

  if (params.score >= params.maxScore) {
    return {
      feedback: "Your answer covers the required marking points. Well done.",
      strengths: awardedLabels.slice(0, 3),
      improvements: [],
    };
  }

  return reconcileFeedbackToMarkingTruth({
    feedback: "",
    strengths: awardedLabels.slice(0, 2),
    improvements: improvementsFallback,
    score: params.score,
    maxScore: params.maxScore,
    awardedCount: awardedLabels.length,
    missingCount: missingLabels.length,
    studentAnswer: params.studentAnswer,
    language: lang,
  });
}
