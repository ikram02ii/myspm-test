/**
 * Single source of truth for per-row marking policy.
 * Concept recognition runs before structural penalties (causal, paired comparison).
 *
 * Live consumer today: gradingEvidencePolicy → comparisonStructureBlocksAward only.
 *
 * Reserved (unfinished product wiring — keep until reconcile/v1 post-match uses them):
 * - rowRequiresCausalEnforcement
 * - rowRequiresExplicitComparisonEntities
 * - causalStructureBlocksAward
 * - comparisonAmbiguityBlocksAward
 * Do not delete these as "dead exports" without a product decision to drop
 * causal/comparison revoke gates entirely.
 */

import type { RubricIdea, StudentIdea } from "../../types";
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

/**
 * Reserved: post-matcher revoke when causal language is missing on a mechanism row.
 * Not yet wired into live reconciliation — unfinished product logic.
 */
export function causalStructureBlocksAward(
  rubric: RubricIdea,
  matchedIdea: StudentIdea | null,
): boolean {
  if (!rowRequiresCausalEnforcement(rubric)) return false;
  if (!matchedIdea) return true;
  return !matchedIdea.hasCausalLink;
}

/**
 * Reserved: post-matcher revoke for comparison entity ambiguity on paired rows.
 * Not yet wired into live reconciliation — unfinished product logic.
 */
export function comparisonAmbiguityBlocksAward(
  rubric: RubricIdea,
  matchedIdea: StudentIdea | null,
): boolean {
  if (!rowRequiresExplicitComparisonEntities(rubric)) return false;
  if (!matchedIdea) return false;
  return matchedIdea.ambiguousSubject === true;
}
