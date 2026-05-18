/**
 * Marking support for SPM sequence / order / hierarchy / staged-process questions.
 * Order is required by default for sequence stems.
 */

import { normalizeAnswerText, studentAnswerCoversIdea, studentExpressesRubricMeaning } from "./gradingFairnessMatch";
import type { QuestionAnalysis, RubricIdea, StudentIdea } from "./types";

/** Stage aliases: if rubric row matches trigger, student text may match any alias. */
const STAGE_ALIAS_GROUPS: { id: string; trigger: RegExp; aliases: RegExp[] }[] = [
  { id: "cell", trigger: /\bcell\b/i, aliases: [/\bcell\b/i, /\bsel\b/i] },
  { id: "tissue", trigger: /\btissue\b/i, aliases: [/\btissue\b/i, /\btisu\b/i] },
  { id: "organ", trigger: /\borgan\b/i, aliases: [/\borgan\b/i, /\borgans?\b/i] },
  { id: "system", trigger: /\bsystem\b/i, aliases: [/\bsystem\b/i, /\bsistem\b/i] },
  { id: "organism", trigger: /\borganism\b/i, aliases: [/\borganism\b/i, /\borganisma\b/i] },
  { id: "dalton", trigger: /\bdalton|solid sphere|indivisible\b/i, aliases: [/\bdalton\b/i, /\bsolid sphere\b/i, /\bindivisible\b/i] },
  { id: "thomson", trigger: /\bthomson|plum pudding\b/i, aliases: [/\bthomson\b/i, /\bplum pudding\b/i] },
  { id: "rutherford", trigger: /\brutherford\b/i, aliases: [/\brutherford\b/i, /\bnucleus\b/i, /\bempty space\b/i, /\bgold foil\b/i] },
  { id: "bohr", trigger: /\bbohr\b/i, aliases: [/\bbohr\b/i, /\bshell\b/i, /\benergy level\b/i, /\borbit\b/i] },
  { id: "prophase", trigger: /\bprophase\b/i, aliases: [/\bprophase\b/i, /\bprofase\b/i] },
  { id: "metaphase", trigger: /\bmetaphase\b/i, aliases: [/\bmetaphase\b/i, /\bmetafase\b/i] },
  { id: "anaphase", trigger: /\banaphase\b/i, aliases: [/\banaphase\b/i, /\banafase\b/i] },
  { id: "telophase", trigger: /\btelophase\b/i, aliases: [/\btelophase\b/i, /\btelofase\b/i] },
  { id: "interphase", trigger: /\binterphase\b/i, aliases: [/\binterphase\b/i, /\bantara fasa\b/i] },
  { id: "mitosis", trigger: /\bmitosis\b/i, aliases: [/\bmitosis\b/i] },
  { id: "meiosis", trigger: /\bmeiosis\b/i, aliases: [/\bmeiosis\b/i] },
  { id: "photosynthesis", trigger: /\bphotosynthesis\b/i, aliases: [/\bphotosynthesis\b/i, /\bfotosintesis\b/i] },
  { id: "respiration", trigger: /\brespiration\b/i, aliases: [/\brespiration\b/i, /\brespirasi\b/i] },
  { id: "digestion", trigger: /\bdigestion\b/i, aliases: [/\bdigestion\b/i, /\bpenghadaman\b/i] },
  { id: "absorption", trigger: /\babsorption\b/i, aliases: [/\babsorption\b/i, /\bpenyerapan\b/i] },
  { id: "assimilation", trigger: /\bassimilation\b/i, aliases: [/\bassimilation\b/i, /\basimilasi\b/i] },
  { id: "egestion", trigger: /\begestion\b/i, aliases: [/\begestion\b/i] },
  { id: "xylem", trigger: /\bxylem\b/i, aliases: [/\bxylem\b/i, /\bxilem\b/i] },
  { id: "phloem", trigger: /\bphloem\b/i, aliases: [/\bphloem\b/i, /\bfloem\b/i] },
  { id: "root", trigger: /\broot\b/i, aliases: [/\broot\b/i, /\bakar\b/i] },
  { id: "leaf", trigger: /\bleaf|leaves\b/i, aliases: [/\bleaf\b/i, /\bleaves\b/i, /\bdaun\b/i] },
  { id: "heart", trigger: /\bheart\b/i, aliases: [/\bheart\b/i, /\bjantung\b/i] },
  { id: "lung", trigger: /\blung\b/i, aliases: [/\blung\b/i, /\bparu\b/i] },
];

export function sequenceQuestionRequiresOrder(question: string, analysis?: QuestionAnalysis | null): boolean {
  if (analysis?.questionType === "sequence_order") return true;
  return isSequenceMarkingQuestion(question, analysis);
}

