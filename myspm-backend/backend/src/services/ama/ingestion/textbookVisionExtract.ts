import { readFile } from "node:fs/promises";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { compressImageForVision, resolveVisionPdfRenderScale } from "../../ai gen/compressImageForVision";
import { openPdfDocument, renderPdfPageToPng } from "../../ai gen/pdfToPngPages";
import { resolveQwenVisionPair } from "../../ai gen/visionPdfExtract";

/** Best vision model for textbook ingestion — verbatim text + figures + tables. */
export function resolveTextbookVisionModel(): string {
  return (
    process.env["QWEN_TEXTBOOK_VISION_MODEL"]?.trim() ||
    process.env["QWEN_VISION_MODEL"]?.trim() ||
    "qwen-vl-max"
  );
}

export type TextbookVisionPageExtraction = {
  pageNumber: number;
  content: string;
  figures: TextbookFigure[];
  tables: TextbookTable[];
  chapterNo: number | null;
  chapter: string | null;
  hasFigure: boolean;
  contentType: "text" | "table" | "figure" | "mixed";
  conceptTitle: string | null;
  keywords: string[];
  pageImagePath: string | null;
  ossKey: string | null;
  /** True when the vision API blocked the page (content moderation). */
  extractionBlocked?: boolean;
};

export type TextbookFigure = {
  id: string;
  caption?: string;
  description: string;
};

export type TextbookTable = {
  id: string;
  caption?: string;
  markdown: string;
};

type RawVisionPayload = {
  content?: string;
  figures?: TextbookFigure[];
  tables?: TextbookTable[];
  chapterNo?: number | null;
  chapter?: string | null;
  hasFigure?: boolean;
  contentType?: string;
  conceptTitle?: string | null;
  keywords?: string[];
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

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function parseVisionJson(raw: string): RawVisionPayload {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned) as RawVisionPayload;
  } catch {
    return { content: raw.trim() };
  }
}

function normalizeContentType(value: string | undefined, hasFigure: boolean, hasTables: boolean): TextbookVisionPageExtraction["contentType"] {
  if (value === "text" || value === "table" || value === "figure" || value === "mixed") return value;
  if (hasFigure && hasTables) return "mixed";
  if (hasFigure) return "figure";
  if (hasTables) return "table";
  return "text";
}

