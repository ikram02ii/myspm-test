import { randomUUID } from "node:crypto";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable, ragTextbookChunksTable, ragTextbooksTable } from "../../lib/ragDb";
import {
  buildPageChunkContent,
  extractPdfPagesHybrid,
  type HybridPdfPageResult,
} from "./hybridPdfIngest";

export type IngestTextbookHybridInput = {
  pdfPath: string;
  subject: string;
  form: string;
  title: string;
  sourceName?: string;
  maxPages?: number;
  uploadToOss?: boolean;
};

export type IngestPastPaperHybridInput = IngestTextbookHybridInput & {
  paperId?: string;
  year?: number | null;
  paperLabel?: string | null;
};

export type HybridIngestResult = {
  documentId: string;
  dbId: number;
  chunkCount: number;
  pages: HybridPdfPageResult[];
  visionPageNumbers: number[];
  textPageNumbers: number[];
};

export async function ingestTextbookPdfHybridToRagDb(
  input: IngestTextbookHybridInput,
): Promise<HybridIngestResult> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const sourceName = input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || null;

  if (!subject || !form || !title) {
    throw new Error("subject, form, and title are required");
  }

  const pages = await extractPdfPagesHybrid({
    pdfPath: input.pdfPath,
    originalName: sourceName,
    maxPages: input.maxPages,
    uploadToOss: input.uploadToOss,
    ossFolder: "myspm/rag/textbooks/hybrid",
  });

  const externalTextbookId = `tb-hybrid-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const inserted = await ragDb!
    .insert(ragTextbooksTable)
    .values({
      textbookId: externalTextbookId,
      subject,
      form,
      title,
      sourceName,
      chunkSizeChars: 0,
      overlapChars: 0,
      createdByUserId: null,
    })
    .returning({ id: ragTextbooksTable.id });

  const textbookDbId = inserted[0]?.id;
  if (!textbookDbId) throw new Error("Failed to create textbook record");

  await ragDb!.insert(ragTextbookChunksTable).values(
    pages.map((page, index) => ({
      textbookDbId,
      chunkId: `hybrid-p${page.pageNumber}`,
      chunkIndex: index,
      conceptTitle: `${title} — page ${page.pageNumber}`,
      conceptSummary: `Hybrid ingest (${page.route}): SPM ${subject} page ${page.pageNumber}.`,
      keywords: subject,
      chapter: null,
      sourceName,
      pageStart: page.pageNumber,
      pageEnd: page.pageNumber,
      isComplete: true,
      sourceImageUrl: page.ossUrl,
      embedding: page.embedding ? JSON.stringify(page.embedding) : null,
      chunkKind: page.route === "vision" ? "hybrid_vision" : "hybrid_text",
      content: buildPageChunkContent({
        meta: { subject, title, docKind: "textbook" },
        page,
      }),
    })),
  );

  return {
    documentId: externalTextbookId,
    dbId: textbookDbId,
    chunkCount: pages.length,
    pages,
    visionPageNumbers: pages.filter((p) => p.route === "vision").map((p) => p.pageNumber),
    textPageNumbers: pages.filter((p) => p.route === "text").map((p) => p.pageNumber),
  };
}

export async function ingestPastPaperPdfHybridToRagDb(
  input: IngestPastPaperHybridInput,
): Promise<HybridIngestResult> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const sourceName = input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || null;

  if (!subject || !form || !title) {
    throw new Error("subject, form, and title are required");
  }

  const pages = await extractPdfPagesHybrid({
    pdfPath: input.pdfPath,
    originalName: sourceName,
    maxPages: input.maxPages,
    uploadToOss: input.uploadToOss,
    ossFolder: "myspm/rag/past-papers/hybrid",
  });

  const externalPaperId = input.paperId?.trim() || `pp-hybrid-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const insertedPaper = await ragDb!
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

  await ragDb!.insert(ragPastPaperChunksTable).values(
    pages.map((page, index) => ({
      pastPaperDbId,
      chunkId: `hybrid-p${page.pageNumber}`,
      chunkIndex: index,
      questionRef: `Page ${page.pageNumber}`,
      conceptTitle: `${title} — page ${page.pageNumber}`,
      conceptSummary: `Hybrid ingest (${page.route}) for page ${page.pageNumber}.`,
      keywords: subject,
      maxMarks: null,
      pageStart: page.pageNumber,
      pageEnd: page.pageNumber,
      sourceImageUrl: page.ossUrl,
      embedding: page.embedding ? JSON.stringify(page.embedding) : null,
      chunkKind: page.route === "vision" ? "hybrid_vision" : "hybrid_text",
      content: buildPageChunkContent({
        meta: { subject, title, docKind: "past_paper" },
        page,
      }),
    })),
  );

  return {
    documentId: externalPaperId,
    dbId: pastPaperDbId,
    chunkCount: pages.length,
    pages,
    visionPageNumbers: pages.filter((p) => p.route === "vision").map((p) => p.pageNumber),
    textPageNumbers: pages.filter((p) => p.route === "text").map((p) => p.pageNumber),
  };
}
