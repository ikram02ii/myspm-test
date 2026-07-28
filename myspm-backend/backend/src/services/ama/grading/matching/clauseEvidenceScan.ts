/**
 * Deterministic grounded clause scan (subject-agnostic).
 *
 * Finds contiguous student-answer spans that cover each credit unit.
 * Used as a safety net alongside the LLM so correct evidence is not missed
 * when the model fails to quote it. Does NOT award marks by itself — ticks
 * still pass through the evidence gate + competitive assignment.
 */

import { normalizeAnswerText } from "./gradingFairness";
import {
  coverRatioAgainstUnit,
  quoteStrictlyGroundedInStudentAnswer,
  studentAddressesUnitExclusively,
  studentCoversUnitCore,
  type DemonstratedTick,
  type UnitTextFields,
} from "./coreConceptMatch";
import type { EvidenceUnit } from "../shared/types";

const MIN_COVER_RATIO = 0.28;
const MULTI_POINT_MARGIN = 0.08;

/** Split student text into overlapping candidate spans (sentences + clauses). */
export function splitStudentEvidenceClauses(text: string): string[] {
  const full = text.trim();
  if (!full) return [];

  const sentences = full
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  for (const sent of sentences) {
    clauses.push(sent);
    const sub = sent
      .split(/(?:[,;]|\s+(?:and|or|but|so|because|while|whereas|kerana|dan|atau|tetapi)\s+)/i)
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).filter(Boolean).length >= 2);
    for (const c of sub) {
      if (c.length >= 4) clauses.push(c);
    }
  }

  // Whole answer as a candidate for short responses.
  if (full.length <= 220 && !clauses.includes(full)) clauses.push(full);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of clauses) {
    const key = normalizeAnswerText(c);
    if (!key || key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push(c.slice(0, 400));
  }
  return out;
}

export type ClauseScanHit = {
  unitId: string;
  quote: string;
  coverRatio: number;
};

/**
 * For each credit unit, pick the best grounded student clause that covers it
 * better than sibling units (when multi-point).
 */
export function scanGroundedEvidenceSpans(params: {
  studentAnswer: string;
  creditUnits: EvidenceUnit[];
}): ClauseScanHit[] {
  const { studentAnswer, creditUnits } = params;
  const units = creditUnits.filter((u) => u.creditWeight > 0);
  if (!studentAnswer.trim() || units.length === 0) return [];

  const clauses = splitStudentEvidenceClauses(studentAnswer);
  if (clauses.length === 0) return [];

  const hits: ClauseScanHit[] = [];
  const multiPoint = units.length >= 2;

  // Prefer the best-covering grounded clause; also keep a longer clause when it
  // still wins (helps cover checks when the unit text is a long marking point).
  for (const unit of units) {
    let best: ClauseScanHit | null = null;

    for (const clause of clauses) {
      if (!quoteStrictlyGroundedInStudentAnswer(clause, studentAnswer)) continue;

      const ratio = coverRatioAgainstUnit(clause, unit as UnitTextFields);
      const covers = studentCoversUnitCore(clause, unit) || ratio >= MIN_COVER_RATIO;
      if (!covers) continue;

      if (multiPoint) {
        let bestOther = 0;
        for (const other of units) {
          if (other.id === unit.id) continue;
          bestOther = Math.max(bestOther, coverRatioAgainstUnit(clause, other as UnitTextFields));
        }
        if (ratio < bestOther + MULTI_POINT_MARGIN) continue;
        if (!studentAddressesUnitExclusively(clause, unit as UnitTextFields, units as UnitTextFields[])) {
          continue;
        }
      }

      if (
        !best ||
        ratio > best.coverRatio + 0.02 ||
        (Math.abs(ratio - best.coverRatio) <= 0.02 && clause.length > best.quote.length)
      ) {
        best = { unitId: unit.id, quote: clause, coverRatio: ratio };
      }
    }

    if (best) hits.push(best);
  }

  return hits;
}

/**
 * Merge LLM ticks with clause-scan hits.
 * Prefer the stronger grounded quote per unit; never invent ungrounded text.
 */
export function mergeLlmTicksWithClauseScan(params: {
  studentAnswer: string;
  creditUnits: EvidenceUnit[];
  llmTicks: DemonstratedTick[];
  scanHits?: ClauseScanHit[];
}): DemonstratedTick[] {
  const { studentAnswer, creditUnits, llmTicks } = params;
  const scanHits =
    params.scanHits ??
    scanGroundedEvidenceSpans({ studentAnswer, creditUnits });

  type Cand = { unitId: string; quote: string; score: number; source: "llm" | "scan" };
  const byUnit = new Map<string, Cand>();

  const consider = (unitId: string, quote: string, source: "llm" | "scan") => {
    const q = quote.trim();
    if (!q || !quoteStrictlyGroundedInStudentAnswer(q, studentAnswer)) return;
    const unit = creditUnits.find((u) => u.id === unitId);
    if (!unit || unit.creditWeight <= 0) return;
    const score = coverRatioAgainstUnit(q, unit as UnitTextFields);
    if (score < 0.15 && !studentCoversUnitCore(q, unit)) return;
    const prev = byUnit.get(unitId);
    // Prefer higher cover; on ties prefer LLM (assistive), else scan.
    if (!prev || score > prev.score + 0.02 || (Math.abs(score - prev.score) <= 0.02 && source === "llm")) {
      byUnit.set(unitId, { unitId, quote: q.slice(0, 400), score, source });
    }
  };

  for (const t of llmTicks) {
    if (!t.valid) continue;
    consider(t.unitId, t.quote, "llm");
  }
  for (const h of scanHits) {
    consider(h.unitId, h.quote, "scan");
  }

  // Preserve invalid LLM rows for units we did not recover (diagnostics).
  const merged: DemonstratedTick[] = creditUnits
    .filter((u) => u.creditWeight > 0)
    .map((u) => {
      const win = byUnit.get(u.id);
      if (win) return { unitId: u.id, quote: win.quote, valid: true };
      const prev = llmTicks.find((t) => t.unitId === u.id);
      return { unitId: u.id, quote: prev?.quote || "", valid: false };
    });

  return merged;
}
