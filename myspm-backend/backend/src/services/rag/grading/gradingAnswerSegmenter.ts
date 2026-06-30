/**
 * Anchors each extracted StudentIdea to the specific clause in the original student
 * answer that best corresponds to it.
 *
 * Why this exists:
 *   After LLM idea extraction, each StudentIdea is a clean semantic phrase — but we lose
 *   the exact text span it came from. Without anchoring, the LLM verifier (Stage 4) falls
 *   back to scanning the full answer, which enables holistic drift.
 *
 *   By attaching `anchoredText` (the real clause from the student's answer), the verifier
 *   is given a narrow, evidence-grounded input rather than the whole paragraph. This makes
 *   "did the student WRITE it" checks more precise.
 */

import type { StudentIdea } from "../types";

export type AnchoredClause = {
  text: string;
  startIndex: number;
  endIndex: number;
};

/**
 * Split on sentence-ending punctuation AND commas.
 *
 * SPM students almost always list with commas:
 *   "item A, item B, item C"
 *   "point satu, point dua, point tiga"
 *
 * Without comma splits, the entire answer becomes ONE clause and every idea
 * gets anchored to the full text — the narrow evidence window is lost.
 */
export function segmentStudentAnswer(answer: string): AnchoredClause[] {
  const clauses: AnchoredClause[] = [];
  // Split on .!?;\n AND commas — commas are the primary list delimiter in SPM answers
  const regex = /[^.!?;,\n]+[.!?;,\n]?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(answer)) !== null) {
    const text = match[0].replace(/[,;.!?\n]+$/, "").trim();
    if (text.length >= 3) {
      clauses.push({
        text,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }
  return clauses;
}

/**
 * Normalize text for matching: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Content-word tokens: drop short filler words, keep meaningful tokens.
 */
const FILLER = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "is", "are",
  "was", "with", "by", "at", "as", "it", "its", "that", "this", "be", "been",
  "have", "has", "do", "does", "not", "no",
  "dan", "atau", "dengan", "untuk", "di", "ke", "dari", "pada", "yang", "ini",
  "itu", "tidak", "bukan", "adalah", "ialah", "oleh",
]);

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !FILLER.has(t));
}

/**
 * Three-strategy anchor matching (tried in order):
 *
 * 1. Substring — normalized idea text is contained in the clause.
 *    Best for short, exact matches: "wash hands" ⊂ "wash hands after use"
 *
 * 2. Keyword coverage — content words of the clause appear in the idea OR
 *    content words of the idea appear in the clause.
 *    Handles BM clause / EN idea and vice versa (partial cross-language).
 *
 * 3. Token overlap — original behaviour as fallback (idea tokens vs clause text).
 *    Catches remaining paraphrase cases.
 *
 * Returns [bestClause, bestScore] or [null, 0].
 */
function bestMatchingClause(
  idea: string,
  clauses: AnchoredClause[],
): [AnchoredClause | null, number] {
  const normIdea = normalize(idea);
  const ideaTokens = contentTokens(idea);

  let best: AnchoredClause | null = null;
  let bestScore = 0;

  for (const clause of clauses) {
    const normClause = normalize(clause.text);
    const clauseTokens = contentTokens(clause.text);

    // Strategy 1: substring match (score = 1.0 — highest priority)
    if (normClause.includes(normIdea) || normIdea.includes(normClause)) {
      return [clause, 1.0];
    }

    let score = 0;

    if (ideaTokens.length > 0 && clauseTokens.length > 0) {
      // Strategy 2: bidirectional keyword coverage
      const ideaHitsInClause = ideaTokens.filter((t) => normClause.includes(t)).length;
      const clauseHitsInIdea = clauseTokens.filter((t) => normIdea.includes(t)).length;
      const fwdCoverage = ideaHitsInClause / ideaTokens.length;
      const bwdCoverage = clauseHitsInIdea / clauseTokens.length;
      score = Math.max(fwdCoverage, bwdCoverage);
    } else if (ideaTokens.length > 0) {
      // Strategy 3: token overlap fallback
      const hits = ideaTokens.filter((t) => normClause.includes(t)).length;
      score = hits / ideaTokens.length;
    }

    if (score > bestScore) {
      bestScore = score;
      best = clause;
    }
  }

  return [best, bestScore];
}

/**
 * For each StudentIdea, find the best matching clause in the answer and
 * attach `anchoredText`, `anchorStart`, and `anchorEnd`.
 *
 * Ideas that cannot be matched (score < 30%) are returned unchanged —
 * downstream code falls back to `idea.idea` as the verifier input.
 *
 * Threshold is intentionally loose (30%) because:
 * - Ideas are LLM paraphrases, not exact student wording
 * - BM student / EN idea cross-language partial matches are acceptable anchors
 * - A wrong anchor is better than no anchor (still narrows the evidence window)
 */
export function anchorStudentIdeas(ideas: StudentIdea[], answer: string): StudentIdea[] {
  if (!ideas.length || !answer.trim()) return ideas;

  const clauses = segmentStudentAnswer(answer);
  if (clauses.length === 0) return ideas;

  // If the answer is a single short clause, anchor everything to it directly
  if (clauses.length === 1) {
    return ideas.map((idea) => ({
      ...idea,
      anchoredText: clauses[0].text,
      anchorStart: clauses[0].startIndex,
      anchorEnd: clauses[0].endIndex,
    }));
  }

  return ideas.map((idea) => {
    if (!idea.idea) return idea;

    const [bestClause, score] = bestMatchingClause(idea.idea, clauses);

    if (bestClause && score >= 0.3) {
      return {
        ...idea,
        anchoredText: bestClause.text,
        anchorStart: bestClause.startIndex,
        anchorEnd: bestClause.endIndex,
      };
    }

    return idea;
  });
}
