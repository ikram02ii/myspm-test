/**
 * Calculation marking agent (Phase 2).
 *
 * Responsibility: stage evidence + numeric reconcile → rules score.
 * Does not run theory verb / coverage-chain evaluators.
 */

import { evaluateCalculationUnderstanding } from "../evaluateCalculationUnderstanding";
import { reconcileCalculationDemonstration } from "../reconcileCalculationDemonstration";
import { scoreFromDemonstration } from "../scoreFromDemonstration";
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

  const scored = scoreFromDemonstration(ctx.acf, udm);

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