function extractChapterNo(chapter: string | null | undefined): number | null {
  if (typeof chapter === "string") {
    const m = chapter.match(/\b(?:chapter|bab|unit)\s*(\d{1,2})\b/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

async function uploadPageImageToOss(
  buffer: Buffer,
  mime: string,
  pageNumber: number,
  originalStem: string,
): Promise<{ key: string; url: string }> {
  const client = makeOssClient();
  const safeStem = originalStem.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "textbook";
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const key = `myspm/rag/textbooks/vision/${Date.now()}-${safeStem}-p${pageNumber}-${randomUUID()}.${ext}`;
  await client.put(key, buffer, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  return { key, url: publicUrlForOssKey(key) };
}

const TEXTBOOK_PAGE_PROMPT = `You are transcribing one page from a Malaysian SPM textbook (English).

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "content": "ALL visible printed text on this page, verbatim — do not paraphrase, omit, or summarize",
  "figures": [{"id":"fig1","caption":"optional caption","description":"full plain-text description of every diagram/graph/chart/photo including axes, labels, units, trends, and key readings"}],
  "tables": [{"id":"table1","caption":"optional caption","markdown":"table reproduced as markdown rows"}],
  "chapterNo": 5,
  "chapter": "Chapter 5 Metabolism and Enzymes",
  "hasFigure": true,
  "contentType": "mixed",
  "conceptTitle": "short topic title for this page",
  "keywords": ["enzyme","substrate","active site"]
}

Rules:
- "content" must include every word you can read on the page, preserving headings, bullet points, and numbering.
- If there are no figures, use "figures": [] and hasFigure false.
- If there are no tables, use "tables": [].
- chapterNo/chapter: set from visible chapter headings on this page; use null if not shown.
- contentType is one of: text, table, figure, mixed.
- Do not add commentary outside the JSON.`;

const EDUCATIONAL_CONTEXT = `

Context: This is an official Malaysian KSSM SPM school textbook page for education and exam preparation only. Transcribe all visible syllabus text, scientific diagrams, charts, and labels in a neutral academic tone.`;

function isModerationError(message: string): boolean {
  return /inappropriate content/i.test(message);
}

function isTransientFetchError(message: string): boolean {
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callVisionApi(params: {
  image: Buffer;
  mime: string;
  pageNumber: number;
  model: string;
  promptExtra?: string;
}): Promise<Omit<TextbookVisionPageExtraction, "pageNumber" | "pageImagePath" | "ossKey" | "extractionBlocked">> {
  const { apiKey, baseUrl } = resolveQwenVisionPair();
  const mime = params.mime ?? "image/jpeg";
  const maxAttempts = 8;

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrlForBuffer(params.image, mime) } },
                {
                  type: "text",
                  text: `${TEXTBOOK_PAGE_PROMPT}${params.promptExtra ?? ""}\n\nThis is page ${params.pageNumber}.`,
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

      const payload = parseVisionJson(text);
      const figures = Array.isArray(payload.figures) ? payload.figures : [];
      const tables = Array.isArray(payload.tables) ? payload.tables : [];
      const hasFigure = Boolean(payload.hasFigure) || figures.length > 0;
      const content = (payload.content ?? text).trim();
      const chapter = payload.chapter?.trim() || null;
      const chapterNo =
        typeof payload.chapterNo === "number" && Number.isFinite(payload.chapterNo)
          ? payload.chapterNo
          : extractChapterNo(chapter);

      return {
        content,
        figures,
        tables,
        chapterNo,
        chapter,
        hasFigure,
        contentType: normalizeContentType(payload.contentType, hasFigure, tables.length > 0),
        conceptTitle: payload.conceptTitle?.trim() || null,
        keywords: Array.isArray(payload.keywords)
          ? payload.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          : [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = err instanceof Error ? err : new Error(msg);
      if (attempt < maxAttempts && isTransientFetchError(msg)) {
        const waitMs = 3000 * attempt;
        console.warn("[textbook-vision] transient API error, retrying", {
          pageNumber: params.pageNumber,
          attempt,
          waitMs,
          error: msg,
        });
        await sleep(waitMs);
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr ?? new Error(`Vision API failed for page ${params.pageNumber}`);
}

function moderationBlockedPage(pageNumber: number): Omit<TextbookVisionPageExtraction, "pageNumber" | "pageImagePath" | "ossKey"> {
  return {
    content: `[MODERATION_BLOCKED] Page ${pageNumber}: the vision API rejected this official textbook page. Content was not transcribed automatically — manual review or OCR fallback is required.`,
    figures: [],
    tables: [],
    chapterNo: null,
    chapter: null,
    hasFigure: false,
    contentType: "text",
    conceptTitle: `Page ${pageNumber} (blocked)`,
    keywords: [],
    extractionBlocked: true,
  };
}

export async function qwenVisionExtractTextbookPage(params: {
  image: Buffer;
  mime?: string;
  pageNumber: number;
}): Promise<Omit<TextbookVisionPageExtraction, "pageNumber" | "pageImagePath" | "ossKey">> {
  const primaryModel = resolveTextbookVisionModel();
  const fallbackModel = process.env["QWEN_TEXTBOOK_VISION_FALLBACK_MODEL"]?.trim() || "qwen-vl-plus";
  const attempts: Array<{ model: string; promptExtra?: string }> = [
    { model: primaryModel },
    { model: primaryModel, promptExtra: EDUCATIONAL_CONTEXT },
    { model: fallbackModel, promptExtra: EDUCATIONAL_CONTEXT },
  ];

  let lastModerationErr: Error | null = null;
  for (const attempt of attempts) {
    try {
      return await callVisionApi({
        image: params.image,
        mime: params.mime ?? "image/jpeg",
        pageNumber: params.pageNumber,
        model: attempt.model,
        promptExtra: attempt.promptExtra,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isModerationError(msg)) throw err;
      lastModerationErr = err instanceof Error ? err : new Error(msg);
      console.warn("[textbook-vision] moderation block, retrying", {
        pageNumber: params.pageNumber,
        model: attempt.model,
      });
    }
  }

  console.warn("[textbook-vision] moderation block — storing placeholder chunk", {
    pageNumber: params.pageNumber,
    error: lastModerationErr?.message,
  });
  return moderationBlockedPage(params.pageNumber);
}

export type ExtractTextbookPdfWithVisionInput = {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  originalName?: string | null;
  startPage?: number;
  endPage?: number;
  maxPages?: number;
  uploadToOss?: boolean;
  onPage?: (page: TextbookVisionPageExtraction) => Promise<void>;
};

export async function processTextbookPdfPagesWithVision(
  input: ExtractTextbookPdfWithVisionInput,
): Promise<{ totalPages: number; pages: TextbookVisionPageExtraction[] }> {
  const buffer =
    input.pdfBuffer ?? (input.pdfPath ? await readFile(input.pdfPath) : null);
  if (!buffer?.length) {
    throw new Error("Provide pdfPath or pdfBuffer");
  }

  const stem =
    (input.originalName ?? input.pdfPath ?? "textbook").split(/[\\/]/).pop() || "textbook";
  const uploadToOss = input.uploadToOss !== false;
  const renderScale = resolveVisionPdfRenderScale();

  const document = await openPdfDocument(buffer);
  const totalPages = document.numPages;
  const startPage = Math.max(1, input.startPage ?? 1);
  const endPage = Math.min(
    input.endPage ?? totalPages,
    input.maxPages != null ? startPage + input.maxPages - 1 : totalPages,
    totalPages,
  );

  console.info("[textbook-vision] processing pages", {
    startPage,
    endPage,
    totalPages,
    model: resolveTextbookVisionModel(),
    renderScale,
  });

  const pages: TextbookVisionPageExtraction[] = [];

  try {
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const rendered = await renderPdfPageToPng(document, pageNumber, renderScale);
      const { buffer: image, mime, width, height } = await compressImageForVision(rendered);

      let ossKey: string | null = null;
      let pageImagePath: string | null = null;
      if (uploadToOss) {
        try {
          const uploaded = await uploadPageImageToOss(image, mime, pageNumber, stem);
          ossKey = uploaded.key;
          pageImagePath = uploaded.url;
        } catch (err) {
          console.warn("[textbook-vision] OSS upload skipped for page", pageNumber, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      console.info("[textbook-vision] VL extract", {
        pageNumber,
        total: endPage,
        renderedBytes: rendered.length,
        visionBytes: image.length,
        width,
        height,
      });

      const extracted = await qwenVisionExtractTextbookPage({ image, mime, pageNumber });

      const page: TextbookVisionPageExtraction = {
        pageNumber,
        ...extracted,
        pageImagePath,
        ossKey,
      };
      pages.push(page);
      if (input.onPage) await input.onPage(page);
    }
  } finally {
    await document.destroy();
  }

  return { totalPages, pages };
}

export function buildTextbookChunkSearchContent(page: TextbookVisionPageExtraction): string {
  const lines: string[] = [
    page.chapter ? `Chapter: ${page.chapter}` : null,
    page.conceptTitle ? `Topic: ${page.conceptTitle}` : null,
    "",
    page.content,
  ].filter((line): line is string => line !== null);

  if (page.tables.length > 0) {
    lines.push("", "[TABLES]");
    for (const table of page.tables) {
      if (table.caption) lines.push(`Table: ${table.caption}`);
      lines.push(table.markdown);
    }
  }

  if (page.figures.length > 0) {
    lines.push("", "[FIGURES]");
    for (const fig of page.figures) {
      if (fig.caption) lines.push(`Figure: ${fig.caption}`);
      lines.push(fig.description);
    }
  }

  return lines.join("\n").trim();
}
