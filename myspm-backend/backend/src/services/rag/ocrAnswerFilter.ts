/**
 * Remove question stems accidentally picked up by OCR (common when the photo includes
 * the on-screen question or a worksheet header).
 */

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*\d{1,2}\s*(?:marks?|markah|m)\s*\)/gi, "")
    .replace(/^(?:en|bm)\s*:\s*/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuestionStemLines(question: string): string[] {
  const lines = question
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const stems: string[] = [];
  for (const line of lines) {
    if (/^[A-Da-d][.)]\s/.test(line)) break;
    if (/^(?:jawapan|answer|penjelasan|explanation)\s*:/i.test(line)) break;

    stems.push(line);
    const withoutLabel = line.replace(/^(?:EN|BM)\s*:\s*/i, "").trim();
    if (withoutLabel && withoutLabel !== line) stems.push(withoutLabel);
  }

  return stems.filter((s) => s.length >= 12);
}

function lineMatchesStem(line: string, stemNorms: string[]): boolean {
  const norm = normalizeForCompare(line);
  if (!norm || norm.length < 8) return false;
  return stemNorms.some((stem) => {
    if (!stem) return false;
    if (norm === stem) return true;
    if (stem.length >= 24 && norm.includes(stem)) return true;
    if (norm.length >= 24 && stem.includes(norm)) return true;
    return false;
  });
}

export type OcrStemFilterResult = {
  text: string;
  removedQuestionLines: boolean;
  lookedLikeQuestionOnly: boolean;
};

/**
 * Drop lines that match the practice question stem (EN/BM or plain).
 */
export function removeQuestionStemFromOcrText(answer: string, question?: string): OcrStemFilterResult {
  const raw = (answer || "").trim();
  if (!raw || !question?.trim()) {
    return { text: raw, removedQuestionLines: false, lookedLikeQuestionOnly: false };
  }

  const stemNorms = extractQuestionStemLines(question)
    .map(normalizeForCompare)
    .filter((s) => s.length >= 12);

  if (stemNorms.length === 0) {
    return { text: raw, removedQuestionLines: false, lookedLikeQuestionOnly: false };
  }

  const answerNorm = normalizeForCompare(raw);
  if (stemNorms.some((stem) => answerNorm === stem || (stem.length >= 20 && answerNorm.includes(stem)))) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 2) {
      return { text: "", removedQuestionLines: true, lookedLikeQuestionOnly: true };
    }
  }

  const kept = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((line) => line.length > 0 && !lineMatchesStem(line, stemNorms));

  const text = kept.join("\n").trim();
  const removedQuestionLines = text.length < raw.length;
  const lookedLikeQuestionOnly = removedQuestionLines && text.length === 0;

  return { text, removedQuestionLines, lookedLikeQuestionOnly };
}
