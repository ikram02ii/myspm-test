import { chatCompletion } from "../../ai gen/llmProvider";
import {
  SPM_SPEAKING_CRITERIA,
  SPM_SPEAKING_CRITERION_MAX,
  SPM_SPEAKING_OVERALL_MAX,
  buildSpmSpeakingAssessmentSystemPrompt,
  type SpeakingCriterionId,
  type SpeakingExamPhase,
} from "./speakingAssessmentPolicy";

export type { SpeakingExamPhase };

export type SpeakingCriterionBand = "weak" | "adequate" | "strong";

export type SpeakingCriterionScore = {
  id: SpeakingCriterionId;
  label: string;
  score: number;
  maxScore: number;
  band: SpeakingCriterionBand;
  justification: string;
};

export type SpeakingGradeResult = {
  phase: SpeakingExamPhase;
  score: number;
  maxScore: number;
  band: string;
  feedback: string;
  strengths: string[];
  improvements: string[];
  /** Per-criterion marks with examiner justification. */
  criteria: SpeakingCriterionScore[];
  /** Higher-band sample answer for the same prompt. */
  modelResponse?: string;
};

const CRITERION_IDS = new Set(SPM_SPEAKING_CRITERIA.map((c) => c.id));

function extractJsonObject(text: string): Record<string, unknown> | null {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeBand(raw: unknown, score: number): SpeakingCriterionBand {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "weak" || s === "adequate" || s === "strong") return s;
  if (score >= 2) return "strong";
  if (score >= 1) return "adequate";
  return "weak";
}

function overallBandFromScore(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.85) return "Excellent";
  if (ratio >= 0.65) return "Good";
  if (ratio >= 0.45) return "Fair";
  if (score > 0) return "Weak";
  return "No response";
}

function parseCriteria(parsed: Record<string, unknown> | null): SpeakingCriterionScore[] {
  const raw = parsed?.criteria;
  const byId = new Map<SpeakingCriterionId, SpeakingCriterionScore>();

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (!CRITERION_IDS.has(id as SpeakingCriterionId)) continue;
      const def = SPM_SPEAKING_CRITERIA.find((c) => c.id === id)!;
      const scoreRaw = Number(o.score);
      const score = Number.isFinite(scoreRaw)
        ? Math.max(0, Math.min(SPM_SPEAKING_CRITERION_MAX, Math.round(scoreRaw)))
        : 1;
      byId.set(id as SpeakingCriterionId, {
        id: id as SpeakingCriterionId,
        label: def.label,
        score,
        maxScore: SPM_SPEAKING_CRITERION_MAX,
        band: normalizeBand(o.band, score),
        justification:
          typeof o.justification === "string" && o.justification.trim()
            ? o.justification.trim()
            : "See overall feedback.",
      });
    }
  }

  return SPM_SPEAKING_CRITERIA.map((def) => {
    const existing = byId.get(def.id);
    if (existing) return existing;
    return {
      id: def.id,
      label: def.label,
      score: 0,
      maxScore: SPM_SPEAKING_CRITERION_MAX,
      band: "weak" as const,
      justification: "This aspect was not demonstrated clearly in the response.",
    };
  });
}

function emptyGrade(phase: SpeakingExamPhase, message: string): SpeakingGradeResult {
  const criteria = SPM_SPEAKING_CRITERIA.map((def) => ({
    id: def.id,
    label: def.label,
    score: 0,
    maxScore: SPM_SPEAKING_CRITERION_MAX,
    band: "weak" as const,
    justification: "No spoken response to assess.",
  }));
  return {
    phase,
    score: 0,
    maxScore: SPM_SPEAKING_OVERALL_MAX,
    band: "No response",
    feedback: message,
    strengths: [],
    improvements: ["Record again and answer the prompt directly with reasons or examples."],
    criteria,
  };
}

export async function gradeSpeakingPhase(params: {
  phase: SpeakingExamPhase;
  cueCard: string;
  transcript: string;
  subject?: string;
  form?: string;
  durationSeconds?: number;
}): Promise<SpeakingGradeResult> {
  const transcript = params.transcript.trim();
  if (!transcript) {
    return emptyGrade(
      params.phase,
      "No speech was detected. Try again in a quiet place and speak clearly into the microphone.",
    );
  }

  const system = buildSpmSpeakingAssessmentSystemPrompt(params.phase);

  const user = [
    `Subject: ${params.subject ?? "English"}`,
    `Form: ${params.form ?? "Form 4"}`,
    `Recorded duration (seconds): ${params.durationSeconds ?? "unknown"}`,
    "",
    "Prompt / cue card:",
    params.cueCard.trim(),
    "",
    "Student transcript (only evidence — do not invent content):",
    transcript,
  ].join("\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { subject: params.subject ?? "English", maxTokens: 1600, temperature: 0.35 },
  );

  const parsed = extractJsonObject(raw);
  const criteria = parseCriteria(parsed);
  const score = criteria.reduce((sum, row) => sum + row.score, 0);
  const maxScore = SPM_SPEAKING_OVERALL_MAX;

  const overallBand =
    typeof parsed?.overallBand === "string" && parsed.overallBand.trim()
      ? parsed.overallBand.trim()
      : overallBandFromScore(score, maxScore);

  const modelResponse =
    typeof parsed?.modelResponse === "string" && parsed.modelResponse.trim()
      ? parsed.modelResponse.trim()
      : undefined;

  return {
    phase: params.phase,
    score,
    maxScore,
    band: overallBand,
    feedback:
      typeof parsed?.feedback === "string" && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : "Thank you for your response. Focus on answering the prompt with clear reasons and examples.",
    strengths: Array.isArray(parsed?.strengths)
      ? parsed.strengths.filter((v): v is string => typeof v === "string").slice(0, 6)
      : [],
    improvements: Array.isArray(parsed?.improvements)
      ? parsed.improvements.filter((v): v is string => typeof v === "string").slice(0, 6)
      : [],
    criteria,
    modelResponse,
  };
}
