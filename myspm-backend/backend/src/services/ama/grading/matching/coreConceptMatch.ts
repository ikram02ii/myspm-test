/**
 * Deterministic core-concept matching for evidence-unit scoring.
 *
 * Root rule for multi-point schemes (no subject hardcoding):
 *   - Each mark is decided from student evidence only.
 *   - A quote/clause may credit a unit only when it covers THAT unit better
 *     than every other credit unit (competitive assignment).
 *   - The same quote cannot unlock multiple marks.
 */

import { normalizeAnswerText } from "./gradingFairness";
import type { EvidenceUnit } from "../shared/types";

const STOPWORD_RE =
  /^(the|and|for|are|was|with|from|that|this|into|each|their|they|them|when|than|then|will|been|being|have|has|had|not|but|its|may|can|use|uses|used|using|also|only|very|such|more|most|less|like|just|even|other|onto|upon|over|under|both|some|any|all|per|via|a|an|of|to|in|is|it|as|or|by|be|which|who|whom|whose|what|where|how|why)$/i;
// Note: do NOT treat cardinals (one/two/three/…) as stopwords — they often
// distinguish sibling marking points ("type one" vs "type two").

/** Significant (content) tokens of a phrase — stopwords and very short tokens removed. */
export function significantTokens(text: string): string[] {
  return normalizeAnswerText(text)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORD_RE.test(t));
}

export function deriveCoreConcept(unit: Pick<EvidenceUnit, "coreConcept" | "aliases" | "content">): string {
  const explicit = unit.coreConcept?.trim();
  if (explicit) return explicit;

  const aliasCandidates = (unit.aliases ?? [])
    .map((a) => (a ?? "").trim())
    .filter(Boolean);
  if (aliasCandidates.length > 0) {
    return aliasCandidates.reduce((shortest, cur) => (cur.length < shortest.length ? cur : shortest));
  }

  const content = (unit.content ?? "").trim();
  if (!content) return "";
  // Generic shortening: prefer the lead idea before an em/en dash, else a short lead phrase.
  // Avoids requiring the whole marking-point sentence to appear in a student clause.
  const beforeDash = content.split(/\s*[—–-]\s*/)[0]?.trim() || content;
  const words = beforeDash.split(/\s+/).filter(Boolean);
  if (words.length > 8) return words.slice(0, 6).join(" ");
  return beforeDash.slice(0, 100);
}

/** ize/ise school-English variants (spelling only — not subject vocabulary). */
function spellingVariants(token: string): string[] {
  const t = token.toLowerCase();
  const out = new Set<string>([t]);
  if (t.endsWith("ized")) out.add(`${t.slice(0, -4)}ised`);
  if (t.endsWith("ised")) out.add(`${t.slice(0, -4)}ized`);
  if (t.endsWith("ization")) out.add(`${t.slice(0, -7)}isation`);
  if (t.endsWith("isation")) out.add(`${t.slice(0, -7)}ization`);
  return [...out];
}

/** Whole-word token set — never substring match ("free" must not hit "freely"). */
export function answerTokenSet(studentText: string): Set<string> {
  const set = new Set<string>();
  for (const raw of normalizeAnswerText(studentText).split(/\s+/).filter(Boolean)) {
    for (const v of spellingVariants(raw)) set.add(v);
  }
  return set;
}

function tokenInAnswer(ansTokens: Set<string>, token: string): boolean {
  return spellingVariants(token).some((v) => ansTokens.has(v));
}

export function coversCoreConcept(studentAnswer: string, coreConcept: string): boolean {
  const ansTokens = answerTokenSet(studentAnswer);
  const core = normalizeAnswerText(coreConcept);
  if (!ansTokens.size || !core) return false;

  if (normalizeAnswerText(studentAnswer).includes(core)) return true;

  const tokens = significantTokens(coreConcept);
  if (tokens.length === 0) return false;

  const n = tokens.length;
  const hits = tokens.filter((t) => tokenInAnswer(ansTokens, t)).length;
  if (hits === 0) return false;

  const requiredRatio = n <= 2 ? 1 : n <= 4 ? 0.75 : 0.6;
  const requiredHits = Math.max(1, Math.ceil(n * requiredRatio));
  return hits >= requiredHits;
}

export function studentCoversUnitCore(
  studentText: string,
  unit: Pick<EvidenceUnit, "coreConcept" | "aliases" | "content">,
): boolean {
  if (coversCoreConcept(studentText, deriveCoreConcept(unit))) return true;
  return (unit.aliases ?? []).some((a) => a && coversCoreConcept(studentText, a));
}

export type UnitTextFields = Pick<EvidenceUnit, "id" | "content" | "coreConcept" | "aliases">;

function unitLexicon(unit: UnitTextFields): string[] {
  return significantTokens(
    [unit.content, unit.coreConcept ?? "", ...(unit.aliases ?? [])].filter(Boolean).join(" "),
  );
}

/** Fraction of unit lexicon tokens present as whole words in the student/quote text. */
export function coverRatioAgainstUnit(text: string, unit: UnitTextFields): number {
  const ansTokens = answerTokenSet(text);
  const unitTokens = unitLexicon(unit);
  if (!ansTokens.size || unitTokens.length === 0) return 0;
  const hits = unitTokens.filter((t) => tokenInAnswer(ansTokens, t)).length;
  return hits / unitTokens.length;
}

/**
 * Strict grounding: quote must appear in the student answer as a contiguous span
 * (after normalization). Loose token-ratio grounding is rejected — it invents links.
 */
export function quoteStrictlyGroundedInStudentAnswer(quote: string, studentAnswer: string): boolean {
  const q = normalizeAnswerText(quote);
  const a = normalizeAnswerText(studentAnswer);
  if (!q || !a || q.length < 4) return false;
  return a.includes(q);
}

