/**
 * Fairness recovery + mechanism sufficiency (subject-neutral).
 */

import type { MarkBreakdownItem, QuestionAnalysis, RubricIdea } from "../types";
import { studentAnswerExplicitlySupportsMarkPoint } from "./gradingEvidencePolicy";
import { verifyBorderlineMeaningMatch } from "./qwenGradingClient";
import {
  normalizeAnswerText,
  normalizeFormulaText,
} from "./gradingTextUtils";

export { normalizeAnswerText, normalizeFormulaText };

/**
 * Semantic equivalences between student phrasings and rubric ideas.
 * Rather than hardcoding subject-specific synonym groups here, equivalence
 * matching is handled generically by:
 *   - rubric.acceptedConcepts / rubric.keywords (LLM-generated per question)
 *   - studentAnswerCoversIdea token-overlap check
 *   - verifyBorderlineMeaningMatch LLM verifier for borderline cases
 *
 * This array is intentionally empty.  Add only genuinely subject-neutral
 * linguistic pairs if needed in future (e.g. EN↔BM function-word synonyms
 * that the rubric LLM consistently misses).
 */
export const EQUIVALENT_PHRASE_GROUPS: readonly string[][] = [];

// --- Mechanism sufficiency (merged from gradingSufficiencyService) ---

const UMBRELLA_LEXEMES = new Set([
  "protect", "protection", "protected", "safe", "safety", "safely", "unsafe",
  "danger", "dangerous", "hazard", "hazardous", "risk", "risky", "enough",
  "adequate", "adequacy", "sufficient", "insufficient", "secure", "proper",
  "properly", "appropriate", "keselamatan", "selamat", "bahaya", "berbahaya", "cukup",
]);

const SUFF_CAUSAL_EN =
  /\b(because|so that|so\s+it|in order to|therefore|thus|hence|as a result|leads to|results in|can get|could get|will get|may get)\b/i;
const SUFF_CAUSAL_BM =
  /\b(kerana|sebab|supaya|maka|justeru|menyebabkan|oleh sebab|akibat)\b/i;
const MECHANISM_DETAIL =
  /\b(hurt|injur|harm|damage|spill|burn|cut|expose|exposed|cover|covers|covering|toe|toes|foot|feet|skin|eye|eyes|acid|alkali|chemical|heat|broken|infect|bleed|tercedera|cedera|terdedah|menutup|terbuka|terluka|terkena|bahaya\s+dari)\w*\b/i;

export function questionExpectsExplainedMechanism(
  question: string,
  analysis?: QuestionAnalysis | null,
): boolean {
  if (
    analysis?.questionType === "cause_effect" ||
    analysis?.questionType === "function_purpose" ||
    analysis?.demandType === "explanation"
  ) {
    return true;
  }
  const q = (question || "").toLowerCase();
  if (/\b(explain why|explain how|terangkan mengapa|terangkan kenapa|jelaskan mengapa|mengapa|why)\b/.test(q)) {
    return true;
  }
  if (
    /\b(purpose|function|role|reason|fungsi|tujuan|peranan|sebab)\b/.test(q) &&
    /\b(explain|describe|terangkan|huraikan|jelaskan)\b/.test(q)
  ) {
    return true;
  }
  return false;
}

export function isGenericUmbrellaMarkPoint(idea: string): boolean {
  const tokens = normalizeAnswerText(idea)
    .split(/\s+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return false;
  const umbrellaHits = tokens.filter((t) =>
    [...UMBRELLA_LEXEMES].some((lex) => t === lex || t.startsWith(lex)),
  ).length;
  if (umbrellaHits >= 2) return true;
  if (umbrellaHits >= 1 && umbrellaHits / tokens.length >= 0.34) return true;
  return false;
}

export function studentWroteCausalMechanism(studentAnswer: string): boolean {
  const text = studentAnswer || "";
  if (!text.trim()) return false;
  return (SUFF_CAUSAL_EN.test(text) || SUFF_CAUSAL_BM.test(text)) && MECHANISM_DETAIL.test(text);
}

function rowDemonstratedInAnswer(rubric: RubricIdea, studentAnswer: string): boolean {
  const ans = normalizeAnswerText(studentAnswer);
  const sources = [rubric.idea, ...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])].filter(Boolean);
  for (const src of sources) {
    const tokens = normalizeAnswerText(src)
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !UMBRELLA_LEXEMES.has(t));
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => ans.includes(t)).length;
    if (hits >= 1 && hits / tokens.length >= 0.5) return true;
  }
  if (MECHANISM_DETAIL.test(ans) && !isGenericUmbrellaMarkPoint(rubric.idea)) return true;
  return false;
}

