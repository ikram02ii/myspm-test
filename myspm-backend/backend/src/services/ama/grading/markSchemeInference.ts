function clampMarks(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

export function parseMarkahFromQuestion(question: string): number | null {
  const m = question.match(/(?:^|\n)\s*(?:Markah|Marks?)\s*[:：]\s*(\d{1,2})\b/im);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null;
}

const MARKING_POINTS_HEADER =
  /(?:Marking points?|Mark\s+scheme|Skema(?:\s+penilaian)?|Panduan\s+penilaian)\s*[:：]/i;

export function extractMarkingPointBullets(question: string): string[] {
  const headerMatch = question.match(MARKING_POINTS_HEADER);
  if (!headerMatch || headerMatch.index == null) return [];

  const afterHeader = question.slice(headerMatch.index + headerMatch[0].length);
  const sectionEnd = afterHeader.search(/(?:^|\n)\s*(?:Soalan|Question)\s+\d+\s*[:.)-]?/im);
  const body = (sectionEnd >= 0 ? afterHeader.slice(0, sectionEnd) : afterHeader).trim();
  if (!body) return [];

  const points: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:Jawapan|Answer|Markah|Marks?|Soalan|Question)\s*:/i.test(trimmed)) break;
    const bullet = trimmed.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
    const text = (bullet?.[1] ?? trimmed).trim();
    if (text.length >= 2) points.push(text);
  }
  return points.filter((p) => p.length >= 2);
}

export function extractJawapanText(question: string): string | null {
  // Do not use the `m` flag: with `m`, `$` matches end-of-line and truncates multi-line Jawapan
  // (e.g. Formula / Final answer) to the first line only.
  const m = question.match(
    /(?:^|\n)\s*(?:Jawapan|Answer|Model answer)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:Marking points?|Mark\s+scheme|Skema|Panduan\s+penilaian|Markah|Marks?|Soalan|Question)\s*[:：]|$)/i,
  );
  const text = m?.[1]?.trim() ?? "";
  return text.length > 0 ? text : null;
}

export function countDistinctModelAnswerPoints(text: string): number {
  const raw = text.trim();
  if (!raw) return 0;

  if (raw.includes(";")) {
    const parts = raw
      .split(";")
      .map((part) => part.trim().replace(/^[-•*]\s*/, ""))
      .filter((part) => part.length >= 2);
    if (parts.length >= 1) return parts.length;
  }

  const bulletLines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-•*]|\d+[.)])\s+\S/.test(line));
  if (bulletLines.length >= 1) return bulletLines.length;

  const sequenceMatch = raw.match(
    /(?:^|\s)(?:First|Secondly|Second|Third|Fourth|Fifth|Finally|Lastly| pertama| kedua| ketiga)\s*[,:]?\s*/gi,
  );
  if (sequenceMatch && sequenceMatch.length >= 2) {
    const chunks = raw
      .split(/(?:^|\s)(?:First|Secondly|Second|Third|Fourth|Fifth|Finally|Lastly| pertama| kedua| ketiga)\s*[,:]?\s*/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4);
    if (chunks.length >= 2) return chunks.length;
  }

  if (!raw.includes("\n") && raw.length <= 120) return 1;

  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
  if (sentences.length >= 2) return sentences.length;

  return 1;
}

export type MarkSchemeMaxScoreSource = "marking_points" | "model_answer" | "markah_line" | "client";

export type MarkSchemeMaxScoreResult = {
  maxScore: number;
  reason: string;
  source: MarkSchemeMaxScoreSource;
};

/**
 * maxScore follows the mark scheme / model answer, not question-stem wording alone.
 * Priority: marking-point bullets → distinct Jawapan points → Markah: line → client fallback.
 */
export function inferMaxScoreFromMarkScheme(
  question: string,
  fallback: number,
): MarkSchemeMaxScoreResult {
  const safeFallback = clampMarks(fallback);

  const markingPoints = extractMarkingPointBullets(question);
  if (markingPoints.length >= 1) {
    const maxScore = clampMarks(markingPoints.length);
    return {
      maxScore,
      source: "marking_points",
      reason: `${maxScore} mark(s) from ${markingPoints.length} distinct marking point(s) in the scheme.`,
    };
  }

  const jawapan = extractJawapanText(question);
  if (jawapan) {
    const pointCount = countDistinctModelAnswerPoints(jawapan);
    if (pointCount >= 1) {
      const maxScore = clampMarks(pointCount);
      return {
        maxScore,
        source: "model_answer",
        reason: `${maxScore} mark(s) from ${pointCount} distinct point(s) required in the model answer.`,
      };
    }
  }

  const markah = parseMarkahFromQuestion(question);
  if (markah != null) {
    return {
      maxScore: markah,
      source: "markah_line",
      reason: `Markah: ${markah} from the supplied mark scheme.`,
    };
  }

  return {
    maxScore: safeFallback,
    source: "client",
    reason: "No marking scheme or model answer in question text; using client maxScore.",
  };
}
