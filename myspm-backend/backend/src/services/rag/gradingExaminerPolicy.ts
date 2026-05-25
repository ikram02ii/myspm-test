/**
 * SPM marking standard: marks follow the syllabus / marking scheme, not loose scientific relatedness.
 */

import { formatEvidenceOnlyMarkingBlock } from "./gradingEvidencePolicy";

export const SPM_EXAM_STANDARD_MARKING_LINES = [
  "You are marking as an official SPM examiner (Form 4/5), not as a university tutor.",
  "",
  "AWARD marks only when the response meets the expected examination standard for this mark point:",
  "- correct SPM terminology or an accepted classroom paraphrase/synonym for the same point",
  "- enough specificity and detail for the marks allocated (not a vague or generic mention)",
  "- complete enough for what the question and mark point demand",
  "- aligned with the rubric marking point (meaning), not merely in the same broad topic",
  "",
  "DO NOT award marks when:",
  "- the idea is only scientifically related but too vague, generic, incomplete, or informal",
  "- the student hints at a topic without the required precision (e.g. 'helps the plant' without the required mechanism)",
  "- embedding similarity or shared keywords alone would suggest a match",
  "- the answer would not realistically earn marks on an SPM marking scheme even if loosely true",
  "",
  "When uncertain, decide: 'Would an SPM examiner award this mark at this level?' — not 'Is this scientifically correct?'",
  "Scientific truth alone is insufficient. Reject scientifically correct but below-exam-standard responses.",
  "",
  "Language fairness still applies: BM/English mix, formula notation, and common names are fine when the exam-standard point is clearly shown.",
  "",
  "Evidence-only: marks require explicit or clearly conveyed wording in the student answer — never inferred science, mechanisms, or relationships.",
] as const;

export function formatSpmExamStandardMarkingBlock(): string {
  return [...SPM_EXAM_STANDARD_MARKING_LINES, "", formatEvidenceOnlyMarkingBlock()].join("\n");
}

/** @deprecated Use formatSpmExamStandardMarkingBlock — kept for imports that still reference examiner priority naming. */
export function formatExaminerMarkingPriorityBlock(): string {
  return formatSpmExamStandardMarkingBlock();
}
