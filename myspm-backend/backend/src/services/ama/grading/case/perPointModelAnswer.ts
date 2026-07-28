/**
 * Per-marking-point model answers — one student-facing exemplar per credit unit.
 * Grading compares the student answer to EACH marking point; score = demonstrated count.
 */

import {
  classifyModelAnswerVerbFamily,
  countModelAnswerPoints,
  formatMarkSchemePointsAsModelAnswer,
} from "../feedback/modelAnswerFeedbackFormatPolicy";
import type { AssessmentCaseFile, EvidenceUnit } from "../shared/types";
import type { MarkBreakdownItem } from "../../types";

export type PerPointExemplar = {
  unitId: string;
  marks: number;
  rubricLabel: string;
  exemplar: string;
};

/** Student-facing card with mark value and award status for feedback UI. */
export type StructuredMarkPointCard = {
  text: string;
  marks: number;
  awarded: boolean;
  rubricId: string;
  reason?: string;
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
  if (counted === expectedCount || counted >= expectedCount) {
    const family = classifyModelAnswerVerbFamily(question);
    if (family === "state_or_identify") {
      const lines = trimmed
        .split(/\n+/)
        .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
        .filter(Boolean);
      if (lines.length >= expectedCount) return lines.slice(0, expectedCount);
    }
    if (family === "explain_or_describe" || family === "compare_or_differentiate") {
      const numbered = trimmed
        .split(/\n\s*\n+/)
        .map((p) => p.replace(/^\d+[.)]\s*/, "").trim())
        .filter(Boolean);
      if (numbered.length >= expectedCount) return numbered.slice(0, expectedCount);
      const lines = trimmed
        .split(/\n+/)
        .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[•\-*]\s*/, "").trim())
        .filter(Boolean);
      if (lines.length >= expectedCount) return lines.slice(0, expectedCount);
    }
    if (trimmed.includes(";")) {
      const parts = trimmed.split(";").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= expectedCount) return parts.slice(0, expectedCount);
    }
    // Generic line / paragraph split when count matches.
    const paragraphs = trimmed
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/^\d+[.)]\s*/, "").replace(/^[•\-*]\s*/, "").trim())
      .filter(Boolean);
    if (paragraphs.length >= expectedCount) return paragraphs.slice(0, expectedCount);
    const lines = trimmed
      .split(/\n+/)
      .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[•\-*]\s*/, "").trim())
      .filter(Boolean);
    if (lines.length >= expectedCount) return lines.slice(0, expectedCount);
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
    marks: Math.max(1, unit.creditWeight || 1),
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

/**
 * Merge exemplars with markBreakdown so each point carries marks + awarded status.
 * Works for theory units and calculation stages alike.
 */
export function buildStructuredMarkPointCards(params: {
  acf: AssessmentCaseFile;
  question: string;
  referenceModelAnswer?: string;
  markBreakdown: MarkBreakdownItem[];
  /** Optional localized texts aligned to credit-unit order. */
  localizedTexts?: string[];
}): StructuredMarkPointCard[] {
  const exemplars = resolvePerPointExemplars({
    acf: params.acf,
    question: params.question,
    referenceModelAnswer: params.referenceModelAnswer,
  });
  const byId = new Map(
    params.markBreakdown
      .filter((row) => row.rubricId)
      .map((row) => [row.rubricId!, row]),
  );
  // Fallback match by idea text when rubricId missing (legacy rows).
  const byIdea = new Map(params.markBreakdown.map((row) => [row.idea.trim().toLowerCase(), row]));

  return exemplars.map((ex, i) => {
    const row =
      byId.get(ex.unitId) ??
      byIdea.get(ex.rubricLabel.trim().toLowerCase()) ??
      params.markBreakdown[i];
    const text = (params.localizedTexts?.[i] || ex.exemplar || ex.rubricLabel).trim();
    return {
      text,
      marks: Math.max(1, row?.marks ?? ex.marks),
      awarded: row?.awarded === true,
      rubricId: ex.unitId,
      reason: row?.reason,
    };
  });
}

/** Deterministic ✓/✗ summary for student feedback (no LLM). */
export function formatMarkPointStatusSummary(
  cards: StructuredMarkPointCard[],
  language: "english" | "malay" | "mixed" = "english",
): string {
  if (cards.length === 0) return "";
  const bm = language === "malay";
  const header = bm ? "Poin penilaian:" : "Marking points:";
  const found = cards.filter((c) => c.awarded);
  const missing = cards.filter((c) => !c.awarded);
  const earned = cards.reduce((sum, c) => sum + (c.awarded ? c.marks : 0), 0);
  const total = cards.reduce((sum, c) => sum + c.marks, 0);

  const lines = cards.map((c, i) => {
    const markLabel =
      c.marks === 1
        ? bm
          ? "1 markah"
          : "1 mark"
        : bm
          ? `${c.marks} markah`
          : `${c.marks} marks`;
    const status = c.awarded ? "✓" : "✗";
    const preview = c.text.length > 120 ? `${c.text.slice(0, 117)}…` : c.text;
    return `${status} [${markLabel}] ${i + 1}. ${preview}`;
  });

  const calcLine = bm
    ? `Markah akhir = ${found.length} poin dijumpai (${earned}) / ${cards.length} poin diperlukan (${total}) = ${earned}/${total}.`
    : `Final score = ${found.length} point(s) found (${earned}) + ${missing.length} missing (0) = ${earned}/${total}.`;

  return [header, ...lines, calcLine].join("\n");
}
