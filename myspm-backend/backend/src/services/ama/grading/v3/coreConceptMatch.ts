/**
 * Deterministic core-concept matching for evidence-unit scoring.
 *
 * Root-cause fix for structural under-scoring: overlap used to be measured
 * against the FULL `unit.content` sentence, so any correct-but-short student
 * answer failed a fixed 72% token ratio purely because the denominator was a
 * long polished sentence. Here we measure overlap against each unit's minimal
 * `coreConcept` instead, with a threshold that SCALES to the concept's own
 * token length.
 *
 * Everything in this module is pure, subject-agnostic, and temperature-0
 * deterministic — no LLM calls, no hardcoded question/answer/subject strings.
 */

import { normalizeAnswerText } from "../gradingFairness";
import type { EvidenceUnit } from "./types";

const STOPWORD_RE =
  /^(the|and|for|are|was|with|from|that|this|into|each|their|they|them|when|than|then|will|been|being|have|has|had|not|but|its|one|two|may|can|use|uses|used|using|also|only|very|such|more|most|less|like|just|even|other|onto|upon|over|under|both|some|any|all|per|via|a|an|of|to|in|is|it|as|or|by|be|which|who|whom|whose|what|where|how|why)$/i;

/** Significant (content) tokens of a phrase — stopwords and very short tokens removed. */
export function significantTokens(text: string): string[] {
  return normalizeAnswerText(text)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORD_RE.test(t));
}

/**
 * The minimal creditable phrase for a unit.
 *  - Prefer the LLM-authored `coreConcept`.
 *  - Backward-compat fallback (old rubrics with no coreConcept): the shortest
 *    alias, else the full content. Both are deterministic.
 */
export function deriveCoreConcept(unit: Pick<EvidenceUnit, "coreConcept" | "aliases" | "content">): string {
  const explicit = unit.coreConcept?.trim();
  if (explicit) return explicit;

  const aliasCandidates = (unit.aliases ?? [])
    .map((a) => (a ?? "").trim())
    .filter(Boolean);
  if (aliasCandidates.length > 0) {
    return aliasCandidates.reduce((shortest, cur) => (cur.length < shortest.length ? cur : shortest));
  }

  return unit.content ?? "";
}

/**
 * Length-scaled coverage of a core concept by the student answer.
 *
 * Scaling rationale (identical for every subject/concept):
 *  - A 1–2 token concept must appear (almost) in full, so a wrong short answer
 *    that merely reuses one unrelated word cannot match.
 *  - Longer concepts allow partial expression, because a correct student need
 *    not reproduce every word of a fuller phrase.
 */
export function coversCoreConcept(studentAnswer: string, coreConcept: string): boolean {
  const ans = normalizeAnswerText(studentAnswer);
  const core = normalizeAnswerText(coreConcept);
  if (!ans || !core) return false;

  // Whole (short) phrase present verbatim.
  if (ans.includes(core)) return true;

  const tokens = significantTokens(coreConcept);
  if (tokens.length === 0) return false;

  const n = tokens.length;
  const hits = tokens.filter((t) => ans.includes(t)).length;
  if (hits === 0) return false;

  const requiredRatio = n <= 2 ? 1 : n <= 4 ? 0.75 : 0.6;
  const requiredHits = Math.max(1, Math.ceil(n * requiredRatio));
  return hits >= requiredHits;
}

/**
 * Does the student answer cover this unit — measured against the unit's core
 * concept and its aliases (each treated as an acceptable minimal phrasing)?
 */
export function studentCoversUnitCore(
  studentText: string,
  unit: Pick<EvidenceUnit, "coreConcept" | "aliases" | "content">,
): boolean {
  if (coversCoreConcept(studentText, deriveCoreConcept(unit))) return true;
  return (unit.aliases ?? []).some((a) => a && coversCoreConcept(studentText, a));
}
