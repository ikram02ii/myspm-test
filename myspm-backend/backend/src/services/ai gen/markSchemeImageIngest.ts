import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { ragDb, ragPastPaperChunksTable, ragPastPapersTable } from "../../lib/ragDb";

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
    if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
      parts.push((item as { text: string }).text);
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
  let parsed: { error?: { message?: string }; message?: string; choices?: Array<{ message?: { content?: unknown } }> };
  try {
    parsed = JSON.parse(rawText) as typeof parsed;
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

export type IngestMarkSchemeImageInput = {
  file: Express.Multer.File;
  subject: string;
  form: string;
  title: string;
  sourceName?: string | null;
  year?: number | null;
  paperLabel?: string | null;
  paperId?: string;
};

export type IngestMarkSchemeImageResult = {
  paperId: string;
  pastPaperDbId: number;
  chunkId: string | undefined;
  chunkDbId: number | undefined;
  sourceImageUrl: string;
  rawOcrText: string;
  structured: unknown;
};

export async function ingestMarkSchemeImage(input: IngestMarkSchemeImageInput): Promise<IngestMarkSchemeImageResult> {
  if (!ragDb) throw new Error("RAG database is not configured");

  const { file, subject, form, title } = input;
  const sourceName = input.sourceName?.trim() || file.originalname || null;
  const paperId = input.paperId?.trim() || `pp-ms-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const uploadedImage = await uploadKnowledgeImageToOss(file);
  const rawOcrText = await qwenOcrImage(file);
  const structured = await structureMarkSchemeFromOcr({
    ocrText: rawOcrText,
    subject,
    form,
    title,
  });

  const structuredRecord =
    structured && typeof structured === "object" ? (structured as Record<string, unknown>) : {};
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
      year: input.year ?? null,
      paperLabel: input.paperLabel ?? null,
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
      content,
    })
    .returning({
      id: ragPastPaperChunksTable.id,
      chunkId: ragPastPaperChunksTable.chunkId,
    });

  return {
    paperId,
    pastPaperDbId,
    chunkId: insertedChunk[0]?.chunkId,
    chunkDbId: insertedChunk[0]?.id,
    sourceImageUrl: uploadedImage.url,
    rawOcrText,
    structured,
  };
}
