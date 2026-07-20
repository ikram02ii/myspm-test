/**
 * Theory marking agent (Phase 2).
 *
 * Responsibility: map student text → evidence units → rules score.
 * Does not run calculation stage plans or numeric reconcile.
 */

import { evaluateUnderstanding } from "../evaluateTheoryUnderstanding";
import { reconcileUnderstandingDemonstration } from "../reconcileTheoryDemonstration";
import { scoreFromDemonstration } from "../scoreFromDemonstration";
import {
  isUdmTraceEnabled,
  logUdmTraceStage,
  snapshotUdmTicks,
} from "../udmTickTrace";
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

  const scored = scoreFromDemonstration(ctx.acf, udm);

  return presentOpenEndedAgentResult({
    ctx,
    agent: "theory",
    scored: {
      score: scored.score,
      markBreakdown: scored.markBreakdown,
      matchedLabels: scored.matchedLabels,
      missingLabels: scored.missingLabels,
      udm,
      chainWalk: scored.chainWalk,
    },
  });
}
