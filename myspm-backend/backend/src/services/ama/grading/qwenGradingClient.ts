/**
 * Shared Qwen chat/completions JSON helper for grading-related calls
 * (idea extraction, borderline match verify, feedback).
 */

import type { RubricIdeaKind, VerifierMode } from "../types";
import { formatSpmExamStandardMarkingBlock, formatSufficiencyMarkingBlock } from "./gradingPolicy";
import { formatEvidenceOnlyMarkingBlock, type EvidenceOnlyMarkingOptions } from "./gradingEvidencePolicy";
import { formatSpmStudentFriendlyRulesBlock } from "./gradingPolicy";
import { withMandatoryMarkingLanguage, withStrictComplianceLanguage } from "./gradingMandatoryLanguage";

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

/** Optional override for calculation solve/verify only (e.g. qwq-plus). Falls back to grading model. */
export function resolveQwenCalculationModel(): string {
  return (
    process.env["QWEN_CALCULATION_MODEL"]?.trim() ||
    process.env["QWEN_GRADING_MODEL"]?.trim() ||
    "qwen-plus"
  );
}

function isReasoningModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("qwq") || m.startsWith("qvq") || m.includes("-thinking");
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

export type QwenGradingJsonOptions = {
  /** Override sampling temperature; Half A rubric generation keeps the default. */
  temperature?: number;
  /** Override model id (e.g. qwq-plus for calculation verification). */
  model?: string;
};

function parseJsonFromModelText(raw: string): unknown | null {
  const jsonText = extractJson(raw.trim());
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}

async function qwenGradingJsonStreaming(
  config: QwenGradingConfig,
  system: string,
  user: string,
  temperature: number,
): Promise<any> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      response_format: { type: "json_object" },
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(rawText);
    } catch {
      throw new Error(rawText.slice(0, 500) || `Qwen stream failed (${response.status})`);
    }
    throw new Error(
      parsedResponse?.error?.message || parsedResponse?.message || `Qwen stream failed (${response.status})`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Qwen stream: missing response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta;
        if (typeof delta?.content === "string") content += delta.content;
        if (typeof delta?.reasoning_content === "string") reasoning += delta.reasoning_content;
      } catch {
        // skip malformed SSE chunk
      }
    }
  }

  const raw = content.trim() || reasoning.trim();
  if (!raw) throw new Error(`Qwen stream (${config.model}): empty response`);
  const parsed = parseJsonFromModelText(raw);
  if (parsed == null) {
    console.warn("[qwenGrading] stream returned non-JSON:", raw.slice(0, 240));
  }
  return parsed;
}

export async function qwenGradingJson(
  system: string,
  user: string,
  options?: QwenGradingJsonOptions,
): Promise<any> {
  const strictSystem = withStrictComplianceLanguage(system);
  const base = resolveQwenGradingConfig();
  const model = options?.model?.trim() || base.model;
  const config: QwenGradingConfig = { ...base, model };
  const temperature = options?.temperature ?? 0.1;

  if (isReasoningModel(model)) {
    return qwenGradingJsonStreaming(config, strictSystem, user, temperature);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: strictSystem },
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
  const parsed = parseJsonFromModelText(raw);
  if (parsed == null) {
    console.warn("[qwenGrading] returned non-JSON:", raw.slice(0, 240));
  }
  return parsed;
}

/** Calculation solve/verify — uses QWEN_CALCULATION_MODEL when set (e.g. qwq-plus). */
export async function qwenCalculationJson(
  system: string,
  user: string,
  options?: Pick<QwenGradingJsonOptions, "temperature">,
): Promise<any> {
  return qwenGradingJson(system, user, {
    ...options,
    model: resolveQwenCalculationModel(),
  });
}

