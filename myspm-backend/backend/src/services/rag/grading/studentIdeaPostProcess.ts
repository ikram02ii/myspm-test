/**
 * Deterministic post-processing after LLM idea extraction.
 */

import type { StudentIdea } from "../types";
import { ideaTextGroundedInAnswer } from "./gradingEvidencePolicy";

// Split compound ideas on list connectors.
// "with" is intentionally excluded — it appears inside valid phrases
// like "handle chemicals with care" or "protect skin with lab coat".
const LIST_SPLIT_RE =
  /\s*(?:,|;|(?:\band\b)|(?:\bor\b)|(?:\bdan\b)|(?:\batau\b)|(?:\bserta\b))\s+/i;

const FILLER_ONLY = new Set([
  "the", "a", "an", "and", "or", "with", "serta", "dan", "atau", "to", "for", "in", "of",
]);

function substantivePart(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !FILLER_ONLY.has(t.toLowerCase()));
  return tokens.length >= 1 && tokens.join("").length >= 3;
}

/** Split compound list ideas the LLM left merged (multiple items joined by and/or/commas). */
export function atomizeCompoundStudentIdeas(ideas: StudentIdea[], studentAnswer: string): StudentIdea[] {
  const out: StudentIdea[] = [];
  for (const row of ideas) {
    const text = row.idea.trim();
    if (!text) continue;
    const parts = text.split(LIST_SPLIT_RE).map((p) => p.trim()).filter(substantivePart);
    if (parts.length >= 2) {
      for (const part of parts) {
        if (ideaTextGroundedInAnswer(part, studentAnswer)) {
          out.push({
            idea: part,
            hasCausalLink: row.hasCausalLink,
            ambiguousSubject: row.ambiguousSubject,
          });
        }
      }
    } else {
      out.push(row);
    }
  }
  return out;
}

/** Drop empty/trivial fragments; keep one-word recall answers when grounded. */
export function sanitizeExtractedStudentIdeas(ideas: StudentIdea[], studentAnswer: string): StudentIdea[] {
  const ans = studentAnswer.trim();
  const ansWords = ans.split(/\s+/).filter(Boolean).length;
  return ideas.filter((row) => {
    const t = row.idea.trim();
    if (!t) return false;
    if (!ideaTextGroundedInAnswer(t, ans)) return false;
    if (t.length < 2) return false;
    if (ansWords <= 2 && t.length >= 2) return true;
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && tokens[0].length < 3) return false;
    return true;
  });
}

export function postProcessStudentIdeas(ideas: StudentIdea[], studentAnswer: string): StudentIdea[] {
  return sanitizeExtractedStudentIdeas(atomizeCompoundStudentIdeas(ideas, studentAnswer), studentAnswer);
}
