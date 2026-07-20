/**
 * Comparison / difference question detection and subject-entity grounding.
 * All logic is derived from question text and rubric row content at runtime.
 */

import type { RubricIdea } from "../types";
import { normalizeAnswerText } from "./gradingFairness";

const COMPARISON_QUESTION_RE =
  /\b(compare|comparison|difference\s+between|similarities|contrasts?|bandingkan|perbezaan|persamaan|bezakan|differentiate|distinguish|berbeza|berbanding)\b/i;

const CONTRAST_CONNECTOR_RE =
  /\b(while|whereas|unlike|compared\s+to|compared\s+with|different\s+from|in\s+contrast|on\s+the\s+other\s+hand|but\s+not|whereas|manakala|berbeza\s+daripada|berbanding\s+dengan|tidak\s+seperti|berlainan|sebaliknya|berbeza)\b/i;

const ENTITY_PRONOUN_RE =
  /\b(it|its|they|them|their|this|that|these|those|he|she|his|her|dia|ia|ini|itu|mereka|beliau|nya)\b/i;

const COMMAND_WORD_PREFIX_RE =
  /^(?:compare|bandingkan|differentiate|distinguish|bezakan|state|explain|describe|nyatakan|terangkan|huraikan|list|name)\s+/i;

const LEADING_ARTICLE_RE = /^(?:the|a|an|ini|itu|sesuatu|sebuah)\s+/i;

const TRAILING_PREP_RE =
  /\s+(?:in|of|for|from|to|with|by|on|at|dalam|bagi|kepada|daripada|ke|dengan|pada|antara)\s*$/i;

/** Strip generic question-frame wording from a captured subject phrase (not entity names). */
const FRAME_PREFIX_RE =
  /^(?:(?:the|a|an)\s+)?(?:structure|structures|function|functions|characteristics|properties|features|roles|struktur|fungsi|ciri|sifat|peranan)\s+(?:of|in|for|dalam|bagi|kepada)\s+/i;

const SUBJECT_LIST_SPLIT_RE = /\s*(?:,|;|(?:\band\b)|(?:\bdan\b)|(?:\bserta\b)|(?:\bor\b)|(?:\batau\b))\s*/i;

const CAPTURE_PATTERNS: readonly RegExp[] = [
  /\b(?:compare|bandingkan|differentiate|distinguish|bezakan)\s+(?:the\s+)?(?:[\w\s]{0,40}?\s+)?(?:of\s+)?(.+?)\s+(?:with|and|dan|serta)\s+(.+?)(?:[.?]|$)/i,
  /\b(?:difference|perbezaan|persamaan|similarit(?:y|ies))\s+(?:between|antara)\s+(.+?)\s+(?:and|dan)\s+(.+?)(?:[.?]|$)/i,
  /\b(?:compare|bandingkan)\s+(.+?)\s+(?:with|dengan)\s+(.+?)(?:[.?]|$)/i,
  /\b(?:between|antara)\s+(.+?)\s+(?:and|dan)\s+(.+?)(?:[.?]|$)/i,
];

function normQuestion(q: string): string {
  return (q || "")
    .toLowerCase()
    .replace(/\r/g, "\n")
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanComparisonSubjectPhrase(raw: string): string {
  let s = raw.replace(/[.?]+$/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(FRAME_PREFIX_RE, "").trim();
  s = s.replace(COMMAND_WORD_PREFIX_RE, "").trim();
  while (LEADING_ARTICLE_RE.test(s)) {
    s = s.replace(LEADING_ARTICLE_RE, "").trim();
  }
  s = s.replace(TRAILING_PREP_RE, "").trim();
  return s.slice(0, 120);
}

function expandSubjectParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const cleaned = cleanComparisonSubjectPhrase(part);
    if (!cleaned) continue;
    const subParts = cleaned.split(SUBJECT_LIST_SPLIT_RE).map((p) => cleanComparisonSubjectPhrase(p)).filter(Boolean);
    if (subParts.length >= 2) out.push(...subParts);
    else if (cleaned.length >= 3) out.push(cleaned);
  }
  return out;
}

function dedupeSubjects(subjects: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of subjects) {
    const key = normalizeAnswerText(s);
    if (!key || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 6);
}