const VERIFIER_MODE_BLOCKS: Record<VerifierMode, string> = {
  meaning: [
    "Task: does the student's answer EXPLICITLY STATE the required marking scheme concept?",
    "ONLY set awarded=true when the student wrote words that directly express the rubric concept (genuine paraphrase allowed ONLY when meaning is explicit).",
    "NEVER award=true when the reader must infer, deduce, or add unstated science.",
    "ALWAYS set awarded=false for vague, generic, related-but-unstated, or prerequisite-only overlap.",
    "NEVER require textbook wording unless the question type demands explanation depth.",
  ].join("\n"),
  membership: [
    "Task: did the student name a valid category member at SPM exam standard?",
    "ONLY award=true for a clear, markable instance written by the student.",
    "NEVER award=true for vague labels, wrong category, or related-but-unacceptable examples.",
  ].join("\n"),
  reasoning: [
    "Task: does the student's reasoning meet SPM marking-scheme standard for this mark point?",
    "ONLY award=true when logic is sound AND the required steps/mechanism are explicitly written.",
    "NEVER award=true on vague outcomes or 'because' without the required mechanism.",
  ].join("\n"),
  method: [
    "Task: did the student use a correct method, formula, or approach for this step?",
    "ONLY award=true when the valid method is explicit in the answer (arithmetic errors alone do NOT revoke).",
    "ALWAYS set awarded=false when the method itself is wrong.",
  ].join("\n"),
  paired: [
    "Task: does this idea correctly describe the named item on this side of the comparison?",
    "ONLY award=true when the idea is correct AND explicitly applies to the named side.",
    "NEVER award=true if the idea describes the other item, even if scientifically correct.",
  ].join("\n"),
  sequence: [
    "Task: does the student's sequence/order meet SPM mark-scheme standard?",
    "ONLY award=true when the required stage is in the correct position (or full order when required).",
    "NEVER award=true for wrong order, missing stages, or vague labels that do not name the required step.",
  ].join("\n"),
  equation: [
    "Task: check ALL of the following — ONLY award=true if ALL pass —",
    "(1) all reactants present and correct,",
    "(2) all products present and correct â€” a missing product = wrong,",
    "(3) equation is balanced â€” count atoms of each element both sides,",
    "(4) coefficients correct â€” no fractional coefficients at SPM level unless the question explicitly requires them,",
    "(5) state symbols correct if the rubric includes them.",
    "NEVER award partial credit in this mode.",
    "Reason must identify the specific condition that failed or confirm all conditions passed.",
  ].join("\n"),
};

const LEAD_BY_MODE: Record<VerifierMode, string> = {
  meaning:
    "Did the student EXPLICITLY WRITE the required concept? ONLY set awarded=true if the student's text directly expresses the rubric point. NEVER award=true if a reader could only infer it. Return awarded true/false only.",
  membership:
    "Is the answer a specific, markable SPM-level instance of this category? ONLY award=true for a valid instance written by the student. NEVER award=true for vague category talk. Return awarded true/false only.",
  reasoning:
    "Does the reasoning meet SPM mark-scheme standard? ONLY award=true when the mark-point reasoning is clearly written. NEVER award=true on vague outcomes alone. Return awarded true/false only.",
  method:
    "Did the student use a correct method for this step? ONLY award=true when the method is explicit in the answer. Return awarded true/false only.",
  paired:
    "Does this student idea correctly describe the named side of the comparison? ONLY award=true when that side is explicit. NEVER award=true on ambiguous entity reference. Return awarded true/false only.",
  equation:
    "Does the equation satisfy ALL required species and balance conditions? ONLY award=true when every condition passes. ALWAYS set awarded=false if any condition fails. Return awarded true/false only.",
  sequence:
    "Does the sequence meet SPM mark-scheme standard for this rubric row? ONLY award=true when order/position requirements are met. NEVER award=true when order is wrong. Return awarded true/false only.",
};

