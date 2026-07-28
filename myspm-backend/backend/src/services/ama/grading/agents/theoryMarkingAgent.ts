/**
 * Theory marking agent (Phase 2).
 *
 * Flow (P0):
 *   scheme units → LLM proposes evidence ticks → gate validates →
 *   competitive assign → sum awarded weights.
 * LLM assists matching; final score depends on validated evidence only.
 */

import { evaluateUnderstanding } from "../evaluation/evaluateTheoryUnderstanding";
import { reconcileUnderstandingDemonstration } from "../matching/reconcileTheoryDemonstration";
import { scoreFromDemonstration } from "../scoring/scoreFromDemonstration";
import {
  isUdmTraceEnabled,
  logUdmTraceStage,
  snapshotUdmTicks,
} from "../shared/udmTickTrace";
import { buildUnitDecisionLogs, logMarkingDecision } from "../shared/markingDecisionLog";
import {
  presentOpenEndedAgentResult,
  type OpenEndedAgentContext,
  type OpenEndedPipelineResult,
} from "./openEndedAgentContext";

export async function runTheoryMarkingAgent(
  ctx: OpenEndedAgentContext,
): Promise<OpenEndedPipelineResult> {
  const rawUdm = await evaluateUnderstanding({
    question: ctx.question,
    studentAnswer: ctx.studentAnswer,
    acf: ctx.acf,
    textbookExcerpt: ctx.textbookExcerpt,
    questionContext: ctx.questionContext,
  });

  const udm = await reconcileUnderstandingDemonstration({
    question: ctx.question,
    studentAnswer: ctx.studentAnswer,
    acf: ctx.acf,
    udm: rawUdm,
  });

  if (isUdmTraceEnabled()) {
    logUdmTraceStage({
      stage: "after_reconcile",
      caseId: ctx.caseId,
      question: ctx.question,
      rows: snapshotUdmTicks(ctx.acf, udm),
    });
  }

  const scored = scoreFromDemonstration(ctx.acf, udm, ctx.studentAnswer);
  const awardedIds = new Set(
    scored.markBreakdown.filter((r) => r.awarded && r.rubricId).map((r) => r.rubricId!),
  );
  const scoredUdm = {
    ...udm,
    unitsDemonstrated: udm.unitsDemonstrated.map((d) => ({
      ...d,
      valid: d.valid && awardedIds.has(d.unitId),
    })),
    unitsMissing: scored.markBreakdown
      .filter((r) => !r.awarded)
      .map((r) => ({
        id: r.rubricId || r.idea,
        kind: "unit" as const,
        label: r.idea,
        reason: r.reason || "Required marking point not found in the student's answer.",
      })),
  };

  const unitDecisions = buildUnitDecisionLogs({
    acf: ctx.acf,
    udm: scoredUdm,
    markBreakdown: scored.markBreakdown,
  });
  logMarkingDecision({
    caseId: ctx.caseId,
    agent: "theory",
    questionType: ctx.acf.intent.analysis?.questionType ?? ctx.acf.intent.category,
    intentFamily: ctx.acf.intent.family,
    maxScore: ctx.maxScore,
    score: scored.score,
    studentAnswerPreview: ctx.studentAnswer,
    units: unitDecisions,
  });

  return presentOpenEndedAgentResult({
    ctx,
    agent: "theory",
    scored: {
      score: scored.score,
      markBreakdown: scored.markBreakdown,
      matchedLabels: scored.matchedLabels,
      missingLabels: scored.missingLabels,
      udm: scoredUdm,
      chainWalk: scored.chainWalk,
    },
  });
}
