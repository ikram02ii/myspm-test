/**
 * Calculation marking agent (Phase 2).
 *
 * Responsibility: stage evidence + numeric reconcile → rules score.
 * Does not run theory verb / coverage-chain evaluators.
 */

import { evaluateCalculationUnderstanding } from "../evaluation/evaluateCalculationUnderstanding";
import { reconcileCalculationDemonstration } from "../matching/reconcileCalculationDemonstration";
import { scoreFromDemonstration } from "../scoring/scoreFromDemonstration";
import { buildUnitDecisionLogs, logMarkingDecision } from "../shared/markingDecisionLog";
import {
  presentOpenEndedAgentResult,
  type OpenEndedAgentContext,
  type OpenEndedPipelineResult,
} from "./openEndedAgentContext";

export async function runCalculationMarkingAgent(
  ctx: OpenEndedAgentContext,
): Promise<OpenEndedPipelineResult> {
  const rawUdm = await evaluateCalculationUnderstanding({
    question: ctx.question,
    studentAnswer: ctx.studentAnswer,
    acf: ctx.acf,
    textbookExcerpt: ctx.textbookExcerpt,
    referenceModelAnswer: ctx.referenceModelAnswer,
  });

  const udm = reconcileCalculationDemonstration({
    question: ctx.question,
    studentAnswer: ctx.studentAnswer,
    acf: ctx.acf,
    udm: rawUdm,
    referenceModelAnswer: ctx.referenceModelAnswer,
  });

  const scored = scoreFromDemonstration(ctx.acf, udm, ctx.studentAnswer);

  logMarkingDecision({
    caseId: ctx.caseId,
    agent: "calculation",
    questionType: ctx.acf.intent.analysis?.questionType ?? "calculation",
    intentFamily: ctx.acf.intent.family,
    maxScore: ctx.maxScore,
    score: scored.score,
    studentAnswerPreview: ctx.studentAnswer,
    units: buildUnitDecisionLogs({
      acf: ctx.acf,
      udm,
      markBreakdown: scored.markBreakdown,
    }),
  });

  return presentOpenEndedAgentResult({
    ctx,
    agent: "calculation",
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
