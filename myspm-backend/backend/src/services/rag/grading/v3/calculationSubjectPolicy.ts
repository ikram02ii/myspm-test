/**
 * Subject-specific calculation domains.
 * Chemistry uses SPM formula → substitution → final rules, verification, and worked model answers.
 * Math / Physics / other subjects use generic calculation rules until dedicated profiles are added.
 */

import type { AssessmentCaseFile } from "./types";
import { isCalculationIntent } from "./calculationAcfPolicy";

export type CalculationDomain = "chemistry" | "general";

/** Future: "physics" | "math" */
export type CalculationDomainFuture = CalculationDomain | "physics" | "math";

export function resolveCalculationDomain(subject: string): CalculationDomain {
  const s = subject.trim().toLowerCase();
  if (/\bchem|kimia\b/.test(s)) return "chemistry";
  return "general";
}

export function isChemistryCalculationSubject(subject: string): boolean {
  return resolveCalculationDomain(subject) === "chemistry";
}

export function isChemistryCalculation(
  acf: Pick<AssessmentCaseFile, "intent" | "subject" | "markRule">,
): boolean {
  if (!isCalculationIntent(acf)) return false;
  if (acf.markRule.calcDomain === "chemistry") return true;
  if (acf.markRule.calcDomain === "general") return false;
  return isChemistryCalculationSubject(acf.subject);
}