/**
 * Tokens in this unit that do not appear in any sibling credit unit.
 * Derived only from the mark scheme rows — no subject word lists.
 */
export function exclusiveUnitTokens(unit: UnitTextFields, creditUnits: UnitTextFields[]): string[] {
  if (creditUnits.length < 2) return [];
  const mine = new Set(unitLexicon(unit));
  const others = new Set<string>();
  for (const other of creditUnits) {
    if (other.id === unit.id) continue;
    for (const t of unitLexicon(other)) others.add(t);
  }
  // Prefer leading tokens of the point (the named side / entity of the row).
  const lead = significantTokens(unit.content).slice(0, 6);
  const exclusiveLead = lead.filter((t) => mine.has(t) && !others.has(t) && t.length >= 3);
  if (exclusiveLead.length > 0) return exclusiveLead;
  return [...mine].filter((t) => !others.has(t) && t.length >= 3);
}

export function studentAddressesUnitExclusively(
  studentText: string,
  unit: UnitTextFields,
  creditUnits: UnitTextFields[],
): boolean {
  const exclusive = exclusiveUnitTokens(unit, creditUnits);
  if (exclusive.length === 0) return true;
  const ansTokens = answerTokenSet(studentText);
  if (ansTokens.size === 0) return false;
  return exclusive.some((t) => tokenInAnswer(ansTokens, t));
}

export type DemonstratedTick = {
  unitId: string;
  quote: string;
  valid: boolean;
  /** Award confirmed by the semantic meaning verifier — exempt from token competition. */
  semanticallyVerified?: boolean;
};

/**
 * Root multi-point assignment (subject-agnostic):
 * 1) Quote must be literally present in the student answer (deterministic grounding).
 * 2) One quote credits at most one unit; one unit keeps its best quote only (dedup).
 * 3) Token-only awards must additionally cover the candidate unit better than every
 *    other credit unit (competitive assignment) — this is the lexical safety gate.
 *
 * Semantically-verified awards (confirmed by the LLM meaning verifier) bypass the
 * token competition in step 3: a genuine paraphrase legitimately has low lexical
 * overlap, so re-imposing a token threshold here would re-reject the very answers
 * the semantic pass rescued. They still pass grounding (1) and de-duplication (2).
 *
 * This replaces hardcoded "do not award covalent/methane/…" lists.
 */
export function assignDemonstrationsCompetitively(params: {
  studentAnswer: string;
  creditUnits: UnitTextFields[];
  demonstrated: DemonstratedTick[];
}): DemonstratedTick[] {
  const { studentAnswer, creditUnits, demonstrated } = params;
  if (creditUnits.length === 0) return demonstrated;

  type Candidate = { unitId: string; quote: string; score: number; semantic: boolean };
  const candidates: Candidate[] = [];

  for (const d of demonstrated) {
    if (!d.valid) continue;
    const unit = creditUnits.find((u) => u.id === d.unitId);
    if (!unit) continue;

    const quote = (d.quote || "").trim();
    // Evidence must be a grounded contiguous span — never invent from the full blob.
    if (!quote || !quoteStrictlyGroundedInStudentAnswer(quote, studentAnswer)) continue;
    const clause = quote;

    // Semantic awards: grounding + de-duplication only, no token competition.
    if (d.semanticallyVerified) {
      candidates.push({ unitId: unit.id, quote: clause.slice(0, 400), score: 1, semantic: true });
      continue;
    }

    const score = coverRatioAgainstUnit(clause, unit);
    if (score < 0.2) continue;

    if (creditUnits.length >= 2) {
      let bestOther = 0;
      for (const other of creditUnits) {
        if (other.id === unit.id) continue;
        bestOther = Math.max(bestOther, coverRatioAgainstUnit(clause, other));
      }
      // Must win distinctly — ties / weaker matches stay unawarded.
      if (score < bestOther + 0.08) continue;
      // When siblings exist, also require at least one scheme-derived exclusive token
      // if the scheme actually has exclusive vocabulary for this row.
      if (!studentAddressesUnitExclusively(clause, unit, creditUnits)) continue;
    }

    candidates.push({ unitId: unit.id, quote: clause.slice(0, 400), score, semantic: false });
  }

  // Semantic awards rank first (they are already concept-verified), then by token cover.
  candidates.sort((a, b) => Number(b.semantic) - Number(a.semantic) || b.score - a.score);
  const usedUnits = new Set<string>();
  const usedQuotes = new Set<string>();
  const winners = new Map<string, DemonstratedTick>();

  for (const c of candidates) {
    if (usedUnits.has(c.unitId)) continue;
    const qKey = normalizeAnswerText(c.quote);
    if (creditUnits.length >= 2 && usedQuotes.has(qKey)) continue;
    usedUnits.add(c.unitId);
    usedQuotes.add(qKey);
    winners.set(c.unitId, {
      unitId: c.unitId,
      quote: c.quote,
      valid: true,
      ...(c.semantic ? { semanticallyVerified: true } : {}),
    });
  }

  // Preserve original rows but force validity from competitive winners only.
  const byId = new Map(demonstrated.map((d) => [d.unitId, d]));
  return creditUnits.map((u) => {
    const win = winners.get(u.id);
    if (win) return win;
    const prev = byId.get(u.id);
    return { unitId: u.id, quote: prev?.quote || "", valid: false };
  });
}

/** @deprecated Prefer assignDemonstrationsCompetitively — kept for call-site compatibility. */
export function revokeUnitsLackingExclusiveEvidence(
  studentAnswer: string,
  creditUnits: UnitTextFields[],
  demonstrated: DemonstratedTick[],
): DemonstratedTick[] {
  return assignDemonstrationsCompetitively({ studentAnswer, creditUnits, demonstrated });
}