export function applyMechanismSufficiencyCredits(params: {
  markBreakdown: MarkBreakdownItem[];
  rubricIdeas: RubricIdea[];
  studentAnswer: string;
  question: string;
  questionAnalysis?: QuestionAnalysis | null;
  maxScore: number;
}): MarkBreakdownItem[] {
  if (params.maxScore < 2) return params.markBreakdown;
  if (!questionExpectsExplainedMechanism(params.question, params.questionAnalysis)) {
    return params.markBreakdown;
  }
  if (!studentWroteCausalMechanism(params.studentAnswer)) return params.markBreakdown;

  const breakdown = params.markBreakdown.map((r) => ({ ...r }));
  const hasSpecificAwarded = breakdown
    .filter((r) => r.awarded)
    .some((row) => {
      const rubric = params.rubricIdeas.find((r) => r.id === row.rubricId || r.idea === row.idea);
      if (!rubric || isGenericUmbrellaMarkPoint(rubric.idea)) return false;
      return rowDemonstratedInAnswer(rubric, params.studentAnswer);
    });
  if (!hasSpecificAwarded) return params.markBreakdown;

  let changed = false;
  for (const row of breakdown) {
    if (row.awarded || row.marks <= 0) continue;
    if (!isGenericUmbrellaMarkPoint(row.idea)) continue;
    row.awarded = true;
    row.reason =
      `${row.reason || ""} Specific mechanism already stated in the answer; general safety/purpose wording is satisfied by that explanation.`.trim();
    row.matchStrategy = row.matchStrategy ?? "sufficiencyMechanism";
    changed = true;
  }
  return changed ? breakdown : params.markBreakdown;
}

export function filterRedundantMissingIdeas(
  missingIdeas: string[],
  markBreakdown: MarkBreakdownItem[],
): string[] {
  const awardedUmbrellaSatisfied = markBreakdown.some(
    (r) => r.awarded && isGenericUmbrellaMarkPoint(r.idea) && r.matchStrategy === "sufficiencyMechanism",
  );
  if (!awardedUmbrellaSatisfied) return missingIdeas;
  return missingIdeas.filter((idea) => {
    const row = markBreakdown.find((r) => r.idea === idea);
    if (row?.awarded) return false;
    return !isGenericUmbrellaMarkPoint(idea);
  });
}

// --- Fairness / paraphrase matching ---

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match for short tokens so "cell" does not match inside "cellular". */
export function normalizedTextIncludesPhrase(text: string, phrase: string): boolean {
  const normText = normalizeAnswerText(text);
  const normPhrase = normalizeAnswerText(phrase);
  if (!normText || !normPhrase) return false;
  if (normPhrase.includes(" ")) return normText.includes(normPhrase);
  if (normPhrase.length <= 5) {
    return new RegExp(`\\b${escapeRegExp(normPhrase)}\\b`).test(normText);
  }
  return normText.includes(normPhrase);
}

export function ideasShareSynonymGroup(a: string, b: string): boolean {
  const na = normalizeAnswerText(a);
  const nb = normalizeAnswerText(b);
  if (!na || !nb) return false;
  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const hitA = group.some((g) => normalizedTextIncludesPhrase(na, g));
    const hitB = group.some((g) => normalizedTextIncludesPhrase(nb, g));
    if (hitA && hitB) return true;
  }
  return false;
}

export function studentAnswerContainsSpecies(studentAnswer: string, speciesKeyword: string): boolean {
  const key = (speciesKeyword || "").trim();
  if (key.length < 2) return true;
  const normKey = normalizeFormulaText(key);
  const normAns = normalizeFormulaText(studentAnswer);
  if (normAns.includes(normKey)) return true;
  return studentAnswerCoversIdea(studentAnswer, key);
}

