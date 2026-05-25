import AsyncStorage from "@react-native-async-storage/async-storage";

import { AUTH_TOKEN_STORAGE_KEY } from "../constants/storageKeys";
import { getMobileApiBaseUrlPrefix } from "./mobileApiBaseUrl";
import { networkLoggerFinish, networkLoggerStart } from "./networkLogger";

export type SttModelId = "openai" | "azure" | "qwen";

export type SttLanguage = "en-MY" | "ms-MY" | "mixed";

export type SttModelInfo = {
  id: SttModelId;
  label: string;
};

export type TranscribeResponse = {
  success: boolean;
  data?: {
    transcript: string;
    model: SttModelId;
    language: SttLanguage;
  };
  error?: string;
};

export type SttModelsResponse = {
  success: boolean;
  data?: SttModelInfo[];
  error?: string;
};

async function sttFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  const prefix = await getMobileApiBaseUrlPrefix();
  const url = `${prefix}/api${path.startsWith("/") ? path : `/${path}`}`;

  const logId = networkLoggerStart({
    method: init?.method ?? "GET",
    url,
    requestBody: init?.body ?? null,
  });
  const t0 = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const rawText = await response.text();
    let parsed: T & { error?: string };
    try {
      parsed = JSON.parse(rawText) as T & { error?: string };
    } catch {
      parsed = { error: rawText } as T & { error?: string };
    }

    networkLoggerFinish(logId, {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - t0,
      responseBody: parsed,
    });

    if (!response.ok) {
      throw new Error(parsed.error ?? "STT request failed");
    }

    return parsed;
  } catch (error) {
    networkLoggerFinish(logId, {
      durationMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchSttModels(): Promise<SttModelInfo[]> {
  const res = await sttFetch<SttModelsResponse>("/stt/models");
  return res.data ?? [];
}

export type TranscribeAudioParams = {
  /** Local file URI from expo-av recording (file://...) */
  uri: string;
  model: SttModelId;
  language?: SttLanguage;
  /** e.g. audio/wav — defaults from filename */
  mimeType?: string;
  filename?: string;
};

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3") || lower.endsWith(".mpeg")) return "audio/mpeg";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/wav";
}

export type TranscribeRecordingParams = {
  model: SttModelId;
  language?: SttLanguage;
  filename: string;
  mimeType: string;
  uri: string;
  blob?: Blob;
};

export async function transcribeRecording(params: TranscribeRecordingParams): Promise<string> {
  const mimeType = params.mimeType || mimeFromFilename(params.filename);
  const form = new FormData();
  form.append("model", params.model);
  form.append("language", params.language ?? "ms-MY");

  if (params.blob) {
    form.append("audio", params.blob, params.filename);
  } else {
    form.append("audio", {
      uri: params.uri,
      name: params.filename,
      type: mimeType,
    } as unknown as Blob);
  }

  const res = await sttFetch<TranscribeResponse>("/stt/transcribe", {
    method: "POST",
    body: form,
  });

  const transcript = res.data?.transcript?.trim();
  if (!transcript) {
    throw new Error("No transcript returned");
  }
  return transcript;
}

/** @deprecated Use transcribeRecording */
export async function transcribeAudioFile(params: TranscribeAudioParams): Promise<string> {
  return transcribeRecording({
    uri: params.uri,
    model: params.model,
    language: params.language,
    filename: params.filename ?? "recording.wav",
    mimeType: params.mimeType ?? mimeFromFilename(params.filename ?? "recording.wav"),
  });
}
