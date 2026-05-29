import { embedTexts as embedTextsViaQwen } from "../rag/retrieval/embeddingsService";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatOpts = {
  subject?: string | null;
  query?: string;
};

export type LlmProvider = "auto" | "dashscope" | "gemini";

function normalizeProvider(v: string | undefined): LlmProvider {
  const raw = (v ?? "auto").trim().toLowerCase();
  if (raw === "dashscope" || raw === "gemini" || raw === "auto") return raw;
  return "auto";
}

export function resolveLlmProvider(): Exclude<LlmProvider, "auto"> {
  const configured = normalizeProvider(process.env.RAG_LLM_PROVIDER);
  if (configured === "dashscope" || configured === "gemini") return configured;
  if ((process.env.GEMINI_API_KEY?.trim() ?? "").length > 0) return "gemini";
  return "dashscope";
}

export function requireLlmKey(): string {
  const key =
    process.env["QWEN_GRADING_API_KEY"]?.trim() ||
    process.env["QWEN_OCR_API_KEY"]?.trim() ||
    process.env["ALIBABA_LLM_API_KEY"]?.trim();
  if (!key) {
    throw new Error("Set ALIBABA_LLM_API_KEY, QWEN_GRADING_API_KEY, or QWEN_OCR_API_KEY in backend/.env");
  }
  return key;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return embedTextsViaQwen(texts);
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: ChatOpts,
): Promise<string> {
  const apiKey = requireLlmKey();
  const baseUrl = (
    process.env["QWEN_GRADING_BASE_URL"]?.trim() ||
    process.env["QWEN_OCR_BASE_URL"]?.trim() ||
    process.env["ALIBABA_LLM_API_BASE_URL"]?.trim() ||
    ""
  ).replace(/\/+$/, "");
  const model = resolveChatModel(opts);

  if (!baseUrl) {
    throw new Error("Set ALIBABA_LLM_API_BASE_URL, QWEN_GRADING_BASE_URL, or QWEN_OCR_BASE_URL in backend/.env");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  const raw = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 500) || `Qwen chat failed (${response.status})`);
  }

  if (!response.ok) {
    const message =
      parsed?.error?.message || parsed?.message || raw.slice(0, 500) || `Qwen chat failed (${response.status})`;
    throw new Error(message);
  }

  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Qwen chat: missing message content");
  }
  return content;
}

function resolveChatModel(opts?: ChatOpts): string {
  const explicitModel =
    process.env["QWEN_GRADING_MODEL"]?.trim() ||
    process.env["QWEN_MODEL"]?.trim() ||
    process.env["ALIBABA_LLM_API_MODEL"]?.trim();

  const subject = opts?.subject?.trim().toLowerCase() ?? "";
  const query = opts?.query?.trim().toLowerCase() ?? "";
  const mathScienceSubjects = new Set([
    "math",
    "mathematics",
    "additional math",
    "addmath",
    "physics",
    "biology",
    "chemistry",
    "science",
  ]);
  const languageSubjects = new Set(["bm", "bahasa melayu", "english", "chinese"]);
  const wantsKbat = /\bkbat\b|essay|karangan|subjective|open[- ]ended/.test(query);

  if (mathScienceSubjects.has(subject)) {
    return process.env["RAG_MODEL_MATH_SCIENCE"]?.trim() || explicitModel || "qwen-plus";
  }

  if (languageSubjects.has(subject) || wantsKbat) {
    return process.env["RAG_MODEL_LANGUAGE_KBAT"]?.trim() || explicitModel || "qwen-plus";
  }

  return process.env["RAG_MODEL_GENERAL"]?.trim() || explicitModel || "qwen-plus";
}

export type GenerateImageOptions = {
  size?: string;
  n?: number;
  /** When false, DashScope will not rewrite/expand the prompt (better for text-free diagrams). */
  promptExtend?: boolean;
  /** DashScope native API: strongly suppress text/labels in the image. */
  negativePrompt?: string;
};

function resolveImageApiKey(): string {
  return (
    process.env["ALIBABA_LLM_API_KEY"]?.trim() ||
    process.env["QWEN_GRADING_API_KEY"]?.trim() ||
    process.env["QWEN_OCR_API_KEY"]?.trim() ||
    requireLlmKey()
  );
}

const DASHSCOPE_NATIVE_IMAGE_ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

function resolveImageEndpoint(): string {
  const explicit = process.env["RAG_IMAGE_ENDPOINT"]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return DASHSCOPE_NATIVE_IMAGE_ENDPOINT;
}

function usesOpenAiImageFormat(endpoint: string): boolean {
  return /\/images\/generations\/?$/i.test(endpoint);
}

function resolveImageModel(): string {
  return process.env["RAG_IMAGE_MODEL"]?.trim() || "qwen-image-2.0-pro";
}

