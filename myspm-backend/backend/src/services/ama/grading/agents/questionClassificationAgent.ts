/**
 * Question Classification Agent — sole authority for top-level question routing.
 *
 * Design decisions:
 * - Meaning over keywords: an experienced SPM examiner reads the full stem and
 *   decides whether the student must compute, explain, label a diagram, etc.
 * - Numbers alone never imply calculation (e.g. "State two functions of X" with
 *   "two" must stay theory).
 * - Downstream agents (theory / calculation) MUST trust this classification and
 *   must not re-detect question type with regex or structure heuristics.
 * - Future question types can be added to TopLevelQuestionType without changing
 *   the binary marking-agent dispatch until dedicated agents exist.
 */

import { createHash } from "node:crypto";
import type { TopLevelQuestionType } from "../../types";
import { qwenGradingJson } from "../shared/qwenGradingClient";
import { RETURN_JSON_TOP_LEVEL_QUESTION_TYPE } from "../prompts/shared/jsonRules";

export type { TopLevelQuestionType };

export type QuestionClassificationResult = {
  questionType: TopLevelQuestionType;
  confidence: number;
  reasoning: string;
};

const VALID_TYPES = new Set<TopLevelQuestionType>([
  "calculation",
  "theory",
  "diagram",
  "structured",
  "other",
]);

const cache = new Map<string, QuestionClassificationResult>();

function cacheKey(subject: string, question: string): string {
  const base = `${subject.trim().toLowerCase()}|${question.trim().toLowerCase()}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

function isClassifierEnabled(): boolean {
  const raw = (process.env["RAG_LLM_QUESTION_CLASSIFIER"] ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function normalizeType(raw: unknown): TopLevelQuestionType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (VALID_TYPES.has(t as TopLevelQuestionType)) return t as TopLevelQuestionType;
  const aliases: Record<string, TopLevelQuestionType> = {
    calc: "calculation",
    calculate: "calculation",
    numerical: "calculation",
    math: "calculation",
    explain: "theory",
    explanation: "theory",
    recall: "theory",
    define: "theory",
    definition: "theory",
    compare: "theory",
    comparison: "theory",
    describe: "theory",
    description: "theory",
    process: "theory",
    label: "diagram",
    labeling: "diagram",
    labelling: "diagram",
    draw: "diagram",
    compound: "structured",
    multi_part: "structured",
    multipart: "structured",
  };
  return aliases[t] ?? null;
}

function buildSystemPrompt(): string {
  return [
    "You are an experienced Malaysian SPM examiner.",
    "Your ONLY job is to classify the question type by reading the FULL stem and understanding what the student must produce.",
    "Prioritize meaning and required response over superficial keywords.",
    "",
    "Return JSON only (no markdown, no prose outside JSON):",
    RETURN_JSON_TOP_LEVEL_QUESTION_TYPE,
    "",
    "questionType definitions (binding):",
    "- calculation: the student MUST perform mathematical operations, formula substitution, numeric solving, working steps, and/or a numerical final answer.",
    "- theory: explanations, definitions, descriptions, reasons, functions, comparisons, processes, or conceptual understanding — no required arithmetic solve.",
    "- diagram: drawing, labeling, identifying parts on/from a diagram, or interpreting a figure as the main demand.",
    "- structured: multi-part stems (a)/(b)/(i)/(ii) with DIFFERENT marking requirement TYPES across parts (e.g. state + explain, or formula-only + calculate).",
    "- other: does not fit the above.",
    "",
    "Critical anti-misclassification rules:",
    "- NEVER classify as calculation only because numbers appear (counts, years, mark totals, 'two reasons', table values used for discussion).",
    "- NEVER classify as calculation unless solving requires actual mathematical computation.",
    "- Words like 'find', 'determine', 'state', 'give' alone do NOT make a calculation question.",
    "- If the stem asks for meaning, function, reason, compare, explain, or describe → theory (unless it is clearly a multi-part structured paper item).",
    "- If EVERY part is a calculation ask (e.g. (a) Calculate acceleration. (b) Calculate distance.) → calculation (NOT structured).",
    "",
    "Examples:",
    '"State the function of the mitochondria." → theory',
    '"Calculate the acceleration of the object." → calculation',
    '"The diagram shows a plant cell. Label structure X." → diagram',
    '"(a) State the formula. (b) Calculate the value." → structured',
    '"(a) Calculate the acceleration. (b) Calculate the distance travelled." → calculation',
    '"Explain why rate increases when temperature rises. (3 marks)" → theory',
    '"A car travels 100 km in 2 hours. Calculate its average speed." → calculation',
  ].join("\n");
}

function fallbackTheory(reason: string): QuestionClassificationResult {
  // Safe default: theory marking never invents formula/working stages.
  return {
    questionType: "theory",
    confidence: 0,
    reasoning: reason,
  };
}

/**
 * Classify a question into a top-level type via LLM.
 * Cached per subject+question. On disable/failure → theory (never invent calc).
 */
export async function classifyQuestionTypeAgent(params: {
  question: string;
  subject?: string | null;
}): Promise<QuestionClassificationResult> {
  const question = (params.question || "").trim();
  const subject = (params.subject || "General").trim() || "General";
  if (!question) return fallbackTheory("Empty question — default theory.");

  if (!isClassifierEnabled()) {
    return fallbackTheory("Question classifier disabled via RAG_LLM_QUESTION_CLASSIFIER.");
  }

  const key = cacheKey(subject, question);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const parsed = await qwenGradingJson(buildSystemPrompt(), `Subject: ${subject}\nQuestion:\n${question}`, {
      temperature: 0,
    });
    const questionType = normalizeType(parsed?.questionType);
    if (!questionType) return fallbackTheory("Classifier returned invalid questionType.");

    const result: QuestionClassificationResult = {
      questionType,
      confidence: clampConfidence(parsed?.confidence),
      reasoning:
        typeof parsed?.reasoning === "string" && parsed.reasoning.trim()
          ? parsed.reasoning.trim().slice(0, 400)
          : `Classified as ${questionType}.`,
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[questionClassificationAgent] failed — defaulting to theory", msg.slice(0, 160));
    return fallbackTheory(`Classifier error — default theory (${msg.slice(0, 80)}).`);
  }
}

/** True when top-level type should dispatch the calculation marking agent. */
export function topLevelUsesCalculationAgent(type: TopLevelQuestionType | null | undefined): boolean {
  return type === "calculation";
}

/** Clear in-process cache (tests). */
export function clearQuestionClassificationCache(): void {
  cache.clear();
}
