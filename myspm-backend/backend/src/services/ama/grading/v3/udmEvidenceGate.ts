/**
 * Evidence gate for understanding demonstration — fail closed.
 * LLM evaluateUnderstanding output is NOT trusted until quotes and concepts are verified.
 */

import {
  normalizeAnswerText,
  studentAnswerContainsDistinctiveRubricToken,
} from "../gradingFairness";
import { verifyBorderlineMeaningMatch } from "../qwenGradingClient";
import { studentCoversUnitCore } from "./coreConceptMatch";
import { isEnumerationStem } from "./acfFinalizePolicy";
import type { AssessmentCaseFile, EvidenceUnit, MissingGap, UnderstandingDemonstration } from "./types";
import type { UdmTickFailReason } from "./udmTickTrace";

/** Cover threshold for studentAnswerCoversIdea proxy used by this gate (hit ratio). */
export const UDM_COVER_HIT_RATIO = Number(process.env.GRADE_UDM_COVER_RATIO || "0.72");

export function quoteGroundedInStudentAnswer(quote: string, studentAnswer: string): boolean {
  const q = normalizeAnswerText(quote);
  const a = normalizeAnswerText(studentAnswer);
  if (!q || !a) return false;
  if (q.length >= 4 && a.includes(q)) return true;

  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;

  const hitRatio = tokens.filter((t) => a.includes(t)).length / tokens.length;
  return hitRatio >= 0.65;
}

function hasDistinctive(clause: string, unit: EvidenceUnit): boolean {
  return (
    studentAnswerContainsDistinctiveRubricToken(clause, unit.content, unit.aliases) ||
    unit.aliases.some((a) => a && studentAnswerContainsDistinctiveRubricToken(clause, a, []))
  );
}

/**
 * Cover check for the gate. Measured against the unit's minimal `coreConcept`
 * (and aliases) with a length-scaled threshold — NOT the long `content` — so a
 * correct-but-short answer is not structurally penalised. Deterministic.
 */
function hasCover(clause: string, unit: EvidenceUnit): boolean {
  return studentCoversUnitCore(clause, unit);
}

/** Experimental: cover check at a configurable hit-ratio (for Step 3 measurement). */
export function coversAtRatio(studentText: string, idea: string, ratio: number): boolean {
  const ans = normalizeAnswerText(studentText);
  const id = normalizeAnswerText(idea);
  if (!ans || !id) return false;
  if (ans.includes(id)) return true;

  const tokens = id
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length > 3 &&
        !/\b(the|and|for|are|was|with|from|that|this|into|each|their|they|them|when|than|then|will|been|being|have|has|had|not|but|its|one|two|may|can|use|uses|used|using|also|only|very|such|more|most|less|like|just|even|other|onto|upon|over|under|both|some|any|all|per|via)\b/i.test(
          t,
        ),
    );
  if (tokens.length === 0) return false;
  const hitRatio = tokens.filter((t) => ans.includes(t)).length / tokens.length;
  return hitRatio >= ratio;
}

export type SyncGateDiagnosis = {
  pass: boolean;
  failReason: UdmTickFailReason;
  /** Clause actually used for checks (quote or full-answer fallback). */
  clauseUsed: string;
  usedFullAnswerFallback: boolean;
};

/**
 * Diagnose why a tick would be kept/dropped by the sync evidence gate.
 * Fix B: if quote fails grounding, fall back to distinctive+cover on full student answer.
 */
