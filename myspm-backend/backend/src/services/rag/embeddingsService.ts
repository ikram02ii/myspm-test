/**
 * Lightweight Qwen/DashScope embeddings client.
 *
 * Uses the OpenAI-compatible endpoint already configured for grading
 * (QWEN_GRADING_BASE_URL + QWEN_GRADING_API_KEY). Falls back to OCR creds.
 *
 * Embeddings are returned as plain number arrays so they can be persisted
 * as JSON in a TEXT column (no pgvector dependency).
 */

type EmbedConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function resolveEmbedConfig(): EmbedConfig {
  const apiKey =
    process.env["QWEN_EMBEDDING_API_KEY"]?.trim() ||
    process.env["QWEN_GRADING_API_KEY"]?.trim() ||
    process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl = (
    process.env["QWEN_EMBEDDING_BASE_URL"]?.trim() ||
    process.env["QWEN_GRADING_BASE_URL"]?.trim() ||
    process.env["QWEN_OCR_BASE_URL"]?.trim() ||
    ""
  ).replace(/\/+$/, "");
  const model = process.env["QWEN_EMBEDDING_MODEL"]?.trim() || "text-embedding-v3";

  if (!apiKey || !baseUrl) {
    throw new Error(
      "Qwen embeddings are not configured (set QWEN_EMBEDDING_API_KEY/BASE_URL or reuse QWEN_GRADING_*).",
    );
  }
  return { apiKey, baseUrl, model };
}

const MAX_BATCH = 16;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const cleaned = texts.map((t) => (t ?? "").trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return [];

  const config = resolveEmbedConfig();
  const url = `${config.baseUrl}/embeddings`;

  const out: number[][] = [];
  for (let i = 0; i < cleaned.length; i += MAX_BATCH) {
    const batch = cleaned.slice(i, i + MAX_BATCH);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: batch,
        encoding_format: "float",
      }),
    });

    const rawText = await response.text();
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(rawText);
    } catch {
      throw new Error(rawText.slice(0, 500) || `Qwen embeddings failed (${response.status})`);
    }
    if (!response.ok) {
      const message =
        parsedResponse?.error?.message ||
        parsedResponse?.message ||
        rawText.slice(0, 500) ||
        `Qwen embeddings failed (${response.status})`;
      throw new Error(message);
    }

    const data = parsedResponse?.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error("Embedding response missing expected data array.");
    }
    for (const item of data) {
      const vec = item?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        throw new Error("Embedding response item has empty vector.");
      }
      out.push(vec.map((v: unknown) => (typeof v === "number" ? v : Number(v))));
    }
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error("embedText returned no vector");
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