export function allEquationSpeciesPresent(studentAnswer: string, keywords: string[] | undefined): boolean {
  const species = (keywords ?? []).map((k) => k.trim()).filter((k) => k.length >= 2);
  if (species.length === 0) return true;
  return species.every((s) => studentAnswerContainsSpecies(studentAnswer, s));
}

/** Post-split / backfill: add cluster phrases that match the row idea text. */
export function enrichRubricRowFromSynonymClusters(row: RubricIdea): RubricIdea {
  const ideaNorm = normalizeAnswerText(row.idea);
  const kw = new Set((row.keywords ?? []).map((k) => k.trim()).filter(Boolean));
  const acc = new Set((row.acceptedConcepts ?? []).map((k) => k.trim()).filter(Boolean));
  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const groupHit = group.some((g) => {
      const ng = normalizeAnswerText(g);
      return ideaNorm.includes(ng) || [...kw, ...acc].some((p) => normalizeAnswerText(p).includes(ng));
    });
    if (!groupHit) continue;
    for (const phrase of group.slice(0, 6)) {
      if (row.openEnded) kw.add(phrase);
      else acc.add(phrase);
    }
  }
  const next: RubricIdea = { ...row };
  if (kw.size > 0) next.keywords = [...new Set([...(row.keywords ?? []), ...kw])].slice(0, 12);
  if (acc.size > 0) next.acceptedConcepts = [...new Set([...(row.acceptedConcepts ?? []), ...acc])].slice(0, 8);
  return next;
}

/** Rubric row needs source/destination or tissue route (e.g. leaves → roots), not just "transports food". */
export function rubricIdeaRequiresRouteDetail(idea: string): boolean {
  const id = normalizeAnswerText(idea);
  if (/\bfrom\s+.+\s+to\b/.test(id)) return true;
  if (/\b(distribut|distribution|translocat)\b/.test(id) && /\b(parts|plant|growth|survival|regions)\b/.test(id)) {
    return true;
  }
  if (
    /\b(leaves|roots|stem|storage|sink|source|photosynthetic)\b/.test(id) &&
    /\b(to|from|transport|transports|carry|move|distribut)\b/.test(id)
  ) {
    return true;
  }
  if (/\bother\s+parts|growing\s+regions|storage\s+organs\b/.test(id)) return true;
  return false;
}

export function studentAnswerHasRouteDetail(answer: string): boolean {
  const ans = normalizeAnswerText(answer);
  if (/\bfrom\s+.+\s+to\b/.test(ans)) return true;
  if (/\bfrom\s+(leaves|roots|source|photosynthetic|daun|akar)\b/.test(ans)) return true;
  if (/\bto\s+(roots|other|all|storage|growing|parts|sink|akar|bahagian)\b/.test(ans)) return true;
  if (/\b(leaves|roots|stem|daun|akar|batang)\b/.test(ans) && /\b(to|from|ke|dari)\b/.test(ans)) return true;
  if (/\b(all|other)\s+parts\b/.test(ans)) return true;
  return false;
}

/** SPM transport marks: route/direction rows need from→to (or equivalent), not only "transports X". */
export function studentAnswerSatisfiesRubricDetail(studentAnswer: string, rubricIdea: string): boolean {
  if (!rubricIdeaRequiresRouteDetail(rubricIdea)) return true;
  return studentAnswerHasRouteDetail(studentAnswer);
}

/**
 * Heuristic: does the student answer already cover the idea text
 * (substring, shared significant tokens, or equivalent phrase group)?
 */
export function studentAnswerCoversIdea(studentAnswer: string, idea: string): boolean {
  const ans = normalizeAnswerText(studentAnswer);
  const id = normalizeAnswerText(idea);
  if (!ans || !id) return false;
  if (ans.includes(id)) return true;
  if (id.includes(ans)) {
    if (!studentAnswerSatisfiesRubricDetail(studentAnswer, idea)) return false;
    const ansWords = ans.split(/\s+/).filter(Boolean).length;
    const idWords = id.split(/\s+/).filter(Boolean).length;
    if (idWords >= ansWords + 5) return false;
    return true;
  }

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
  if (hitRatio >= 0.72) return true;

  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const ideaHit = group.some((g) => normalizedTextIncludesPhrase(id, g));
    const ansHit = group.some((g) => normalizedTextIncludesPhrase(ans, g));
    if (ideaHit && ansHit) return true;
  }

  if (ideasShareSynonymGroup(studentAnswer, idea)) return true;

  return false;
}

