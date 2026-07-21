import type { SttLanguage, SttModelId, SttModelInfo } from "./types";

const ALL_MODELS: Array<{ id: SttModelId; label: string; requires: string[] }> = [
  { id: "openai", label: "OpenAI (gpt-4o-transcribe)", requires: ["OPENAI_API_KEY"] },
  { id: "azure", label: "Azure Speech", requires: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] },
  { id: "qwen", label: "Qwen (qwen3-asr-flash-filetrans)", requires: ["QWEN_API_KEY"] },
];

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Resolves STT API key from dedicated or existing DashScope/Qwen env vars. */
export function resolveQwenApiKey(): string | undefined {
  return (
    env("QWEN_API_KEY") ??
    env("QWEN_GRADING_API_KEY") ??
    env("ALIBABA_LLM_API_KEY")
  );
}

function envSatisfied(key: string): boolean {
  if (key === "QWEN_API_KEY") return !!resolveQwenApiKey();
  return !!env(key);
}

export function configuredSttModels(): SttModelInfo[] {
  return ALL_MODELS.filter((m) => m.requires.every(envSatisfied)).map(({ id, label }) => ({
    id,
    label,
  }));
}

export function isSttModelConfigured(model: string): model is SttModelId {
  return configuredSttModels().some((m) => m.id === model);
}

export function getLangConfig(language: SttLanguage): {
  azureLang: string;
  openaiLang: string;
} {
  if (language === "en-MY") return { azureLang: "en-MY", openaiLang: "en" };
  return { azureLang: "ms-MY", openaiLang: "ms" };
}

export function getOpenAIPrompt(language: SttLanguage): string {
  if (language === "en-MY") return "Transcribe in English.";
  if (language === "mixed") {
    return "Transcribe in Malay and English. Preserve code-switching as spoken.";
  }
  return "Transkripsi dalam Bahasa Melayu. Sertakan bahasa Inggeris jika ada.";
}

export function qwenLanguageHints(language: SttLanguage): string[] {
  if (language === "en-MY") return ["en"];
  if (language === "mixed") return ["ms", "en"];
  return ["ms"];
}

export function openAiModel(): string {
  return env("OPENAI_MODEL") ?? "gpt-4o-transcribe";
}

export function openAiApiKey(): string | undefined {
  return env("OPENAI_API_KEY");
}

export function azureSpeechKey(): string | undefined {
  return env("AZURE_SPEECH_KEY");
}

export function azureSpeechRegion(): string | undefined {
  return env("AZURE_SPEECH_REGION");
}
