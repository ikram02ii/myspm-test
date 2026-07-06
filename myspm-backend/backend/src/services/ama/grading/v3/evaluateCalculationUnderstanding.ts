/**
 * Calculation-only LLM evaluator — no theory / coverage-chain instructions.
 * Paired with reconcileCalculationDemonstration for deterministic numeric checks.
 */

import { qwenGradingJson } from "../qwenGradingClient";
import {
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  isCalculationIntent,
} from "./calculationAcfPolicy";
import { isChemistryCalculation } from "./calculationSubjectPolicy";
import { extractComparableFinalAnswer } from "./calculationNumericMatch";
import { parseUnderstandingDemonstration } from "./evaluateUnderstanding";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";

function showWorkingPrompt(chemCalc: boolean): string {
  const L = chemCalc ? CALCULATION_STAGE_LABELS : GENERIC_CALCULATION_STAGE_LABELS;
  const subject = chemCalc ? "CHEMISTRY" : "PHYSICS/GENERAL";
  return [
    `${subject} (sequential marks): credit each stage only when clearly present:`,
    `1) ${L.formula} — must show an equation or formula (not just a number).`,
    `2) ${L.substitution} — must show values substituted into the formula.`,
    `3) ${L.final} — correct final value with appropriate unit.`,
    "Final answer alone without formula/working earns ONLY the final stage (partial marks).",
    "Working shown is fine — still credit the final stage when the value and unit are correct.",
    chemCalc ? "Treat 75% and 0.75 as equivalent for substitution when appropriate." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function answerOnlyPrompt(chemCalc: boolean): string {
  const finalLabel = chemCalc ? CALCULATION_STAGE_LABELS.final : GENERIC_CALCULATION_STAGE_LABELS.final;
  return `Credit ${finalLabel} when the final value is correct — working is optional.`;
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
  const answerOnly = params.acf.markRule.calcPolicy === "answer_only";
  const referenceRaw = params.referenceModelAnswer?.trim() || params.acf.referenceModelAnswer?.trim();
  const reference = referenceRaw ? extractComparableFinalAnswer(referenceRaw) : undefined;

  const system = [
    "You are an SPM calculation examiner. Credit only what the student actually wrote — quote their words.",
    "Evaluate numeric working stages independently. Do NOT credit prose definitions.",
    "Treat numerically equivalent answers as correct (e.g. 1 mol and 1.0 mol, 2 and 2.0).",
    chemCalc
      ? "For relative formula mass (Mr) questions, accept a dimensionless Mr value without g/mol."
      : "",
    answerOnly ? answerOnlyPrompt(chemCalc) : showWorkingPrompt(chemCalc),
    reference
      ? `Expected final result (for your judgment — do NOT reveal to student): ${reference}`
      : "",
    "Mark invalidClaims only for genuinely wrong final values, wrong units, or impossible science — not formatting.",
    "",
    'Return JSON: {',
    '  "unitsDemonstrated": [{ "unitId", "quote", "valid": boolean }],',
    '  "relationsDemonstrated": [],',
    '  "unitsMissing": [{ "unitId", "reason" }],',
    '  "relationsMissing": [],',
    '  "invalidClaims": [{ "text", "reason" }]',
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Question: ${params.question}`,
    `Max marks: ${params.acf.maxScore}`,
    `Mark policy: ${params.acf.markRule.calcPolicy ?? "show_working"}`,
    "",
    "Credit stages:",
    JSON.stringify(
      creditUnits.map((u) => ({ id: u.id, label: u.content, marks: u.creditWeight })),
      null,
      0,
    ),
    params.textbookExcerpt ? `Method context:\n${params.textbookExcerpt.slice(0, 3000)}` : "",
    "",
    `Student answer:\n${params.studentAnswer}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await qwenGradingJson(system, user, { temperature: 0 });
  return parseUnderstandingDemonstration(parsed ?? {}, params.acf);
}
