type ConceptChunk = {
  /** e.g. "Chapter 1: Cell Structure" or "Bab 3: Enzim" — from textbook headings in the excerpt */
  chapter: string;
  conceptTitle: string;
  conceptSummary: string;
  chunkText: string;
  keywords: string[];
  isComplete: boolean;
};

type ConceptChunkResponse = {
  chunks: ConceptChunk[];
};

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey =
    process.env["QWEN_CHUNKING_API_KEY"]?.trim() ||
    process.env["QWEN_GRADING_API_KEY"]?.trim() ||
    process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_CHUNKING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model =
    process.env["QWEN_CHUNKING_MODEL"]?.trim() ||
    process.env["QWEN_GRADING_MODEL"]?.trim() ||
    process.env["QWEN_MODEL"]?.trim() ||
    "qwen-plus";

  if (!apiKey || !baseUrl) {
    throw new Error("Qwen chunking is not configured (set QWEN_CHUNKING_API_KEY/BASE_URL or reuse QWEN_*).");
  }
  return { apiKey, baseUrl, model };
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function sanitizeChunks(raw: unknown): ConceptChunk[] {
  const payload = raw as Partial<ConceptChunkResponse>;
  if (!Array.isArray(payload.chunks)) return [];
  return payload.chunks
    .map((chunk) => ({
      conceptTitle: String(chunk?.conceptTitle ?? "").trim(),
      conceptSummary: String(chunk?.conceptSummary ?? "").trim(),
      chunkText: String(chunk?.chunkText ?? "").trim(),
      keywords: Array.isArray(chunk?.keywords)
        ? chunk.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)
        : [],
      isComplete: Boolean(chunk?.isComplete),
    }))
    .filter((chunk) => chunk.conceptTitle.length > 0 && chunk.chunkText.length > 0);
}

export async function llmConceptChunkSection(params: {
  sectionText: string;
  subject: string;
  form: string;
  sourceName: string;
  pageStart?: number;
  pageEnd?: number;
  /** Optional ingest hint; weaker than sectionChapterFromPdf */
  chapter?: string;
  /** Chapter inferred from PDF page stream (Bab 2, Chapter 3, …) for this page span */
  sectionChapterFromPdf?: string;
}): Promise<ConceptChunk[]> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const timeoutMsRaw = process.env["QWEN_CHUNKING_TIMEOUT_MS"];
  const timeoutMs = Number.isFinite(Number(timeoutMsRaw)) ? Number(timeoutMsRaw) : 60_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const maxTokensRaw = process.env["QWEN_CHUNKING_MAX_TOKENS"];
  const maxTokens = Number.isFinite(Number(maxTokensRaw)) ? Math.max(64, Math.floor(Number(maxTokensRaw))) : 1200;

  const systemPrompt =
    "You split textbook text into concept-aware chunks for retrieval. Return JSON only with shape { chunks: [{ chapter, conceptTitle, conceptSummary, chunkText, keywords, isComplete }] }.";

  const pdfChapter =
    params.sectionChapterFromPdf?.trim() || params.chapter?.trim() || "";

  const userPrompt = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Source: ${params.sourceName}`,
    pdfChapter
      ? `Chapter for this excerpt (from PDF page order — use this exact chapter value for every chunk unless the excerpt clearly contains a newer heading below): ${pdfChapter}`
      : null,
    params.pageStart ? `Page start: ${params.pageStart}` : null,
    params.pageEnd ? `Page end: ${params.pageEnd}` : null,
    "Rules:",
    "- Do not invent information not present in the text.",
    "- chapter: REQUIRED for every chunk. If a PDF chapter line is given above, set chapter to that value for all chunks in this excerpt unless the excerpt text itself shows a different chapter heading (e.g. excerpt starts mid-document at a new BAB). Otherwise copy headings from the text (e.g. \"BAB 3\", \"Chapter 2: Cell Structure\"). Prefer the book's language (Bab N for BM books, Chapter N for English). If the excerpt only shows a section number (e.g. \"1.2\") with a title, use \"Section 1.2: <title>\". If nothing applies, use \"\".",
    "- Create one chunk per concept where possible.",
    "- If concept is mentioned but not explained, set isComplete=false or skip it.",
    "- chunkText target length is 400-1200 chars where possible.",
    "- Add useful SPM-level keywords/synonyms for retrieval.",
    "- Avoid chunks that are diagram labels only.",
    "- Avoid duplicates.",
    "Text:",
    params.sectionText,
  ]
    .filter((v): v is string => Boolean(v))
    .join("\n\n");

  const payload = {
    model: config.model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  const startedAt = Date.now();
  console.info("[rag][chunking] llm concept chunking request", {
    url,
    model: config.model,
    sectionChars: params.sectionText.length,
    pageStart: params.pageStart ?? null,
    pageEnd: params.pageEnd ?? null,
    timeoutMs,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  console.info("[rag][chunking] llm concept chunking response", {
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });

  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 500) || `Qwen concept chunking failed (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      parsedResponse?.error?.message ||
        parsedResponse?.message ||
        `Qwen concept chunking failed (${response.status})`,
    );
  }

  const content = messageContentToString(parsedResponse?.choices?.[0]?.message?.content);
  const parsed = JSON.parse(extractJson(content));
  return sanitizeChunks(parsed);
}

export type { ConceptChunk };
