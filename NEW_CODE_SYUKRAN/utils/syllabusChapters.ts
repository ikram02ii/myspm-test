/**
 * Client-side chapter list ordering (matches backend syllabusChapterSort).
 */

export function parseChapterSortKey(label: string): { num: number; sub: number } {
  const trimmed = label.trim();
  const m = trimmed.match(/^(?:chapter|bab|unit|topik)\s*(\d+)(?:\.(\d+))?/i);
  if (m) {
    return { num: Number(m[1]), sub: m[2] ? Number(m[2]) : 0 };
  }
  return { num: 9999, sub: 0 };
}

export function sortSyllabusChapterLabels(chapters: string[]): string[] {
  return [...chapters]
    .filter((c) => c.trim().length > 0)
    .sort((a, b) => {
      const ka = parseChapterSortKey(a);
      const kb = parseChapterSortKey(b);
      if (ka.num !== kb.num) return ka.num - kb.num;
      if (ka.sub !== kb.sub) return ka.sub - kb.sub;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
}

/** Compact row title in the AI topic picker */
export function formatChapterListLabel(label: string): string {
  const t = label.trim();
  const m = t.match(/^(Chapter|Bab|Unit)\s*(\d+)\s*[:.\-–—]\s*(.+)$/i);
  if (m) {
    const prefix = /^bab$/i.test(m[1]) ? "Bab" : "Ch.";
    return `${prefix} ${m[2]} · ${m[3].trim()}`;
  }
  return t;
}
