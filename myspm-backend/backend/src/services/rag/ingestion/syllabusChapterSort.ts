/**
 * Order syllabus chapter labels for UI (Chapter 1 … 15, not Chapter 1, 10, 11, 2…).
 */

export type ChapterSortKey = {
  /** Primary chapter number; 9999 = unnumbered / other */
  num: number;
  sub: number;
  label: string;
};

export function parseChapterSortKey(label: string): ChapterSortKey {
  const trimmed = label.trim();
  const m = trimmed.match(/^(?:chapter|bab|unit|topik)\s*(\d+)(?:\.(\d+))?/i);
  if (m) {
    return {
      num: Number(m[1]),
      sub: m[2] ? Number(m[2]) : 0,
      label: trimmed,
    };
  }
  return { num: 9999, sub: 0, label: trimmed };
}

/** Drop obvious OCR/noise labels; keep real syllabus headings. */
export function isLikelySyllabusChapterLabel(label: string): boolean {
  const t = label.trim();
  if (t.length < 4) return false;
  if (/^(?:chapter|bab|unit|topik)\s*\d+/i.test(t)) return true;
  if (/video|nota\s*\d|b0\d-\d/i.test(t)) return false;
  return t.length <= 200;
}

export function sortSyllabusChapterLabels(chapters: string[]): string[] {
  const filtered = chapters.filter((c) => isLikelySyllabusChapterLabel(c));
  const list = filtered.length > 0 ? filtered : chapters.filter((c) => c.trim().length > 0);
  return [...list].sort((a, b) => {
    const ka = parseChapterSortKey(a);
    const kb = parseChapterSortKey(b);
    if (ka.num !== kb.num) return ka.num - kb.num;
    if (ka.sub !== kb.sub) return ka.sub - kb.sub;
    return ka.label.localeCompare(kb.label, undefined, { sensitivity: "base" });
  });
}

/** Short label for compact UI, e.g. "Chapter 3: Movement…" → "Ch. 3 · Movement…" */
export function formatChapterListLabel(label: string): string {
  const t = label.trim();
  const m = t.match(/^(Chapter|Bab|Unit)\s*(\d+)\s*[:.\-–—]\s*(.+)$/i);
  if (m) {
    const prefix = m[1].toLowerCase() === "bab" ? "Bab" : "Ch.";
    return `${prefix} ${m[2]} · ${m[3].trim()}`;
  }
  return t;
}
