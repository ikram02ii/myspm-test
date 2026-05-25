import { azureTranscribe } from "./azure";
import {
  getLangConfig,
  getOpenAIPrompt,
  isSttModelConfigured,
} from "./config";
import { openaiTranscribe } from "./openai";
import { qwenTranscribe } from "./qwen";
import { withTempAudioFile } from "./tempAudioFile";
import type { SttLanguage, TranscribeInput, TranscribeResult } from "./types";

export function parseSttLanguage(raw: string | undefined): SttLanguage {
  if (raw === "en-MY" || raw === "mixed") return raw;
  return "ms-MY";
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  if (!isSttModelConfigured(input.model)) {
    throw new Error(`Model "${input.model}" is not configured or unknown`);
  }

  const { azureLang, openaiLang } = getLangConfig(input.language);
  const openaiPrompt = getOpenAIPrompt(input.language);
  const originalName = input.originalName || "audio.wav";

  const transcript = await withTempAudioFile(
    input.audioBuffer,
    originalName,
    async (filePath) => {
      if (input.model === "openai") {
        return openaiTranscribe(filePath, openaiLang, openaiPrompt);
      }
      if (input.model === "azure") {
        return azureTranscribe(filePath, azureLang);
      }
      return qwenTranscribe(filePath, input.language);
    },
  );

  return {
    transcript,
    model: input.model,
    language: input.language,
  };
}
