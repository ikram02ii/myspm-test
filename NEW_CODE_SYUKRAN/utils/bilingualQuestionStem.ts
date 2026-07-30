const MARKS_SUFFIX_RE_GLOBAL = /\s*[\[(]?\s*\d{1,2}\s*(?:marks?|markah)\s*[\])]?\s*$/i;

export function stripMarksSuffixFromStem(text: string): string {
  return (text || "").replace(MARKS_SUFFIX_RE_GLOBAL, "").trim();
}
export type QuestionLangView = "en" | "bm";

const STEM_LINE_RE = /^(?:en|bm)\s*:/i;
const MARKS_SUFFIX_RE = /\s*(\(\s*\d{1,2}\s*(?:marks?|markah)\s*\))\s*$/i;

export function questionHasBilingualStem(questionText: string): boolean {
  return STEM_LINE_RE.test((questionText || "").trim());
}

export function parseBilingualQuestionStem(
  questionText: string,
): { en: string; bm: string } | null {
  const lines = (questionText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let en = "";
  let bm = "";
  for (const line of lines) {
    const enMatch = line.match(/^en\s*:\s*(.+)$/i);
    const bmMatch = line.match(/^bm\s*:\s*(.+)$/i);
    if (enMatch) en = enMatch[1].trim();
    else if (bmMatch) bm = bmMatch[1].trim();
  }

  if (!en && !bm) return null;
  return { en, bm };
}

function stripInlineMarks(line: string): { text: string; marks: string | null } {
  const match = line.match(MARKS_SUFFIX_RE);
  if (!match) return { text: line.trim(), marks: null };
  return {
    text: line.replace(MARKS_SUFFIX_RE, "").trim(),
    marks: match[1],
  };
}

/** Display stem in EN or BM only (marks shown separately in UI). */
export function formatQuestionStemForLangView(
  questionText: string,
  view: QuestionLangView,
): string {
  const parsed = parseBilingualQuestionStem(questionText);
  if (!parsed) {
    return stripMarksSuffixFromStem(questionText);
  }

  const enPart = stripInlineMarks(parsed.en);
  const bmPart = stripInlineMarks(parsed.bm);

  const body =
    view === "en"
      ? enPart.text || parsed.en
      : bmPart.text || parsed.bm;

  if (!body.trim()) {
    return stripMarksSuffixFromStem(questionText);
  }

  return stripMarksSuffixFromStem(body);
}

/** True when an MCQ option stores bilingual EN:/BM: text. */
export function optionHasBilingualText(optionText: string): boolean {
  return questionHasBilingualStem(optionText);
}

/**
 * Display one MCQ option in EN or BM.
 * Plain (legacy) options without EN:/BM: are shown unchanged for both views.
 */
export function formatOptionForLangView(
  optionText: string,
  view: QuestionLangView,
): string {
  const raw = (optionText || "").trim();
  if (!raw) return "";

  const parsed = parseBilingualQuestionStem(raw);
  if (!parsed) return raw;

  const body = view === "en" ? parsed.en || parsed.bm : parsed.bm || parsed.en;
  return (body || raw).trim();
}
