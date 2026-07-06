// Must be imported BEFORE pdfjs-dist. It resolves the EXACT same @napi-rs/canvas
// copy that pdfjs-dist uses internally, registers its Path2D / DOMMatrix / ImageData
// as globals, and re-exports its createCanvas.
//
// Why: node_modules contains several incompatible copies of @napi-rs/canvas (root
// 1.0.0, pdfjs-dist's nested 0.1.x, pdf-parse's nested 0.1.x). pdfjs renders using
// `globalThis.Path2D`, which it polyfills from ITS nested copy. If our render canvas
// is created from a different copy, the native binding rejects the "foreign" Path2D
// with: "Value is none of these types `String`, `Path`". Sharing one copy fixes it.
import { createRequire } from "node:module";

type CanvasModule = {
  createCanvas: (width: number, height: number) => {
    getContext: (type: "2d") => unknown;
    toBuffer: (mime: string) => Buffer;
  };
  Path2D: unknown;
  DOMMatrix: unknown;
  ImageData: unknown;
};

const requireFromHere = createRequire(import.meta.url);
const pdfjsEntry = requireFromHere.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const pdfCanvas = createRequire(pdfjsEntry)("@napi-rs/canvas") as CanvasModule;

const g = globalThis as unknown as {
  Path2D?: unknown;
  DOMMatrix?: unknown;
  ImageData?: unknown;
  fetch?: typeof fetch;
  __fileFetchPatched?: boolean;
};

g.Path2D = pdfCanvas.Path2D;
g.DOMMatrix = pdfCanvas.DOMMatrix;
g.ImageData = pdfCanvas.ImageData;

// Teach global fetch() to read file:// URLs. pdfjs loads its wasm image decoders
// (jbig2/openjpeg/qcms) via fetch(), but Node's fetch rejects the file: scheme,
// which causes "Unable to load wasm data" and silently drops JBig2/JPEG2000 images
// from rendered pages. HTTPS/HTTP requests pass through to the original fetch.
if (!g.__fileFetchPatched && typeof g.fetch === "function") {
  const originalFetch = g.fetch.bind(globalThis);
  g.fetch = (async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url?: string } | undefined)?.url;
    if (typeof url === "string" && url.startsWith("file://")) {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const data = await readFile(fileURLToPath(url));
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch(input as RequestInfo, init as RequestInit | undefined);
  }) as typeof fetch;
  g.__fileFetchPatched = true;
}

export const createCanvas = pdfCanvas.createCanvas;
