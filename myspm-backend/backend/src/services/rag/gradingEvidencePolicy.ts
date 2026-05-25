/**
 * Evidence-only marking: credit only what the student actually wrote.
 */

import type { RubricIdea } from "./types";
import {
  ideasShareSynonymGroup,
  normalizeAnswerText,
  studentAnswerCoversIdea,
} from "./gradingFairnessMatch";

export const EVIDENCE_ONLY_MARKING_LINES = [
  "EVIDENCE-ONLY RULE (mandatory):",
  "- Award marks ONLY for concepts explicitly stated or clearly conveyed in the student answer text.",
  "- Do NOT infer missing mechanisms, purposes, outcomes, causes, effects, or relationships.",
  "- Do NOT assume what a vague or generic phrase 'probably meant' — if it could fit many topics, withhold the mark.",
  "- Evaluate ONLY information actually expressed; the question stem does not count as student evidence.",
  "- For Explain/Describe/Why: the student must state the relevant concept, mechanism, or effect in their own words.",
  "- When marking is uncertain, default to NOT awarded unless the required wording is clearly in the answer.",
] as const;

export const FEEDBACK_EVIDENCE_ONLY_LINES = [
  "FEEDBACK EVIDENCE RULE:",
  "- Describe only what the student actually wrote. Do NOT claim they mentioned ideas that never appear in their answer.",
  "- Do NOT paraphrase missing rubric points as if the student said them.",
  "- If a mark point was not awarded, say it was missing or not stated clearly enough — do not imply they partially said it unless their exact wording supports that.",
] as const;

export function formatEvidenceOnlyMarkingBlock(): string {
  return EVIDENCE_ONLY_MARKING_LINES.join("\n");
}

export function formatFeedbackEvidenceOnlyBlock(): string {
  return FEEDBACK_EVIDENCE_ONLY_LINES.join("\n");
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "with", "from", "that", "this", "when", "than", "then", "will",
  "been", "being", "have", "has", "had", "not", "but", "its", "one", "two", "may", "can", "use", "also",
  "only", "very", "such", "more", "most", "less", "like", "just", "even", "other", "into", "upon", "over",
  "under", "both", "some", "any", "all", "per", "via", "yang", "dan", "atau", "untuk", "dalam", "pada",
]);

/** True when wording is too generic to credit a specific mark point. */
export function isGenericVagueStatement(text: string): boolean {
  const t = normalizeAnswerText(text);
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return !/\b(xylem|phloem|osmosis|diffusion|mitosis|meiosis|dna|rna|enzyme|glucose|oxygen|carbon|chlorophyll|stomata|transpiration|photosynthesis|respiration|allele|gene|chromosome)\b/i.test(
      t,
    );
  }
  if (words.length <= 6) {
    const mostlyGeneric =
      words.filter((w) =>
        /^(helps?|helped|important|good|bad|better|needed|useful|benefit|affect|grow|survive|work|function|energy|water|food|plant|animal|cell|thing|stuff|something|because|so|to)$/i.test(
          w,
        ),
      ).length >= Math.max(2, words.length - 1);
    if (mostlyGeneric) return true;
  }
  const vaguePhrases = [
    /\b(helps? the|good for|important for|needed for|useful for|beneficial to)\b/,
    /\b(affects? the|increase|decrease)(s)?\s+(growth|rate|level|amount)\b/,
    /\b(so that it|because it|in order to)\s+(can|will|could)\s+(work|function|grow|survive)\b/,
    /\b(related to|connected to|linked to|part of)\b/,
    /\b(something|things|stuff|everything)\b/,
  ];
  return words.length <= 10 && vaguePhrases.some((p) => p.test(t));
}

/** Idea string must appear in the raw answer (not LLM-expanded). */
export function ideaTextGroundedInAnswer(idea: string, studentAnswer: string): boolean {
  const i = normalizeAnswerText(idea);
  const a = normalizeAnswerText(studentAnswer);
  if (!i || !a) return false;
  if (a.includes(i)) return true;
  const tokens = i.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return i.length <= 12 && a.includes(i);
  const hit = tokens.filter((t) => a.includes(t)).length;
  return hit / tokens.length >= 0.75;
}

/**
 * Code-level gate after LLM verify: mark point must be grounded in answer text.
 */
export function studentAnswerExplicitlySupportsMarkPoint(
  studentAnswer: string,
  rubric: RubricIdea,
  evidenceLine: string,
): boolean {
  const line = (evidenceLine || "").trim() || studentAnswer.trim();
  if (!line || isGenericVagueStatement(line)) return false;
  if (!ideaTextGroundedInAnswer(line, studentAnswer)) return false;
  if (studentAnswerCoversIdea(studentAnswer, rubric.idea)) return true;
  if (ideasShareSynonymGroup(line, rubric.idea) || ideasShareSynonymGroup(studentAnswer, rubric.idea)) {
    return !isGenericVagueStatement(studentAnswer);
  }
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    if (phrase?.trim() && studentAnswerCoversIdea(studentAnswer, phrase)) {
      return !isGenericVagueStatement(line);
    }
  }
  const id = normalizeAnswerText(rubric.idea);
  const ans = normalizeAnswerText(studentAnswer);
  const tokens = id.split(/\s+/).filter((t) => t.length > 4 && !STOPWORDS.has(t));
  if (tokens.length >= 2) {
    const hit = tokens.filter((t) => ans.includes(t)).length;
    if (hit / tokens.length >= 0.6) return !isGenericVagueStatement(line);
  }
  return false;
}

export function filterGroundedStudentIdeas<T extends { idea: string }>(
  ideas: T[],
  studentAnswer: string,
): T[] {
  return ideas.filter((row) => row.idea.trim() && ideaTextGroundedInAnswer(row.idea, studentAnswer));
}
