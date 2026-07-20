/**
 * Optional LLM question-type classification (temperature 0, fixed enum).
 * Regex from analyzeQuestion() remains the fallback on failure or invalid output.
 */

import { createHash } from "node:crypto";
import type { QuestionAnalysis, QuestionAnalysisQuestionType } from "../types";
import { qwenGradingJson } from "./qwenGradingClient";
import { RETURN_JSON_QUESTION_TYPE } from "./prompts/shared/jsonRules";

const VALID_TYPES: readonly QuestionAnalysisQuestionType[] = [
  "fixed_answer",
  "open_ended_example",
  "function_purpose",
  "structure_description",
  "cause_effect",
  "compare_contrast",
  "calculation",
  "mcq",
  "sequence_order",
  "general",
] as const;

const TYPE_SET = new Set<string>(VALID_TYPES);

const cache = new Map<string, QuestionAnalysisQuestionType>();

function cacheKey(subject: string, question: string): string {
  const base = `${subject.trim().toLowerCase()}|${question.trim().toLowerCase()}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

function isLlmClassifierEnabled(): boolean {
  const raw = (process.env["RAG_LLM_QUESTION_TYPE"] ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function normalizeLlmType(raw: unknown): QuestionAnalysisQuestionType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (TYPE_SET.has(t)) return t as QuestionAnalysisQuestionType;
  const aliases: Record<string, QuestionAnalysisQuestionType> = {
    recall: "fixed_answer",
    compare: "compare_contrast",
    comparison: "compare_contrast",
    explain: "cause_effect",
    explanation: "cause_effect",
    sequence: "sequence_order",
    example: "open_ended_example",
    define: "fixed_answer",
  };
  return aliases[t] ?? null;
}

/**
 * When enabled, classifies the full question stem via LLM and overrides questionType on analysis.
 * Cached per subject+question hash.
 */
export async function applyLlmQuestionTypeToAnalysis(
  analysis: QuestionAnalysis,
  question: string,
): Promise<QuestionAnalysis> {
  if (!isLlmClassifierEnabled()) return analysis;

  const key = cacheKey(analysis.subject, question);
  const cached = cache.get(key);
  if (cached) {
    return cached === analysis.questionType ? analysis : { ...analysis, questionType: cached };
  }

  const system = [
    "Classify this Malaysian SPM exam question by reading the FULL stem (not only the first word).",
    RETURN_JSON_QUESTION_TYPE,
    `questionType MUST be exactly one of: ${VALID_TYPES.join(" | ")}.`,
    "Rules:",
    "- compare_contrast: compare, differences/similarities between entities, bandingkan, perbezaan antara, bezakan.",
    "- fixed_answer: state/name/list/identify/define ONE or MORE specific terms (recall).",
    "- cause_effect: explain why/how, mechanisms, consequences, terangkan mengapa.",
    "- sequence_order: ordered stages, levels, steps, urutan, hierarchy.",
    "- structure_description: describe parts/structures without compare.",
    "- open_ended_example: give example(s), uses, applications from a category.",
    "- calculation: numeric working, kira, hitung.",
    "- mcq: A/B/C/D options in stem.",
    "- function_purpose: role, function, purpose, fungsi, tujuan.",
    "- general: none of the above clearly fits.",
    'Example: "State TWO differences between X and Y" → compare_contrast (not fixed_answer).',
  ].join("\n");

  const user = `Subject: ${analysis.subject}\nQuestion: ${question}`;

  try {
    // consistency lock: Half B marking pipeline requires temperature 0 (stage 1)
    const parsed = await qwenGradingJson(system, user, { temperature: 0 });
    const llmType = normalizeLlmType(parsed?.questionType);
    if (!llmType) return analysis;
    cache.set(key, llmType);
    if (llmType === analysis.questionType) return analysis;
    return { ...analysis, questionType: llmType };
  } catch {
    return analysis;
  }
}
