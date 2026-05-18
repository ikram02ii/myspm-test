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
  "- MARKING FAIRNESS (applies at every stage): A student answer in Bahasa Malaysia, in chemical formula notation, by common name, by trade name, or in mixed BM/English must be treated as equivalent to the standard English textbook term for the same concept. Never penalize for language choice, notation style, or brevity when the scientific meaning or category membership is correct.",
  "- RUBRIC AS GUIDE: Rubric rows list representative mark points, not the only acceptable answers. Award marks when the student shows the intended scientific meaning, including valid SPM-level alternatives not written in the rubric. Do not require exact textbook phrasing.",
] as const;

export function formatSpmStudentFriendlyRulesBlock(): string {
  return [SPM_STUDENT_FRIENDLY_RULES_HEADER, ...SPM_STUDENT_FRIENDLY_RULES_LINES].join("\n");
}
