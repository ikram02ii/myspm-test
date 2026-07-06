/**
 * Second pass after LLM evaluateUnderstanding:
 *  1. Recover marks the LLM missed — handles compound sentences where one
 *     sentence contains two mark points (e.g. "Mitosis makes identical cells
 *     for growth, repair and reproduction" = 2 marks, not 1).
 *  2. Revoke vague over-credits — only tightens when the LLM awarded 2+ ticks
 *     from a fuzzy answer that lacks the required science words.
 */

import {
  studentAnswerCoversIdea,
  studentAnswerContainsDistinctiveRubricToken,
  normalizeAnswerText,
} from "../gradingFairness";
import { verifyBorderlineMeaningMatch } from "../qwenGradingClient";
import { isFixedSetRecallStem } from "./acfFinalizePolicy";
import { isCalculationIntent } from "./calculationAcfPolicy";
import type { AssessmentCaseFile, EvidenceUnit, UnderstandingDemonstration } from "./types";

// ---------------------------------------------------------------------------
// Clause splitting
// ---------------------------------------------------------------------------

/**
 * Split a student answer into clauses so a compound sentence like
 * "X because Y, and also Z" is checked per-segment instead of as a whole.
 * This is the core fix for "robot only ticks one idea per sentence".
 */
function splitIntoClauses(text: string): string[] {
  const full = text.trim();
  if (!full) return [];

  // Primary split: sentence boundaries (.!?) and newlines.
  const sentences = full
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Secondary split: comma/semicolon clauses within each sentence.
  const clauses: string[] = [];
  for (const sent of sentences) {
    const sub = sent
      .split(/[,;](?:\s+(?:and|or|but|so|which|that|because|kerana|dan|atau)\s+|\s+)/i)
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).length >= 2); // drop single-word fragments
    if (sub.length > 1) {
      clauses.push(sent, ...sub); // keep full sentence too for context
    } else {
      clauses.push(sent);
    }
  }

  return [...new Set(clauses)]; // deduplicate
}

/** Return the clause (or full answer) that best covers the unit. */
function bestMatchingClause(studentAnswer: string, unit: EvidenceUnit): string {
  const clauses = splitIntoClauses(studentAnswer);

  for (const clause of clauses) {
    if (studentAnswerCoversIdea(clause, unit.content)) return clause;
    if (unit.aliases.some((a) => a && studentAnswerCoversIdea(clause, a))) return clause;
  }

  // Fall back to full answer — verifier gets the context either way.
  return studentAnswer.slice(0, 400);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unitIsCredited(demonstrated: UnderstandingDemonstration["unitsDemonstrated"], unitId: string): boolean {
  return demonstrated.some((d) => d.unitId === unitId && d.valid);
}

function isCompareDifferenceStem(question: string): boolean {
  return /\b(difference|bezakan|bandingkan|compare|differentiate)\b.*\b(between|antara|dan)\b/i.test(question);
}

function mentionsBothCompareSides(studentAnswer: string, units: EvidenceUnit[]): boolean {
  if (units.length < 2) return true;
  return (
    units.filter(
      (u) =>
        studentAnswerContainsDistinctiveRubricToken(studentAnswer, u.content, u.aliases) ||
        u.aliases.some((a) => studentAnswerContainsDistinctiveRubricToken(studentAnswer, a, [])),
    ).length >= 2
  );
}

// ---------------------------------------------------------------------------
// Relaxed heuristic for clause-level checks (compound sentences)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the","and","for","are","was","with","from","that","this","into","each","their",
  "they","them","when","than","then","will","been","being","have","has","had","not",
  "but","its","one","two","may","can","use","uses","used","using","also","only",
  "very","such","more","most","less","like","just","even","other","both","some","any","all",
]);

/**
 * Relaxed coverage check used ONLY for individual clauses of compound sentences.
 * Uses a 45% token-overlap threshold (vs 72% for the full answer) so a clause
 * like "can be tested by experiment" passes for a unit "hypothesis is testable".
 */
function clauseLooselyCoversIdea(clause: string, idea: string): boolean {
  const ans = normalizeAnswerText(clause);
  const id = normalizeAnswerText(idea);
  if (!ans || !id) return false;
  if (ans.includes(id) || id.includes(ans)) return true;

  const tokens = id
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t.toLowerCase()));

  if (tokens.length === 0) return false;
  const hitRatio = tokens.filter((t) => ans.includes(t)).length / tokens.length;
  return hitRatio >= 0.45;
}

// ---------------------------------------------------------------------------
// Step 1: Recover missed units
// ---------------------------------------------------------------------------