/** True when the answer (or a line) matches the rubric row via idea text, keywords, or accepted concepts. */
export function studentExpressesRubricMeaning(
  studentText: string,
  rubric: RubricIdea,
  fullAnswer?: string,
): boolean {
  const text = (studentText || "").trim();
  const answer = fullAnswer ?? studentText;
  if (!text) return false;
  if (studentAnswerCoversIdea(answer, rubric.idea) || studentAnswerCoversIdea(text, rubric.idea)) return true;
  if (ideasShareSynonymGroup(text, rubric.idea)) return true;
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    if (!phrase?.trim()) continue;
    if (studentAnswerCoversIdea(text, phrase) || studentAnswerCoversIdea(answer, phrase)) return true;
    if (ideasShareSynonymGroup(text, phrase)) return true;
  }
  return false;
}

export type ContradictionFixResult = {
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
  score: number;
  contradictionCheckPassed: boolean;
};

/**
 * Returns true only when the student answer contains at least one DISTINCTIVE
 * token from the rubric idea — i.e. a content word that is specific to this
 * concept, not a generic word that appears in many ideas.
 *
 * This guards against "substrate fits enzyme" triggering reconciliation for a
 * rubric idea like "active site is specific", where only general vocabulary
 * (enzyme) is shared but the distinctive concept word (specific / active site)
 * is absent from the student answer.
 */
function studentAnswerContainsDistinctiveRubricToken(
  studentAnswer: string,
  rubricIdea: string,
  acceptedConcepts?: string[],
): boolean {
  const GENERIC = new Set([
    "the","a","an","of","in","is","are","to","and","or","that","it","its","by","at","be",
    "has","have","can","will","does","with","from","for","not","this","they","when",
    "more","less","high","low","same","than","very","only","also","both","each",
  ]);

  const ideaTokens = (rubricIdea + " " + (acceptedConcepts ?? []).join(" "))
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));

  if (ideaTokens.length === 0) return true; // no distinctive tokens to check
  const ansNorm = normalizeAnswerText(studentAnswer);

  // At least one distinctive rubric token must appear in the student answer.
  return ideaTokens.some((token) => ansNorm.includes(token));
}

/**
 * Reconcile "missing" rubric rows when heuristics suggest the answer may already
 * cover them — confirmed by LLM at SPM exam standard (not heuristic auto-credit).
 *
 * Reconciliation ONLY restores marks for explicitly expressed concepts.
 * It does NOT restore marks for:
 *   - implied prerequisite knowledge
 *   - concepts the student's answer is consistent with but does not state
 *   - ideas whose distinctive vocabulary is absent from the student answer
 */
