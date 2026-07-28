import { createCanvas, loadImage } from "@napi-rs/canvas/node-canvas.js";

export type VisionImagePayload = {
  buffer: Buffer;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Longest side in pixels (DashScope multimodal limit is sensitive to payload size). */
export function visionMaxLongEdge(): number {
  return envNumber("VISION_MAX_IMAGE_LONG_EDGE", 1600);
}

/** Max encoded image bytes before base64 (base64 adds ~33%). */
export function visionMaxImageBytes(): number {
  return envNumber("VISION_MAX_IMAGE_BYTES", 3_500_000);
}

function visionJpegQualityStart(): number {
  const q = envNumber("VISION_JPEG_QUALITY", 0.82);
  return Math.min(1, Math.max(0.35, q));
}

export function resolveVisionPdfRenderScale(): number {
  const raw = process.env["PDF_VISION_RENDER_SCALE"]?.trim() || process.env["PDF_RENDER_SCALE"]?.trim() || "1.25";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1.25;
}

/**
 * Downscale and JPEG-compress a rendered page so Qwen VL stays under multimodal size limits.
 */
export async function compressImageForVision(source: Buffer): Promise<VisionImagePayload> {
  const img = await loadImage(source);
  let width = img.width;
  let height = img.height;
  const maxLong = visionMaxLongEdge();
  const longEdge = Math.max(width, height);

  if (longEdge > maxLong) {
    const ratio = maxLong / longEdge;
    width = Math.max(1, Math.floor(width * ratio));
    height = Math.max(1, Math.floor(height * ratio));
  }

  const drawToCanvas = (w: number, h: number) => {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  };

  let canvas = drawToCanvas(width, height);
  let quality = visionJpegQualityStart();
  let buffer = canvas.toBuffer("image/jpeg", { quality });
  const maxBytes = visionMaxImageBytes();

  while (buffer.length > maxBytes && quality > 0.4) {
    quality -= 0.08;
    buffer = canvas.toBuffer("image/jpeg", { quality });
  }

  while (buffer.length > maxBytes && width > 640) {
    width = Math.max(640, Math.floor(width * 0.85));
    height = Math.max(1, Math.floor(height * 0.85));
    canvas = drawToCanvas(width, height);
    quality = Math.max(0.55, quality);
    buffer = canvas.toBuffer("image/jpeg", { quality });
  }

  if (buffer.length > maxBytes) {
    throw new Error(
      `Page image still ${buffer.length} bytes after compression (limit ${maxBytes}). ` +
        "Lower PDF_VISION_RENDER_SCALE or VISION_MAX_IMAGE_LONG_EDGE.",
    );
  }

  return { buffer, mime: "image/jpeg", width, height };
}
