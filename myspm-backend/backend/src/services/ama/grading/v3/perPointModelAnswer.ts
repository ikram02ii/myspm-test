/**
 * Per-marking-point model answers — one student-facing exemplar per credit unit.
 * Grading compares the student answer to EACH marking point; score = demonstrated count.
 */

import {
  classifyModelAnswerVerbFamily,
  countModelAnswerPoints,
  formatMarkSchemePointsAsModelAnswer,
} from "../modelAnswerFeedbackFormatPolicy";
import type { AssessmentCaseFile, EvidenceUnit } from "./types";

export type PerPointExemplar = {
  unitId: string;
  marks: number;
  rubricLabel: string;
  exemplar: string;
};

export function creditUnitsOrdered(acf: AssessmentCaseFile): EvidenceUnit[] {
  return acf.units.filter((u) => u.creditWeight > 0);
}

/** Split a stored model-answer string into N exemplar chunks when possible. */
export function splitReferenceIntoPointExemplars(
  reference: string,
  expectedCount: number,
  question: string,
): string[] {
  const trimmed = (reference || "").trim();
  if (!trimmed || expectedCount <= 0) return [];

  const counted = countModelAnswerPoints(trimmed);
  if (counted === expectedCount) {
    const family = classifyModelAnswerVerbFamily(question);
    if (family === "state_or_identify") {
      return trimmed
        .split(/\n+/)
        .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
        .filter(Boolean);
    }
    if (family === "explain_or_describe" || family === "compare_or_differentiate") {
      const numbered = trimmed
        .split(/\n\s*\n+/)
        .map((p) => p.replace(/^\d+[.)]\s*/, "").trim())
        .filter(Boolean);
      if (numbered.length === expectedCount) return numbered;
      const lines = trimmed
        .split(/\n+/)
        .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[•\-*]\s*/, "").trim())
        .filter(Boolean);
      if (lines.length === expectedCount) return lines;
    }
    if (trimmed.includes(";")) {
      const parts = trimmed.split(";").map((p) => p.trim()).filter(Boolean);
      if (parts.length === expectedCount) return parts;
    }
  }

  return [];
}

/** Build one exemplar row per credit unit from reference text or rubric labels. */
export function resolvePerPointExemplars(params: {
  acf: AssessmentCaseFile;
  question: string;
  referenceModelAnswer?: string;
}): PerPointExemplar[] {
  const units = creditUnitsOrdered(params.acf);
  const reference = (params.referenceModelAnswer || params.acf.referenceModelAnswer || "").trim();
  const split = splitReferenceIntoPointExemplars(reference, units.length, params.question);

  return units.map((unit, i) => ({
    unitId: unit.id,
    marks: unit.creditWeight,
    rubricLabel: unit.content,
    exemplar: split[i]?.trim() || unit.content,
  }));
}

/** Student-facing model answer: one block per marking point (matches UI split). */
export function formatPerPointModelAnswerForDisplay(
  points: PerPointExemplar[],
  question: string,
): string {
  if (points.length === 0) return "";
  const texts = points.map((p) => p.exemplar.trim()).filter(Boolean);
  return formatMarkSchemePointsAsModelAnswer(texts, question);
}

/** Join per-point exemplars for storage in referenceModelAnswer. */
export function joinPerPointExemplarsForStorage(
  exemplars: string[],
  question: string,
): string {
  return formatMarkSchemePointsAsModelAnswer(
    exemplars.map((e) => e.trim()).filter(Boolean),
    question,
  );
}
