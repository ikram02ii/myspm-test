/**
 * Shared Qwen chat/completions JSON helper for grading-related calls
 * (idea extraction, borderline match verify, feedback).
 */

import type { RubricIdeaKind, VerifierMode } from "./types";
import { formatSpmExamStandardMarkingBlock } from "./gradingExaminerPolicy";
import { formatEvidenceOnlyMarkingBlock } from "./gradingEvidencePolicy";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";

export type QwenGradingConfig = { apiKey: string; baseUrl: string; model: string };

export function resolveQwenGradingConfig(): QwenGradingConfig {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model = process.env["QWEN_GRADING_MODEL"]?.trim() || "qwen-plus";
  if (!apiKey || !baseUrl) throw new Error("Qwen grading is not configured.");
  return { apiKey, baseUrl, model };
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export async function qwenGradingJson(system: string, user: string): Promise<any> {
  const config = resolveQwenGradingConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 500) || `Qwen call failed (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(parsedResponse?.error?.message || parsedResponse?.message || `Qwen call failed (${response.status})`);
  }
  const content = parsedResponse?.choices?.[0]?.message?.content;
  const raw = messageContentToString(content).trim();
  const jsonText = extractJson(raw);
  return JSON.parse(jsonText);
}

const VERIFIER_MODE_BLOCKS: Record<VerifierMode, string> = {
  meaning: [
    "Task: would an SPM examiner award this mark for the student's wording on this rubric point?",
    "Award only if the student shows the mark point with SPM-level specificity and detail (paraphrases OK).",
    "Withhold if only vaguely related, generic, incomplete, informal, or scientifically true but below exam standard.",
  ].join("\n"),
  membership: [
    "Task: did the student name a valid category member at SPM exam standard (specific enough to mark)?",
    "Award for a clear, markable instance — not a vague label or unrelated example.",
    "Withhold if too vague, wrong category, or scientifically related but not acceptable on an SPM mark scheme.",
  ].join("\n"),
  reasoning: [
    "Task: does the student's reasoning meet SPM marking-scheme standard for this mark point?",
    "Award only if the logic is sound AND specific enough for the marks (steps/mechanism as required).",
    "Withhold for wrong science, missing steps, or vague 'because' without the required mechanism.",
  ].join("\n"),
  method: [
    "Task: did the student use a correct method, formula, or approach for this step regardless of whether the final value is correct?",
    "Award if the approach is valid even with arithmetic errors.",
    "Withhold only if the method itself is wrong.",
  ].join("\n"),
  paired: [
    "Task: does this idea correctly describe the named item on this side of the comparison?",
    "Award only if the idea is correct AND applies to the right item.",
    "Withhold if the idea describes the other item even if correct.",
  ].join("\n"),
  sequence: [
    "Task: does the student's sequence/order meet SPM mark-scheme standard for this stage or full order?",
    "Award only when the required stage is present in the correct position (or full order when required).",
    "Withhold for wrong order, missing stages, or vague labels that do not name the required step.",
  ].join("\n"),
  equation: [
    "Task: check ALL of the following and award only if ALL pass —",
    "(1) all reactants present and correct,",
    "(2) all products present and correct — a missing product = wrong,",
    "(3) equation is balanced — count atoms of each element both sides,",
    "(4) coefficients correct — no fractional coefficients at SPM level unless the question explicitly requires them,",
    "(5) state symbols correct if the rubric includes them.",
    "Never award partial credit in this mode.",
    "Reason must identify the specific condition that failed or confirm all conditions passed.",
  ].join("\n"),
};

const LEAD_BY_MODE: Record<VerifierMode, string> = {
  meaning:
    "Would an SPM examiner award this mark point for the student's answer (exam standard, not science trivia)? Answer awarded true/false only — do NOT choose marks.",
  membership:
    "Is the student's answer a specific, markable SPM-level instance of this category? Answer awarded true/false only — do NOT choose marks.",
  reasoning:
    "Does the reasoning meet SPM mark-scheme standard for this point? Answer awarded true/false only — do NOT choose marks.",
  method:
    "Did the student use a correct method or approach for this step? Answer with awarded true/false only — do NOT choose marks.",
  paired:
    "Does this student idea correctly describe the item named on this side of the comparison? Answer with awarded true/false only — do NOT choose marks.",
  equation:
    "Does the student's equation satisfy ALL required species and balance conditions? Answer with awarded true/false only — do NOT choose marks.",
  sequence:
    "Does the student's sequence meet SPM mark-scheme standard for this rubric row? Answer awarded true/false only — do NOT choose marks.",
};

export async function verifyBorderlineMeaningMatch(params: {
  mode: VerifierMode;
  question: string;
  rubricIdea: string;
  rubricKind: RubricIdeaKind;
  rubricKeywords?: string[];
  studentIdea: string;
  similarity: number;
  fullStudentAnswer: string;
  priorAwardedRubricIdeas: string[];
  strictContextBound: boolean;
  openCategoryMarking: boolean;
  exampleUseCombo: boolean;
}): Promise<{ awarded: boolean; reason: string }> {
  const system = [
    "Verify a student response against a rubric marking point at SPM Form 4/5 level.",
    formatSpmExamStandardMarkingBlock(),
    formatEvidenceOnlyMarkingBlock(),
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON only: { \"awarded\": boolean, \"reason\": string }.",
    "The reason must be one short plain sentence for the student, citing only what they actually wrote.",
    "If awarded is false: say the required point was not stated clearly in their answer (too vague / not mentioned / only implied).",
    "Never award because the student 'probably meant' a scientific idea that is not expressed in the answer text.",
    VERIFIER_MODE_BLOCKS[params.mode],
    params.openCategoryMarking || params.strictContextBound
      ? "Open-category: award only a specific valid SPM instance of the criterion. Context-bound: must fit the named source in the question."
      : null,
    params.exampleUseCombo
      ? "Example+use: only credit use/function if the student's written answer states that use — do not infer the example from the question stem alone."
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const userParts = [
    LEAD_BY_MODE[params.mode],
    "Treat common SPM paraphrases as the same mark point only when specificity is sufficient.",
    "For cause-effect questions, withhold if only a generic outcome is stated without the mark-point mechanism.",
    "Do not require repeating context already in the question stem, but do require the mark-point detail itself.",
    params.openCategoryMarking && !params.strictContextBound
      ? "OPEN CATEGORY: award only when the student gives a specific valid instance at SPM mark-scheme level."
      : null,
    params.strictContextBound
      ? "CONTEXT-BOUND: reject if inconsistent with the source named in the question."
      : null,
    params.priorAwardedRubricIdeas.length > 0
      ? `Already-matched rubric ideas (for example→use chaining): ${params.priorAwardedRubricIdeas.join(" | ")}`
      : null,
    params.mode === "membership" ? `Rubric row kind: ${params.rubricKind}` : null,
    params.mode === "membership" && (params.rubricKeywords?.length ?? 0) > 0
      ? `Category keywords: ${params.rubricKeywords!.join(" | ")}`
      : null,
    `Question: ${params.question}`,
    `Rubric marking point: ${params.rubricIdea}`,
    `Best student idea line: ${params.studentIdea || "(none)"}`,
    `Full student answer: ${params.fullStudentAnswer}`,
    params.similarity > 0 ? `Embedding similarity (hint only): ${params.similarity.toFixed(3)}` : null,
  ].filter((line): line is string => Boolean(line));

  const parsed = await qwenGradingJson(system, userParts.join("\n\n"));
  const awarded =
    typeof parsed?.awarded === "boolean"
      ? parsed.awarded
      : typeof parsed?.awarded === "string"
        ? /^(true|yes|1)$/i.test(parsed.awarded)
        : false;
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
  return { awarded, reason };
}
