/**
 * Calculation-only LLM evaluator — no theory / coverage-chain instructions.
 * Paired with reconcileCalculationDemonstration for deterministic numeric checks.
 */

import { qwenGradingJson } from "../shared/qwenGradingClient";
import {
  buildCalculationStagePromptLines,
  isCalculationIntent,
} from "../case/calculationAcfPolicy";
import { isChemistryCalculation, isPhysicsCalculation, resolveCalculationDomain } from "../case/calculationSubjectPolicy";
import { extractComparableFinalAnswer } from "../extraction/calculationNumericMatch";
import { buildCalculationEvaluationSystemLines } from "../prompts/calculation/evaluateCalculationPrompt";
import { parseUnderstandingDemonstration } from "./evaluateTheoryUnderstanding";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "../shared/types";

function emptyCalculationDemonstration(acf: AssessmentCaseFile): UnderstandingDemonstration {
  return {
    unitsDemonstrated: [],
    relationsDemonstrated: [],
    unitsMissing: acf.units
      .filter((u) => u.creditWeight > 0)
      .map((u) => ({
        id: u.id,
        kind: "unit" as const,
        label: u.content,
        reason: "No valid calculation working shown in the answer.",
      })),
    relationsMissing: [],
    invalidClaims: [],
  };
}

export async function evaluateCalculationUnderstanding(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  textbookExcerpt?: string;
  referenceModelAnswer?: string;
}): Promise<UnderstandingDemonstration> {
  if (!isCalculationIntent(params.acf)) {
    throw new Error("evaluateCalculationUnderstanding requires calculation intent");
  }

  const creditUnits = params.acf.units.filter((u) => u.creditWeight > 0);
  const chemCalc = isChemistryCalculation(params.acf);
  const physicsCalc = isPhysicsCalculation(params.acf);
  const domain = resolveCalculationDomain(params.acf.subject);
  const policy = params.acf.markRule.calcPolicy ?? "show_working";
  const referenceRaw = params.referenceModelAnswer?.trim() || params.acf.referenceModelAnswer?.trim();
  const reference = referenceRaw ? extractComparableFinalAnswer(referenceRaw) : undefined;

  const stagePrompt = buildCalculationStagePromptLines({
    maxScore: params.acf.maxScore,
    domain,
    policy,
    creditUnits: creditUnits.map((u) => ({ content: u.content, creditWeight: u.creditWeight })),
  }).join("\n");

  const system = buildCalculationEvaluationSystemLines({
    chemCalc,
    physicsCalc,
    stagePrompt,
    expectedFinal: reference,
  })
    .filter(Boolean)
    .join("\n");

  const user = [
    `Question: ${params.question}`,
    `Max marks: ${params.acf.maxScore}`,
    `Mark policy: ${policy}`,
    `Stage count (binding): ${creditUnits.length}`,
    "",
    "Credit stages / marking points (ONLY these — ids must match):",
    JSON.stringify(
      creditUnits.map((u) => ({ id: u.id, label: u.content, marks: u.creditWeight })),
      null,
      0,
    ),
    referenceRaw
      ? `Optional worked exemplar (fact-check / expected final only — not a checklist):\n${referenceRaw.slice(0, 4000)}`
      : "",
    params.textbookExcerpt ? `Method context:\n${params.textbookExcerpt.slice(0, 3000)}` : "",
    "",
    `Student answer:\n${params.studentAnswer}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await qwenGradingJson(system, user, { temperature: 0 });
  if (parsed == null || typeof parsed !== "object") {
    return emptyCalculationDemonstration(params.acf);
  }
  return parseUnderstandingDemonstration(parsed as Record<string, unknown>, params.acf);
}
