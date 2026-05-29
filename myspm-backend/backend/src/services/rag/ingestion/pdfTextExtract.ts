import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export type PdfPage = { pageNumber: number; text: string };

export function cleanText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractPdfPages(pdfPath: string): Promise<PdfPage[]> {
  if (!pdfPath || !pdfPath.trim()) throw new Error("pdfPath is required");
  const pdfBuffer = await readFile(pdfPath);
  if (pdfBuffer.length === 0) throw new Error("PDF file is empty");

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
      .filter((page) => page.text.length > 0);
  } finally {
    await parser.destroy();
  }
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
