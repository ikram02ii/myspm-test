/**
 * Post-grade checks: score consistency, topic leakage, max-score inference.
 */
import type { ContextAuditResult, MarkBreakdownItem, QuestionAnalysis } from "../types";
import { studentAnswerCoversIdea } from "./gradingFairness";

export type RetrievalConfidence = "high" | "medium" | "low";

export function computeRetrievalConfidence(params: {
  audit: ContextAuditResult;
  approvedChunkCount: number;
  lowConfidenceFlag: boolean;
}): RetrievalConfidence {
  if (params.approvedChunkCount === 0) return "low";
  if (params.audit.isSufficientContext && !params.lowConfidenceFlag) return "high";
  if (params.approvedChunkCount >= 2 && params.audit.relevanceScore >= 0.35) return "medium";
  return "low";
}

export type GradingValidationResult = {
  contradictionCheckPassed: boolean;
  topicConsistencyPassed: boolean;
  topicConsistencyWarning?: string;
  retrievalConfidence: RetrievalConfidence;
  scoreAfterConsistency: number;
  missingIdeasAfterContradiction: string[];
  matchedIdeasAfterContradiction: string[];
  markBreakdownAfterContradiction?: MarkBreakdownItem[];
};

/**
 * Deterministic score alignment with rubric rows (code-owned, not LLM).
 */
export function repairScoreFromBreakdown(
  markBreakdown: MarkBreakdownItem[] | undefined,
  maxScore: number,
  currentScore: number,
): number {
  if (!markBreakdown || markBreakdown.length === 0) return Math.max(0, Math.min(maxScore, currentScore));
  const summed = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  return Math.max(0, Math.min(maxScore, Math.round(summed)));
}

/**
 * Align reported score with the sum of awarded rubric marks, and catch obvious
 * full-mark inconsistencies when missing rows remain.
 */
export function applyScoreConsistencyRules(params: {
  score: number;
  maxScore: number;
  markBreakdown?: MarkBreakdownItem[];
  missingIdeas: string[];
  studentAnswer: string;
  questionAnalysis?: QuestionAnalysis | null;
}): { score: number; reason?: string } {
  let score = params.score;
  const { markBreakdown, maxScore, missingIdeas, studentAnswer } = params;
  if (!markBreakdown || markBreakdown.length === 0) return { score };

  const fromBreakdown = repairScoreFromBreakdown(markBreakdown, maxScore, score);
  if (fromBreakdown !== score) {
    return { score: fromBreakdown, reason: "Score aligned to sum of awarded rubric marks." };
  }

  if (score >= maxScore && missingIdeas.length > 0) {
    const anyMissingStill = missingIdeas.some((m) => !studentAnswerCoversIdea(studentAnswer, m));
    if (anyMissingStill && fromBreakdown < score) {
      return { score: fromBreakdown, reason: "Full marks inconsistent with missing rubric rows; aligned to breakdown sum." };
    }
  }

  return { score };
}

type TopicCluster = {
  id: string;
  /** Question stem suggests this topic. */
  stemSignal: RegExp;
  /** If these appear in grader output but not in the student answer, likely wrong-topic leakage. */
  outputRedFlags: RegExp;
};

