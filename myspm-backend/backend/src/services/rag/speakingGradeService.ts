import { chatCompletion } from "../ai gen/llmProvider";

export type SpeakingExamPhase = "prepare" | "speak";

export type SpeakingGradeResult = {
  phase: SpeakingExamPhase;
  score: number;
  maxScore: number;
  band: string;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function phaseInstructions(phase: SpeakingExamPhase): string {
  if (phase === "prepare") {
    return [
      "Phase: 1-minute PREPARATION (exam simulation).",
      "The student may outline ideas aloud or practise key phrases — not the final long turn.",
      "Mark: coverage of cue-card bullet points, clarity of plan, relevant vocabulary, organisation.",
      "Do not penalise heavily for brevity if the plan is strong.",
    ].join(" ");
  }
  return [
    "Phase: 1–2 minute INDIVIDUAL LONG TURN (exam simulation).",
    "Mark: fluency, pronunciation (as inferable from transcript), content coverage of all bullet prompts,",
    "coherence, range of language, and natural Malaysian classroom English.",
  ].join(" ");
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
    return {
      phase: params.phase,
      score: 0,
      maxScore: 10,
      band: "No response",
      feedback:
        "No speech was detected. Try again in a quiet place and speak clearly into the microphone.",
      strengths: [],
      improvements: ["Record again with the microphone unobstructed."],
    };
  }

  const system = `You are an SPM English Speaking examiner (Malaysia). Grade one phase of the oral exam.
${phaseInstructions(params.phase)}
Return ONLY valid JSON:
{
  "score": <integer 0-10>,
  "maxScore": 10,
  "band": "<short label e.g. Excellent / Good / Fair / Weak>",
  "feedback": "<2-4 sentences for the student>",
  "strengths": ["<point>", "..."],
  "improvements": ["<point>", "..."]
}`;

  const user = [
    `Subject: ${params.subject ?? "English"}`,
    `Form: ${params.form ?? "Form 4"}`,
    `Recorded duration (seconds): ${params.durationSeconds ?? "unknown"}`,
    "",
    "Cue card:",
    params.cueCard.trim(),
    "",
    "Student transcript:",
    transcript,
  ].join("\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { subject: params.subject ?? "English", maxTokens: 900, temperature: 0.35 },
  );

  const parsed = extractJsonObject(raw);
  const scoreRaw = Number(parsed?.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, Math.round(scoreRaw))) : 5;

  return {
    phase: params.phase,
    score,
    maxScore: 10,
    band: typeof parsed?.band === "string" ? parsed.band : score >= 7 ? "Good" : "Fair",
    feedback:
      typeof parsed?.feedback === "string"
        ? parsed.feedback
        : "Thank you for your response. Review the cue card and practise covering every bullet point.",
    strengths: Array.isArray(parsed?.strengths)
      ? parsed.strengths.filter((v): v is string => typeof v === "string").slice(0, 5)
      : [],
    improvements: Array.isArray(parsed?.improvements)
      ? parsed.improvements.filter((v): v is string => typeof v === "string").slice(0, 5)
      : [],
  };
}
