import { Platform } from "react-native";

import { ragApiPost } from "./ragApi";
import { ragApiPostFormData } from "./ragApi";

export type SpeakingGradePhase = "prepare" | "speak";

export type SpeakingCriterionBand = "weak" | "adequate" | "strong";

export type SpeakingCriterionScore = {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  band: SpeakingCriterionBand;
  justification: string;
};

export type SpeakingGradeResponse = {
  phase: SpeakingGradePhase;
  score: number;
  maxScore: number;
  band: string;
  feedback: string;
  strengths: string[];
  improvements: string[];
  criteria: SpeakingCriterionScore[];
  modelResponse?: string;
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

function bandLabel(band: string): string {
  const b = band.toLowerCase();
  if (b === "strong") return "Strong";
  if (b === "adequate") return "Adequate";
  if (b === "weak") return "Weak";
  return band;
}

export function formatSpeakingGradeSummary(result: SpeakingGradeResponse): string {
  const phaseLabel = result.phase === "prepare" ? "Preparation" : "Response";
  const lines = [
    `${phaseLabel}: ${result.score}/${result.maxScore} (${result.band})`,
    "",
    result.feedback,
  ];

  if (result.criteria?.length > 0) {
    lines.push("", "Criterion scores:");
    for (const row of result.criteria) {
      lines.push(
        `• ${row.label}: ${row.score}/${row.maxScore} (${bandLabel(row.band)}) — ${row.justification}`,
      );
    }
  }

  if (result.strengths.length > 0) {
    lines.push("", "Strengths:", ...result.strengths.map((s) => `• ${s}`));
  }
  if (result.improvements.length > 0) {
    lines.push("", "Areas for improvement:", ...result.improvements.map((s) => `• ${s}`));
  }
  if (result.modelResponse?.trim()) {
    lines.push("", "Model response (higher band):", result.modelResponse.trim());
  }

  return lines.join("\n");
}
