import { Router, type IRouter, type RequestHandler } from "express";
import { authMiddleware, type AuthRequest } from "../../middlewares/auth";
import multer from "multer";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas/node-canvas.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const PDF_MIME = "application/pdf";
const PDF_PAGE_IMAGE_MIME = "image/png";
const MAX_PDF_PAGES = 80;

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function makeOssClient() {
  return new OSS({
    accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET"),
    endpoint: requiredEnv("OSS_ENDPOINT"),
    bucket: requiredEnv("OSS_BUCKET"),
    secure: true,
  });
}

function publicUrlForKey(key: string): string {
  const domain = requiredEnv("OSS_BUCKET_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}/${key}`;
}

function safeUserFolderFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim().toLowerCase() ?? "";
  const safe = local.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return safe || "unknown";
}

function prefixForUser(req: AuthRequest): string {
  const email = req.user?.email?.trim();
  if (!email) {
    throw new Error("Missing user email");
  }
  const folder = safeUserFolderFromEmail(email);
  return `myspm/mobile/scans/${folder}/`;
}

function extFromMime(mime: string): string {
  if (mime === PDF_PAGE_IMAGE_MIME) return "png";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  if (mime === "image/tiff") return "tiff";
  return "jpg";
}

async function saveScanImage(params: {
  client: OSS;
  userPrefix: string;
  buffer: Buffer;
  mime: string;
}): Promise<{ key: string; url: string }> {
  const key = `${params.userPrefix}${Date.now()}-${randomUUID()}.${extFromMime(params.mime)}`;

  await params.client.put(key, params.buffer, {
    headers: {
      "Content-Type": params.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });

  return {
    key,
    url: publicUrlForKey(key),
  };
}

function dataUrlForBuffer(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && "text" in item && typeof (item as any).text === "string") {
      parts.push((item as any).text);
    }
  }
  return parts.join("\n");
}

