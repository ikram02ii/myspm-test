/**
 * Evidence gate for understanding demonstration — fail closed.
 * LLM evaluateUnderstanding output is NOT trusted until quotes and concepts are verified.
 *
 * P0 rule: a mark requires a quote that is a contiguous span of the student answer
 * and that covers the target unit. No full-answer fallback. No keyword-only awards.
 */

import {
  normalizeAnswerText,
  studentAnswerContainsDistinctiveRubricToken,
  studentAnswerCoversIdea,
} from "./gradingFairness";
import { verifyBorderlineMeaningMatch } from "../shared/qwenGradingClient";
import {
  assignDemonstrationsCompetitively,
  coverRatioAgainstUnit,
  quoteStrictlyGroundedInStudentAnswer,
  studentCoversUnitCore,
  type UnitTextFields,
} from "./coreConceptMatch";
import { splitStudentEvidenceClauses } from "./clauseEvidenceScan";
import { isEnumerationStem } from "../case/acfFinalizePolicy";
import { isCalculationIntent } from "../case/calculationAcfPolicy";
import { cosineSimilarity, embedTexts } from "../../retrieval/embeddingsService";
import type { AssessmentCaseFile, EvidenceUnit, MissingGap, UnderstandingDemonstration } from "../shared/types";
import type { UdmTickFailReason } from "../shared/udmTickTrace";
import { DEFAULT_UDM_COVER_HIT_RATIO } from "../shared/gradingConfig";

/** Cover threshold for studentAnswerCoversIdea proxy used by this gate (hit ratio). */
export const UDM_COVER_HIT_RATIO = Number(
  process.env.GRADE_UDM_COVER_RATIO || String(DEFAULT_UDM_COVER_HIT_RATIO),
);

/** Strict contiguous grounding only — token-ratio grounding invents links. */
export function quoteGroundedInStudentAnswer(quote: string, studentAnswer: string): boolean {
  return quoteStrictlyGroundedInStudentAnswer(quote, studentAnswer);
}

function hasDistinctive(clause: string, unit: EvidenceUnit): boolean {
  return (
    studentAnswerContainsDistinctiveRubricToken(clause, unit.content, unit.aliases) ||
    unit.aliases.some((a) => a && studentAnswerContainsDistinctiveRubricToken(clause, a, []))
  );
}

function hasCover(clause: string, unit: EvidenceUnit): boolean {
  if (studentCoversUnitCore(clause, unit)) return true;
  if (studentAnswerCoversIdea(clause, unit.content)) return true;
  return (unit.aliases ?? []).some((a) => Boolean(a) && studentAnswerCoversIdea(clause, a));
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
  /** Clause actually used for checks (must be grounded quote). */
  clauseUsed: string;
  usedFullAnswerFallback: boolean;
};

/**
 * Diagnose why a tick would be kept/dropped by the sync evidence gate.
 * Full-answer fallback is disabled — ungrounded quotes always fail.
 */
