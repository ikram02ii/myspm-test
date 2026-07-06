import { asc, eq, inArray } from "drizzle-orm";
import { ragDb, ragTbChunksTable, ragTbTable } from "../../../lib/ragDb";
import { isLowQualityChunk } from "../retrieval/retrievalService";
import {
  type ChapterPageRange,
  chapterRangeForPage,
  cleanTranscribedPageContent,
  isModerationBlockedContent,
} from "./textbookChapterMap";

type PageRow = {
  id: number;
  chunkId: string;
  chunkIndex: number;
  chapterNo: number | null;
  chapter: string | null;
  conceptTitle: string | null;
  conceptSummary: string | null;
  keywords: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  hasFigure: boolean;
  figures: string | null;
  tables: string | null;
  pageImagePath: string | null;
  contentType: string | null;
  isComplete: boolean | null;
};

export type FixVlTbPageChunksResult = {
  tbId: string;
  tbDbId: number;
  beforeCount: number;
  splitFromChapters: number;
  updated: number;
  deletedNoise: number;
  deletedDuplicates: number;
  afterCount: number;
};

function buildPageSearchContent(chapter: string, body: string, conceptTitle?: string | null): string {
  const lines = [
    `Chapter: ${chapter}`,
    conceptTitle ? `Topic: ${conceptTitle}` : null,
    "",
    body,
  ].filter((line): line is string => line !== null);
  return lines.join("\n").trim();
}

function dedupePagesByNumber(rows: PageRow[]): { kept: PageRow[]; duplicateIds: number[] } {
  const byPage = new Map<number, PageRow>();
  const duplicateIds: number[] = [];
  for (const row of rows) {
    const page = row.pageStart;
    if (page == null) continue;
    const prev = byPage.get(page);
    if (!prev) {
      byPage.set(page, row);
      continue;
    }
    if (row.id > prev.id) {
      duplicateIds.push(prev.id);
      byPage.set(page, row);
    } else {
      duplicateIds.push(row.id);
    }
  }
  return { kept: [...byPage.values()].sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0)), duplicateIds };
}

function isNoisePage(row: PageRow, ranges: ChapterPageRange[]): boolean {
  const page = row.pageStart;
  if (page == null) return true;
  if (!chapterRangeForPage(page, ranges)) return true;
  if (isModerationBlockedContent(row.content)) return true;
  if (row.isComplete === false) return true;
  const body = cleanTranscribedPageContent(
    row.content.replace(/^Chapter:[^\n]*\n?/m, "").replace(/^Topic:[^\n]*\n?/m, "").trim(),
  );
  if (body.length < 80) return true;
  if (isLowQualityChunk(row.content)) return true;
  return false;
}

/** Recover page chunks from merged vl-chapter-* rows (uses `--- Page N ---` markers). */
function parsePagesFromMergedChapterContent(
  content: string,
  chapter: ChapterPageRange,
): Array<{ pageNumber: number; body: string }> {
  const pages: Array<{ pageNumber: number; body: string }> = [];
  const parts = content.split(/(?=--- Page \d+ ---)/);
  for (const part of parts) {
    const header = part.match(/^--- Page (\d+) ---\s*/);
    if (!header) continue;
    const pageNumber = Number(header[1]);
    if (!Number.isFinite(pageNumber)) continue;
    let body = part.slice(header[0].length).trim();
    const cut = body.search(/\n\[(TABLES|FIGURES)\]/);
    if (cut >= 0) body = body.slice(0, cut).trim();
    if (body) pages.push({ pageNumber, body });
  }
  if (pages.length === 0 && chapter.pageStart === chapter.pageEnd) {
    const body = cleanTranscribedPageContent(content);
    if (body.length >= 80) pages.push({ pageNumber: chapter.pageStart, body });
  }
  return pages;
}

async function splitChapterChunksToPages(
  tbDbId: number,
  chapterRows: PageRow[],
  ranges: ChapterPageRange[],
  dryRun: boolean,
): Promise<number> {
  if (chapterRows.length === 0) return 0;

  const inserts: Array<typeof ragTbChunksTable.$inferInsert> = [];
  for (const row of chapterRows) {
    const chNo = row.chapterNo ?? 0;
    const chapter = ranges.find((r) => r.chapterNo === chNo);
    if (!chapter) continue;
    const parsed = parsePagesFromMergedChapterContent(row.content, chapter);
    for (const { pageNumber, body } of parsed) {
      const cleaned = cleanTranscribedPageContent(body);
      if (cleaned.length < 80) continue;
      inserts.push({
        tbDbId,
        chunkId: `vl-page-${pageNumber}`,
        chunkIndex: pageNumber - 1,
        chapterNo: chapter.chapterNo,
        chapter: chapter.chapter,
        conceptTitle: `${chapter.chapter} — page ${pageNumber}`,
        conceptSummary: `Vision extraction page ${pageNumber}.`,
        keywords: "Biology",
        pageStart: pageNumber,
        pageEnd: pageNumber,
        content: buildPageSearchContent(chapter.chapter, cleaned, `${chapter.chapter} — page ${pageNumber}`),
        hasFigure: row.hasFigure,
        figures: null,
        tables: null,
        pageImagePath: row.pageImagePath,
        contentType: row.contentType ?? "text",
        isComplete: true,
      });
    }
  }

  if (!dryRun) {
    const deleteIds = chapterRows.map((r) => r.id);
    if (deleteIds.length > 0) {
      await ragDb!.delete(ragTbChunksTable).where(inArray(ragTbChunksTable.id, deleteIds));
    }
    if (inserts.length > 0) {
      await ragDb!.insert(ragTbChunksTable).values(inserts);
    }
  }
  return inserts.length;
}

