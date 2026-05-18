import { readFile } from "node:fs/promises";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { compressImageForVision, resolveVisionPdfRenderScale } from "./compressImageForVision";
import { renderPdfBufferToPngPages } from "./pdfToPngPages";

export type VisionPdfPageResult = {
  pageNumber: number;
  extractedText: string;
  ossKey: string | null;
  ossUrl: string | null;
};

/** API-friendly shape (oss fields always strings). */
export type UploadedPageAsset = {
  pageNumber: number;
  ossKey: string;
  ossUrl: string;
  extractedText: string;
};

export function toUploadedPageAsset(page: VisionPdfPageResult): UploadedPageAsset {
  return {
    pageNumber: page.pageNumber,
    ossKey: page.ossKey ?? "",
    ossUrl: page.ossUrl ?? "",
    extractedText: page.extractedText,
  };
}

export type ExtractPdfPagesWithVisionInput = {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  originalName?: string | null;
  maxPages?: number;
  /** When false, skip OSS upload (VL still runs on in-memory PNG). Default true. */
  uploadToOss?: boolean;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function makeOssClient(): OSS {
  return new OSS({
    accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET"),
    endpoint: requiredEnv("OSS_ENDPOINT"),
    bucket: requiredEnv("OSS_BUCKET"),
    secure: true,
  });
}

function publicUrlForOssKey(key: string): string {
  const domain = requiredEnv("OSS_BUCKET_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}/${key}`;
}

function dataUrlForBuffer(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && "text" in item && typeof (item as { text?: string }).text === "string") {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.join("\n");
}

export function resolveQwenVisionPair(): { apiKey: string; baseUrl: string } {
  const candidates = [
    {
      apiKey: process.env["QWEN_GRADING_API_KEY"]?.trim(),
      baseUrl: process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
    {
      apiKey: process.env["QWEN_OCR_API_KEY"]?.trim(),
      baseUrl: process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
    {
      apiKey: process.env["ALIBABA_LLM_API_KEY"]?.trim(),
      baseUrl: process.env["ALIBABA_LLM_API_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
  ];
  const configured = candidates.find((c) => c.apiKey && c.baseUrl);
  if (!configured?.apiKey || !configured.baseUrl) {
    throw new Error("Configure QWEN_GRADING_API_KEY + QWEN_GRADING_BASE_URL (or QWEN_OCR_* / ALIBABA_LLM_*) for vision.");
  }
  return { apiKey: configured.apiKey, baseUrl: configured.baseUrl };
}

export function resolveVisionModel(): string {
  return (
    process.env["QWEN_VISION_MODEL"]?.trim() ||
    process.env["QWEN_OCR_MODEL"]?.trim() ||
    process.env["DASHSCOPE_OCR_MODEL"]?.trim() ||
    "qwen-vl-plus"
  );
}

export async function qwenVisionExtractPage(params: {
  image: Buffer;
  mime?: string;
  pageNumber: number;
}): Promise<string> {
  const { apiKey, baseUrl } = resolveQwenVisionPair();
  const model = resolveVisionModel();
  const mime = params.mime ?? "image/jpeg";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrlForBuffer(params.image, mime) } },
            {
              type: "text",
              text: `This is page ${params.pageNumber} of an SPM exam document (may include diagrams).

Extract:
1) All visible printed text, preserving question numbers, A–D options, tables, and line breaks where helpful.
2) For every diagram, graph, chart, photo, or figure: add a block starting with "DIAGRAM:" then describe axes, labels, units, trends, key readings, and relationships in plain text.

Return plain text only. No markdown fences. No commentary about your process.`,
            },
          ],
        },
      ],
    }),
  });

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 400) || `Vision HTTP ${response.status}`);
  }

  const p = parsed as Record<string, unknown>;
  if (!response.ok) {
    const errObj = p?.error as Record<string, unknown> | undefined;
    const msg =
      (typeof errObj?.message === "string" && errObj.message) ||
      (typeof p?.message === "string" && p.message) ||
      rawText.slice(0, 400) ||
      `Vision failed (${response.status})`;
    throw new Error(msg);
  }

  const choices = p?.choices as unknown[] | undefined;
  const first = choices?.[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const text = messageContentToString(message?.content).trim();
  if (!text) throw new Error(`Vision model returned empty text for page ${params.pageNumber}`);
  return text;
}