export function diagnoseSyncEvidenceGate(
  quote: string,
  studentAnswer: string,
  unit: EvidenceUnit,
  options?: { allowFullAnswerFallback?: boolean },
): SyncGateDiagnosis {
  // P0: ignore allowFullAnswerFallback — always require grounded quote.
  void options;
  const quoteText = quote.trim();
  const grounded = quoteGroundedInStudentAnswer(quoteText, studentAnswer);

  if (!grounded) {
    return {
      pass: false,
      failReason: "grounded",
      clauseUsed: quoteText || studentAnswer.slice(0, 400),
      usedFullAnswerFallback: false,
    };
  }

  if (hasCover(quoteText, unit)) {
    return { pass: true, failReason: null, clauseUsed: quoteText, usedFullAnswerFallback: false };
  }
  if (hasDistinctive(quoteText, unit)) {
    // Distinctive token alone is insufficient — need cover of the unit idea.
    return { pass: false, failReason: "covers", clauseUsed: quoteText, usedFullAnswerFallback: false };
  }
  return { pass: false, failReason: "covers", clauseUsed: quoteText, usedFullAnswerFallback: false };
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

type VerifierOutcome = { status: "awarded" } | { status: "rejected" } | { status: "unavailable" };

/**
 * Meaning verifier — REJECT only. Never used to award a tick the sync gate failed.
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

/** Opt-out switch for the semantic award recovery pass (on by default for theory). */
function semanticAwardEnabled(): boolean {
  return process.env.GRADE_SEMANTIC_AWARD !== "0";
}

/** Opt-out switch for embedding-based candidate selection in the recovery pass. */
function semanticEmbedEnabled(): boolean {
  return process.env.GRADE_SEMANTIC_EMBED !== "0";
}

/**
 * Rank student clauses by semantic (embedding) similarity to each uncredited unit.
 * Returns unitId -> clauses ordered most-similar first. Empty map on any failure,
 * so the caller can fall back to token-overlap selection.
 */
async function rankClausesByEmbedding(
  units: UnitTextFields[],
  clauses: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!semanticEmbedEnabled() || units.length === 0 || clauses.length === 0) return out;

  try {
    const unitTexts = units.map((u) => `${u.content} ${(u.aliases ?? []).join(" ")}`.trim());
    const vectors = await embedTexts([...unitTexts, ...clauses]);
    if (vectors.length !== unitTexts.length + clauses.length) return out;

    const unitVecs = vectors.slice(0, unitTexts.length);
    const clauseVecs = vectors.slice(unitTexts.length);

    units.forEach((unit, ui) => {
      const scored = clauses
        .map((clause, ci) => ({ clause, sim: cosineSimilarity(unitVecs[ui]!, clauseVecs[ci]!) }))
        .sort((a, b) => b.sim - a.sim);
      out.set(unit.id, scored.map((s) => s.clause));
    });
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Pick the most relevant grounded student clause for a unit.
 * Relevance is only used to choose which clause to show the meaning verifier;
 * a low token overlap is expected for genuine paraphrases (that is the point).
 */
function pickCandidateClause(
  clauses: string[],
  unit: UnitTextFields,
  studentAnswer: string,
  usedClauseKeys: Set<string>,
): string | null {
  let best: string | null = null;
  let bestRatio = -1;
  for (const clause of clauses) {
    const key = normalizeAnswerText(clause);
    if (!key || usedClauseKeys.has(key)) continue;
    if (!quoteStrictlyGroundedInStudentAnswer(clause, studentAnswer)) continue;
    const ratio = coverRatioAgainstUnit(clause, unit);
    if (
      ratio > bestRatio + 0.02 ||
      (Math.abs(ratio - bestRatio) <= 0.02 && (best == null || clause.length > best.length))
    ) {
      best = clause;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * Second-chance semantic award (theory only).
 *
 * The deterministic gate + competitive assignment credit a unit only on token
 * overlap, so a correct answer phrased with different words (a genuine paraphrase
 * of the model answer / marking point) can be rejected. This pass gives such
 * answers an AWARD path: for each uncredited credit unit, the meaning verifier
 * checks the student's grounded clause against the marking point. Sibling
 * marking points are passed as `otherRubricIdeas` so evidence that only covers a
 * different point cannot steal this mark (competitive guard).
 */
async function recoverSemanticAwards(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  demonstrated: UnderstandingDemonstration["unitsDemonstrated"];
  failReasons: Map<string, UdmTickFailReason>;
  questionContext?: string;
}): Promise<UnderstandingDemonstration["unitsDemonstrated"]> {
  const { question, studentAnswer, acf, demonstrated, failReasons, questionContext } = params;
  if (!semanticAwardEnabled() || isCalculationIntent(acf)) return demonstrated;

  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const creditedIds = new Set(demonstrated.filter((d) => d.valid).map((d) => d.unitId));
  const uncredited = creditUnits.filter((u) => !creditedIds.has(u.id));
  if (uncredited.length === 0) return demonstrated;

  const clauses = splitStudentEvidenceClauses(studentAnswer);
  if (clauses.length === 0) return demonstrated;

  const rows = new Map(demonstrated.map((d) => [d.unitId, { ...d }]));
  const usedClauseKeys = new Set<string>(
    demonstrated.filter((d) => d.valid && d.quote).map((d) => normalizeAnswerText(d.quote)),
  );
  const matchedLabels = demonstrated
    .filter((d) => d.valid)
    .map((d) => creditUnits.find((u) => u.id === d.unitId)?.content)
    .filter((c): c is string => Boolean(c));

  // Semantic candidate selection: prefer embedding similarity (catches paraphrases
  // with little token overlap), fall back to token-overlap ranking on failure.
  const embedRanking = await rankClausesByEmbedding(uncredited, clauses);

  const selectCandidate = (unit: UnitTextFields): string | null => {
    const ranked = embedRanking.get(unit.id);
    if (ranked && ranked.length > 0) {
      for (const clause of ranked) {
        const key = normalizeAnswerText(clause);
        if (!key || usedClauseKeys.has(key)) continue;
        if (!quoteStrictlyGroundedInStudentAnswer(clause, studentAnswer)) continue;
        return clause;
      }
    }
    return pickCandidateClause(clauses, unit, studentAnswer, usedClauseKeys);
  };

  for (const unit of uncredited) {
    const candidate = selectCandidate(unit);
    if (!candidate) continue;

    const outcome = await verifyWithRetry({
      mode: "meaning",
      question,
      priorContext: questionContext,
      rubricIdea: unit.content,
      rubricKind: "point",
      rubricKeywords: unit.aliases,
      studentIdea: candidate.slice(0, 400),
      similarity: 0,
      fullStudentAnswer: studentAnswer,
      priorAwardedRubricIdeas: [...matchedLabels],
      otherRubricIdeas: creditUnits.filter((u) => u.id !== unit.id).map((u) => u.content).slice(0, 8),
      strictContextBound: true,
      openCategoryMarking: acf.markRule.openPool === true,
      exampleUseCombo: false,
    });

    if (outcome.status !== "awarded") continue;

    // Mark as semantically verified so the downstream deterministic gates
    // (competitive assignment, reconcile revoke, score clamp) keep this award on
    // grounding + de-duplication alone and do NOT re-reject the paraphrase for
    // low token overlap.
    rows.set(unit.id, {
      unitId: unit.id,
      quote: candidate.slice(0, 400),
      valid: true,
      semanticallyVerified: true,
    });
    usedClauseKeys.add(normalizeAnswerText(candidate));
    matchedLabels.push(unit.content);
    failReasons.delete(unit.id);
    console.info("[grade:semanticAward]", {
      unitId: unit.id,
      unit: unit.content.slice(0, 80),
      quote: candidate.slice(0, 120),
    });
  }

  return creditUnits.map((u) => rows.get(u.id) ?? { unitId: u.id, quote: "", valid: false });
}

export async function substantiateUnderstandingDemonstration(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  questionContext?: string;
}): Promise<UnderstandingDemonstration> {
  const result = await substantiateUnderstandingDemonstrationWithTrace(params);
  return result.udm;
}

export async function substantiateUnderstandingDemonstrationWithTrace(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  questionContext?: string;
}): Promise<SubstantiateResult> {
  const { question, studentAnswer, acf, udm, questionContext } = params;
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const creditById = new Map(creditUnits.map((u) => [u.id, u]));
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

    const sync = diagnoseSyncEvidenceGate(d.quote, studentAnswer, unit, {
      allowFullAnswerFallback: false,
    });

    if (!sync.pass) {
      demonstrated[i] = { ...d, valid: false };
      failReasons.set(d.unitId, sync.failReason);
      continue;
    }

    if (enumeration) {
      matchedLabels.push(unit.content);
      continue;
    }

    // Multi-point with clear sync cover: accept without meaning LLM.
    if (creditUnits.length >= 2) {
      matchedLabels.push(unit.content);
      continue;
    }

    // Single-point: meaning verifier may REJECT a sync-pass tick; never awards new ones.
    const outcome = await verifyWithRetry({
      mode: "meaning",
      priorContext: questionContext,
      question,
      rubricIdea: unit.content,
      rubricKind: "point",
      rubricKeywords: unit.aliases,
      studentIdea: sync.clauseUsed.slice(0, 400),
      similarity: 0,
      fullStudentAnswer: studentAnswer,
      priorAwardedRubricIdeas: matchedLabels,
      otherRubricIdeas: creditUnits.filter((u) => u.id !== unit.id).map((u) => u.content).slice(0, 8),
      strictContextBound: true,
      openCategoryMarking: acf.markRule.openPool === true,
      exampleUseCombo: false,
    });

    if (outcome.status === "rejected") {
      demonstrated[i] = { ...d, valid: false };
      failReasons.set(d.unitId, "verifier");
      continue;
    }

    // unavailable: keep sync pass (conservative on infra failure only when sync already passed)
    matchedLabels.push(unit.content);
  }

  const competitivelyAssigned = assignDemonstrationsCompetitively({
    studentAnswer,
    creditUnits,
    demonstrated,
  });

  // Record competitive rejects for transparency.
  for (const d of demonstrated) {
    if (!d.valid) continue;
    const kept = competitivelyAssigned.some((c) => c.unitId === d.unitId && c.valid);
    if (!kept && !failReasons.has(d.unitId)) {
      failReasons.set(d.unitId, "covers");
    }
  }

  // Second-chance semantic award: rescue correct paraphrases the token gate missed.
  // Runs AFTER competitive assignment so recovered ticks are not re-dropped by the
  // token-overlap competition (paraphrases legitimately have low overlap).
  const finalDemonstrated = await recoverSemanticAwards({
    question,
    studentAnswer,
    acf,
    demonstrated: competitivelyAssigned,
    failReasons,
    questionContext,
  });

  return {
    udm: {
      ...udm,
      unitsDemonstrated: finalDemonstrated,
      unitsMissing: rebuildMissingUnits(acf, finalDemonstrated),
    },
    failReasons,
  };
}

export function stripUnsubstantiatedDemonstrations(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  studentAnswer: string,
): UnderstandingDemonstration {
  const creditUnits = acf.units.filter((u) => u.creditWeight > 0);
  const demonstrated = assignDemonstrationsCompetitively({
    studentAnswer,
    creditUnits,
    demonstrated: udm.unitsDemonstrated,
  });

  return {
    ...udm,
    unitsDemonstrated: demonstrated,
    unitsMissing: rebuildMissingUnits(acf, demonstrated),
  };
}
