import { Platform } from "react-native";

import { ragApiPostFormData } from "./ragApi";

/** Language hint for subject oral transcription (Qwen ASR via /rag/speaking/transcribe). */
export type SttLanguage = "en-MY" | "ms-MY" | "mixed";

export type TranscribeRecordingParams = {
  /** Local file URI from expo-av recording (file://...) */
  uri: string;
  language?: SttLanguage;
  /** e.g. audio/wav — defaults from filename */
  mimeType?: string;
  filename: string;
  blob?: Blob;
};

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3") || lower.endsWith(".mpeg")) return "audio/mpeg";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/wav";
}

type SpeakingTranscribeResponse = {
  transcript: string;
  model: string;
  language: string;
};

/**
 * Subject oral STT — same backend path as English speaking (`/rag/speaking/transcribe`).
 * Pass language (e.g. ms-MY) so Qwen uses the right language hints.
 */
export async function transcribeRecording(params: TranscribeRecordingParams): Promise<string> {
  const mimeType = params.mimeType || mimeFromFilename(params.filename);
  const form = new FormData();
  form.append("language", params.language ?? "ms-MY");

  if (params.blob) {
    form.append("audio", params.blob, params.filename);
  } else if (Platform.OS === "web") {
    const response = await fetch(params.uri);
    const blob = await response.blob();
    form.append("audio", blob, params.filename);
  } else {
    form.append("audio", {
      uri: params.uri,
      name: params.filename,
      type: mimeType,
    } as unknown as Blob);
  }

  const res = await ragApiPostFormData<SpeakingTranscribeResponse>(
    "/rag/speaking/transcribe",
    form,
  );

  const transcript = res.transcript?.trim();
  if (!transcript) {
    throw new Error("No transcript returned");
  }
  return transcript;
}

/** @deprecated Use transcribeRecording */
export async function transcribeAudioFile(params: {
  uri: string;
  language?: SttLanguage;
  mimeType?: string;
  filename?: string;
}): Promise<string> {
  return transcribeRecording({
    uri: params.uri,
    language: params.language,
    filename: params.filename ?? "recording.wav",
    mimeType: params.mimeType ?? mimeFromFilename(params.filename ?? "recording.wav"),
  });
}
