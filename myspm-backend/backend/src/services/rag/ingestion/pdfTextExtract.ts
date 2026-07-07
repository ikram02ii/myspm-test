import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { configurePdfJsForNode } from "../../ai gen/pdfJsNodeSetup";

export type PdfPage = { pageNumber: number; text: string };

export function cleanText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function parsePdfBufferToPages(pdfBuffer: Buffer): Promise<PdfPage[]> {
  if (pdfBuffer.length === 0) throw new Error("PDF buffer is empty");

  configurePdfJsForNode();
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    const pagesRaw = Array.isArray((result as any).pages) ? ((result as any).pages as Array<any>) : [];
    if (pagesRaw.length === 0) return [{ pageNumber: 1, text: cleanText(result.text ?? "") }];

    return pagesRaw
      .map((page) => ({
        pageNumber: Number(page?.num ?? 0),
        text: cleanText(String(page?.text ?? "")),
      }))
      .filter((page) => page.pageNumber > 0);
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfPages(pdfPath: string): Promise<PdfPage[]> {
  if (!pdfPath || !pdfPath.trim()) throw new Error("pdfPath is required");
  const pdfBuffer = await readFile(pdfPath);
  return parsePdfBufferToPages(pdfBuffer);
}

export async function extractPdfPagesFromBuffer(pdfBuffer: Buffer): Promise<PdfPage[]> {
  return parsePdfBufferToPages(pdfBuffer);
}

export async function extractPdfText(pdfPath: string): Promise<string> {
  const pages = await extractPdfPages(pdfPath);
  return pages.map((page) => page.text).join("\n\n");
}

/** Extract full text from an in-memory PDF (API uploads). */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Missing PDF buffer");
  }

  configurePdfJsForNode();
  const parser = new PDFParse({ data: buffer });
  let parsedText = "";
  try {
    const parsed = await parser.getText();
    parsedText = parsed.text ?? "";
  } finally {
    await parser.destroy();
  }

  const cleaned = cleanText(parsedText);
  if (!cleaned) {
    throw new Error("PDF extraction produced empty text");
  }
  return cleaned;
}
