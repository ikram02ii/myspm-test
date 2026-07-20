/**
 * Subject-specific calculation domains.
 * Chemistry uses SPM formula → substitution → final rules, verification, and worked model answers.
 * Physics uses SPM data → formula → substitution → calculation → final (final capped at 1 mark).
 * Math / other subjects use generic calculation rules until dedicated profiles are added.
 */

import type { AssessmentCaseFile } from "./types";
import { isCalculationIntent } from "./calculationAcfPolicy";

export type CalculationDomain = "chemistry" | "physics" | "general";

export function resolveCalculationDomain(subject: string): CalculationDomain {
  const s = subject.trim().toLowerCase();
  if (/\bchem|kimia\b/.test(s)) return "chemistry";
  if (/\bphysic|fizik\b/.test(s)) return "physics";
  return "general";
}

export function isChemistryCalculationSubject(subject: string): boolean {
  return resolveCalculationDomain(subject) === "chemistry";
}

export function isPhysicsCalculationSubject(subject: string): boolean {
  return resolveCalculationDomain(subject) === "physics";
}

export function isChemistryCalculation(
  acf: Pick<AssessmentCaseFile, "intent" | "subject" | "markRule">,
): boolean {
  if (!isCalculationIntent(acf)) return false;
  if (acf.markRule.calcDomain === "chemistry") return true;
  if (acf.markRule.calcDomain === "physics" || acf.markRule.calcDomain === "general") return false;
  return isChemistryCalculationSubject(acf.subject);
}

export function isPhysicsCalculation(
  acf: Pick<AssessmentCaseFile, "intent" | "subject" | "markRule">,
): boolean {
  if (!isCalculationIntent(acf)) return false;
  if (acf.markRule.calcDomain === "physics") return true;
  if (acf.markRule.calcDomain === "chemistry" || acf.markRule.calcDomain === "general") return false;
  return isPhysicsCalculationSubject(acf.subject);
}
