export type SttModelId = "openai" | "azure" | "qwen";

export type SttLanguage = "en-MY" | "ms-MY" | "mixed";

export type SttModelInfo = {
  id: SttModelId;
  label: string;
};

export type TranscribeInput = {
  audioBuffer: Buffer;
  originalName: string;
  mimeType?: string;
  model: SttModelId;
  language: SttLanguage;
};

export type TranscribeResult = {
  transcript: string;
  model: SttModelId;
  language: SttLanguage;
};
