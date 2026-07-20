/**
 * Second pass after LLM evaluateUnderstanding:
 *  1. Recover marks the LLM missed — handles compound sentences where one
 *     sentence contains two mark points (e.g. "Mitosis makes identical cells
 *     for growth, repair and reproduction" = 2 marks, not 1).
 *  2. Revoke vague over-credits — only tightens when the LLM awarded 2+ ticks
 *     from a fuzzy answer that lacks the required science words.
 */

import { stripUnsubstantiatedDemonstrations } from "./udmEvidenceGate";
import { studentAnswerContainsDistinctiveRubricToken } from "../gradingFairness";
import { verifyBorderlineMeaningMatch } from "../qwenGradingClient";
import { isCalculationIntent } from "./calculationAcfPolicy";
import { isEnumerationStem } from "./acfFinalizePolicy";
import { studentCoversUnitCore } from "./coreConceptMatch";
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

/** Return the clause (or full answer) that best covers the unit's core concept. */
function bestMatchingClause(studentAnswer: string, unit: EvidenceUnit): string {
  const clauses = splitIntoClauses(studentAnswer);

  for (const clause of clauses) {
    if (studentCoversUnitCore(clause, unit)) return clause;
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

  const clauses = splitIntoClauses(studentAnswer);
  const enumeration = isEnumerationStem(acf);

  for (const unit of creditUnits) {
    if (unitIsCredited(demonstrated, unit.id)) continue;

    // Gate 1 — core-concept coverage across clauses, then the full answer.
    // Measured against the unit's minimal coreConcept (length-scaled), not the
    // long content, so a correct-but-short clause still matches.
    let coveringClause: string | null =
      clauses.find((c) => studentCoversUnitCore(c, unit)) ?? null;

    if (!coveringClause && studentCoversUnitCore(studentAnswer, unit)) {
      coveringClause = studentAnswer;
    }

    if (!coveringClause) continue;

    // Gate 2 — must have distinctive science vocabulary (always required).
    if (!studentAnswerContainsDistinctiveRubricToken(coveringClause, unit.content, unit.aliases)) {
      continue;
    }

    // Enumeration stems: a distinctive core-concept match is sufficient — recover
    // deterministically without the LLM (the student named the right item).
    if (enumeration) {
      demonstrated.push({ unitId: unit.id, quote: bestMatchingClause(studentAnswer, unit), valid: true });
      matchedLabels.push(unit.content);
      const idx = missing.findIndex((g) => g.id === unit.id);
      if (idx >= 0) missing.splice(idx, 1);
      continue;
    }

    // Gate 3 — LLM verifier confirms the award (strict) for explain/chain types.
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
        strictContextBound: true,
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

  // Strip ticks where the quoted phrase has no distinctive science word or weak overlap.
  demonstrated = demonstrated.map((d) => {
    if (!d.valid) return d;
    const unit = creditById.get(d.unitId);
    if (!unit) return d;
    const quote = d.quote.trim() || studentAnswer;
    return studentAnswerContainsDistinctiveRubricToken(quote, unit.content, unit.aliases)
      ? d
      : { ...d, valid: false };
  });

  // Compare/difference stem: both sides must be explicitly named for full credit.
  // Cap at one tick when both sides are not named — never wipe a single demonstrated side.
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  if (
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
// Step 3: Partial credit floor (meaning-verified)
// ---------------------------------------------------------------------------
// Niche: a credit unit whose distinctive science word appears in the answer but
// which recoverMissedUnits skipped because literal word-overlap (cover) with the
// long marking point was too low. This is the "correct short answer" case.
// The award MUST be confirmed by the meaning verifier — a bare distinctive-token
// match is NOT enough, or wrong answers that merely reuse a rubric word (e.g.
// "Mass is in grams", "It is the gradient") would be falsely credited.

async function applyPartialCreditFloor(
  question: string,
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): Promise<UnderstandingDemonstration> {
  // Only fire when nothing was awarded yet.
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const alreadyAwarded = udm.unitsDemonstrated.some(
    (d) => d.valid && creditUnits.some((u) => u.id === d.unitId),
  );
  if (alreadyAwarded) return udm;

  // Don't soften units that are themselves contradicted by an invalid claim.
  // Unrelated correct points may still receive the floor.
  const contradictedByInvalidClaim = (unit: EvidenceUnit): boolean => {
    if (udm.invalidClaims.length === 0) return false;
    const hay = unit.content.toLowerCase();
    return udm.invalidClaims.some((c) => {
      const claimNorm = (c.text || "").toLowerCase();
      if (!claimNorm) return false;
      const tokens = claimNorm.split(/\W+/).filter((t) => t.length >= 4);
      if (tokens.length === 0) return hay.includes(claimNorm);
      return tokens.filter((t) => hay.includes(t)).length / tokens.length >= 0.5;
    });
  };

  // Answer must be substantive (≥ 4 words).
  const wordCount = studentAnswer.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 4) return udm;

  // Find the first credit unit whose distinctive science word appears in the
  // answer AND whose meaning the verifier confirms.
  for (const unit of creditUnits) {
    if (contradictedByInvalidClaim(unit)) continue;
    if (!studentAnswerContainsDistinctiveRubricToken(studentAnswer, unit.content, unit.aliases)) {
      continue;
    }
    const quote = bestMatchingClause(studentAnswer, unit);
    try {
      const verified = await verifyBorderlineMeaningMatch({
        mode: "meaning",
        question,
        rubricIdea: unit.content,
        rubricKind: "point",
        rubricKeywords: unit.aliases,
        studentIdea: quote,
        similarity: 0,
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: [],
        strictContextBound: true,
        openCategoryMarking: acf.markRule.openPool === true,
        exampleUseCombo: false,
      });
      if (!verified.awarded) continue;
    } catch {
      // Verifier unavailable → do NOT floor (never award an unconfirmed mark).
      continue;
    }
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
  const floored = await applyPartialCreditFloor(params.question, params.acf, revoked, params.studentAnswer);
  return stripUnsubstantiatedDemonstrations(params.acf, floored, params.studentAnswer);
}