export function isSequenceMarkingQuestion(question: string, analysis?: QuestionAnalysis | null): boolean {
  if (analysis?.questionType === "sequence_order") return true;
  const q = (question || "").toLowerCase();
  const sequenceStem =
    /\b(sequence|urutan|order of|correct order|in order|stages?\s+of|steps?\s+in|step\s+by\s+step|organisation|organization|organizational|hierarchy|levels?\s+of|peringkat|langkah|proses|development of|evolution of|history of|from\s+.+\s+to)\b/i.test(
      q,
    );
  const asksListOrDescribe =
    /\b(list|state|arrange|describe|explain|outline|nyatakan|senaraikan|huraikan|terangkan)\b/i.test(q);
  return sequenceStem && asksListOrDescribe;
}

export function rubricRowExpectsFullOrderedSequence(rubricIdea: string): boolean {
  return (
    /\b(complete|full|whole|entire|correct)\s+(sequence|order|urutan)\b/i.test(rubricIdea) ||
    /\bcorrect\s+order\b/i.test(rubricIdea)
  );
}

export function rubricRowExpectsPositionInSequence(rubricIdea: string): boolean {
  return /\b(first|second|third|fourth|fifth|before|after|then|next|followed by|diikuti|sebelum|selepas|awal|akhir|\d+(?:st|nd|rd|th))\b/i.test(
    rubricIdea,
  );
}

function matchTextToStageId(text: string): string | null {
  const norm = normalizeAnswerText(text);
  if (!norm) return null;
  for (const group of STAGE_ALIAS_GROUPS) {
    if (group.trigger.test(norm) || group.aliases.some((a) => a.test(norm))) return group.id;
  }
  return null;
}

/** Map rubric row to a canonical stage id (alias group or rubric index fallback). */
export function rubricRowStageId(rubric: RubricIdea, rubricIndex: number): string {
  return matchTextToStageId(rubric.idea) ?? `rubric-${rubricIndex}`;
}

function aliasGroupHit(rubricNorm: string, studentNorm: string): boolean {
  for (const group of STAGE_ALIAS_GROUPS) {
    if (!group.trigger.test(rubricNorm)) continue;
    if (group.aliases.some((a) => a.test(studentNorm))) return true;
  }
  return false;
}

/** True when text mentions the stage named in this rubric row (ignores position). */
export function sequenceStageMatchesStudent(
  rubric: RubricIdea,
  studentAnswer: string,
  studentIdeas?: StudentIdea[],
): boolean {
  const rubricNorm = normalizeAnswerText(rubric.idea);
  const answerNorm = normalizeAnswerText(studentAnswer);
  if (!rubricNorm || !answerNorm) return false;

  if (studentExpressesRubricMeaning(studentAnswer, rubric, studentAnswer)) return true;
  if (aliasGroupHit(rubricNorm, answerNorm)) return true;

  for (const si of studentIdeas ?? []) {
    const ideaNorm = normalizeAnswerText(si.idea);
    if (!ideaNorm) continue;
    if (studentExpressesRubricMeaning(si.idea, rubric, studentAnswer)) return true;
    if (aliasGroupHit(rubricNorm, ideaNorm)) return true;
    if (studentAnswerCoversIdea(si.idea, rubric.idea)) return true;
  }

  const tokens = rubricNorm
    .split(/\s+/)
    .filter((t) => t.length > 4 && !/\b(stage|step|level|sequence|order|point|mark)\b/.test(t));
  if (tokens.length > 0) {
    const hitCount = tokens.filter((t) => answerNorm.includes(t)).length;
    if (hitCount / tokens.length >= 0.5) return true;
  }

  return false;
}

/** Split student answer into ordered fragments (arrows, commas, numbering, newlines). */
export function splitSequenceFragments(studentAnswer: string): string[] {
  const raw = (studentAnswer || "")
    .replace(/\r/g, "\n")
    .replace(/\s*(?:→|->|=>|,|;|\n|\d+[.)])\s*/g, "|")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  return raw.length > 0 ? raw : [studentAnswer.trim()].filter(Boolean);
}

/**
 * Ordered stage ids as they appear in the student's answer (left-to-right).
 * Uses fragments when delimited; otherwise scans the full answer for stage tokens in order.
 */