async function recoverMissedUnits(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
}): Promise<UnderstandingDemonstration> {
  const { question, studentAnswer, acf, udm } = params;
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const demonstrated = [...udm.unitsDemonstrated];
  const missing = [...udm.unitsMissing];
  const matchedLabels = demonstrated
    .filter((d) => d.valid)
    .map((d) => creditUnits.find((u) => u.id === d.unitId)?.content ?? d.unitId);

  const ansWords = studentAnswer.trim().split(/\s+/).filter(Boolean);
  const ansWordCount = ansWords.length;
  const isSubstantive = ansWordCount >= 3;
  const isCompound = ansWordCount >= 8; // long answers likely have multiple ideas

  const clauses = splitIntoClauses(studentAnswer);

  for (const unit of creditUnits) {
    if (unitIsCredited(demonstrated, unit.id)) continue;

    // Gate 1 — heuristic coverage check across all clauses.
    // For compound answers use a relaxed 45% overlap; otherwise use standard covers check.
    let coveringClause: string | null =
      clauses.find(
        (c) =>
          studentAnswerCoversIdea(c, unit.content) ||
          unit.aliases.some((a) => a && studentAnswerCoversIdea(c, a)),
      ) ?? null;

    if (!coveringClause && isCompound) {
      coveringClause =
        clauses.find(
          (c) =>
            clauseLooselyCoversIdea(c, unit.content) ||
            unit.aliases.some((a) => a && clauseLooselyCoversIdea(c, a)),
        ) ?? null;
    }

    // Also try the full answer (catches cases where clause split is too aggressive).
    if (!coveringClause) {
      const fullHit =
        studentAnswerCoversIdea(studentAnswer, unit.content) ||
        unit.aliases.some((a) => a && studentAnswerCoversIdea(studentAnswer, a));
      if (fullHit) coveringClause = studentAnswer;
    }

    if (!coveringClause) continue;

    // Gate 2 — must have at least one distinctive science word (blocks pure keyword coincidences).
    if (!isSubstantive && !studentAnswerContainsDistinctiveRubricToken(coveringClause, unit.content, unit.aliases)) {
      continue;
    }

    // Gate 3 — LLM verifier confirms the award.
    try {
      const verified = await verifyBorderlineMeaningMatch({
        mode: "meaning",
        question,
        rubricIdea: unit.content,
        rubricKind: "point",
        rubricKeywords: unit.aliases,
        studentIdea: bestMatchingClause(studentAnswer, unit),
        similarity: 0,
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: matchedLabels,
        strictContextBound: false,
        openCategoryMarking: acf.markRule.openPool === true,
        exampleUseCombo: false,
      });
      if (!verified.awarded) continue;

      demonstrated.push({ unitId: unit.id, quote: bestMatchingClause(studentAnswer, unit), valid: true });
      matchedLabels.push(unit.content);
      const idx = missing.findIndex((g) => g.id === unit.id);
      if (idx >= 0) missing.splice(idx, 1);
    } catch {
      /* keep as missing if verifier fails */
    }
  }

  return { ...udm, unitsDemonstrated: demonstrated, unitsMissing: missing };
}

// ---------------------------------------------------------------------------
// Step 2: Revoke over-credits (only when 2+ vague ticks were awarded)
// ---------------------------------------------------------------------------

function revokeOverCredits(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): UnderstandingDemonstration {
  const creditById = new Map(acf.units.filter((u) => u.creditWeight > 0).map((u) => [u.id, u]));
  let demonstrated = [...udm.unitsDemonstrated];

  const validCount = () => demonstrated.filter((d) => d.valid && creditById.has(d.unitId)).length;

  // Only tighten when robot awarded 2+ ticks — keep a single partial tick as-is.
  if (validCount() < 2) return { ...udm, unitsDemonstrated: demonstrated };

  // Strip ticks where the quoted phrase has no distinctive science word.
  demonstrated = demonstrated.map((d) => {
    if (!d.valid) return d;
    const unit = creditById.get(d.unitId);
    if (!unit) return d;
    const quote = d.quote.trim() || studentAnswer;
    return studentAnswerContainsDistinctiveRubricToken(quote, unit.content, unit.aliases)
      ? d
      : { ...d, valid: false };
  });

  // Compare/difference stem: both sides must be explicitly named.
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  if (
    isFixedSetRecallStem(acf.question, acf.maxScore) &&
    isCompareDifferenceStem(acf.question) &&
    validCount() >= 2 &&
    !mentionsBothCompareSides(studentAnswer, creditUnits)
  ) {
    const first = demonstrated.find((d) => d.valid);
    if (first) {
      demonstrated = demonstrated.map((d) =>
        d.unitId === first.unitId ? d : d.valid ? { ...d, valid: false } : d,
      );
    }
  }

  return { ...udm, unitsDemonstrated: demonstrated };
}

// ---------------------------------------------------------------------------
// Step 3: Partial credit floor
// ---------------------------------------------------------------------------
// When the student scored 0 but wrote something that contains a real science
// word from the rubric, award 1 mark for the best-matching unit.
// This is purely heuristic (no extra LLM call) — guards against over-strict
// 0 marks on answers like "osmosis is when water moves through a membrane".

function applyPartialCreditFloor(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): UnderstandingDemonstration {
  // Only fire when nothing was awarded yet.
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const alreadyAwarded = udm.unitsDemonstrated.some(
    (d) => d.valid && creditUnits.some((u) => u.id === d.unitId),
  );
  if (alreadyAwarded) return udm;

  // Don't soften explicitly wrong answers.
  if (udm.invalidClaims.length > 0) return udm;

  // Answer must be substantive (≥ 4 words).
  const wordCount = studentAnswer.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 4) return udm;

  // Find the first credit unit whose distinctive science word appears in the answer.
  for (const unit of creditUnits) {
    if (!studentAnswerContainsDistinctiveRubricToken(studentAnswer, unit.content, unit.aliases)) {
      continue;
    }
    // Award 1 mark for this unit — floor, not ceiling.
    const quote = bestMatchingClause(studentAnswer, unit);
    return {
      ...udm,
      unitsDemonstrated: [
        ...udm.unitsDemonstrated,
        { unitId: unit.id, quote, valid: true },
      ],
      unitsMissing: udm.unitsMissing.filter((g) => g.id !== unit.id),
    };
  }

  return udm;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function reconcileUnderstandingDemonstration(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
}): Promise<UnderstandingDemonstration> {
  if (isCalculationIntent(params.acf)) return params.udm;

  const recovered = await recoverMissedUnits(params);
  const revoked = revokeOverCredits(params.acf, recovered, params.studentAnswer);
  return applyPartialCreditFloor(params.acf, revoked, params.studentAnswer);
}
