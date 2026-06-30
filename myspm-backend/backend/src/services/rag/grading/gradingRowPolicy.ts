/**
 * Single source of truth for per-row marking policy.
 * Concept recognition runs before structural penalties (causal, paired comparison).
 */

import type { RubricIdea, StudentIdea } from "../types";
import {
  isDirectionalComparisonRow,
  rubricCriterionRequiresPairedComparison,
  studentAnswerMentionsAllComparisonSubjects,
} from "./gradingComparisonSubjects";

/** Whether this row requires explicit causal language in the matching student idea. */
export function rowRequiresCausalEnforcement(rubric: RubricIdea): boolean {
  return rubric.requiresCausalLink === true;
}

/** Whether ambiguousSubject should block an award for this row. */
export function rowRequiresExplicitComparisonEntities(rubric: RubricIdea): boolean {
  if ((rubric.comparisonSubjects?.length ?? 0) < 2) return false;
  if (rubric.kind === "comparison") return true;
  return rubricCriterionRequiresPairedComparison(rubric);
}

/**
 * Structural comparison gate — only when this row genuinely needs both entities named.
 * Uses the evidence clause first (not the whole answer).
 */
export function comparisonStructureBlocksAward(
  rubric: RubricIdea,
  evidenceLine: string,
  studentAnswer: string,
): boolean {
  const subjects = rubric.comparisonSubjects ?? [];
  if (subjects.length < 2) return false;

  const evidence = (evidenceLine || "").trim() || studentAnswer.trim();
  if (!evidence) return true;

  // Directional rows ("A is more X than B"): both entities must appear in the evidence clause.
  if (isDirectionalComparisonRow(rubric)) {
    return !studentAnswerMentionsAllComparisonSubjects(evidence, subjects);
  }

  // Paired contrast rows (while/whereas in rubric): require both entities in evidence.
  if (rubricCriterionRequiresPairedComparison(rubric)) {
    return !studentAnswerMentionsAllComparisonSubjects(evidence, subjects);
  }

  return false;
}

/** Post-matcher revoke: causal language missing on a mechanism row only. */
export function causalStructureBlocksAward(
  rubric: RubricIdea,
  matchedIdea: StudentIdea | null,
): boolean {
  if (!rowRequiresCausalEnforcement(rubric)) return false;
  if (!matchedIdea) return true;
  return !matchedIdea.hasCausalLink;
}

/** Post-matcher revoke: comparison entity ambiguity on rows that need explicit pairing. */
export function comparisonAmbiguityBlocksAward(
  rubric: RubricIdea,
  matchedIdea: StudentIdea | null,
): boolean {
  if (!rowRequiresExplicitComparisonEntities(rubric)) return false;
  if (!matchedIdea) return false;
  return matchedIdea.ambiguousSubject === true;
}
