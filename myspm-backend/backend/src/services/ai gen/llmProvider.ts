import { embedTexts as embedTextsViaQwen } from "../rag/embeddingsService";

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

export async function generateImage(prompt: string): Promise<string[]> {
  void prompt;
  return [];
}
