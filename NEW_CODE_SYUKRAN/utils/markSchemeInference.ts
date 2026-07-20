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
  return points;
}

export function extractJawapanText(question: string): string | null {
  const m = question.match(
    /(?:^|\n)\s*(?:Jawapan|Answer|Model answer)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:Marking points?|Mark\s+scheme|Skema|Panduan\s+penilaian|Markah|Marks?|Soalan|Question)\s*[:：]|\s*$)/im,
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

/** maxScore = checklist size (marking points → Jawapan points → Markah:), not stem wording. */
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
      reason: `${maxScore} mark(s) from ${markingPoints.length} marking point(s).`,
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
        reason: `${maxScore} mark(s) from ${pointCount} model-answer point(s).`,
      };
    }
  }

  const markah = parseMarkahFromQuestion(question);
  if (markah != null) {
    return {
      maxScore: markah,
      source: "markah_line",
      reason: `Markah: ${markah} from the mark scheme.`,
    };
  }

  return {
    maxScore: safeFallback,
    source: "client",
    reason: "No mark scheme found; using fallback.",
  };
}

export function buildQuestionPayloadForGrade(
  questionText: string,
  questionForGrade?: string | null,
  explanation?: string | null,
): string {
  const primary = (questionForGrade ?? questionText).trim();
  if (inferMaxScoreFromMarkScheme(primary, 0).source !== "client") {
    return primary;
  }
  const expl = (explanation ?? "").trim();
  if (!expl) return primary;
  const combined = `${primary}\n${expl}`.trim();
  if (inferMaxScoreFromMarkScheme(combined, 0).source !== "client") {
    return combined;
  }
  return primary;
}