async function uploadPageImageToOss(
  buffer: Buffer,
  mime: string,
  pageNumber: number,
  originalStem: string,
): Promise<{ key: string; url: string }> {
  const client = makeOssClient();
  const safeStem = originalStem.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "document";
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const key = `myspm/rag/past-papers/vision/${Date.now()}-${safeStem}-p${pageNumber}-${randomUUID()}.${ext}`;
  await client.put(key, buffer, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  return { key, url: publicUrlForOssKey(key) };
}

/**
 * Render PDF → PNG per page, run Qwen VL on each page, optionally upload page images to OSS.
 */
export async function extractAllPagesFromPdfWithVision(
  input: ExtractPdfPagesWithVisionInput,
): Promise<VisionPdfPageResult[]> {
  const buffer =
    input.pdfBuffer ?? (input.pdfPath ? await readFile(input.pdfPath) : null);
  if (!buffer?.length) {
    throw new Error("Provide pdfPath or pdfBuffer");
  }

  const stem =
    (input.originalName ?? input.pdfPath ?? "document").split(/[\\/]/).pop() || "document";
  const maxPages = input.maxPages ?? 40;
  const uploadToOss = input.uploadToOss !== false;

  const renderScale = resolveVisionPdfRenderScale();
  const pageImages = await renderPdfBufferToPngPages(buffer, { maxPages, scale: renderScale });
  if (pageImages.length === 0) throw new Error("PDF did not render any pages");

  console.info("[vision-pdf] rendered pages", {
    count: pageImages.length,
    model: resolveVisionModel(),
    renderScale,
  });

  const results: VisionPdfPageResult[] = [];

  for (let i = 0; i < pageImages.length; i += 1) {
    const pageNumber = i + 1;
    const rendered = pageImages[i]!;
    const { buffer: image, mime, width, height } = await compressImageForVision(rendered);

    let ossKey: string | null = null;
    let ossUrl: string | null = null;
    if (uploadToOss) {
      const uploaded = await uploadPageImageToOss(image, mime, pageNumber, stem);
      ossKey = uploaded.key;
      ossUrl = uploaded.url;
    }

    console.info("[vision-pdf] VL extract", {
      pageNumber,
      total: pageImages.length,
      renderedBytes: rendered.length,
      visionBytes: image.length,
      width,
      height,
    });
    const extractedText = await qwenVisionExtractPage({ image, mime, pageNumber });

    results.push({ pageNumber, extractedText, ossKey, ossUrl });
  }

  return results;
}

/** Single image file → VL (optional OSS). */
export async function extractImageWithVision(input: {
  imageBuffer: Buffer;
  originalName?: string | null;
  uploadToOss?: boolean;
}): Promise<VisionPdfPageResult> {
  const stem = (input.originalName ?? "image").split(/[\\/]/).pop() || "image";
  const uploadToOss = input.uploadToOss !== false;

  let ossKey: string | null = null;
  let ossUrl: string | null = null;
  const { buffer: image, mime } = await compressImageForVision(input.imageBuffer);

  if (uploadToOss) {
    const uploaded = await uploadPageImageToOss(image, mime, 1, stem);
    ossKey = uploaded.key;
    ossUrl = uploaded.url;
  }

  const extractedText = await qwenVisionExtractPage({ image, mime, pageNumber: 1 });
  return { pageNumber: 1, extractedText, ossKey, ossUrl };
}

export function buildVisionPageChunkContent(page: VisionPdfPageResult, meta: { subject: string; title: string }): string {
  return [
    "[PAST PAPER MARK SCHEME]",
    `Subject: ${meta.subject}`,
    `Title: ${meta.title}`,
    `Page: ${page.pageNumber}`,
    page.ossUrl ? `Source image: ${page.ossUrl}` : null,
    "",
    page.extractedText,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
