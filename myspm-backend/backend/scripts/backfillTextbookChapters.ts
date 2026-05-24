/**
 * Set rag_textbook_chunks.chapter from PDF page ranges (does not re-chunk).
 *
 * Usage:
 *   npx tsx scripts/backfillTextbookChapters.ts --subject Chemistry --form "Form 5" --map scripts/data/chemistry-form5-chapters.json
 *   npx tsx scripts/backfillTextbookChapters.ts --textbookId tb-... --map path/to/chapters.json [--dry-run]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { and, asc, eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

export type ChapterPageRange = {
  chapter: string;
  pageStart: number;
  pageEnd: number;
};

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const eqArg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(flag.length + 1).trim();
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function loadChapterMap(mapPath: string): ChapterPageRange[] {
  const raw = readFileSync(mapPath, "utf8");
  const parsed = JSON.parse(raw) as ChapterPageRange[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Chapter map must be a non-empty JSON array.");
  }
  return parsed.map((row, i) => {
    const chapter = row.chapter?.trim();
    const pageStart = Number(row.pageStart);
    const pageEnd = Number(row.pageEnd);
    if (!chapter) throw new Error(`Row ${i + 1}: missing chapter label`);
    if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd) || pageStart > pageEnd) {
      throw new Error(`Row ${i + 1}: invalid page range ${row.pageStart}–${row.pageEnd}`);
    }
    return { chapter, pageStart, pageEnd };
  });
}

/** Page used to assign chapter: midpoint of chunk span, else pageStart. */
export function chapterForPage(
  page: number,
  ranges: ChapterPageRange[],
): string | null {
  for (const r of ranges) {
    if (page >= r.pageStart && page <= r.pageEnd) return r.chapter;
  }
  return null;
}

export function chapterForChunkPages(
  pageStart: number | null | undefined,
  pageEnd: number | null | undefined,
  ranges: ChapterPageRange[],
): string | null {
  if (pageStart == null && pageEnd == null) return null;
  const a = pageStart ?? pageEnd!;
  const b = pageEnd ?? pageStart!;
  const mid = Math.floor((Math.min(a, b) + Math.max(a, b)) / 2);
  return chapterForPage(mid, ranges) ?? chapterForPage(a, ranges) ?? chapterForPage(b, ranges);
}

async function main(): Promise<void> {
  const mapPath = arg("map");
  if (!mapPath) {
    console.error("Usage: --map <chapters.json> and (--subject + --form) or --textbookId");
    process.exit(1);
  }

  const ranges = loadChapterMap(join(process.cwd(), mapPath));
  const dryRun = flag("dry-run");
  const subject = arg("subject");
  const form = arg("form");
  const textbookId = arg("textbookId");

  const { ragDb, ragTextbookChunksTable, ragTextbooksTable } = await import("../src/lib/ragDb");

  const [textbook] = await ragDb
    .select()
    .from(ragTextbooksTable)
    .where(
      textbookId
        ? eq(ragTextbooksTable.textbookId, textbookId)
        : and(eq(ragTextbooksTable.subject, subject!), eq(ragTextbooksTable.form, form!)),
    )
    .limit(1);

  if (!textbook) {
    throw new Error(textbookId ? `Textbook not found: ${textbookId}` : `No textbook for ${subject} / ${form}`);
  }

  const chunks = await ragDb
    .select({
      id: ragTextbookChunksTable.id,
      chunkId: ragTextbookChunksTable.chunkId,
      chunkIndex: ragTextbookChunksTable.chunkIndex,
      chapter: ragTextbookChunksTable.chapter,
      pageStart: ragTextbookChunksTable.pageStart,
      pageEnd: ragTextbookChunksTable.pageEnd,
    })
    .from(ragTextbookChunksTable)
    .where(eq(ragTextbookChunksTable.textbookDbId, textbook.id))
    .orderBy(asc(ragTextbookChunksTable.chunkIndex));

  let updated = 0;
  let unchanged = 0;
  let unmapped = 0;
  const unmappedSamples: Array<{ chunkId: string; pages: string; oldChapter: string }> = [];

  for (const chunk of chunks) {
    const next = chapterForChunkPages(chunk.pageStart, chunk.pageEnd, ranges);
    if (!next) {
      unmapped += 1;
      if (unmappedSamples.length < 8) {
        unmappedSamples.push({
          chunkId: chunk.chunkId,
          pages: `${chunk.pageStart ?? "?"}–${chunk.pageEnd ?? "?"}`,
          oldChapter: chunk.chapter ?? "",
        });
      }
      continue;
    }
    if (chunk.chapter === next) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (!dryRun) {
      await ragDb
        .update(ragTextbookChunksTable)
        .set({ chapter: next })
        .where(eq(ragTextbookChunksTable.id, chunk.id));
    }
  }

  const byChapter = new Map<string, number>();
  for (const chunk of chunks) {
    const ch =
      chapterForChunkPages(chunk.pageStart, chunk.pageEnd, ranges) ?? chunk.chapter ?? "(unmapped)";
    byChapter.set(ch, (byChapter.get(ch) ?? 0) + 1);
  }

  console.log(`${textbook.subject} ${textbook.form} | ${textbook.title} | textbookId=${textbook.textbookId}`);
  console.log(dryRun ? "[dry-run] no database writes" : "Applied chapter labels.");
  console.log(`chunks=${chunks.length} updated=${updated} unchanged=${unchanged} unmapped=${unmapped}`);
  console.log("\nDistribution after map:");
  for (const [ch, n] of [...byChapter.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${n}\t${ch}`);
  }
  if (unmappedSamples.length > 0) {
    console.log("\nUnmapped samples (outside your page ranges):");
    for (const s of unmappedSamples) {
      console.log(`  ${s.chunkId} pages ${s.pages} was "${s.oldChapter}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