export function extractStudentStageOrder(studentAnswer: string): string[] {
  const fragments = splitSequenceFragments(studentAnswer);
  if (fragments.length > 1) {
    const ids: string[] = [];
    for (const frag of fragments) {
      const id = matchTextToStageId(frag);
      if (id) ids.push(id);
    }
    if (ids.length > 0) return ids;
  }

  const lower = (studentAnswer || "").toLowerCase();
  const hits: { pos: number; id: string }[] = [];
  for (const group of STAGE_ALIAS_GROUPS) {
    let bestPos = -1;
    for (const re of [group.trigger, ...group.aliases]) {
      const m = lower.match(re);
      if (m && m.index != null && (bestPos < 0 || m.index < bestPos)) bestPos = m.index;
    }
    if (bestPos >= 0) hits.push({ pos: bestPos, id: group.id });
  }
  hits.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    ordered.push(h.id);
  }
  return ordered;
}

export function expectedStageOrderFromRubrics(rubricIdeas: RubricIdea[]): string[] {
  return rubricIdeas.map((r, idx) => rubricRowStageId(r, idx));
}

function stageIdsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = STAGE_ALIAS_GROUPS.find((g) => g.id === a);
  const gb = STAGE_ALIAS_GROUPS.find((g) => g.id === b);
  if (!ga || !gb) return a === b;
  return ga.id === gb.id;
}

/**
 * Award only if this rubric stage appears at the correct position in the student's sequence.
 * Position = same index in the ordered list (0-based), matching rubric row order.
 */
export function sequenceStageAtCorrectPosition(
  rubric: RubricIdea,
  rubricIndex: number,
  rubricIdeas: RubricIdea[],
  studentAnswer: string,
  studentIdeas?: StudentIdea[],
): { hit: boolean; evidence: string; reason: string } {
  const expectedId = rubricRowStageId(rubric, rubricIndex);
  const studentOrder = extractStudentStageOrder(studentAnswer);
  const fragments = splitSequenceFragments(studentAnswer);

  const expectedOrder = expectedStageOrderFromRubrics(rubricIdeas);
  const positionLabel = rubricIndex + 1;

  if (studentOrder.length === 0) {
    return {
      hit: false,
      evidence: studentAnswer.slice(0, 120),
      reason: "No recognisable stages in the answer.",
    };
  }

  const studentAtSlot = studentOrder[rubricIndex];
  if (studentAtSlot && stageIdsMatch(studentAtSlot, expectedId)) {
    const evidence = fragments[rubricIndex] ?? fragments.find((f) => matchTextToStageId(f) === studentAtSlot) ?? "";
    return {
      hit: true,
      evidence: evidence || studentAnswer.slice(0, 120),
      reason: `Correct stage at position ${positionLabel} in the sequence.`,
    };
  }

  const mentionedElsewhere = studentOrder.findIndex((id) => stageIdsMatch(id, expectedId));
  if (mentionedElsewhere >= 0) {
    return {
      hit: false,
      evidence: fragments[mentionedElsewhere] ?? studentAnswer.slice(0, 120),
      reason: `Stage found but in the wrong position (expected position ${positionLabel}, found at ${mentionedElsewhere + 1}). Order matters for sequence questions.`,
    };
  }

  if (sequenceStageMatchesStudent(rubric, studentAnswer, studentIdeas)) {
    return {
      hit: false,
      evidence: studentAnswer.slice(0, 120),
      reason: "Stage mentioned but not placed in the correct order in the sequence.",
    };
  }

  return {
    hit: false,
    evidence: studentAnswer.slice(0, 120),
    reason: `Required stage for position ${positionLabel} not found (expected: ${expectedOrder.join(" → ")}).`,
  };
}

/** Check full answer follows rubric stage order (for single-row full-sequence rubrics). */
export function studentFullSequenceOrderMatches(
  rubricIdeas: RubricIdea[],
  studentAnswer: string,
): boolean {
  const expected = expectedStageOrderFromRubrics(rubricIdeas);
  const student = extractStudentStageOrder(studentAnswer);
  if (student.length < expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (!student[i] || !stageIdsMatch(student[i], expected[i])) return false;
  }
  return true;
}

export function formatExpectedSequenceForPrompt(rubricIdeas: RubricIdea[]): string {
  return expectedStageOrderFromRubrics(rubricIdeas).join(" → ");
}

/**
 * @deprecated Use sequenceStageAtCorrectPosition — kept for call sites.
 */
export function sequencePositionMatch(
  rubric: RubricIdea,
  fragments: string[],
  studentAnswer: string,
): boolean {
  return sequenceStageMatchesStudent(rubric, fragments.join(" ") || studentAnswer);
}

export function historySequenceConceptMatch(
  rubricIdea: string,
  studentIdea: string,
  question: string,
): boolean {
  if (!isSequenceMarkingQuestion(question)) return false;
  return sequenceStageMatchesStudent(
    { id: "legacy", idea: rubricIdea, marks: 1, kind: "point" },
    studentIdea,
    [{ idea: studentIdea, hasCausalLink: false }],
  );
}
