import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { ragDb, ragTbChunksTable, ragTbTable } from "../../../lib/ragDb";
import {
  buildTextbookChunkSearchContent,
  processTextbookPdfPagesWithVision,
  resolveTextbookVisionModel,
  type TextbookVisionPageExtraction,
} from "./textbookVisionExtract";
import {
  type ChapterPageRange,
  chapterLabelForPage,
  chapterNoForPage,
  loadChapterPageMap,
} from "./textbookChapterMap";

export type IngestTextbookViaVisionInput = {
  pdfPath: string;
  subject: string;
  form: string;
  title: string;
  tbId?: string;
  sourceName?: string;
  language?: string;
  startPage?: number;
  endPage?: number;
  maxPages?: number;
  uploadToOss?: boolean;
  /** JSON file with chapter page ranges — overrides vision-detected chapter labels. */
  chapterPageMapPath?: string;
};

export type IngestTextbookViaVisionResult = {
  tbId: string;
  tbDbId: number;
  chunkCount: number;
  totalPages: number;
  visionModel: string;
  pages: TextbookVisionPageExtraction[];
};

type ChapterState = {
  chapterNo: number | null;
  chapter: string | null;
};

function applyChapterFromPageMap(
  page: TextbookVisionPageExtraction,
  ranges: ChapterPageRange[],
): TextbookVisionPageExtraction {
  const chapter = chapterLabelForPage(page.pageNumber, ranges);
  const chapterNo = chapterNoForPage(page.pageNumber, ranges);
  if (!chapter && chapterNo == null) return page;
  return {
    ...page,
    chapter: chapter ?? page.chapter,
    chapterNo: chapterNo ?? page.chapterNo,
  };
}

function applyChapterCarryForward(
  page: TextbookVisionPageExtraction,
  state: ChapterState,
): TextbookVisionPageExtraction {
  if (page.chapterNo != null) state.chapterNo = page.chapterNo;
  if (page.chapter) state.chapter = page.chapter;

  let chapterNo = page.chapterNo;
  let chapter = page.chapter;
  if (chapterNo == null && state.chapterNo != null) chapterNo = state.chapterNo;
  if (!chapter && state.chapter) chapter = state.chapter;

  if (chapterNo === page.chapterNo && chapter === page.chapter) return page;
  return { ...page, chapterNo, chapter };
}

function chunkRowFromPage(tbDbId: number, page: TextbookVisionPageExtraction, subject: string) {
  return {
    tbDbId,
    chunkId: `vl-page-${page.pageNumber}`,
    chunkIndex: page.pageNumber - 1,
    chapterNo: page.chapterNo,
    chapter: page.chapter,
    conceptTitle:
      page.conceptTitle ??
      (page.chapter ? `${page.chapter} — page ${page.pageNumber}` : `Page ${page.pageNumber}`),
    conceptSummary: page.conceptTitle
      ? `Vision extraction for ${page.conceptTitle} (page ${page.pageNumber}).`
      : `Vision extraction for textbook page ${page.pageNumber}.`,
    keywords: page.keywords.length > 0 ? page.keywords.join(", ") : subject,
    pageStart: page.pageNumber,
    pageEnd: page.pageNumber,
    content: buildTextbookChunkSearchContent(page),
    hasFigure: page.hasFigure,
    figures: page.figures.length > 0 ? JSON.stringify(page.figures) : null,
    tables: page.tables.length > 0 ? JSON.stringify(page.tables) : null,
    pageImagePath: page.pageImagePath,
    contentType: page.contentType,
    isComplete: !page.extractionBlocked,
  };
}

/**
 * PDF on disk → render each page → qwen-vl-max per page → rag_tb / rag_tb_chunks.
 * Writes one DB row per page so a mid-run failure does not lose prior pages.
 */
export async function ingestTextbookPdfViaVisionToRagDb(
  input: IngestTextbookViaVisionInput,
): Promise<IngestTextbookViaVisionResult> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const sourceName = input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || null;
  const visionModel = resolveTextbookVisionModel();
  const startPage = Math.max(1, input.startPage ?? 1);
  const chapterRanges = input.chapterPageMapPath?.trim()
    ? loadChapterPageMap(input.chapterPageMapPath.trim())
    : null;

  if (!subject || !form || !title) {
    throw new Error("subject, form, and title are required");
  }

  if (!ragDb) throw new Error("RAG database is not configured");

  const externalTbId = input.tbId?.trim() || `tb-vl-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const existing = await ragDb
    .select({ id: ragTbTable.id })
    .from(ragTbTable)
    .where(eq(ragTbTable.tbId, externalTbId))
    .limit(1);

  let tbDbId: number;
  if (existing[0]?.id) {
    tbDbId = existing[0].id;
    await ragDb
      .delete(ragTbChunksTable)
      .where(and(eq(ragTbChunksTable.tbDbId, tbDbId), gte(ragTbChunksTable.pageStart, startPage)));
    console.info("[rag][textbook-vision] resuming", { tbId: externalTbId, tbDbId, startPage });
  } else {
    const insertedTb = await ragDb
      .insert(ragTbTable)
      .values({
        tbId: externalTbId,
        subject,
        form,
        title,
        sourceName,
        ingestMethod: "vision",
        visionModel,
        totalPages: null,
        language: input.language?.trim() || "en",
      })
      .returning({ id: ragTbTable.id });
    tbDbId = insertedTb[0]?.id ?? 0;
    if (!tbDbId) throw new Error("Failed to create textbook record");
  }

  const chapterState: ChapterState = { chapterNo: null, chapter: null };
  if (startPage > 1) {
    const prev = await ragDb
      .select({
        chapterNo: ragTbChunksTable.chapterNo,
        chapter: ragTbChunksTable.chapter,
      })
      .from(ragTbChunksTable)
      .where(
        and(eq(ragTbChunksTable.tbDbId, tbDbId), eq(ragTbChunksTable.pageStart, startPage - 1)),
      )
      .limit(1);
    if (prev[0]) {
      chapterState.chapterNo = prev[0].chapterNo;
      chapterState.chapter = prev[0].chapter;
    }
  }

  const processed: TextbookVisionPageExtraction[] = [];

  const { totalPages } = await processTextbookPdfPagesWithVision({
    pdfPath: input.pdfPath,
    originalName: sourceName,
    startPage,
    endPage: input.endPage,
    maxPages: input.maxPages,
    uploadToOss: input.uploadToOss,
    onPage: async (rawPage) => {
      const withChapter = chapterRanges
        ? applyChapterFromPageMap(rawPage, chapterRanges)
        : applyChapterCarryForward(rawPage, chapterState);
      const page = withChapter;
      await ragDb.insert(ragTbChunksTable).values(chunkRowFromPage(tbDbId, page, subject));
      processed.push(page);
    },
  });

  await ragDb
    .update(ragTbTable)
    .set({ totalPages, visionModel, title, sourceName })
    .where(eq(ragTbTable.id, tbDbId));

  const countRow = await ragDb
    .select({ n: ragTbChunksTable.id })
    .from(ragTbChunksTable)
    .where(eq(ragTbChunksTable.tbDbId, tbDbId));

  console.info("[rag][textbook-vision] ingested", {
    tbId: externalTbId,
    tbDbId,
    chunkCount: countRow.length,
    visionModel,
    startPage,
    totalPages,
  });

  return {
    tbId: externalTbId,
    tbDbId,
    chunkCount: countRow.length,
    totalPages,
    visionModel,
    pages: processed,
  };
}
