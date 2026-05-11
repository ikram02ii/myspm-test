import type { ContextAuditResult, RetrievedChunk } from "./types";

type QwenAuditShape = {
  relevanceScore?: number;
  isSufficientContext?: boolean;
  relevantChunkIds?: string[];
  irrelevantChunkIds?: string[];
  reason?: string;
};

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model =
    process.env["QWEN_GRADING_MODEL"]?.trim() || process.env["QWEN_MODEL"]?.trim() || "qwen-plus";

  if (!apiKey || !baseUrl) {
    throw new Error("Qwen grading is not configured (set QWEN_GRADING_API_KEY/BASE_URL or reuse QWEN_OCR_*).");
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

function fallbackAudit(question: string, chunks: RetrievedChunk[]): ContextAuditResult {
  const loweredQuestion = question.toLowerCase();
  const relevantChunkIds: string[] = [];
  const irrelevantChunkIds: string[] = [];

  for (const chunk of chunks) {
    const loweredContent = chunk.content.toLowerCase();
    if (loweredContent.includes(loweredQuestion.slice(0, Math.min(25, loweredQuestion.length)))) {
      relevantChunkIds.push(chunk.chunkId);
    } else if (chunk.score >= 0.7) {
      relevantChunkIds.push(chunk.chunkId);
    } else {
      irrelevantChunkIds.push(chunk.chunkId);
    }
  }

  const relevanceScore = chunks.length > 0 ? relevantChunkIds.length / chunks.length : 0;
  return {
    relevanceScore,
    isSufficientContext: relevanceScore >= 0.5 && relevantChunkIds.length >= 2,
    relevantChunkIds,
    irrelevantChunkIds,
    reason: "Fallback deterministic audit was used because model audit parsing failed.",
  };
}

export async function auditRetrievedContext(
  questionText: string,
  retrievedChunks: RetrievedChunk[],
): Promise<ContextAuditResult> {
  if (retrievedChunks.length === 0) {
    return {
      relevanceScore: 0,
      isSufficientContext: false,
      relevantChunkIds: [],
      irrelevantChunkIds: [],
      reason: "No retrieved chunks were available for auditing.",
    };
  }

  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const chunkSummaries = retrievedChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    title: chunk.title,
    subject: chunk.subject,
    form: chunk.form,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
    content: chunk.content.slice(0, 1200),
  }));

  const payload = {
    model: config.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You audit retrieved textbook chunks for grading. Return strict JSON only: relevanceScore (0..1), isSufficientContext (boolean), relevantChunkIds (string[]), irrelevantChunkIds (string[]), reason (string).",
      },
      {
        role: "user",
        content: [
          `Question:\n${questionText}`,
          `Retrieved chunks JSON:\n${JSON.stringify(chunkSummaries)}`,
          "Rules:",
          "- Mark a chunk relevant only if it directly supports answering or grading the given question.",
          "- Penalize chapter headers, table-of-contents-like text, and unrelated topic snippets.",
          "- isSufficientContext should be true only when there is enough high-relevance evidence for reliable grading.",
        ].join("\n\n"),
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    return fallbackAudit(questionText, retrievedChunks);
  }

  if (!response.ok) {
    throw new Error(
      parsedResponse?.error?.message ||
        parsedResponse?.message ||
        `Context audit failed (${response.status})`,
    );
  }

  const content = messageContentToString(parsedResponse?.choices?.[0]?.message?.content);
  try {
    const parsedAudit = JSON.parse(extractJson(content)) as QwenAuditShape;
    const relevantChunkIds = Array.isArray(parsedAudit.relevantChunkIds)
      ? parsedAudit.relevantChunkIds.filter((id): id is string => typeof id === "string")
      : [];
    const irrelevantChunkIds = Array.isArray(parsedAudit.irrelevantChunkIds)
      ? parsedAudit.irrelevantChunkIds.filter((id): id is string => typeof id === "string")
      : [];

    const relevanceScoreRaw = typeof parsedAudit.relevanceScore === "number" ? parsedAudit.relevanceScore : 0;
    const relevanceScore = Math.max(0, Math.min(1, relevanceScoreRaw));

    return {
      relevanceScore,
      isSufficientContext: Boolean(parsedAudit.isSufficientContext),
      relevantChunkIds,
      irrelevantChunkIds,
      reason:
        typeof parsedAudit.reason === "string" && parsedAudit.reason.trim().length > 0
          ? parsedAudit.reason.trim()
          : "No audit reason provided.",
    };
  } catch {
    return fallbackAudit(questionText, retrievedChunks);
  }
}
