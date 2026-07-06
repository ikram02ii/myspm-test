import { readFileSync } from "node:fs";

export type ChapterPageRange = {
  chapter: string;
  pageStart: number;
  pageEnd: number;
  chapterNo: number;
};

export function parseChapterNoFromLabel(chapter: string): number | null {
  const m = chapter.match(/\bchapter\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function loadChapterPageMap(mapPath: string): ChapterPageRange[] {
  const raw = readFileSync(mapPath, "utf8");
  const parsed = JSON.parse(raw) as Array<{ chapter: string; pageStart: number; pageEnd: number }>;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Chapter map must be a non-empty JSON array.");
  }
  return parsed.map((row, i) => {
    const chapter = row.chapter?.trim();
    const pageStart = Number(row.pageStart);
    const pageEnd = Number(row.pageEnd);
    if (!chapter) throw new Error(`Row ${i + 1}: missing chapter label`);
    if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd) || pageStart > pageEnd) {
      throw new Error(`Row ${i + 1}: invalid page range`);
    }
    const chapterNo = parseChapterNoFromLabel(chapter);
    if (chapterNo == null) throw new Error(`Row ${i + 1}: could not parse chapter number from "${chapter}"`);
    return { chapter, pageStart, pageEnd, chapterNo };
  });
}

export function chapterRangeForPage(page: number, ranges: ChapterPageRange[]): ChapterPageRange | null {
  for (const r of ranges) {
    if (page >= r.pageStart && page <= r.pageEnd) return r;
  }
  return null;
}

export function chapterLabelForPage(page: number, ranges: ChapterPageRange[]): string | null {
  return chapterRangeForPage(page, ranges)?.chapter ?? null;
}

export function chapterNoForPage(page: number, ranges: ChapterPageRange[]): number | null {
  return chapterRangeForPage(page, ranges)?.chapterNo ?? null;
}

/** Strip running headers, lone page numbers, and excess whitespace from transcribed page text. */
export function cleanTranscribedPageContent(raw: string): string {
  const lines = raw.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== "") cleaned.push("");
      continue;
    }
    if (/^\d{1,3}$/.test(t)) continue;
    if (/^kssm\s+biology\s+form\s+4$/i.test(t)) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(t)) continue;
    cleaned.push(t);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isModerationBlockedContent(content: string): boolean {
  return content.includes("[MODERATION_BLOCKED]");
}