export function diagnoseSyncEvidenceGate(
  quote: string,
  studentAnswer: string,
  unit: EvidenceUnit,
  options?: { allowFullAnswerFallback?: boolean },
): SyncGateDiagnosis {
  const allowFallback = options?.allowFullAnswerFallback !== false; // Fix B: default ON
  const quoteText = quote.trim();
  const grounded = quoteGroundedInStudentAnswer(quoteText || studentAnswer, studentAnswer);

  if (grounded) {
    const clause = quoteText || studentAnswer;
    if (!hasDistinctive(clause, unit)) {
      return { pass: false, failReason: "distinctive", clauseUsed: clause, usedFullAnswerFallback: false };
    }
    if (!hasCover(clause, unit)) {
      return { pass: false, failReason: "covers", clauseUsed: clause, usedFullAnswerFallback: false };
    }
    return { pass: true, failReason: null, clauseUsed: clause, usedFullAnswerFallback: false };
  }

  // Fix B: quote not grounded → try full student answer for distinctive + cover.
  if (allowFallback) {
    const full = studentAnswer.trim();
    if (full && hasDistinctive(full, unit) && hasCover(full, unit)) {
      return { pass: true, failReason: null, clauseUsed: full.slice(0, 400), usedFullAnswerFallback: true };
    }
    // Attribute why fallback failed (distinctive first, else covers).
    if (full && !hasDistinctive(full, unit)) {
      return { pass: false, failReason: "distinctive", clauseUsed: full.slice(0, 400), usedFullAnswerFallback: true };
    }
    if (full && !hasCover(full, unit)) {
      return { pass: false, failReason: "covers", clauseUsed: full.slice(0, 400), usedFullAnswerFallback: true };
    }
  }

  return {
    pass: false,
    failReason: "grounded",
    clauseUsed: quoteText || studentAnswer.slice(0, 400),
    usedFullAnswerFallback: false,
  };
}

export function passesSyncEvidenceGate(
  quote: string,
  studentAnswer: string,
  unit: EvidenceUnit,
): boolean {
  return diagnoseSyncEvidenceGate(quote, studentAnswer, unit).pass;
}

function rebuildMissingUnits(
  acf: AssessmentCaseFile,
  demonstrated: UnderstandingDemonstration["unitsDemonstrated"],
): MissingGap[] {
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const credited = new Set(demonstrated.filter((d) => d.valid).map((d) => d.unitId));
  return creditUnits
    .filter((u) => !credited.has(u.id))
    .map((u) => ({
      id: u.id,
      kind: "unit" as const,
      label: u.content,
      reason: "Required marking point not explicitly demonstrated in the student's answer.",
    }));
}

export type SubstantiateResult = {
  udm: UnderstandingDemonstration;
  failReasons: Map<string, UdmTickFailReason>;
};

/** Verifier result that distinguishes a real "no" from a call that never completed. */
type VerifierOutcome = { status: "awarded" } | { status: "rejected" } | { status: "unavailable" };

/**
 * Call the borderline meaning verifier with one retry.
 * A thrown/timed-out call returns "unavailable" (NOT "rejected") so the caller
 * can fall back to the deterministic sync decision instead of silently zeroing
 * a correct answer on a transient error.
 */
async function verifyWithRetry(
  args: Parameters<typeof verifyBorderlineMeaningMatch>[0],
): Promise<VerifierOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const verified = await verifyBorderlineMeaningMatch(args);
      return verified.awarded ? { status: "awarded" } : { status: "rejected" };
    } catch {
      if (attempt === 1) return { status: "unavailable" };
    }
  }
  return { status: "unavailable" };
}

export async function substantiateUnderstandingDemonstration(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
}): Promise<UnderstandingDemonstration> {
  const result = await substantiateUnderstandingDemonstrationWithTrace(params);
  return result.udm;
}

