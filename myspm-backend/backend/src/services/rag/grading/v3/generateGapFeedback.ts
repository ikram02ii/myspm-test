import { qwenGradingJson } from "../qwenGradingClient";
import { formatSpmStudentFriendlyRulesBlock } from "../gradingPolicy";
import { chainWalkToFeedbackGaps } from "./coverageChainScorer";
import type { AssessmentCaseFile, GradingContext, UnderstandingDemonstration } from "./types";

export async function generateGapFeedback(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  score: number;
  maxScore: number;
  language?: "en" | "bm" | "mixed";
  gradingContext?: GradingContext;
}): Promise<{ feedback: string; strengths: string[]; improvements: string[] }> {
  const chainWalk = params.gradingContext?.chainWalk;
  const chainGaps =
    chainWalk && params.acf.markRule.kind === "coverage_chain"
      ? chainWalkToFeedbackGaps(params.acf, params.udm, chainWalk)
      : null;

  const demonstrated = chainWalk
    ? chainWalk.creditedUnits
        .map((id) => params.udm.unitsDemonstrated.find((d) => d.unitId === id && d.valid))
        .filter((d): d is NonNullable<typeof d> => d != null)
    : params.udm.unitsDemonstrated.filter((d) => d.valid);

  const gaps = chainGaps
    ? [
        ...chainGaps.blockedLabels.map((label) => ({
          kind: "unit" as const,
          label,
          reason: "Chain broken before this point — not credited.",
        })),
        ...chainGaps.missingChainLabels.map((label) => ({
          kind: "unit" as const,
          label,
          reason: "Not demonstrated in the answer.",
        })),
        ...chainGaps.relationGapLabels.map((label) => ({
          kind: "relation" as const,
          label,
          reason: "Required link not demonstrated.",
        })),
      ]
    : [...params.udm.unitsMissing, ...params.udm.relationsMissing];

  const system = [
    "Write SPM marking feedback for a student based on demonstrated understanding gaps.",
    formatSpmStudentFriendlyRulesBlock(),
    'Return JSON: { "feedback": string, "strengths": string[], "improvements": string[] }',
    "Feedback must reference gaps (missing evidence, missing links, missing stages) — NOT failed rubric rows.",
    "Quote the student's words when praising or correcting.",
    "Do not invent marks; score is already decided.",
    chainWalk
      ? "CHAIN SCORING (binding): Only units listed under Credited received marks. Blocked units were mentioned but not credited because an earlier chain link failed. Do NOT say a blocked unit earned credit."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Question: ${params.question}`,
    `Score: ${params.score}/${params.maxScore}`,
    `Assessed understanding: ${params.acf.assessedUnderstanding}`,
    chainWalk
      ? [
          `Credited (scored): ${chainGaps?.creditedLabels.join(" | ") || "(none)"}`,
          chainGaps?.blockedLabels.length
            ? `Blocked (mentioned, not credited): ${chainGaps.blockedLabels.join(" | ")}`
            : "",
          chainGaps?.missingChainLabels.length
            ? `Missing from chain: ${chainGaps.missingChainLabels.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : demonstrated.length > 0
        ? `Demonstrated:\n${demonstrated.map((d) => `- ${d.quote}`).join("\n")}`
        : "Demonstrated: (none clearly)",
    !chainWalk && gaps.length > 0
      ? `Gaps:\n${gaps.map((g) => `- [${g.kind}] ${g.label}: ${g.reason}`).join("\n")}`
      : !chainWalk
        ? "Gaps: none — full understanding shown."
        : gaps.length > 0
          ? `Gaps:\n${gaps.map((g) => `- [${g.kind}] ${g.label}: ${g.reason}`).join("\n")}`
          : "Gaps: none — full understanding shown.",
    params.udm.invalidClaims.length > 0
      ? `Incorrect claims:\n${params.udm.invalidClaims.map((c) => `- "${c.text}": ${c.reason}`).join("\n")}`
      : "",
    params.acf.referenceModelAnswer
      ? `Reference answer (guide only):\n${params.acf.referenceModelAnswer}`
      : "",
    `Student answer:\n${params.studentAnswer}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user, { temperature: 0.2 });
    const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
    const strengths = Array.isArray(parsed?.strengths)
      ? (parsed.strengths as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const improvements = Array.isArray(parsed?.improvements)
      ? (parsed.improvements as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    if (feedback.length > 0) {
      return { feedback, strengths, improvements };
    }
  } catch {
    /* fallback */
  }

  if (params.score >= params.maxScore) {
    return {
      feedback: "Your answer demonstrates the required understanding. Well done.",
      strengths: demonstrated.map((d) => d.quote).slice(0, 3),
      improvements: [],
    };
  }

  const gapText = gaps.map((g) => g.label).slice(0, 3).join("; ");
  return {
    feedback: gapText
      ? `You scored ${params.score}/${params.maxScore}. To improve: ${gapText}.`
      : `You scored ${params.score}/${params.maxScore}. Expand your answer to show more of the expected understanding.`,
    strengths: demonstrated.map((d) => d.quote).slice(0, 2),
    improvements: gaps.map((g) => g.reason).slice(0, 3),
  };
}
