import { createCanvas } from "@napi-rs/canvas/node-canvas.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const PNG_MIME = "image/png";

export async function renderPdfBufferToPngPages(
  pdfBuffer: Buffer,
  opts?: { maxPages?: number; scale?: number },
): Promise<Buffer[]> {
  const maxPages = opts?.maxPages ?? 40;
  const scaleRaw = opts?.scale ?? Number(process.env.PDF_RENDER_SCALE || "2.5");
  const renderScale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 2.5;

  const document = await pdfjs
    .getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    })
    .promise;

  const limit = Math.min(document.numPages, maxPages);
  const pages: Buffer[] = [];

  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");

    await page
      .render({
        canvasContext: canvasContext as any,
        viewport,
      } as any)
      .promise;

    pages.push(canvas.toBuffer(PNG_MIME));
    page.cleanup();
  }

  await document.destroy();
  return pages;
}