export async function substantiateUnderstandingDemonstrationWithTrace(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
}): Promise<SubstantiateResult> {
  const { question, studentAnswer, acf, udm } = params;
  const creditById = new Map(acf.units.filter((u) => u.creditWeight > 0).map((u) => [u.id, u]));
  const demonstrated = [...udm.unitsDemonstrated];
  const matchedLabels: string[] = [];
  const failReasons = new Map<string, UdmTickFailReason>();
  const enumeration = isEnumerationStem(acf);

  for (let i = 0; i < demonstrated.length; i++) {
    const d = demonstrated[i]!;
    if (!d.valid) continue;

    const unit = creditById.get(d.unitId);
    if (!unit) {
      demonstrated[i] = { ...d, valid: false };
      failReasons.set(d.unitId, "unknown_unit");
      continue;
    }

    const sync = diagnoseSyncEvidenceGate(d.quote, studentAnswer, unit);

    // Meaning-first routing:
    //  - "grounded" failure = no evidence linkage at all → revoke without asking
    //    the verifier (nothing to attribute the mark to).
    //  - "covers"/"distinctive" failure = evidence exists but the literal word
    //    overlap proxy is weak → do NOT revoke here. The meaning verifier is the
    //    decider, because a correct short answer ("Mass and time", "can be
    //    measured") routinely fails word-overlap against a long marking point.
    //  - sync.pass = fast path; still meaning-verified as a guard against the
    //    proxy over-accepting a wrong answer.
    if (!sync.pass && sync.failReason === "grounded") {
      demonstrated[i] = { ...d, valid: false };
      failReasons.set(d.unitId, "grounded");
      continue;
    }

    // Enumeration stems (state/name/list/examples/fixed count): a single correct
    // core-concept match is sufficient — accept deterministically, no LLM. The
    // student named the right item; there is no reasoning chain to verify. Wrong
    // items never reach here because they fail the core-concept cover above.
    if (enumeration && sync.pass) {
      matchedLabels.push(unit.content);
      continue;
    }

    const outcome = await verifyWithRetry({
      mode: "meaning",
      question,
      rubricIdea: unit.content,
      rubricKind: "point",
      rubricKeywords: unit.aliases,
      studentIdea: (sync.clauseUsed || d.quote.trim() || studentAnswer).slice(0, 400),
      similarity: 0,
      fullStudentAnswer: studentAnswer,
      priorAwardedRubricIdeas: matchedLabels,
      strictContextBound: true,
      openCategoryMarking: acf.markRule.openPool === true,
      exampleUseCombo: false,
    });

    if (outcome.status === "rejected") {
      demonstrated[i] = { ...d, valid: false };
      failReasons.set(d.unitId, "verifier");
      continue;
    }

    if (outcome.status === "unavailable") {
      // Verifier could not complete. Fall back to the deterministic sync gate:
      //  - sync.pass → keep (clear literal match, no need for the LLM).
      //  - sync failed on covers/distinctive → revoke (cannot confirm meaning
      //    while the verifier is down; never award an unconfirmed borderline).
      if (!sync.pass) {
        demonstrated[i] = { ...d, valid: false };
        failReasons.set(d.unitId, sync.failReason);
        continue;
      }
      matchedLabels.push(unit.content);
      continue;
    }

    matchedLabels.push(unit.content);
  }

  return {
    udm: {
      ...udm,
      unitsDemonstrated: demonstrated,
      unitsMissing: rebuildMissingUnits(acf, demonstrated),
    },
    failReasons,
  };
}

export function stripUnsubstantiatedDemonstrations(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): UnderstandingDemonstration {
  const creditById = new Map(acf.units.filter((u) => u.creditWeight > 0).map((u) => [u.id, u]));
  const demonstrated = udm.unitsDemonstrated.map((d) => {
    if (!d.valid) return d;
    const unit = creditById.get(d.unitId);
    if (!unit) return { ...d, valid: false };
    // Meaning-first: by this stage every valid tick has already been meaning-
    // verified (async gate or recoverMissedUnits). This final pass only removes
    // ticks with NO evidence linkage (ungrounded / hallucinated quote); it must
    // NOT revoke a verifier-confirmed mark just because literal word overlap
    // with a long marking point is below the cover ratio.
    const sync = diagnoseSyncEvidenceGate(d.quote, studentAnswer, unit);
    return sync.pass || sync.failReason !== "grounded" ? d : { ...d, valid: false };
  });

  return {
    ...udm,
    unitsDemonstrated: demonstrated,
    unitsMissing: rebuildMissingUnits(acf, demonstrated),
  };
}
