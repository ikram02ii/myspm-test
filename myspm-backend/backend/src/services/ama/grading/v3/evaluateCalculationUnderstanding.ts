/**
 * Calculation-only LLM evaluator — no theory / coverage-chain instructions.
 * Paired with reconcileCalculationDemonstration for deterministic numeric checks.
 */

import { qwenGradingJson } from "../qwenGradingClient";
import {
  buildCalculationStagePromptLines,
  isCalculationIntent,
} from "./calculationAcfPolicy";
import { isChemistryCalculation, isPhysicsCalculation, resolveCalculationDomain } from "./calculationSubjectPolicy";
import { extractComparableFinalAnswer } from "./calculationNumericMatch";
import { parseUnderstandingDemonstration } from "./evaluateTheoryUnderstanding";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";

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

  const system = [
    "You are an SPM calculation examiner. Credit only what the student actually wrote — quote their words.",
    "CRITICAL: Respond with valid JSON only — no prose, markdown, or explanation outside the JSON object.",
    "Award marks ONLY against the credit stages / marking points listed below.",
    "The reference worked model answer is NOT a second mark scheme — use it only to check the expected numeric final (and units).",
    "Evaluate ONLY the credit stages listed below. Do NOT invent extra stages (e.g. do not require substitution when it is not listed).",
    "A stage earns valid:true when the student shows that stage with correct method/meaning for that stage.",
    "NEVER withhold Formula/Working because the student's wording or layout differs from the worked exemplar.",
    "Do NOT credit prose definitions.",
    "Treat numerically equivalent answers as correct (e.g. 1 mol and 1.0 mol, 2 and 2.0).",
    chemCalc
      ? "For relative formula mass (Mr) questions, accept a dimensionless Mr value without g/mol."
      : physicsCalc
        ? "For Physics, SI units are required on the final answer unless the question specifies otherwise."
        : "",
    stagePrompt,
    reference
      ? `Expected final result (for your judgment — do NOT reveal to student): ${reference}`
      : "",
    "Mark invalidClaims only for genuinely wrong final values, wrong units, or impossible science — not formatting or incompleteness vs the exemplar.",
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
