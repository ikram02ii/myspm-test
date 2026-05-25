import { randomUUID } from "node:crypto";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable } from "../../lib/ragDb";
import {
  buildVisionPageChunkContent,
  extractAllPagesFromPdfWithVision,
  type VisionPdfPageResult,
} from "./visionPdfExtract";

export type IngestPastPaperViaVisionInput = {
  pdfPath: string;
  subject: string;
  form: string;
  title: string;
  paperId?: string;
  year?: number | null;
  paperLabel?: string | null;
  sourceName?: string;
  maxPages?: number;
  uploadToOss?: boolean;
};

export type IngestPastPaperViaVisionResult = {
  paperId: string;
  pastPaperDbId: number;
  chunkCount: number;
  pages: VisionPdfPageResult[];
};

/**
 * PDF on disk → render each page → Qwen VL per page → one RAG chunk per page.
 */
export async function ingestPastPaperPdfViaVisionToRagDb(
  input: IngestPastPaperViaVisionInput,
): Promise<IngestPastPaperViaVisionResult> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const sourceName = input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || null;

  if (!subject || !form || !title) {
    throw new Error("subject, form, and title are required");
  }

  if (!ragDb) throw new Error("RAG database is not configured");

  const pages = await extractAllPagesFromPdfWithVision({
    pdfPath: input.pdfPath,
    originalName: sourceName,
    maxPages: input.maxPages,
    uploadToOss: input.uploadToOss,
  });

  const externalPaperId = input.paperId?.trim() || `pp-vl-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const insertedPaper = await ragDb
    .insert(ragPastPapersTable)
    .values({
      paperId: externalPaperId,
      subject,
      form,
      year: input.year ?? null,
      paperLabel: input.paperLabel?.trim() || null,
      title,
      sourceName,
    })
    .returning({ id: ragPastPapersTable.id });

  const pastPaperDbId = insertedPaper[0]?.id;
  if (!pastPaperDbId) throw new Error("Failed to create past paper record");

  await ragDb.insert(ragPastPaperChunksTable).values(
    pages.map((page, index) => ({
      pastPaperDbId,
      chunkId: `vl-page-${page.pageNumber}`,
      chunkIndex: index,
      questionRef: `Page ${page.pageNumber}`,
      conceptTitle: `${title} — page ${page.pageNumber}`,
      conceptSummary: `Vision extraction (text + diagram descriptions) for SPM past paper page ${page.pageNumber}.`,
      keywords: subject,
      maxMarks: null,
      content: buildVisionPageChunkContent(page, { subject, title }),
    })),
  );

  console.info("[rag][past-paper-vision] ingested", {
    paperId: externalPaperId,
    pastPaperDbId,
    chunkCount: pages.length,
  });

  return {
    paperId: externalPaperId,
    pastPaperDbId,
    chunkCount: pages.length,
    pages,
  };
}