export async function verifyBorderlineMeaningMatch(params: {
  mode: VerifierMode;
  question: string;
  rubricIdea: string;
  rubricKind: RubricIdeaKind;
  rubricKeywords?: string[];
  /** Common misconceptions for this mark point — LLM must not award if student wrote one of these. */
  rejectTriggers?: string[];
  studentIdea: string;
  similarity: number;
  fullStudentAnswer: string;
  priorAwardedRubricIdeas: string[];
  strictContextBound: boolean;
  openCategoryMarking: boolean;
  exampleUseCombo: boolean;
  markingPolicyOptions?: EvidenceOnlyMarkingOptions;
}): Promise<{ awarded: boolean; reason: string }> {
  const policyOpts = params.markingPolicyOptions;
  const system = withMandatoryMarkingLanguage(
    [
      "Verify a student response against a rubric marking point at SPM Form 4/5 level.",
      formatSpmExamStandardMarkingBlock(policyOpts),
      formatSufficiencyMarkingBlock(),
      formatEvidenceOnlyMarkingBlock(policyOpts),
      formatSpmStudentFriendlyRulesBlock(),
      "Return JSON only: { \"awarded\": boolean, \"reason\": string }.",
      "Before awarding you MUST: (1) find an exact phrase in the student answer, (2) match it to this rubric point by meaning, (3) if no phrase exists for THIS point, awarded MUST be false — other points may still earn marks.",
      "EXPLICIT EVIDENCE RULE (highest priority): ONLY award when the student's written text directly expresses the rubric concept.",
      "  - ONLY award: genuine paraphrase with the same scientific meaning in the student's own words.",
      "  - NEVER award: implied prerequisite or deduced background knowledge.",
      "  - NEVER award: partial overlap or one shared general term.",
      "  The question is always: did the student WRITE IT — you MUST NOT credit what a reader could DEDUCE.",
      "If awarded is true: reason MUST quote the student's exact words (short quotation) and state how it matches the rubric point.",
      "If awarded is false: you MUST state the required point was not written (too vague / not mentioned / only implied).",
      "NEVER award because the student 'probably meant' an idea that is not expressed in the answer text.",
      "NEVER copy concepts from the model answer or rubric into the analysis as if the student wrote them.",
      "NEVER award because a diagram, figure, graph, or table shows the point if the student did not write it.",
      VERIFIER_MODE_BLOCKS[params.mode],
      params.openCategoryMarking || params.strictContextBound
        ? "Open-category: ONLY award a specific valid SPM instance. Context-bound: MUST fit the named source in the question."
        : null,
      params.exampleUseCombo
        ? "Example+use: ONLY credit use/function if the student's written answer states that use — NEVER infer from the question stem alone."
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );

  const userParts = [
    LEAD_BY_MODE[params.mode],
    "ONLY treat common SPM paraphrases as the same mark point when specificity is sufficient.",
    "For cause-effect questions, you MUST withhold if only a generic outcome is stated without the mark-point mechanism.",
    "You MUST NOT require repeating context already in the question stem, but you MUST require the mark-point detail itself.",
    params.openCategoryMarking && !params.strictContextBound
      ? "OPEN CATEGORY: award only when the student gives a specific valid instance at SPM mark-scheme level."
      : null,
    params.strictContextBound
      ? "CONTEXT-BOUND: reject if inconsistent with the source named in the question."
      : null,
    params.priorAwardedRubricIdeas.length > 0
      ? `Already-matched rubric ideas (for exampleâ†’use chaining): ${params.priorAwardedRubricIdeas.join(" | ")}`
      : null,
    params.mode === "membership" ? `Rubric row kind: ${params.rubricKind}` : null,
    params.mode === "membership" && (params.rubricKeywords?.length ?? 0) > 0
      ? `Category keywords: ${params.rubricKeywords!.join(" | ")}`
      : null,
    (params.rejectTriggers?.length ?? 0) > 0
      ? `MISCONCEPTION GUARD — NEVER award if the student wrote any of these common wrong answers: ${params.rejectTriggers!.join(" | ")}`
      : null,
    `Question: ${params.question}`,
    `Rubric marking point: ${params.rubricIdea}`,
    `Best student idea line: ${params.studentIdea || "(none)"}`,
    `Full student answer: ${params.fullStudentAnswer}`,
    params.similarity > 0 ? `Embedding similarity (hint only): ${params.similarity.toFixed(3)}` : null,
  ].filter((line): line is string => Boolean(line));

  // consistency lock: Half B marking pipeline requires temperature 0
  const parsed = await qwenGradingJson(system, userParts.join("\n\n"), { temperature: 0 });
  const awarded =
    typeof parsed?.awarded === "boolean"
      ? parsed.awarded
      : typeof parsed?.awarded === "string"
        ? /^(true|yes|1)$/i.test(parsed.awarded)
        : false;
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
  return { awarded, reason };
}