export async function fixMissingIdeasAgainstStudentAnswer(params: {
  question: string;
  subject?: string;
  studentAnswer: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
  rubricIdeas?: RubricIdea[];
  score: number;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
}): Promise<ContradictionFixResult> {
  const { studentAnswer, maxScore, question } = params;
  let missing = [...params.missingIdeas];
  let matched = [...params.matchedIdeas];
  const breakdown = params.markBreakdown?.map((r) => ({ ...r }));
  let score = params.score;
  const confirmedMissing: string[] = [];

  for (const idea of params.missingIdeas) {
    const rubricRow = params.rubricIdeas?.find((r) => r.idea === idea);

    // Gate 1: the student answer must contain at least one distinctive concept
    // token from this rubric idea.  Shared generic vocabulary does not qualify.
    if (!studentAnswerContainsDistinctiveRubricToken(studentAnswer, idea, rubricRow?.acceptedConcepts)) {
      continue;
    }

    // Gate 2: existing semantic heuristic (token overlap / synonym group).
    const heuristicHit = rubricRow
      ? studentExpressesRubricMeaning(studentAnswer, rubricRow, studentAnswer)
      : studentAnswerCoversIdea(studentAnswer, idea) || ideasShareSynonymGroup(studentAnswer, idea);
    if (!heuristicHit || !studentAnswerSatisfiesRubricDetail(studentAnswer, idea)) continue;

    try {
      const verified = await verifyBorderlineMeaningMatch({
        mode: "meaning",
        question,
        rubricIdea: idea,
        rubricKind: rubricRow?.kind ?? "point",
        rubricKeywords: rubricRow?.keywords,
        studentIdea: studentAnswer.slice(0, 400),
        similarity: 0,
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: matched,
        strictContextBound: false,
        openCategoryMarking: rubricRow?.openEnded === true,
        exampleUseCombo: false,
      });
      // Gate 3: LLM verifier AND explicit-support check must both pass.
      if (
        verified.awarded &&
        rubricRow &&
        studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubricRow, studentAnswer, question)
      ) {
        confirmedMissing.push(idea);
      }
    } catch {
      /* keep as missing on LLM failure */
    }
  }

  if (confirmedMissing.length === 0) {
    let markBreakdownOut = breakdown;
    if (markBreakdownOut && params.rubricIdeas?.length) {
      markBreakdownOut = applyMechanismSufficiencyCredits({
        markBreakdown: markBreakdownOut,
        rubricIdeas: params.rubricIdeas,
        studentAnswer,
        question,
        questionAnalysis: params.questionAnalysis ?? null,
        maxScore,
      });
      score = Math.min(
        maxScore,
        markBreakdownOut.reduce((sum, item) => sum + (item.awarded ? item.marks : 0), 0),
      );
      matched = markBreakdownOut.filter((r) => r.awarded).map((r) => r.idea);
      missing = filterRedundantMissingIdeas(
        markBreakdownOut.filter((r) => !r.awarded).map((r) => r.idea),
        markBreakdownOut,
      );
    }
    return {
      missingIdeas: missing,
      matchedIdeas: matched,
      markBreakdown: markBreakdownOut,
      score,
      contradictionCheckPassed: true,
    };
  }

  missing = missing.filter((m) => !confirmedMissing.includes(m));
  for (const idea of confirmedMissing) {
    if (!matched.includes(idea)) matched.push(idea);
  }

  if (breakdown && breakdown.length > 0) {
    for (const row of breakdown) {
      const rubricRow = params.rubricIdeas?.find((r) => r.id === row.rubricId || r.idea === row.idea);
      if (!row.awarded && confirmedMissing.includes(row.idea)) {
        row.awarded = true;
        row.reason =
          `${row.reason || ""} (SPM exam-standard check: mark point clearly shown.)`.trim();
        row.matchMethod = "llmVerifier";
        row.matchStrategy = "examStandardReconcile";
      } else if (
        !row.awarded &&
        rubricRow &&
        confirmedMissing.includes(rubricRow.idea)
      ) {
        row.awarded = true;
        row.reason =
          `${row.reason || ""} (SPM exam-standard check: mark point clearly shown.)`.trim();
        row.matchMethod = "llmVerifier";
        row.matchStrategy = "examStandardReconcile";
      }
    }
    const summed = breakdown.reduce((sum, item) => sum + (item.awarded ? item.marks : 0), 0);
    score = Math.max(0, Math.min(maxScore, Math.round(summed)));
  } else {
    score = Math.max(0, Math.min(maxScore, score + confirmedMissing.length));
  }

  let markBreakdownOut = breakdown;
  if (markBreakdownOut && params.rubricIdeas?.length) {
    markBreakdownOut = applyMechanismSufficiencyCredits({
      markBreakdown: markBreakdownOut,
      rubricIdeas: params.rubricIdeas,
      studentAnswer,
      question,
      questionAnalysis: params.questionAnalysis ?? null,
      maxScore,
    });
    score = Math.min(
      maxScore,
      markBreakdownOut.reduce((sum, item) => sum + (item.awarded ? item.marks : 0), 0),
    );
    matched = markBreakdownOut.filter((r) => r.awarded).map((r) => r.idea);
    missing = filterRedundantMissingIdeas(
      markBreakdownOut.filter((r) => !r.awarded).map((r) => r.idea),
      markBreakdownOut,
    );
  }

  return {
    missingIdeas: missing,
    matchedIdeas: matched,
    markBreakdown: markBreakdownOut,
    score,
    contradictionCheckPassed: true,
  };
}