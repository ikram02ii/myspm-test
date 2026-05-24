import { Router, type IRouter } from "express";
import multer from "multer";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { OCR_EXTRACTION_PROMPT } from "../services/rag/ocrTextNormalize";
import { runOcrPostProcessPipeline } from "../services/rag/ocrPipelineService";

const router: IRouter = Router();

// Multipart image validation (field `image`, optional `email` in body or as part).
const IMAGE_MIME = /^image\/(jpeg|jpg|pjpeg|jfif|png|gif|webp|bmp|tiff|heic|heif)$/i;
const IMAGE_EXT = /\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter(_req, file, cb) {
    if (String(file.fieldname || "").toLowerCase() !== "image") {
      cb(null, true);
      return;
    }

    const byMime = IMAGE_MIME.test(file.mimetype || "");
    const byExt = IMAGE_EXT.test(file.originalname || "");
    const byImageFieldWithFilename =
      String(file.fieldname || "").toLowerCase() === "image" &&
      typeof file.originalname === "string" &&
      file.originalname.trim().length > 0;

    const ok = byMime || byExt || byImageFieldWithFilename;
    if (!ok) {
      cb(
        new Error(
          `Only image files allowed. Received mime="${file.mimetype || ""}" name="${file.originalname || ""}"`,
        ),
      );
      return;
    }

    cb(null, true);
  },
});

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function makeOssClient(): any {
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

function prefixForUserFromEmail(email: string): string {
  const folder = safeUserFolderFromEmail(email);
  return `myspm/mobile/scans/${folder}/`;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

function normalizedMime(mime: string): string {
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function mimeFromFilename(filename: unknown): string | null {
  const name = String(filename || "");
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return null;

  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return null;
}

function pickUploadedImage(files: any[]): any | null {
  const asArray = Array.isArray(files) ? files : [];
  const byName = asArray.find(
    (f) => String(f.fieldname || "").toLowerCase() === "image" && f.buffer?.length,
  );
  if (byName) return byName;

  const firstImage = asArray.find((f) => f.buffer?.length && IMAGE_MIME.test(f.mimetype || ""));
  if (firstImage) return firstImage;

  // Mobile clients sometimes send generic mime/field names; accept the first
  // buffered file as a last-resort fallback.
  const firstBuffered = asArray.find((f) => f?.buffer?.length);
  return firstBuffered || null;
}

async function uploadScanImageToOss(oss: any, buffer: Buffer, mime: string, email: string): Promise<{ url: string }> {
  const prefix = prefixForUserFromEmail(email);
  const ext = EXT_BY_MIME[normalizedMime(mime)] || "bin";
  const objectKey = `${prefix}${Date.now()}-${randomUUID()}.${ext}`;

  await oss.put(objectKey, buffer, {
    headers: { "Content-Type": normalizedMime(mime) },
  });

  const url = publicUrlForKey(objectKey);
  console.log("[scan] uploaded", { objectKey, url, mime: normalizedMime(mime) });
  return { url };
}

function dataUrlForBuffer(buffer: Buffer, mime: string): string {
  const m = normalizedMime(mime);
  const safeMime = IMAGE_MIME.test(m) ? m : "image/jpeg";
  const b64 = buffer.toString("base64");
  return `data:${safeMime};base64,${b64}`;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && "text" in item && typeof (item as any).text === "string") {
        parts.push((item as any).text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Qwen-VL OCR via Alibaba Model Studio / DashScope OpenAI-compatible API.
 *
 * Env: `QWEN_OCR_API_KEY` (e.g. `sk-...`), `QWEN_OCR_BASE_URL` must be the **compatible-mode** base:
 *   `https://<deployment>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
 *   or public: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
 * Do not use the native DashScope `.../api/v1` base here — this route calls `POST .../chat/completions`.
 */
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
            text: OCR_EXTRACTION_PROMPT,
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
    const url = `${attempt.baseUrl}/chat/completions`;
    console.log("[scan] qwen-ocr request", { url, model, attempt: attempt.label });

    const response = await fetch(url, {
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

    const content = parsed?.choices?.[0]?.message?.content;
    const text = messageContentToString(content).trim();
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

function ocrPostProcessEnabled(): boolean {
  const v = (process.env["OCR_POST_PROCESS"] ?? "true").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

async function runScanPipeline(
  buffer: Buffer,
  mime: string,
  email: string,
  context?: { question?: string; subject?: string },
): Promise<{ text: string; format: "plain"; validationWarning?: string }> {
  const oss = makeOssClient();
  await uploadScanImageToOss(oss, buffer, mime, email);
  const rawOcr = await qwenOcrFromImageBuffer(buffer, mime);
  if (!ocrPostProcessEnabled()) {
    return { text: rawOcr.trim(), format: "plain" };
  }
  const processed = await runOcrPostProcessPipeline({
    rawOcrText: rawOcr,
    question: context?.question,
    subject: context?.subject,
  });
  return {
    text: processed.text,
    format: processed.format,
    validationWarning: processed.validationWarning,
  };
}

router.post("/scan", upload.any(), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? (req.files as any[]) : [];
    const imageFile = pickUploadedImage(files);

    if (!imageFile?.buffer) {
      return res.status(400).json({
        error: "Missing image",
        detail: `No valid image part found. Received parts: ${files
          .map((f) => `${f.fieldname || "?"}(${f.mimetype || "no-mime"})`)
          .join(", ")}`,
      });
    }

    const rawMime = String(imageFile.mimetype || "");
    const derived = !IMAGE_MIME.test(rawMime) ? mimeFromFilename(imageFile.originalname) : null;
    const mimeCandidate = derived || rawMime || "image/jpeg";
    const mime = mimeCandidate === "image/jpg" ? "image/jpeg" : mimeCandidate;

    console.log("[scan] image part", {
      fieldname: imageFile.fieldname,
      mimetype: rawMime,
      originalname: imageFile.originalname,
      usedMime: mime,
    });

    const bodyEmail =
      typeof (req.body as any)?.email === "string" ? (req.body as any).email.trim() : "";
    const filesEmail = files
      .filter((f) => String(f.fieldname || "").toLowerCase() === "email")
      .find((f) => f.buffer)
      ?.buffer.toString("utf8")
      .trim();

    // OCR should still work even when client does not provide email (e.g. quick
    // practice answer scan). Use a safe fallback bucket folder in that case.
    const email = bodyEmail || filesEmail || "unknown@local";
    const emailForStorage = email.includes("@") ? email : "unknown@local";

    const question =
      typeof (req.body as any)?.question === "string" ? (req.body as any).question.trim() : "";
    const subject =
      typeof (req.body as any)?.subject === "string" ? (req.body as any).subject.trim() : "";

    const { text, format, validationWarning } = await runScanPipeline(imageFile.buffer, mime, emailForStorage, {
      question: question || undefined,
      subject: subject || undefined,
    });
    console.log("[scan] ocr text", { length: text?.length ?? 0, preview: (text ?? "").slice(0, 200) });
    return res.json({
      text,
      format,
      ...(validationWarning ? { validationWarning } : {}),
    });
  } catch (e) {
    const err = e as any;
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message = err instanceof Error ? err.message : String(err);

    console.error("[scan] failed", { status, message });

    return res.status(status).json({
      error: status === 500 ? "Server misconfiguration" : "OCR failed",
      detail: message,
    });
  }
});

export default router;