/** Parse entities being compared from the question stem (generic patterns, EN + BM). */
export function extractComparisonSubjectsFromQuestion(question: string): string[] {
  const q = normQuestion(question);
  if (!q || !COMPARISON_QUESTION_RE.test(q)) return [];

  const collected: string[] = [];
  for (const re of CAPTURE_PATTERNS) {
    const m = re.exec(q);
    if (!m?.[1] || !m?.[2]) continue;
    collected.push(...expandSubjectParts([m[1], m[2]]));
    if (collected.length >= 2) break;
  }

  if (collected.length < 2) {
    const clause = q.replace(COMPARISON_QUESTION_RE, " ").trim();
    const split = expandSubjectParts([clause]);
    if (split.length >= 2) collected.push(...split);
  }

  return dedupeSubjects(collected);
}

/**
 * True when the stem asks for comparison or differences (English or Bahasa Melayu).
 * @param preComputedQuestionType - If already computed by analyzeQuestion(), pass it here
 *   to skip the regex and guarantee consistency with Stage 1 detection.
 */
export function isComparisonDifferenceQuestion(question: string, preComputedQuestionType?: string): boolean {
  if (preComputedQuestionType !== undefined) return preComputedQuestionType === "compare_contrast";
  const q = normQuestion(question);
  return q.length > 0 && COMPARISON_QUESTION_RE.test(q);
}

/** True when a rubric row describes a paired contrast (both sides required in the answer). */
export function rubricCriterionRequiresCompleteComparison(rubric: RubricIdea): boolean {
  const texts = [rubric.idea, ...(rubric.acceptedConcepts ?? [])].filter(Boolean);
  return texts.some((t) => CONTRAST_CONNECTOR_RE.test(t));
}

const DIRECTIONAL_COMPARISON_RE =
  /\b(more|less|greater|smaller|higher|lower|stronger|weaker|faster|slower|lebih|kurang|tinggi|rendah)\b.+\b(than|daripada|berbanding)\b|\b(than|daripada|berbanding)\b.+\b(more|less|greater|smaller|higher|lower|lebih|kurang)\b/i;

/** True when the rubric row is a directional comparison ("A is more X than B"). */
export function isDirectionalComparisonRow(rubric: RubricIdea): boolean {
  const texts = [
    rubric.idea,
    ...(rubric.acceptedConcepts ?? []),
    ...(rubric.acceptedSynonyms ?? []),
  ].filter(Boolean);
  return texts.some((t) => DIRECTIONAL_COMPARISON_RE.test(t));
}

/** Paired while/whereas contrast — not a directional "more than" row. */
export function rubricCriterionRequiresPairedComparison(rubric: RubricIdea): boolean {
  return rubricCriterionRequiresCompleteComparison(rubric) && !isDirectionalComparisonRow(rubric);
}

function substantiveTokens(text: string): string[] {
  return normalizeAnswerText(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(the|and|for|are|was|with|from|that|this|dan|atau|serta|ialah|adalah)$/i.test(t));
}

function subjectExplicitlyMentioned(answerNorm: string, subject: string): boolean {
  const subNorm = normalizeAnswerText(subject);
  if (!subNorm || !answerNorm) return false;
  if (answerNorm.includes(subNorm)) return true;

  const tokens = substantiveTokens(subject).filter((t) => t.length >= 4);
  if (tokens.length === 0) {
    const short = substantiveTokens(subject);
    return short.length > 0 && short.every((t) => answerNorm.includes(t));
  }
  const hit = tokens.filter((t) => answerNorm.includes(t)).length;
  return hit / tokens.length >= 0.75;
}

/**
 * True only when every comparison subject appears explicitly in the answer.
 * Entity pronouns without explicit subject names do not satisfy a missing subject.
 */
export function studentAnswerMentionsAllComparisonSubjects(
  studentAnswer: string,
  comparisonSubjects: string[],
): boolean {
  if (!comparisonSubjects.length) return true;
  const ans = normalizeAnswerText(studentAnswer);
  if (!ans) return false;

  const subjects = dedupeSubjects(comparisonSubjects);
  if (subjects.length < 2) return true;

  for (const subject of subjects) {
    if (!subjectExplicitlyMentioned(ans, subject)) return false;
  }

  if (ENTITY_PRONOUN_RE.test(ans)) {
    const mentioned = subjects.filter((s) => subjectExplicitlyMentioned(ans, s));
    if (mentioned.length < subjects.length) return false;
  }

  return true;
}

/** Attach parsed comparison subjects to rubric rows for comparison stems. */
