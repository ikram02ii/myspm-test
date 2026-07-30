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

  // Explicit "Mark 1:" / "Mark 2:" rows (common in generated Jawapan / schemes).
  const markLabeled = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^mark\s*\d+\s*[:：]/i.test(line));
  if (markLabeled.length >= 1) return markLabeled.length;

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

function stripSchemePointLabel(line: string): string {
  return line
    .replace(/^mark\s*\d+\s*[:：]\s*/i, "")
    .replace(/^(?:[-•*]|\d+[.)])\s+/, "")
    .trim();
}

/**
 * Distinct marking ideas already present in the question payload
 * (Marking points: section or Jawapan Mark N: / bullets).
 */
export function extractEmbeddedSchemePoints(question: string): string[] {
  const bullets = extractMarkingPointBullets(question);
  if (bullets.length >= 1) {
    return bullets.map(stripSchemePointLabel).filter((p) => p.length >= 2);
  }

  const jawapan = extractJawapanText(question);
  if (!jawapan) return [];

  const markLabeled = jawapan
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^mark\s*\d+\s*[:：]/i.test(line))
    .map(stripSchemePointLabel)
    .filter((p) => p.length >= 2);
  if (markLabeled.length >= 1) return markLabeled;

  const jawapanBullets = jawapan
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-•*]|\d+[.)])\s+\S/.test(line))
    .map(stripSchemePointLabel)
    .filter((p) => p.length >= 2);
  return jawapanBullets;
}

/** True when the grade request already carries a usable mark scheme / Jawapan. */
export function hasEmbeddedMarkScheme(question: string): boolean {
  return extractEmbeddedSchemePoints(question).length >= 1;
}

export type MarkSchemeMaxScoreSource = "marking_points" | "model_answer" | "markah_line" | "client";

export type MarkSchemeMaxScoreResult = {
  maxScore: number;
  reason: string;
  source: MarkSchemeMaxScoreSource;
};

/**
 * maxScore follows the mark scheme / model answer, not question-stem wording alone.
 * Uses the strongest signal among marking points, Markah:, and multi-point Jawapan.
 */
export function inferMaxScoreFromMarkScheme(
  question: string,
  fallback: number,
): MarkSchemeMaxScoreResult {
  const safeFallback = clampMarks(fallback);

  const markingPoints = extractMarkingPointBullets(question);
  const markah = parseMarkahFromQuestion(question);
  const jawapan = extractJawapanText(question);
  const jawapanCount = jawapan ? countDistinctModelAnswerPoints(jawapan) : 0;

  type Cand = { score: number; source: MarkSchemeMaxScoreSource; reason: string };
  const cands: Cand[] = [];
  if (markingPoints.length >= 1) {
    cands.push({
      score: clampMarks(markingPoints.length),
      source: "marking_points",
      reason: `${markingPoints.length} mark(s) from ${markingPoints.length} distinct marking point(s) in the scheme.`,
    });
  }
  if (markah != null) {
    cands.push({
      score: markah,
      source: "markah_line",
      reason: `Markah: ${markah} from the supplied mark scheme.`,
    });
  }
  if (jawapanCount >= 2) {
    cands.push({
      score: clampMarks(jawapanCount),
      source: "model_answer",
      reason: `${jawapanCount} mark(s) from ${jawapanCount} distinct point(s) required in the model answer.`,
    });
  }

  if (cands.length > 0) {
    const rank = (s: MarkSchemeMaxScoreSource) =>
      s === "marking_points" ? 0 : s === "markah_line" ? 1 : 2;
    cands.sort((a, b) => b.score - a.score || rank(a.source) - rank(b.source));
    const best = cands[0]!;
    return { maxScore: best.score, source: best.source, reason: best.reason };
  }

  if (jawapanCount === 1) {
    return {
      maxScore: 1,
      source: "model_answer",
      reason: "1 mark(s) from 1 distinct point(s) required in the model answer.",
    };
  }

  return {
    maxScore: safeFallback,
    source: "client",
    reason: "No marking scheme or model answer in question text; using client maxScore.",
  };
}
