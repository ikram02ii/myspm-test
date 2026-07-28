import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Point pdf.js at the same worker bundle as the main API (Node ingest/render).
 * Clears a stale worker left by pdf-parse's nested pdfjs-dist (version mismatch).
 */
export function configurePdfJsForNode(): typeof pdfjs {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  (globalThis as { pdfjs?: typeof pdfjs }).pdfjs = pdfjs;
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
  return pdfjs;
}
