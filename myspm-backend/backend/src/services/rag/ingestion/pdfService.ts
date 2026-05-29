import { PDFParse } from "pdf-parse";
import { cleanText } from "./chunking";

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