const TOPIC_CLUSTERS: TopicCluster[] = [
  {
    id: "photosynthesis_lab",
    stemSignal:
      /photosynth|hydrilla|chlorophyll|oxygen\s+bubbles?|rate\s+of\s+photosynth|light\s+intensity.*photosynth|carbon\s+dioxide.*photosynth|fotosintesis/i,
    outputRedFlags:
      /\b(glycogen|deamination|urea|liver\s+assimilation|assimilation\s+in\s+the\s+liver|hepatocytes?\s+store)\b/i,
  },
  {
    id: "liver_assimilation",
    stemSignal: /\b(liver|hepat|assimilation|glycogen|deamination|urea|amino\s+acid.*liver)\b/i,
    outputRedFlags: /\b(hydrilla|oxygen\s+bubbles?|chloroplast|chlorophyll|photosynth|fotosintesis)\b/i,
  },
  {
    id: "genetics",
    stemSignal:
      /\b(allele|genotype|phenotype|karyotype|chromosome|meiosis|mitosis|cross(?:ing)?\s*over|inheritance|blood\s+group|abo|syndrome|mutation|dna|gene|gamete)\b/i,
    outputRedFlags: /\b(hydrilla|glycogen|photosynth|liver\s+assimilation|antibody|vaccine)\b/i,
  },
  {
    id: "immunity",
    stemSignal:
      /\b(antibody|antigen|vaccine|immunity|lymphocyte|phagocyte|hiv|pathogen|immune|vaksin|imun)\b/i,
    outputRedFlags: /\b(glycogen|photosynth|hydrilla|chloroplast|deamination|urea)\b/i,
  },
  {
    id: "lab_safety_ppe",
    stemSignal:
      /\b(ppe|personal\s+protective|laboratory\s+safety|goggles|gloves|lab\s+coat|chemical\s+spills?|fume\s+cupboard|radas\s+perlindungan)\b/i,
    outputRedFlags: /\b(photosynth|hydrilla|glycogen|sperm\s+cell|chromosome|meiosis|oxygen\s+bubbles)\b/i,
  },
  {
    id: "pollen_reproduction",
    stemSignal:
      /\b(pollen|pollination|sucrose|pollen\s+grain|pollen\s+tube|germinate|embryo\s+sac|double\s+fertilisation|gametophyte)\b/i,
    outputRedFlags: /\b(glycogen|liver\s+assimilation|deamination|hydrilla|photosynth.*enzyme\s+denature)\b/i,
  },
];

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type ValidateTopicConsistencyInput = {
  question: string;
  studentAnswer: string;
  feedback: string;
  modelAnswer?: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  rubricIdeas?: string[];
  markBreakdown?: MarkBreakdownItem[];
  score: number;
  maxScore: number;
  language: "english" | "malay" | "mixed";
};

export type ValidateTopicConsistencyResult = {
  topicConsistencyPassed: boolean;
  topicConsistencyWarning?: string;
  feedback: string;
  modelAnswer?: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
};

function briefSafeFeedback(
  score: number,
  maxScore: number,
  matched: string[],
  missing: string[],
  language: "english" | "malay" | "mixed",
): string {
  const m = matched.filter(Boolean);
  const miss = missing.filter(Boolean);
  if (language === "malay") {
    if (score >= maxScore) return `Betul (${score}/${maxScore}). Poin utama: ${m.slice(0, 4).join("; ") || "jawapan anda"}.`.trim();
    return `Markah ${score}/${maxScore}. Sudah betul: ${m.slice(0, 3).join("; ") || "(tiada)"}. Perlu perbaiki: ${miss.slice(0, 3).join("; ") || "perincikan jawapan"}.`.trim();
  }
  if (score >= maxScore) return `Correct (${score}/${maxScore}). Main points: ${m.slice(0, 4).join("; ") || "your answer"}.`.trim();
  return `Score ${score}/${maxScore}. You already gave: ${m.slice(0, 3).join("; ") || "(see your answer)"}. Still improve: ${miss.slice(0, 3).join("; ") || "add a bit more detail"}.`.trim();
}

/**
 * Blocks obvious wrong-topic leakage in grader strings (e.g. liver/glycogen feedback on a Hydrilla photosynthesis question).
 */
