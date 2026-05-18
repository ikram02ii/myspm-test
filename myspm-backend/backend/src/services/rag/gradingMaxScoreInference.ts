/**
 * Infer a fair SPM-style max mark count from the question stem when the client
 * sends a generic high value (e.g. 5) for a short recall item.
 */

import type { QuestionAnalysis } from "./types";
import { hasTwoDistinctDemandsJoinedByAnd } from "./gradingCategoryMarking";

export type MaxScoreAdjustment = {
  originalMaxScore: number;
  adjustedMaxScore: number;
  maxScoreAdjustedReason: string;
};

function clampMarks(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

/** Reads "(4 marks)", "[6 markah]" etc. from stem. */
export function parseExplicitMarksInStem(question: string): number | null {
  const t = (question || "").replace(/\r/g, "\n");
  const patterns = [
    /\((\d{1,2})\s*marks?\)/i,
    /\((\d{1,2})\s*markah\)/i,
    /\[(\d{1,2})\s*marks?\]/i,
    /\[(\d{1,2})\s*markah\]/i,
    /\b(\d{1,2})\s*marks?\b/i,
    /\b(\d{1,2})\s*markah\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20) return n;
    }
  }
  return null;
}

function normalizeForHeuristics(question: string): string {
  return question
    .toLowerCase()
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two separate marking demands, often joined by "and" (EN) or "dan" (BM). */
export function hasCompoundAndDemand(question: string): boolean {
  const q = normalizeForHeuristics(question);
  if (/^\s*(?:compare|bandingkan|differentiate|bezakan)\b/i.test(q)) return false;
  const cmd =
    "(define|state|name|give|identify|describe|explain|suggest|list|compare|outline|calculate|discuss|nyatakan|namakan|senaraikan|terangkan|huraikan|jelaskan|bandingkan|cadangkan|takrifkan|hitung|kira|bincangkan)";
  if (new RegExp(`\\b${cmd}\\b.{8,}?\\b(?:and|dan)\\b.{8,}?\\b${cmd}\\b`, "i").test(q)) return true;
  if (
    /\b(?:give|state|name|list|identify|describe|explain|nyatakan|namakan|senaraikan|terangkan)\b.+\b(?:and|dan)\b.+\b(?:one|an|the|a)\s+(?:example|use|property|function|reason|effect|karyotype|syndrome|disorder)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(?:define|takrifkan)\b.+\b(?:and|dan)\b.+\b(?:state|nyatakan|name|namakan|give|identify)\b/i.test(q)) return true;
  if (/\b(?:state|nyatakan|name|namakan)\b.+\b(?:and|dan)\b.+\b(?:explain|terangkan|describe|huraikan)\b/i.test(q)) return true;
  if (/\b(?:name|namakan)\b.+\b(?:and|dan)\b.+\b(?:karyotype|syndrome|karotip|sindrom)\b/i.test(q)) return true;
  return false;
}

/**
 * When `requestedMax` is high but the stem signals fewer marking demands,
 * return a lower `adjustedMaxScore`. When the stem joins two demands with
 * "and"/"dan" and no explicit mark count, `adjustedMaxScore` is at least 2
 * (may exceed a client `maxScore` of 1). Explicit "(N marks)" in the stem
 * still wins.
 */
export function inferAdjustedMaxScore(
  question: string,
  requestedMax: number,
  analysis?: QuestionAnalysis | null,
): MaxScoreAdjustment {
  const originalMaxScore = clampMarks(requestedMax);
  const explicit = parseExplicitMarksInStem(question);
  if (explicit !== null) {
    const adjustedMaxScore = Math.min(originalMaxScore, explicit);
    const out = {
      originalMaxScore,
      adjustedMaxScore: clampMarks(adjustedMaxScore),
      maxScoreAdjustedReason:
        explicit <= originalMaxScore
          ? `Stem explicitly indicates ${explicit} mark(s).`
          : `Stem indicates ${explicit} mark(s); capped to client maxScore ${originalMaxScore}.`,
    };
    if (process.env.NODE_ENV === "development") {
      console.info("[rag][maxScoreInference]", out);
    }
    return out;
  }

  const dualAndFloor =
    hasTwoDistinctDemandsJoinedByAnd(question) || hasCompoundAndDemand(question);

  const q = normalizeForHeuristics(question);
  let suggested = originalMaxScore;
  let reason = "No stem-based adjustment; using client maxScore.";

  if (analysis) {
    const cap = clampMarks(analysis.suggestedMaxScore);
    if (cap < suggested) {
      suggested = cap;
      reason = `Question-demand cap from analysis (suggestedMaxScore=${cap}).`;
    }
  }

  const recallVerb =
    /\b(state|give|list|name|identify|nyatakan|senaraikan|namakan|kenal\s*pasti|labelkan)\b/;
  const explainVerb = /\b(explain|describe|discuss|huraikan|terangkan|jelaskan|bincangkan)\b/;
  const whyVerb = /\b(explain\s+why|why\s+does|why\s+do|mengapa|kenapa)\b/;
  const purposeVerb =
    /\b(primary\s+)?purpose\b|\bmain\s+function\b|\bstate\s+the\s+function\b|\bwhat\s+is\s+the\s+function\b|\btujuan\s+utama\b|\bfungsi\s+utama\b/i;
  const sequenceHistoryVerb =
    /\b(evolution\s+of|development\s+of|history\s+of|sequence\s+of|from\s+.+\s+to\s+.+)\b/i;
  const multiStageCue =
    /\b(dalton|thomson|rutherford|bohr|scientist|model|stage|steps?|urutan|peringkat)\b/i;

  if (analysis?.questionType === "compare_contrast" && originalMaxScore >= 5) {
    suggested = Math.min(suggested, Math.max(4, analysis.suggestedMaxScore));
    reason = "Compare/contrast — expect several paired points; capped to a typical SPM compare range.";
  } else if (sequenceHistoryVerb.test(q) && multiStageCue.test(q) && originalMaxScore >= 4) {
    suggested = Math.max(4, Math.min(suggested, originalMaxScore));
    reason = "Evolution/development/sequence stem implies multiple named stages; keep at least 4 marks.";
  } else if (purposeVerb.test(q) && !explainVerb.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Purpose/function one-liner style — typically 1–2 marks unless stem shows more.";
  } else if (recallVerb.test(q) && /\b(five|5|lima)\b/.test(q) && /\b(reason|point|factor|example|item|perkara|faktor|contoh)/i.test(q)) {
    suggested = Math.min(suggested, 5);
    reason = "Question asks for five (or similar) distinct items — up to 5 marks.";
  } else if (recallVerb.test(q) && /\b(four|4|empat)\b/.test(q)) {
    suggested = Math.min(suggested, 4);
    reason = "Question asks for four distinct items — up to 4 marks.";
  } else if (recallVerb.test(q) && /\b(three|3|tiga)\b/.test(q)) {
    suggested = Math.min(suggested, 3);
    reason = "Question asks for three distinct items — up to 3 marks.";
  } else if (recallVerb.test(q) && /\b(two|2|dua)\b/.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Question asks for two distinct items — 2 marks.";
  } else if (
    /\b(one|1|a\s+single|only\s+one)\b/.test(q) &&
    (recallVerb.test(q) || /\b(name|namakan|identify|which\s+(type|kind|sort)\s+of)\b/.test(q))
  ) {
    suggested = Math.min(suggested, 1);
    reason = "Question asks for a single named answer or one point.";
  } else if (/\bwhich\s+(type|kind|sort)\s+of\b/.test(q) || /\bwhat\s+is\s+the\s+name\b/.test(q)) {
    suggested = Math.min(suggested, 1);
    reason = "Identification of one type/name.";
  } else if (recallVerb.test(q) && !/\b(two|three|four|five|2|3|4|5|dua|tiga|empat|lima)\b/.test(q) && !explainVerb.test(q) && q.length < 120) {
    suggested = Math.min(suggested, 2);
    reason = "Short recall/state question without a plural count — treat as 1–2 marks.";
  } else if (/\bwhat\s+is\s+the\s+(main\s+)?function\b/.test(q) || /\bfungsi\s+utama\b/.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Simple function question — typically 1–2 marks.";
  } else if (whyVerb.test(q)) {
    if (/\b(process|mechanism|sequence|stages?|development|evolution|langkah|urutan|peringkat)\b/i.test(q) && originalMaxScore >= 4) {
      suggested = Math.min(Math.max(suggested, 4), originalMaxScore);
      reason = "'Explain why' with mechanism/process cues — allow 3–4 marks.";
    } else {
      suggested = Math.min(suggested, 3);
      reason = "'Explain why' style — typically 2–3 marks unless the stem asks for more.";
    }
  } else if (explainVerb.test(q)) {
    if (originalMaxScore >= 5) {
      suggested = Math.min(suggested, 4);
      reason =
        "General explain/describe/discuss without an explicit mark count — cap at 4 marks for a typical SPM-length answer (use 5 only when the stem clearly needs five separate points).";
    }
  }

  if (suggested >= originalMaxScore) {
    const adjustedMaxScore = clampMarks(dualAndFloor ? Math.max(originalMaxScore, 2) : originalMaxScore);
    const dualNote = dualAndFloor ? " At least 2 marks: stem joins two demands with 'and'/'dan'." : "";
    const out = {
      originalMaxScore,
      adjustedMaxScore,
      maxScoreAdjustedReason: dualAndFloor ? `${reason}${dualNote}` : reason,
    };
    if (process.env.NODE_ENV === "development") {
      console.info("[rag][maxScoreInference]", out);
    }
    return out;
  }

  let adjustedMaxScore = clampMarks(suggested);
  if (dualAndFloor) adjustedMaxScore = clampMarks(Math.max(adjustedMaxScore, 2));

  const out = {
    originalMaxScore,
    adjustedMaxScore,
    maxScoreAdjustedReason: `${reason}${dualAndFloor ? " At least 2 marks: two demands joined by 'and'/'dan'." : ""} Client sent maxScore=${originalMaxScore}; adjusted for fairer marking.`,
  };
  if (process.env.NODE_ENV === "development") {
    console.info("[rag][maxScoreInference]", out);
  }
  return out;
}
