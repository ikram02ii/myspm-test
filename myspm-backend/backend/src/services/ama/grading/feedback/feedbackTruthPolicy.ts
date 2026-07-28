/**
 * Code-owned feedback truth for ALL questions — not topic-specific.
 *
 * Principle: feedback language MUST match (score, awardedCount, student evidence).
 * When nothing was awarded, never trust LLM praise / "needs more detail" framing.
 */

const FALSE_PROGRESS_RE =
  /\b(on the right track|right track|good start|heading in the right direction|partially correct|partially right|some understanding|almost there|you(?:'re| are) close|nice try|not far off|getting there|promising start|well done|great(?:\s+job)?|excellent|good attempt|solid attempt|you understood|you have the idea|hampir betul|hampir tepat|cuba yang bagus|baik|bagus\s+sekali|dalam\s+landasan|sedikit\s+lagi)\b/i;

/** Phrases that imply the student had relevant substance (invalid at 0 awards). */
const IMPLIES_PARTIAL_SUBSTANCE_RE =
  /\b(needs? more detail|more detail|elaborate|expand on|on the right track|right track|add more|go further|develop (?:your|the) (?:idea|answer)|baguskan lagi|perlu lebih terperinci|tambah butiran)\b/i;

/** Empty / junk / non-attempt answers — topic-agnostic. */
export function isNonResponsiveStudentAnswer(answer: string): boolean {
  const t = (answer || "").trim();
  if (!t) return true;
  if (/^\d+([.,]\d+)?%?$/.test(t)) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;
  if (/^(.)\1{2,}$/u.test(t)) return true; // "aaa", "...."
  if (/^(idk|n\/a|na|nil|none|no|yes|ok|okay|test|asdf|qwerty|lol|haha|hmm+|xxx+)$/i.test(t)) {
    return true;
  }
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters === 0 && t.length <= 12) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && (t.length <= 2 || /^\d/.test(t))) return true;
  // Very short answers with no space and almost no letters (e.g. "8", "#", "??")
  if (words.length <= 1 && letters < 3 && t.length <= 6) return true;
  return false;
}

export function feedbackClaimsFalseProgress(feedback: string): boolean {
  return FALSE_PROGRESS_RE.test(feedback || "");
}

export function feedbackImpliesPartialSubstance(feedback: string): boolean {
  return IMPLIES_PARTIAL_SUBSTANCE_RE.test(feedback || "");
}

export function buildZeroScoreFeedback(params: {
  maxScore: number;
  studentAnswer: string;
  language?: "english" | "malay";
}): string {
  const malay = params.language === "malay";
  if (isNonResponsiveStudentAnswer(params.studentAnswer)) {
    return malay
      ? `Jawapan anda tidak menjawab soalan. Markah: 0/${params.maxScore}. Rujuk titik-titik markah dalam jawapan model di bawah.`
      : `Your answer did not address the question. Score: 0/${params.maxScore}. Use the model answer marking points below to see what was required.`;
  }
  return malay
    ? `Tiada titik markah yang ditunjukkan dengan jelas. Markah: 0/${params.maxScore}. Semak jawapan model untuk idea yang diperlukan.`
    : `None of the required marking points were clearly shown. Score: 0/${params.maxScore}. Check the model answer for the ideas needed.`;
}

export function buildPartialScoreFeedback(params: {
  score: number;
  maxScore: number;
  awardedCount: number;
  missingCount: number;
  language?: "english" | "malay";
}): string {
  const malay = params.language === "malay";
  if (malay) {
    return `Markah: ${params.score}/${params.maxScore}. ${params.awardedCount} titik diberi, ${params.missingCount} titik belum ditunjukkan dengan jelas.`;
  }
  return `Score: ${params.score}/${params.maxScore}. ${params.awardedCount} marking point${params.awardedCount === 1 ? " was" : "s were"} awarded; ${params.missingCount} still missing or unclear.`;
}

/**
 * Enforce feedback/strengths against marking truth for any subject / stem.
 *
 * Hard rules (code, not LLM):
 * - awardedCount === 0 → deterministic zero feedback; strengths = []
 * - strengths only when awards exist
 * - strip false-progress / "needs more detail" framing when it contradicts the score
 */
export function reconcileFeedbackToMarkingTruth(params: {
  feedback: string;
  strengths: string[];
  improvements: string[];
  score: number;
  maxScore: number;
  awardedCount: number;
  missingCount?: number;
  studentAnswer: string;
  language?: "english" | "malay";
}): { feedback: string; strengths: string[]; improvements: string[] } {
  const { score, maxScore, awardedCount, studentAnswer } = params;
  const missingCount =
    typeof params.missingCount === "number"
      ? params.missingCount
      : Math.max(0, params.improvements.length);

  let feedback = (params.feedback || "").trim();
  let strengths = [...params.strengths];
  let improvements = [...params.improvements];

  if (awardedCount <= 0 || score <= 0) {
    strengths = [];
    feedback = buildZeroScoreFeedback({
      maxScore,
      studentAnswer,
      language: params.language,
    });
    return { feedback, strengths, improvements };
  }

  // Partial / full: keep LLM wording only when it does not invent progress beyond awards.
  if (feedbackClaimsFalseProgress(feedback) && awardedCount < maxScore && score / Math.max(1, maxScore) < 0.5) {
    // Mild praise is fine at mid scores; replace empty / contradictory with factual line
    if (!feedback || feedbackImpliesPartialSubstance(feedback) && awardedCount === 0) {
      feedback = buildPartialScoreFeedback({
        score,
        maxScore,
        awardedCount,
        missingCount,
        language: params.language,
      });
    }
  }

  if (!feedback) {
    if (score >= maxScore) {
      feedback =
        params.language === "malay"
          ? "Jawapan anda meliputi titik markah yang diperlukan. Syabas."
          : "Your answer covers the required marking points. Well done.";
    } else {
      feedback = buildPartialScoreFeedback({
        score,
        maxScore,
        awardedCount,
        missingCount,
        language: params.language,
      });
    }
  }

  // Never allow strengths when nothing was awarded (belt and braces).
  if (awardedCount <= 0) strengths = [];
  if (score >= maxScore) improvements = [];

  return { feedback, strengths, improvements };
}

/** True when caller should skip the feedback LLM and use code templates. */
export function shouldUseDeterministicFeedback(params: {
  score: number;
  awardedCount: number;
  studentAnswer: string;
}): boolean {
  if (params.awardedCount <= 0 || params.score <= 0) return true;
  if (isNonResponsiveStudentAnswer(params.studentAnswer)) return true;
  return false;
}
