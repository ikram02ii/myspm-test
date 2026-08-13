import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

let polyfillsApplied = false;

/**
 * pdf.js Node canvas rendering needs native Path2D/DOMMatrix from @napi-rs/canvas.
 * Without them, Form XObject pages throw: Value is none of these types `String`, `Path`.
 */
function ensureNapiCanvasPolyfills(): void {
  if (polyfillsApplied) return;
  polyfillsApplied = true;
  try {
    const require = createRequire(import.meta.url);
    const canvas = require("@napi-rs/canvas") as {
      Path2D?: typeof Path2D;
      DOMMatrix?: typeof DOMMatrix;
      ImageData?: typeof ImageData;
    };
    if (canvas.DOMMatrix && !(globalThis as { DOMMatrix?: unknown }).DOMMatrix) {
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = canvas.DOMMatrix;
    }
    if (canvas.Path2D) {
      (globalThis as { Path2D?: unknown }).Path2D = canvas.Path2D;
    }
    if (canvas.ImageData && !(globalThis as { ImageData?: unknown }).ImageData) {
      (globalThis as { ImageData?: unknown }).ImageData = canvas.ImageData;
    }
  } catch (err) {
    console.warn(
      "[pdfjs-node] Failed to polyfill Path2D/DOMMatrix from @napi-rs/canvas:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Point pdf.js at the same worker bundle as the main API (Node ingest/render).
 * Clears a stale worker left by pdf-parse's nested pdfjs-dist (version mismatch).
 */
export function configurePdfJsForNode(): typeof pdfjs {
  ensureNapiCanvasPolyfills();
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  (globalThis as { pdfjs?: typeof pdfjs }).pdfjs = pdfjs;
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
  return pdfjs;
}