/** DashScope text-to-image expects `1024*1024`, not `1024x1024`. */
function normalizeDashScopeImageSize(raw: string | undefined): string {
  const value = raw?.trim() || "1024*1024";
  return value.replace(/x/gi, "*");
}

function parseOpenAiImageUrls(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const data = (parsed as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];

  const urls: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.url === "string" && row.url.trim()) {
      urls.push(row.url.trim());
      continue;
    }
    if (typeof row.b64_json === "string" && row.b64_json.trim()) {
      urls.push(`data:image/png;base64,${row.b64_json.trim()}`);
    }
  }
  return urls;
}

function parseDashScopeNativeImageUrls(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, unknown>;
  const urls: string[] = [];

  const pushImage = (value: unknown) => {
    if (typeof value === "string" && value.trim()) urls.push(value.trim());
  };

  const output = root.output;
  if (output && typeof output === "object") {
    const choices = (output as Record<string, unknown>).choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") continue;
        const message = (choice as Record<string, unknown>).message;
        if (!message || typeof message !== "object") continue;
        const content = (message as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (part && typeof part === "object") {
            pushImage((part as Record<string, unknown>).image);
          }
        }
      }
    }
    const results = (output as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const row of results) {
        if (row && typeof row === "object") {
          pushImage((row as Record<string, unknown>).url);
        }
      }
    }
  }

  return urls;
}

async function generateImageOpenAiCompatible(
  endpoint: string,
  prompt: string,
  n: number,
  size: string,
): Promise<string[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolveImageApiKey()}`,
    },
    body: JSON.stringify({
      model: resolveImageModel(),
      prompt,
      n,
      size: size.replace(/\*/g, "x"),
    }),
  });

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 500) || `Image API failed (${response.status})`);
  }

  if (!response.ok) {
    const err = parsed as Record<string, unknown>;
    const errObj = err?.error as Record<string, unknown> | undefined;
    const message =
      (typeof errObj?.message === "string" && errObj.message) ||
      (typeof err?.message === "string" && err.message) ||
      raw.slice(0, 500) ||
      `Image API failed (${response.status})`;
    throw new Error(message);
  }

  return parseOpenAiImageUrls(parsed);
}

async function generateImageDashScopeNative(
  endpoint: string,
  prompt: string,
  n: number,
  size: string,
  promptExtend: boolean,
  negativePrompt?: string,
): Promise<string[]> {
  const parameters: Record<string, unknown> = {
    n,
    size,
    watermark: false,
    prompt_extend: promptExtend,
    negative_prompt:
      negativePrompt?.trim() ||
      process.env["RAG_IMAGE_NEGATIVE_PROMPT"]?.trim() ||
      " ",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolveImageApiKey()}`,
    },
    body: JSON.stringify({
      model: resolveImageModel(),
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
      },
      parameters,
    }),
  });

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 500) || `Image API failed (${response.status})`);
  }

  if (!response.ok) {
    const err = parsed as Record<string, unknown>;
    const message =
      (typeof err.message === "string" && err.message) ||
      (typeof err.code === "string" && err.code) ||
      raw.slice(0, 500) ||
      `Image API failed (${response.status})`;
    throw new Error(String(message));
  }

  const code = (parsed as Record<string, unknown>).code;
  const message = (parsed as Record<string, unknown>).message;
  if (typeof code === "string" && code.trim()) {
    throw new Error(typeof message === "string" && message.trim() ? message : code);
  }

  const urls = parseDashScopeNativeImageUrls(parsed);
  if (urls.length === 0) {
    throw new Error("Image API returned no image URL");
  }
  return urls;
}

/** DashScope text-to-image (native multimodal API; see RAG_IMAGE_* in .env). */
export async function generateImage(prompt: string, opts?: GenerateImageOptions): Promise<string[]> {
  const trimmed = prompt.trim().slice(0, 800);
  if (!trimmed) return [];

  const endpoint = resolveImageEndpoint();
  if (!endpoint) {
    throw new Error("Set RAG_IMAGE_ENDPOINT in backend/.env");
  }

  const nRaw = opts?.n ?? Number(process.env["RAG_IMAGE_COUNT_PER_REQUEST"] ?? "1");
  const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(4, Math.floor(nRaw))) : 1;
  const size = normalizeDashScopeImageSize(opts?.size ?? process.env["RAG_IMAGE_SIZE"]);
  const promptExtend =
    opts?.promptExtend ??
    !/^(false|0|no)$/i.test(process.env["RAG_IMAGE_PROMPT_EXTEND"]?.trim() ?? "true");

  if (usesOpenAiImageFormat(endpoint)) {
    return generateImageOpenAiCompatible(endpoint, trimmed, n, size);
  }
  return generateImageDashScopeNative(endpoint, trimmed, n, size, promptExtend, opts?.negativePrompt);
}