export function validateTopicConsistency(input: ValidateTopicConsistencyInput): ValidateTopicConsistencyResult {
  const q = normalize(input.question);
  const sa = normalize(input.studentAnswer);
  const outParts = [
    input.feedback,
    input.modelAnswer ?? "",
    ...(input.missingIdeas ?? []),
    ...(input.matchedIdeas ?? []),
    ...(input.rubricIdeas ?? []),
    ...(input.markBreakdown ?? []).map((r) => `${r.idea} ${r.reason}`),
  ];
  const blob = normalize(outParts.join("\n"));

  const activeClusters = TOPIC_CLUSTERS.filter((c) => c.stemSignal.test(q));
  if (activeClusters.length === 0) {
    return {
      topicConsistencyPassed: true,
      feedback: input.feedback,
      modelAnswer: input.modelAnswer,
      missingIdeas: input.missingIdeas,
      matchedIdeas: input.matchedIdeas,
      markBreakdown: input.markBreakdown,
    };
  }

  for (const c of activeClusters) {
    if (!c.outputRedFlags.test(blob)) continue;
    if (c.outputRedFlags.test(sa)) continue;
    const safeFeedback = briefSafeFeedback(
      input.score,
      input.maxScore,
      input.matchedIdeas,
      input.missingIdeas,
      input.language,
    );
    const modelAns =
      input.matchedIdeas.filter(Boolean).length > 0
        ? input.matchedIdeas.filter(Boolean).slice(0, 6).join("; ")
        : input.modelAnswer;

    return {
      topicConsistencyPassed: false,
      topicConsistencyWarning: `Topic guard (${c.id}): grader output contained cues typical of a different topic than this stem; student-facing feedback was replaced with a safe summary tied to your scored points.`,
      feedback: safeFeedback,
      modelAnswer: modelAns,
      missingIdeas: input.missingIdeas,
      matchedIdeas: input.matchedIdeas,
      markBreakdown: input.markBreakdown,
    };
  }

  return {
    topicConsistencyPassed: true,
    feedback: input.feedback,
    modelAnswer: input.modelAnswer,
    missingIdeas: input.missingIdeas,
    matchedIdeas: input.matchedIdeas,
    markBreakdown: input.markBreakdown,
  };
}

import { hasTwoDistinctDemandsJoinedByAnd } from "./gradingPolicy";

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
    reason = "Compare/contrast â€” expect several paired points; capped to a typical SPM compare range.";
  } else if (sequenceHistoryVerb.test(q) && multiStageCue.test(q) && originalMaxScore >= 4) {
    suggested = Math.max(4, Math.min(suggested, originalMaxScore));
    reason = "Evolution/development/sequence stem implies multiple named stages; keep at least 4 marks.";
  } else if (purposeVerb.test(q) && !explainVerb.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Purpose/function one-liner style â€” typically 1â€“2 marks unless stem shows more.";
  } else if (recallVerb.test(q) && /\b(five|5|lima)\b/.test(q) && /\b(reason|point|factor|example|item|perkara|faktor|contoh)/i.test(q)) {
    suggested = Math.min(suggested, 5);
    reason = "Question asks for five (or similar) distinct items â€” up to 5 marks.";
  } else if (recallVerb.test(q) && /\b(four|4|empat)\b/.test(q)) {
    suggested = Math.min(suggested, 4);
    reason = "Question asks for four distinct items â€” up to 4 marks.";
  } else if (recallVerb.test(q) && /\b(three|3|tiga)\b/.test(q)) {
    suggested = Math.min(suggested, 3);
    reason = "Question asks for three distinct items â€” up to 3 marks.";
  } else if (recallVerb.test(q) && /\b(two|2|dua)\b/.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Question asks for two distinct items â€” 2 marks.";
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
    reason = "Short recall/state question without a plural count â€” treat as 1â€“2 marks.";
  } else if (/\bwhat\s+is\s+the\s+(main\s+)?function\b/.test(q) || /\bfungsi\s+utama\b/.test(q)) {
    suggested = Math.min(suggested, 2);
    reason = "Simple function question â€” typically 1â€“2 marks.";
  } else if (whyVerb.test(q)) {
    if (/\b(process|mechanism|sequence|stages?|development|evolution|langkah|urutan|peringkat)\b/i.test(q) && originalMaxScore >= 4) {
      suggested = Math.min(Math.max(suggested, 4), originalMaxScore);
      reason = "'Explain why' with mechanism/process cues â€” allow 3â€“4 marks.";
    } else {
      suggested = Math.min(suggested, 3);
      reason = "'Explain why' style â€” typically 2â€“3 marks unless the stem asks for more.";
    }
  } else if (explainVerb.test(q)) {
    if (originalMaxScore >= 5) {
      suggested = Math.min(suggested, 4);
      reason =
        "General explain/describe/discuss without an explicit mark count â€” cap at 4 marks for a typical SPM-length answer (use 5 only when the stem clearly needs five separate points).";
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

