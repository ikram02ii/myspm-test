import { readFile } from "node:fs/promises";
import { compressImageForVision, resolveVisionPdfRenderScale } from "./compressImageForVision";
import {
  classifyAllPagesFromText,
  refineBorderlineClassificationWithVlm,
  type PageClassification,
  type PageExtractionRoute,
} from "./pageVisionClassifier";
import { renderPdfPageToPng } from "./pdfToPngPages";
import { extractPdfPages, extractPdfPagesFromBuffer } from "../ama/ingestion/pdfTextExtract";
import { embedText } from "../ama/retrieval/embeddingsService";
import {
  qwenVisionExtractPage,
  uploadPageImageToOss,
} from "./visionPdfExtract";

export type HybridPdfPageResult = {
  pageNumber: number;
  route: PageExtractionRoute;
  extractedText: string;
  ossKey: string | null;
  ossUrl: string | null;
  classification: PageClassification;
  embedding: number[] | null;
};

export type HybridPdfIngestInput = {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  originalName?: string | null;
  maxPages?: number;
  uploadToOss?: boolean;
  /** OSS key prefix folder, e.g. myspm/rag/textbooks/hybrid */
  ossFolder?: string;
  /** Run VLM classifier on borderline pages (heuristic score === 1). Default true. */
  vlmRefineBorderline?: boolean;
  /** Compute embeddings for each page chunk. Default true. */
  embedChunks?: boolean;
};

function buildPageChunkContent(params: {
  meta: { subject: string; title: string; docKind: "textbook" | "past_paper" };
  page: HybridPdfPageResult;
}): string {
  return [
    params.meta.docKind === "textbook" ? "[TEXTBOOK PAGE]" : "[PAST PAPER PAGE]",
    `Subject: ${params.meta.subject}`,
    `Title: ${params.meta.title}`,
    `Page: ${params.page.pageNumber}`,
    `Extraction route: ${params.page.route}`,
    params.page.ossUrl ? `Source image: ${params.page.ossUrl}` : null,
    `Classifier: ${params.page.classification.reasons.join("; ")}`,
    "",
    params.page.extractedText,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function extractVisionPage(params: {
  pdfBuffer: Buffer;
  pageNumber: number;
  uploadToOss: boolean;
  originalStem: string;
  ossFolder: string;
}): Promise<{ text: string; ossKey: string | null; ossUrl: string | null }> {
  const scale = resolveVisionPdfRenderScale();
  const rendered = await renderPdfPageToPng(params.pdfBuffer, params.pageNumber, { scale });
  const { buffer: image, mime } = await compressImageForVision(rendered);

  let ossKey: string | null = null;
  let ossUrl: string | null = null;
  if (params.uploadToOss) {
    const uploaded = await uploadPageImageToOss(
      image,
      mime,
      params.pageNumber,
      params.originalStem,
      params.ossFolder,
    );
    ossKey = uploaded.key;
    ossUrl = uploaded.url;
  }

  const text = await qwenVisionExtractPage({
    image,
    mime,
    pageNumber: params.pageNumber,
  });

  return { text, ossKey, ossUrl };
}

/**
 * 1) pdf-parse text per page → classify text vs vision
 * 2) Optional VLM refine on borderline pages
 * 3) Vision route: render PNG → OSS → Qwen VL full extract
 * 4) Text route: keep pdf-parse text
 * 5) Optional embeddings per page
 */
export async function extractPdfPagesHybrid(
  input: HybridPdfIngestInput,
): Promise<HybridPdfPageResult[]> {
  const buffer =
    input.pdfBuffer ?? (input.pdfPath ? await readFile(input.pdfPath) : null);
  if (!buffer?.length) {
    throw new Error("Provide pdfPath or pdfBuffer");
  }

  const stem =
    (input.originalName ?? input.pdfPath ?? "document").split(/[\\/]/).pop() || "document";
  const maxPages = input.maxPages ?? 200;
  const uploadToOss = input.uploadToOss !== false;
  const ossFolder = input.ossFolder?.trim() || "myspm/rag/hybrid";
  const vlmRefineBorderline = input.vlmRefineBorderline !== false;
  const embedChunks = input.embedChunks !== false;

  const textPages = input.pdfPath
    ? await extractPdfPages(input.pdfPath)
    : await extractPdfPagesFromBuffer(buffer);
  const limited = textPages.filter((p) => p.pageNumber <= maxPages);
  if (limited.length === 0) {
    throw new Error("No text pages extracted from PDF");
  }

  let classifications = classifyAllPagesFromText(limited);

  if (vlmRefineBorderline) {
    const refined: PageClassification[] = [];
    for (const c of classifications) {
      const forceVlm = process.env["RAG_HYBRID_VLM_CLASSIFY_ALL"] === "true";
      if (c.heuristicScore !== 1 && !forceVlm) {
        refined.push(c);
        continue;
      }
      const scale = resolveVisionPdfRenderScale();
      const png = await renderPdfPageToPng(buffer, c.pageNumber, { scale });
      refined.push(
        await refineBorderlineClassificationWithVlm({
          pageNumber: c.pageNumber,
          classification: c,
          pagePng: png,
        }),
      );
    }
    classifications = refined;
  }

  const textByPage = new Map(limited.map((p) => [p.pageNumber, p.text]));
  const results: HybridPdfPageResult[] = [];

  for (const classification of classifications) {
    const pageNumber = classification.pageNumber;
    let extractedText = textByPage.get(pageNumber)?.trim() ?? "";
    let ossKey: string | null = null;
    let ossUrl: string | null = null;

    if (classification.route === "vision") {
      const vision = await extractVisionPage({
        pdfBuffer: buffer,
        pageNumber,
        uploadToOss,
        originalStem: stem,
        ossFolder,
      });
      extractedText = vision.text;
      ossKey = vision.ossKey;
      ossUrl = vision.ossUrl;
    }

    if (!extractedText.trim()) {
      console.warn("[hybrid-pdf] empty page text", { pageNumber, route: classification.route });
      continue;
    }

    let embedding: number[] | null = null;
    if (embedChunks) {
      try {
        embedding = await embedText(extractedText.slice(0, 6000));
      } catch (err) {
        console.warn("[hybrid-pdf] embedding failed", {
          pageNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    results.push({
      pageNumber,
      route: classification.route,
      extractedText,
      ossKey,
      ossUrl,
      classification,
      embedding,
    });
  }

  console.info("[hybrid-pdf] completed", {
    totalPages: limited.length,
    visionPages: results.filter((r) => r.route === "vision").length,
    textPages: results.filter((r) => r.route === "text").length,
  });

  return results;
}

export { buildPageChunkContent };
