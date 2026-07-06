// createCanvas comes from the SAME @napi-rs/canvas copy pdfjs uses (see
// registerCanvasGlobals). This import MUST stay before the pdfjs import so the
// shared Path2D/DOMMatrix/ImageData globals are registered before pdfjs loads,
// otherwise ctx.fill(path) throws "Value is none of these types String, Path".
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "./registerCanvasGlobals.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const PNG_MIME = "image/png";

/**
 * Absolute file:// URL to pdfjs-dist's `wasm/` directory (jbig2/openjpeg/qcms).
 * pdfjs defaults `wasmUrl` to the relative string "wasm", which resolves to
 * nothing in Node — so JBig2/JPEG2000-encoded images silently fail to decode and
 * are dropped from the rendered page ("JBig2 failed to initialize"). Passing the
 * absolute URL lets pdfjs load the decoders and render every embedded image.
 */
function resolvePdfjsWasmUrl(): string {
  const requireFromHere = createRequire(import.meta.url);
  const entry = requireFromHere.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  // entry = <pkgRoot>/legacy/build/pdf.mjs → wasm dir = <pkgRoot>/wasm
  const wasmDir = join(dirname(entry), "..", "..", "wasm");
  const href = pathToFileURL(wasmDir).href;
  return href.endsWith("/") ? href : `${href}/`;
}

const PDF_WASM_URL = resolvePdfjsWasmUrl();

export async function renderPdfBufferToPngPages(
  pdfBuffer: Buffer,
  opts?: { maxPages?: number; startPage?: number; endPage?: number; scale?: number },
): Promise<Buffer[]> {
  const document = await openPdfDocument(pdfBuffer);
  const startPage = Math.max(1, opts?.startPage ?? 1);
  const docPages = document.numPages;
  const endPage = Math.min(
    opts?.endPage ?? docPages,
    opts?.maxPages != null ? startPage + opts.maxPages - 1 : docPages,
    docPages,
  );

  const pages: Buffer[] = [];
  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    pages.push(await renderPdfPageToPng(document, pageNumber, opts?.scale));
  }

  await document.destroy();
  return pages;
}

export async function openPdfDocument(pdfBuffer: Buffer) {
  return pdfjs
    .getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      wasmUrl: PDF_WASM_URL,
      useWorkerFetch: true,
    } as Parameters<typeof pdfjs.getDocument>[0])
    .promise;
}

export async function renderPdfPageToPng(
  document: Awaited<ReturnType<typeof openPdfDocument>>,
  pageNumber: number,
  scale?: number,
): Promise<Buffer> {
  const scaleRaw = scale ?? Number(process.env.PDF_RENDER_SCALE || "2.5");
  const renderScale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 2.5;

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

  const png = canvas.toBuffer(PNG_MIME);
  page.cleanup();
  return png;
}
