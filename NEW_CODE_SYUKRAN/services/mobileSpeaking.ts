import { Platform } from "react-native";

import { ragApiPost } from "./ragApi";
import { ragApiPostFormData } from "./ragApi";

export type SpeakingGradePhase = "prepare" | "speak";

export type SpeakingGradeResponse = {
  phase: SpeakingGradePhase;
  score: number;
  maxScore: number;
  band: string;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

export type SpeakingTranscribeResponse = {
  transcript: string;
  model: string;
  language: string;
};

export async function transcribeSpeakingAudio(uri: string): Promise<SpeakingTranscribeResponse> {
  const form = new FormData();
  const name = `speaking-${Date.now()}.m4a`;
  const type = "audio/m4a";

  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    form.append("audio", blob, name);
  } else {
    form.append("audio", { uri, name, type } as unknown as Blob);
  }

  return ragApiPostFormData<SpeakingTranscribeResponse>("/rag/speaking/transcribe", form);
}

export async function gradeSpeakingResponse(params: {
  phase: SpeakingGradePhase;
  cueCard: string;
  transcript: string;
  subject?: string;
  form?: string;
  durationSeconds?: number;
}): Promise<SpeakingGradeResponse> {
  return ragApiPost<SpeakingGradeResponse>("/rag/speaking/grade", params);
}

export function formatSpeakingGradeSummary(result: SpeakingGradeResponse): string {
  const lines = [
    `${result.phase === "prepare" ? "Preparation" : "Long turn"}: ${result.score}/${result.maxScore} (${result.band})`,
    "",
    result.feedback,
  ];
  if (result.strengths.length > 0) {
    lines.push("", "Strengths:", ...result.strengths.map((s) => `• ${s}`));
  }
  if (result.improvements.length > 0) {
    lines.push("", "Improve:", ...result.improvements.map((s) => `• ${s}`));
  }
  return lines.join("\n");
}
