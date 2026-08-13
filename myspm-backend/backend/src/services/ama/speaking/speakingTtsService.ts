/**
 * Qwen / DashScope text-to-speech for the SPM English speaking examiner.
 */

export type SpeakingTtsResult = {
  audioUrl: string;
  model: string;
  voice: string;
};

function ttsModel(): string {
  return process.env.QWEN_TTS_MODEL?.trim() || "qwen3-tts-flash";
}

function ttsVoice(): string {
  // Clear English system voice; override with QWEN_TTS_VOICE if desired.
  return process.env.QWEN_TTS_VOICE?.trim() || "Ethan";
}

function resolveApiKey(): string {
  const key =
    process.env.QWEN_API_KEY?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.ALIBABA_LLM_API_KEY?.trim();
  if (!key) {
    throw new Error("Set QWEN_API_KEY in backend/.env for examiner text-to-speech.");
  }
  return key;
}

const DASHSCOPE_TTS_ENDPOINT =
  process.env.QWEN_TTS_ENDPOINT?.trim() ||
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

/** Synthesize examiner speech; returns a short-lived audio URL from DashScope. */
export async function synthesizeSpeakingTts(text: string): Promise<SpeakingTtsResult> {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    throw new Error("text is required for TTS");
  }

  // qwen3-tts-flash supports up to ~600 characters
  const inputText = trimmed.length > 580 ? `${trimmed.slice(0, 577)}...` : trimmed;
  const model = ttsModel();
  const voice = ttsVoice();
  const apiKey = resolveApiKey();

  const res = await fetch(DASHSCOPE_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: {
        text: inputText,
        voice,
        language_type: "English",
      },
    }),
  });

  const data = (await res.json()) as {
    code?: string;
    message?: string;
    output?: { audio?: { url?: string } };
  };

  if (!res.ok) {
    throw new Error(
      `Qwen TTS failed (${res.status}): ${data.message || data.code || res.statusText}`,
    );
  }

  const audioUrl = data.output?.audio?.url?.trim();
  if (!audioUrl) {
    throw new Error(
      `Qwen TTS returned no audio URL: ${data.message || JSON.stringify(data).slice(0, 240)}`,
    );
  }

  return { audioUrl, model, voice };
}