async function qwenOcrFromImageBuffer(buffer: Buffer, mime: string): Promise<string> {
  const primaryKey = process.env.QWEN_OCR_API_KEY?.trim();
  const primaryBase = process.env.QWEN_OCR_BASE_URL?.trim().replace(/\/+$/, "");
  const fallbackKey =
    process.env.QWEN_GRADING_API_KEY?.trim() ||
    process.env.ALIBABA_LLM_API_KEY?.trim() ||
    undefined;
  const fallbackBase =
    process.env.QWEN_GRADING_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.ALIBABA_LLM_API_BASE_URL?.trim().replace(/\/+$/, "") ||
    undefined;

  if (!primaryKey && !fallbackKey) {
    const err = new Error("Qwen OCR is not configured (set QWEN_OCR_API_KEY and QWEN_OCR_BASE_URL).");
    (err as any).status = 500;
    throw err;
  }
  if (!primaryBase && !fallbackBase) {
    const err = new Error("Qwen OCR base URL is not configured (set QWEN_OCR_BASE_URL or QWEN_GRADING_BASE_URL).");
    (err as any).status = 500;
    throw err;
  }

  const model =
    process.env.QWEN_OCR_MODEL?.trim() ||
    process.env.DASHSCOPE_OCR_MODEL?.trim() ||
    "qwen-vl-ocr";

  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrlForBuffer(buffer, mime) } },
          {
            type: "text",
            text:
              "Extract all visible text from this exam paper page. Return plain text only. Preserve question numbers, A-D options, formulas, units, and line breaks where they reflect the layout. Do not add commentary.",
          },
        ],
      },
    ],
  };

  const attempts = [
    { apiKey: primaryKey, baseUrl: primaryBase, label: "primary" },
    { apiKey: fallbackKey, baseUrl: fallbackBase, label: "fallback" },
  ].filter((x, i, arr) =>
    Boolean(x.apiKey && x.baseUrl) &&
    arr.findIndex((y) => y.apiKey === x.apiKey && y.baseUrl === x.baseUrl) === i,
  ) as Array<{ apiKey: string; baseUrl: string; label: string }>;

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    const response = await fetch(`${attempt.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attempt.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const err = new Error(rawText.slice(0, 400) || `OCR HTTP ${response.status}`);
      (err as any).status = 502;
      lastError = err;
      continue;
    }

    if (!response.ok) {
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        (typeof parsed?.error === "string" ? parsed.error : null) ||
        rawText.slice(0, 400) ||
        `OCR failed (${response.status})`;
      const err = new Error(msg);
      (err as any).status = response.status >= 400 && response.status < 600 ? response.status : 502;
      lastError = err;
      continue;
    }

    const text = messageContentToString(parsed?.choices?.[0]?.message?.content).trim();
    if (!text) {
      const err = new Error("OCR returned empty text");
      (err as any).status = 502;
      lastError = err;
      continue;
    }

    return text;
  }

  throw lastError ?? new Error("OCR failed");
}

async function renderPdfPagesToPngBuffers(pdfBuffer: Buffer): Promise<Buffer[]> {
  const scale = Number(process.env.PDF_RENDER_SCALE || "2.5");
  const renderScale = Number.isFinite(scale) && scale > 0 ? scale : 2.5;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  }).promise;

  const pages: Buffer[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");

    await page.render({
      canvasContext: canvasContext as any,
      viewport,
    } as any).promise;

    pages.push(canvas.toBuffer(PDF_PAGE_IMAGE_MIME));
    page.cleanup();
  }

  await document.destroy();
  return pages;
}

router.get("/scan/history", async (req, res) => {
  try {
    const userPrefix = prefixForUser(req as AuthRequest);
    const client = makeOssClient();
    const result = await client.list(
      {
        prefix: userPrefix,
        "max-keys": 60,
      },
      {}
    );

    const objects = (result.objects ?? [])
      .filter((o) => typeof o.name === "string" && o.name.length > 0)
      .map((o) => ({
        key: o.name as string,
        url: publicUrlForKey(o.name as string),
        uploadedAt: o.lastModified ? new Date(o.lastModified).toISOString() : null,
        size: typeof o.size === "number" ? o.size : null,
      }))
      .sort((a, b) => (a.uploadedAt && b.uploadedAt ? b.uploadedAt.localeCompare(a.uploadedAt) : 0));

    res.status(200).json({ items: objects });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

router.post("/scan/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer || !file.mimetype) {
      res.status(400).json({ error: "Missing image" });
      return;
    }

    const userPrefix = prefixForUser(req as AuthRequest);
    const client = makeOssClient();
    const saved = await saveScanImage({
      client,
      userPrefix,
      buffer: file.buffer,
      mime: file.mimetype,
    });

    res.status(200).json(saved);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

router.post("/scan/upload-many", upload.array("images", 80), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const images = files.filter((file) => file?.buffer?.length && file.mimetype?.startsWith("image/"));

    if (images.length === 0) {
      res.status(400).json({ error: "Missing images" });
      return;
    }

    const userPrefix = prefixForUser(req as AuthRequest);
    const client = makeOssClient();

    const items = await Promise.all(
      images.map(async (file, index) => {
        const saved = await saveScanImage({
          client,
          userPrefix,
          buffer: file.buffer,
          mime: file.mimetype,
        });

        return {
          ...saved,
          index,
          originalName: file.originalname || null,
          mime: file.mimetype,
          size: file.size,
        };
      })
    );

    res.status(200).json({
      count: items.length,
      items,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

router.post("/scan/pdf-ocr", upload.single("pdf"), async (req, res) => {
  try {
    const file = req.file;
    const isPdf =
      file?.mimetype === PDF_MIME ||
      String(file?.originalname || "").toLowerCase().endsWith(".pdf");

    if (!file?.buffer || !isPdf) {
      res.status(400).json({ error: "Missing PDF. Upload a PDF using the multipart field name `pdf`." });
      return;
    }

    const pageImages = await renderPdfPagesToPngBuffers(file.buffer);
    if (pageImages.length === 0) {
      res.status(400).json({ error: "PDF did not render any pages" });
      return;
    }
    if (pageImages.length > MAX_PDF_PAGES) {
      res.status(400).json({
        error: `PDF has too many pages. Maximum supported pages: ${MAX_PDF_PAGES}.`,
        pageCount: pageImages.length,
      });
      return;
    }

    const userPrefix = `${prefixForUser(req as AuthRequest)}past-papers/`;
    const client = makeOssClient();
    const pages: Array<{
      pageNumber: number;
      key: string;
      url: string;
      ocrText: string;
    }> = [];

    for (const [index, pageImage] of pageImages.entries()) {
      const pageNumber = index + 1;
      const saved = await saveScanImage({
        client,
        userPrefix,
        buffer: pageImage,
        mime: PDF_PAGE_IMAGE_MIME,
      });

      const ocrText = await qwenOcrFromImageBuffer(pageImage, PDF_PAGE_IMAGE_MIME);
      pages.push({
        pageNumber,
        ...saved,
        ocrText,
      });
    }

    res.status(200).json({
      originalName: file.originalname || null,
      pageCount: pages.length,
      pages,
      fullText: pages.map((page) => `--- Page ${page.pageNumber} ---\n${page.ocrText}`).join("\n\n"),
    });
  } catch (error) {
    const err = error as any;
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error("[scan/pdf-ocr] failed", err);
    res.status(status).json({
      error: status === 500 ? "Failed to process PDF" : "OCR failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }
});

export default router;