/**
 * Fix VL page chunks only: correct chapter labels from page map, clean content, drop noise.
 * Does NOT merge pages into chapter blobs.
 */
export async function fixVlTbPageChunks(params: {
  tbId: string;
  ranges: ChapterPageRange[];
  dryRun?: boolean;
}): Promise<FixVlTbPageChunksResult> {
  if (!ragDb) throw new Error("RAG database is not configured");

  const [book] = await ragDb
    .select({ id: ragTbTable.id, tbId: ragTbTable.tbId })
    .from(ragTbTable)
    .where(eq(ragTbTable.tbId, params.tbId))
    .limit(1);
  if (!book) throw new Error(`VL textbook not found: ${params.tbId}`);

  let allRows = await ragDb
    .select({
      id: ragTbChunksTable.id,
      chunkId: ragTbChunksTable.chunkId,
      chunkIndex: ragTbChunksTable.chunkIndex,
      chapterNo: ragTbChunksTable.chapterNo,
      chapter: ragTbChunksTable.chapter,
      conceptTitle: ragTbChunksTable.conceptTitle,
      conceptSummary: ragTbChunksTable.conceptSummary,
      keywords: ragTbChunksTable.keywords,
      pageStart: ragTbChunksTable.pageStart,
      pageEnd: ragTbChunksTable.pageEnd,
      content: ragTbChunksTable.content,
      hasFigure: ragTbChunksTable.hasFigure,
      figures: ragTbChunksTable.figures,
      tables: ragTbChunksTable.tables,
      pageImagePath: ragTbChunksTable.pageImagePath,
      contentType: ragTbChunksTable.contentType,
      isComplete: ragTbChunksTable.isComplete,
    })
    .from(ragTbChunksTable)
    .where(eq(ragTbChunksTable.tbDbId, book.id))
    .orderBy(asc(ragTbChunksTable.pageStart), asc(ragTbChunksTable.id));

  const beforeCount = allRows.length;
  let splitFromChapters = 0;

  const chapterRows = allRows.filter((r) => r.chunkId.startsWith("vl-chapter-"));
  if (chapterRows.length > 0) {
    splitFromChapters = await splitChapterChunksToPages(book.id, chapterRows, params.ranges, Boolean(params.dryRun));
    if (!params.dryRun) {
      allRows = await ragDb
        .select({
          id: ragTbChunksTable.id,
          chunkId: ragTbChunksTable.chunkId,
          chunkIndex: ragTbChunksTable.chunkIndex,
          chapterNo: ragTbChunksTable.chapterNo,
          chapter: ragTbChunksTable.chapter,
          conceptTitle: ragTbChunksTable.conceptTitle,
          conceptSummary: ragTbChunksTable.conceptSummary,
          keywords: ragTbChunksTable.keywords,
          pageStart: ragTbChunksTable.pageStart,
          pageEnd: ragTbChunksTable.pageEnd,
          content: ragTbChunksTable.content,
          hasFigure: ragTbChunksTable.hasFigure,
          figures: ragTbChunksTable.figures,
          tables: ragTbChunksTable.tables,
          pageImagePath: ragTbChunksTable.pageImagePath,
          contentType: ragTbChunksTable.contentType,
          isComplete: ragTbChunksTable.isComplete,
        })
        .from(ragTbChunksTable)
        .where(eq(ragTbChunksTable.tbDbId, book.id))
        .orderBy(asc(ragTbChunksTable.pageStart), asc(ragTbChunksTable.id));
    }
  }

  const { kept, duplicateIds } = dedupePagesByNumber(allRows);
  const noiseIds: number[] = [];
  let updated = 0;

  for (const row of kept) {
    const page = row.pageStart;
    if (page == null) {
      noiseIds.push(row.id);
      continue;
    }
    const chapter = chapterRangeForPage(page, params.ranges);
    if (!chapter) {
      noiseIds.push(row.id);
      continue;
    }
    if (isNoisePage(row, params.ranges)) {
      noiseIds.push(row.id);
      continue;
    }

    const rawBody = row.content
      .replace(/^Chapter:[^\n]*\n?/gm, "")
      .replace(/^Topic:[^\n]*\n?/gm, "")
      .replace(/^Section:[^\n]*\n?/gm, "")
      .trim();
    const cleanedBody = cleanTranscribedPageContent(rawBody);
    const nextContent = buildPageSearchContent(
      chapter.chapter,
      cleanedBody,
      row.conceptTitle ?? `${chapter.chapter} — page ${page}`,
    );
    const needsUpdate =
      row.chapter !== chapter.chapter ||
      row.chapterNo !== chapter.chapterNo ||
      row.content !== nextContent;

    if (needsUpdate) {
      updated += 1;
      if (!params.dryRun) {
        await ragDb
          .update(ragTbChunksTable)
          .set({
            chapter: chapter.chapter,
            chapterNo: chapter.chapterNo,
            content: nextContent,
            isComplete: true,
          })
          .where(eq(ragTbChunksTable.id, row.id));
      }
    }
  }

  const deleteIds = [...new Set([...duplicateIds, ...noiseIds])];
  if (!params.dryRun && deleteIds.length > 0) {
    await ragDb.delete(ragTbChunksTable).where(inArray(ragTbChunksTable.id, deleteIds));
  }

  const afterCount = params.dryRun
    ? kept.length - noiseIds.length
    : (
        await ragDb
          .select({ id: ragTbChunksTable.id })
          .from(ragTbChunksTable)
          .where(eq(ragTbChunksTable.tbDbId, book.id))
      ).length;

  return {
    tbId: book.tbId,
    tbDbId: book.id,
    beforeCount,
    splitFromChapters,
    updated,
    deletedNoise: noiseIds.length,
    deletedDuplicates: duplicateIds.length,
    afterCount,
  };
}
