import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../middlewares/auth";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable } from "../lib/ragDb";
import { extractTextFromPdfBuffer } from "../services/rag/pdfService";
import { gradeSubmission } from "../services/rag/gradeService";
import { buildGradingContextPayload, retrieveChunks } from "../services/rag/retrievalService";
import { listTextbooks, registerTextbook } from "../services/rag/textbookService";
import { generateWithRag } from "../services/ai gen/generateFromRag";
import { runGenerateFromUpload } from "../services/ai gen/generateFromUpload";

const router: IRouter = Router();
const disableRagAuth = process.env["DISABLE_RAG_AUTH"] === "true";
if (!disableRagAuth) {
  router.use(authMiddleware as RequestHandler);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});
const gradeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function imageBufferToDataUrl(buffer: Buffer, mime: string | undefined): string {
  const rawMime = (mime || "").toLowerCase();
  const safeMime = rawMime.startsWith("image/") ? rawMime : "image/jpeg";
  return `data:${safeMime};base64,${buffer.toString("base64")}`;
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

function publicUrlForOssKey(key: string): string {
  const domain = requiredEnv("OSS_BUCKET_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}/${key}`;
}

function imageExtFromMime(mime: string | undefined): string {
  const normalized = (mime || "").toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "image/tiff") return "tiff";
  return "jpg";
}

async function uploadKnowledgeImageToOss(file: Express.Multer.File): Promise<{ key: string; url: string }> {
  const ext = imageExtFromMime(file.mimetype);
  const key = `myspm/rag/mark-schemes/${Date.now()}-${randomUUID()}.${ext}`;
  const client = makeOssClient();

  await client.put(key, file.buffer, {
    headers: {
      "Content-Type": file.mimetype || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });

  return { key, url: publicUrlForOssKey(key) };
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

function resolveQwenOcrConfig(): { apiKey: string; baseUrl: string; model: string } {
  const model = process.env["QWEN_OCR_MODEL"]?.trim() || process.env["DASHSCOPE_OCR_MODEL"]?.trim() || "qwen-vl-ocr";
  const candidates = [
    {
      apiKey: process.env["QWEN_OCR_API_KEY"]?.trim(),
      baseUrl: process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
    {
      apiKey: process.env["QWEN_GRADING_API_KEY"]?.trim(),
      baseUrl: process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
    {
      apiKey: process.env["ALIBABA_LLM_API_KEY"]?.trim(),
      baseUrl: process.env["ALIBABA_LLM_API_BASE_URL"]?.trim().replace(/\/+$/, ""),
    },
  ];

  const configured = candidates.find((candidate) => candidate.apiKey && candidate.baseUrl);

  if (!configured?.apiKey || !configured.baseUrl) {
    throw new Error("Qwen OCR is not configured (set QWEN_OCR_API_KEY and QWEN_OCR_BASE_URL).");
  }

  return { apiKey: configured.apiKey, baseUrl: configured.baseUrl, model };
}

function resolveQwenTextConfig(): { apiKey: string; baseUrl: string; model: string } {
  const model = process.env["QWEN_GRADING_MODEL"]?.trim() || process.env["QWEN_MODEL"]?.trim() || "qwen-plus";
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

  const configured = candidates.find((candidate) => candidate.apiKey && candidate.baseUrl);

  if (!configured?.apiKey || !configured.baseUrl) {
    throw new Error("Qwen text cleanup is not configured (set QWEN_GRADING_API_KEY and QWEN_GRADING_BASE_URL).");
  }

  return { apiKey: configured.apiKey, baseUrl: configured.baseUrl, model };
}

async function qwenChat(config: { apiKey: string; baseUrl: string; model: string }, messages: unknown[]): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages }),
  });

  const rawText = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 400) || `Qwen HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(parsed?.error?.message || parsed?.message || rawText.slice(0, 400) || `Qwen HTTP ${response.status}`);
  }

  const text = messageContentToString(parsed?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error("Qwen returned empty content");
  return text;
}

async function qwenOcrImage(file: Express.Multer.File): Promise<string> {
  const config = resolveQwenOcrConfig();
  return qwenChat(config, [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageBufferToDataUrl(file.buffer, file.mimetype) } },
        {
          type: "text",
          text:
            "Extract all visible text from this SPM marking scheme image. Return plain text only. Preserve table rows, content point labels such as C1/C2, bullet points, marks, headings, and line breaks. Do not add commentary.",
        },
      ],
    },
  ]);
}

function parseJsonObjectFromModel(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Structured mark scheme response was not valid JSON");
  }
}

async function structureMarkSchemeFromOcr(params: {
  ocrText: string;
  subject: string;
  form: string;
  title: string;
}): Promise<unknown> {
  const config = resolveQwenTextConfig();
  const text = await qwenChat(config, [
    {
      role: "system",
      content:
        "You convert OCR text from SPM marking schemes into strict JSON for a RAG knowledge base. Return JSON only, no markdown.",
    },
    {
      role: "user",
      content: [
        `Subject: ${params.subject}`,
        `Form: ${params.form}`,
        `Source title: ${params.title}`,
        "",
        "Convert the OCR below into this exact JSON shape:",
        "{",
        '  "questionNumber": number | null,',
        '  "questionType": string | null,',
        '  "title": string,',
        '  "markingScheme": [',
        "    {",
        '      "contentPoint": string | null,',
        '      "requirement": string,',
        '      "suggestedAnswers": string[],',
        '      "notes": string[]',
        "    }",
        "  ],",
        '  "keywords": string[],',
        '  "rawOcrCorrections": string[]',
        "}",
        "",
        "Rules:",
        "- Preserve C1/C2/C3 labels when present.",
        "- Keep ACCEPT ANY SUITABLE ANSWER as a note or suggested answer.",
        "- Do not invent content not present in the OCR.",
        "- If a field is unknown, use null or an empty array.",
        "",
        "OCR TEXT:",
        params.ocrText,
      ].join("\n"),
    },
  ]);

  return parseJsonObjectFromModel(text);
}

function buildRagContent(params: {
  subject: string;
  form: string;
  title: string;
  sourceName: string | null;
  sourceImageUrl: string | null;
  rawOcrText: string;
  structured: unknown;
}): string {
  return [
    "[PAST PAPER MARK SCHEME]",
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Title: ${params.title}`,
    params.sourceName ? `Source: ${params.sourceName}` : null,
    params.sourceImageUrl ? `Source image: ${params.sourceImageUrl}` : null,
    "",
    "Structured mark scheme JSON:",
    JSON.stringify(params.structured, null, 2),
    "",
    "Raw OCR text:",
    params.rawOcrText,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function handleRegisterTextbook(req: Request, res: Response) {
  try {
    const creatorIdRaw = (req as AuthRequest).user?.id;
    const creatorId = typeof creatorIdRaw === "string" ? Number(creatorIdRaw) : Number.NaN;
    const createdByUserId = Number.isFinite(creatorId) ? creatorId : undefined;

    const result = await registerTextbook({
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      form: typeof req.body?.form === "string" ? req.body.form : "",
      title: typeof req.body?.title === "string" ? req.body.title : "",
      sourceName: typeof req.body?.sourceName === "string" ? req.body.sourceName : undefined,
      text: typeof req.body?.text === "string" ? req.body.text : "",
      chunkConfig: {
        chunkSizeChars: Number(req.body?.chunkSizeChars),
        overlapChars: Number(req.body?.overlapChars),
      },
      createdByUserId,
    });

    return res.status(201).json({
      textbookId: result.textbookId,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create textbook knowledge base";
    const statusCode =
      message === "subject, form, and title are required" ||
      message === "text is required" ||
      message === "No chunks produced from textbook text"
        ? 400
        : 500;
    console.error("[rag] create textbook failed", error);
    return res.status(statusCode).json({ error: message });
  }
}

router.post("/textbooks", handleRegisterTextbook);

router.post("/textbooks/register", handleRegisterTextbook);

router.post("/textbooks/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ error: "Missing PDF file. Use multipart/form-data with file field 'file'." });
    }

    const hasPdfMime = (file.mimetype || "").toLowerCase().includes("pdf");
    const hasPdfExt = (file.originalname || "").toLowerCase().endsWith(".pdf");
    if (!hasPdfMime && !hasPdfExt) {
      return res.status(400).json({ error: "Only PDF files are supported." });
    }

    const creatorIdRaw = (req as AuthRequest).user?.id;
    const creatorId = typeof creatorIdRaw === "string" ? Number(creatorIdRaw) : Number.NaN;
    const createdByUserId = Number.isFinite(creatorId) ? creatorId : undefined;
    const extractedText = await extractTextFromPdfBuffer(file.buffer);

    const result = await registerTextbook({
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      form: typeof req.body?.form === "string" ? req.body.form : "",
      title: typeof req.body?.title === "string" ? req.body.title : "",
      sourceName:
        typeof req.body?.sourceName === "string" && req.body.sourceName.trim().length > 0
          ? req.body.sourceName
          : file.originalname,
      text: extractedText,
      chunkConfig: {
        chunkSizeChars: Number(req.body?.chunkSizeChars),
        overlapChars: Number(req.body?.overlapChars),
      },
      createdByUserId,
    });

    return res.status(201).json({
      textbookId: result.textbookId,
      chunkCount: result.chunkCount,
      sourceName: file.originalname,
      extractedCharCount: extractedText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload textbook PDF";
    const statusCode =
      message.includes("Missing PDF file") ||
      message.includes("Only PDF files are supported") ||
      message === "PDF extraction produced empty text" ||
      message === "subject, form, and title are required" ||
      message === "No chunks produced from textbook text"
        ? 400
        : 500;

    console.error("[rag] upload textbook failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.get("/textbooks", async (_req, res) => {
  try {
    const items = await listTextbooks();
    return res.json({ items });
  } catch (error) {
    console.error("[rag] list textbooks failed", error);
    return res.status(500).json({ error: "Failed to list textbook knowledge base" });
  }
});

router.post("/retrieve", async (req, res) => {
  try {
    const result = await retrieveChunks({
      query: typeof req.body?.query === "string" ? req.body.query : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retrieve textbook chunks";
    const statusCode = message === "query is required" ? 400 : 500;
    console.error("[rag] retrieve failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/grading-context", async (req, res) => {
  try {
    const retrieval = await retrieveChunks({
      query: typeof req.body?.query === "string" ? req.body.query : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
    });

    const payload = buildGradingContextPayload(retrieval);
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build grading context";
    const statusCode = message === "query is required" ? 400 : 500;
    console.error("[rag] grading context build failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "Body must include non-empty string \"query\"" });
    }

    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    if (!subject) {
      return res.status(400).json({ error: "Body must include non-empty string \"subject\"" });
    }

    const topK =
      typeof req.body?.topK === "number" && Number.isFinite(req.body.topK)
        ? req.body.topK
        : 8;

    const generateImage = req.body?.generateImage === true;
    const imagePrompt =
      typeof req.body?.imagePrompt === "string" ? req.body.imagePrompt : null;

    const result = await generateWithRag({
      query,
      subject,
      topK,
      generateImage,
      imagePrompt,
    });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate questions";
    console.error("[rag] generate failed", error);
    return res.status(500).json({ error: message });
  }
});

router.post("/generate-upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ error: "Missing file. Use multipart/form-data with field name \"file\" (PDF or image)." });
    }

    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    const questionType = typeof req.body?.questionType === "string" ? req.body.questionType.trim() : "";
    const difficulty = typeof req.body?.difficulty === "string" ? req.body.difficulty.trim() : "";
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";

    if (!subject || !topic || !questionType || !difficulty || !query) {
      return res.status(400).json({
        error: "subject, topic, questionType, difficulty, and query are required (multipart text fields).",
      });
    }

    const saveRaw = typeof req.body?.save === "string" ? req.body.save.trim().toLowerCase() : "";
    const saveToQuestionsTable =
      saveRaw === "true" || saveRaw === "1" || saveRaw === "yes" || req.body?.save === true;

    const createdBy =
      typeof req.body?.createdBy === "string" && req.body.createdBy.trim()
        ? req.body.createdBy.trim()
        : "RAG";

    const source =
      typeof req.body?.source === "string" && req.body.source.trim()
        ? req.body.source.trim().slice(0, 50)
        : "generated_upload";

    const maxPdfPagesRaw = req.body?.maxPdfPages;
    const maxPdfPages =
      maxPdfPagesRaw !== undefined && String(maxPdfPagesRaw).trim() !== ""
        ? Math.min(40, Math.max(1, Math.trunc(Number(maxPdfPagesRaw))))
        : undefined;

    const result = await runGenerateFromUpload({
      fileBuffer: file.buffer,
      mimeType: file.mimetype || "",
      originalName: file.originalname,
      subject,
      topic,
      questionType,
      difficulty,
      query,
      saveToQuestionsTable,
      createdBy,
      source,
      maxPdfPages,
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate from upload";
    const statusCode =
      message.includes("Missing file") ||
      message.includes("required") ||
      message.includes("Unsupported file") ||
      message.includes("No pages") ||
      message.includes("Expected a JSON array")
        ? 400
        : 500;
    console.error("[rag] generate-upload failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/past-paper/mark-scheme-image", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer || !(file.mimetype || "").toLowerCase().startsWith("image/")) {
      return res.status(400).json({ error: "Missing image. Use multipart/form-data with image field 'image'." });
    }

    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const form = typeof req.body?.form === "string" ? req.body.form.trim() : "";
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!subject || !form || !title) {
      return res.status(400).json({ error: "subject, form, and title are required" });
    }

    const sourceName =
      typeof req.body?.sourceName === "string" && req.body.sourceName.trim()
        ? req.body.sourceName.trim()
        : file.originalname || null;
    const year =
      Number.isFinite(Number(req.body?.year)) && String(req.body?.year ?? "").trim().length > 0
        ? Math.trunc(Number(req.body.year))
        : null;
    const paperLabel =
      typeof req.body?.paperLabel === "string" && req.body.paperLabel.trim()
        ? req.body.paperLabel.trim()
        : null;
    const paperId =
      typeof req.body?.paperId === "string" && req.body.paperId.trim()
        ? req.body.paperId.trim()
        : `pp-ms-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const uploadedImage = await uploadKnowledgeImageToOss(file);
    const rawOcrText = await qwenOcrImage(file);
    const structured = await structureMarkSchemeFromOcr({
      ocrText: rawOcrText,
      subject,
      form,
      title,
    });

    const structuredRecord = structured && typeof structured === "object" ? (structured as Record<string, any>) : {};
    const questionNumber = structuredRecord.questionNumber;
    const questionType = typeof structuredRecord.questionType === "string" ? structuredRecord.questionType : null;
    const keywords = Array.isArray(structuredRecord.keywords)
      ? structuredRecord.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
      : [];
    const questionRef =
      Number.isFinite(Number(questionNumber))
        ? `Q${Math.trunc(Number(questionNumber))}${questionType ? ` ${questionType}` : ""}`
        : questionType || null;

    const content = buildRagContent({
      subject,
      form,
      title,
      sourceName,
      sourceImageUrl: uploadedImage.url,
      rawOcrText,
      structured,
    });

    const insertedPaper = await ragDb
      .insert(ragPastPapersTable)
      .values({
        paperId,
        subject,
        form,
        year,
        paperLabel,
        title,
        sourceName,
      })
      .returning({ id: ragPastPapersTable.id });

    const pastPaperDbId = insertedPaper[0]?.id;
    if (!pastPaperDbId) throw new Error("Failed to create past paper record");

    const insertedChunk = await ragDb
      .insert(ragPastPaperChunksTable)
      .values({
        pastPaperDbId,
        chunkId: `chunk-${Date.now()}-${randomUUID().slice(0, 8)}`,
        chunkIndex: 0,
        questionRef,
        conceptTitle: questionRef ? `${title} ${questionRef}` : title,
        conceptSummary: `Structured SPM marking scheme extracted from image OCR for ${subject}.`,
        keywords: keywords.join(", "),
        maxMarks: null,
        pageStart: null,
        pageEnd: null,
        sourceImageUrl: uploadedImage.url,
        embedding: null,
        chunkKind: "mark_scheme_image",
        content,
      })
      .returning({
        id: ragPastPaperChunksTable.id,
        chunkId: ragPastPaperChunksTable.chunkId,
      });

    return res.status(201).json({
      paperId,
      pastPaperDbId,
      chunkId: insertedChunk[0]?.chunkId,
      chunkDbId: insertedChunk[0]?.id,
      sourceImageUrl: uploadedImage.url,
      rawOcrText,
      structured,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest mark scheme image";
    const statusCode =
      message.includes("Missing image") ||
      message.includes("required") ||
      message.includes("not valid JSON")
        ? 400
        : 500;

    console.error("[rag] mark scheme image ingest failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/grade", gradeUpload.single("diagramImage"), async (req, res) => {
  try {
    const userIdRaw = (req as AuthRequest).user?.id;
    const userId = typeof userIdRaw === "string" ? Number(userIdRaw) : Number.NaN;
    const diagramImageFile = req.file;
    const diagramImageBase64FromFile = diagramImageFile?.buffer?.length
      ? imageBufferToDataUrl(diagramImageFile.buffer, diagramImageFile.mimetype)
      : undefined;

    const result = await gradeSubmission({
      question: typeof req.body?.question === "string" ? req.body.question : "",
      studentAnswer: typeof req.body?.studentAnswer === "string" ? req.body.studentAnswer : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
      maxScore: Number(req.body?.maxScore),
      rubricVersion: typeof req.body?.rubricVersion === "string" ? req.body.rubricVersion : undefined,
      diagramImageUrl: typeof req.body?.diagramImageUrl === "string" ? req.body.diagramImageUrl : undefined,
      diagramImageBase64: diagramImageBase64FromFile
        || (typeof req.body?.diagramImageBase64 === "string" ? req.body.diagramImageBase64 : undefined),
      submissionId: typeof req.body?.submissionId === "string" ? req.body.submissionId : undefined,
      userId: Number.isFinite(userId) ? userId : null,
    });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to grade submission";
    const statusCode =
      message === "question is required" || message === "studentAnswer is required"
        ? 400
        : 500;

    console.error("[rag] grade failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

export default router;
