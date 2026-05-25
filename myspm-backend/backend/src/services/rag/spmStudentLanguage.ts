/**
 * Shared instructions so AI marking, rubrics, and related LLM outputs stay at
 * Malaysian SPM Form 4/5 reading level — short, clear, school-friendly wording.
 */
export const SPM_STUDENT_FRIENDLY_RULES_HEADER =
  "STUDENT LANGUAGE LEVEL (Malaysian SPM Form 4/5 — all text students will read):";

export const SPM_STUDENT_FRIENDLY_RULES_LINES = [
  "- Write for 16–17-year-old SPM students, not university lecturers.",
  "- Use short, clear sentences and everyday school vocabulary.",
  "- Avoid rare words, long nested clauses, and 'essay' or journal-style phrasing.",
  "- Science and maths: use terms found in Malaysian SPM textbooks only. If a word might confuse, add one short gloss in brackets (optional, keep brief).",
  "- Bahasa Melayu: standard classroom BM (e.g. kerana, supaya, iaitu). Avoid archaic or overly formal legal-style BM.",
  "- English: simple school English (because, so, helps, wrong, correct). Do not sound like an academic paper.",
  "- Tone: calm and helpful, like a supportive teacher. No condescension, no showing off vocabulary.",
  "- In JSON, every learner-facing string (feedback, modelAnswer, strengths, improvements, markBreakdown[].reason) must follow these rules.",
  "- LANGUAGE FAIRNESS: BM/English mix, chemical formulae, common names, and trade names count when they clearly express the same SPM mark point — never penalize notation or language choice alone.",
  "- EXAM STANDARD (marking only): Award marks only when the answer meets SPM marking-scheme level — specific terminology, required detail, and completeness for that mark. Do not award for vague, generic, incomplete, or informal wording even if scientifically related.",
  "- EVIDENCE ONLY: Credit only what the student actually wrote. Do not infer mechanisms, purposes, or missing details. Feedback must not claim the student said something that is not in their answer.",
  "- DIAGRAMS/FIGURES: Use attached or referenced figures only to understand the question and rubric. Never treat the figure as proof the student knows a label, structure, value, or process unless they wrote it.",
] as const;

export function formatSpmStudentFriendlyRulesBlock(): string {
  return [SPM_STUDENT_FRIENDLY_RULES_HEADER, ...SPM_STUDENT_FRIENDLY_RULES_LINES].join("\n");
}
