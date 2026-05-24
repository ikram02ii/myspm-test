import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { ragDb, ragTextbookChunksTable, ragTextbooksTable } from "../../lib/ragDb";

const MAX_CHAPTERS = 400;

type ChapterMapRow = { chapter?: string; pageStart?: number; pageEnd?: number };

/** e.g. Biology + Form 4 → biology-form4 */
function chapterMapFileSlug(subject: string, form: string): string {
  const sub = subject.trim().toLowerCase().replace(/\s+/g, "");
  const fo = form.trim().toLowerCase().replace(/\s+/g, "");
  return `${sub}-${fo}`;
}

function chapterMapFilePath(subject: string, form: string): string {
  return join(process.cwd(), "scripts", "data", `${chapterMapFileSlug(subject, form)}-chapters.json`);
}

async function loadChapterMapFromScriptData(subject: string, form: string): Promise<string[]> {
  const path = chapterMapFilePath(subject, form);
  if (!existsSync(path)) return [];

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as ChapterMapRow[];
    if (!Array.isArray(parsed)) return [];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of parsed) {
      const label = row.chapter?.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  } catch {
    return [];
  }
}

function extractChapterNumber(label: string): number | null {
  const m = label.match(/\b(?:chapter|bab|unit)\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function chapterLabelQuality(label: string): number {
  let score = label.length;
  if (/[–—]/.test(label)) score += 50;
  if (/^Chapter\s+\d+\s*[–—:]/i.test(label)) score += 100;
  if (/^\d+\.\d+/.test(label)) score -= 80;
  return score;
}

/** One entry per chapter number; prefer full titles from backfill (Chapter N – Title). */
export function normalizeChapterLabels(raw: string[]): string[] {
  const byNum = new Map<number, string>();
  const unnumbered: string[] = [];

  for (const c of raw) {
    const t = c.trim();
    if (!t) continue;
    const n = extractChapterNumber(t);
    if (n == null) {
      if (!unnumbered.includes(t)) unnumbered.push(t);
      continue;
    }
    const prev = byNum.get(n);
    if (!prev || chapterLabelQuality(t) > chapterLabelQuality(prev)) {
      byNum.set(n, t);
    }
  }

  const numbered = [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, label]) => label);

  return [...numbered, ...unnumbered.sort((a, b) => a.localeCompare(b))];
}

async function listChaptersFromDb(subject: string, form: string): Promise<string[]> {
  const sub = subject.trim();
  const fo = form.trim();
  if (!sub || !fo) return [];

  const rows = await ragDb
    .select({ chapter: ragTextbookChunksTable.chapter })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
    .where(
      and(
        eq(ragTextbooksTable.subject, sub),
        eq(ragTextbooksTable.form, fo),
        isNotNull(ragTextbookChunksTable.chapter),
        sql`trim(${ragTextbookChunksTable.chapter}) <> ''`,
      ),
    )
    .groupBy(ragTextbookChunksTable.chapter);

  const raw: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = r.chapter?.trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    raw.push(c);
  }
  return raw;
}

/**
 * Distinct syllabus chapters for subject+form, ordered Chapter 1…15 with full titles when available.
 * Prefers `scripts/data/{subject}-{form}-chapters.json` (backfill map), then normalized DB labels.
 */
export async function listTextbookChaptersForSubjectForm(
  subject: string,
  form: string,
): Promise<string[]> {
  const fromMap = await loadChapterMapFromScriptData(subject, form);
  if (fromMap.length > 0) return fromMap;

  const fromDb = await listChaptersFromDb(subject, form);
  return normalizeChapterLabels(fromDb).slice(0, MAX_CHAPTERS);
}
