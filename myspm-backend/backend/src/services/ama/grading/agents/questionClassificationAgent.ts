/**
 * Question Classification Agent — sole authority for top-level question routing.
 *
 * Design decisions:
 * - Meaning over keywords: an experienced SPM examiner reads the full stem and
 *   decides whether the student must compute, explain, label a diagram, etc.
 * - Do NOT rely on the word "calculate" / "kira" / "hitung". Many SPM calc stems
 *   use find / determine / what is the value / show that — or give data and ask
 *   for a numeric result with no calc verb at all.
 * - Numbers alone never imply calculation (e.g. "State two functions of X").
 * - Prefer expected solving process + answer structure (formula → working → final)
 *   over surface wording.
 * - Downstream agents MUST trust this classification and must not re-route with
 *   keyword-only heuristics.
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

/** Bump when prompt/behaviour changes so in-process cache cannot serve stale types. */
const CACHE_VERSION = "v3-process-based-calc";

const cache = new Map<string, QuestionClassificationResult>();

function cacheKey(subject: string, question: string): string {
  const base = `${CACHE_VERSION}|${subject.trim().toLowerCase()}|${question.trim().toLowerCase()}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

function isClassifierEnabled(): boolean {
  const raw = (process.env["RAG_LLM_QUESTION_CLASSIFIER"] ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function clampConfidence(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  return 0.5;
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
    quantitative: "calculation",
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

/**
 * True when the stem / embedded scheme already shows a calculation answer shape
 * (formula + working/final), independent of the verb "calculate".
 */
export function looksLikeCalculationAnswerStructure(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;

  const hasFormula =
    /\b(formula|equation|persamaan|rumus|law\s+of|hukum)\b/.test(t) ||
    /correct\s+formula/i.test(t);
  const hasWorking =
    /\b(working|substitution|steps?\s+of\s+solving|penggantian|kerja\s+kira|show\s+(?:your\s+)?working|langkah\s+kira)\b/.test(
      t,
    );
  const hasFinal =
    /\b(final\s+answer|jawapan\s+akhir|numerical\s+answer|with\s+(?:si\s+)?unit|dengan\s+unit|correct\s+final)\b/.test(
      t,
    );

  // Classic SPM calc mark scheme: formula + (working|final).
  if (hasFormula && (hasWorking || hasFinal)) return true;

  // Explicit stage labels often appear even without the word calculate.
  const stageHits = [hasFormula, hasWorking, hasFinal].filter(Boolean).length;
  if (stageHits >= 2) return true;

  return false;
}

/**
 * Stem asks for a numeric solve even without "calculate" — data + unknown quantity.
 * Used only as a classifier HINT, not as sole authority.
 */
export function looksLikeNumericSolveStem(text: string): boolean {
  const q = (text || "").trim();
  if (!q) return false;
  // Cut mark-scheme blocks so we only inspect the stem demand.
  const cut = q.search(
    /(?:^|\n)\s*(?:Jawapan|Answer|Model answer|Marking points?|Mark\s+scheme|Skema|Markah|Marks?)\s*[:：]/im,
  );
  const stem = (cut >= 0 ? q.slice(0, cut) : q).toLowerCase();

  // Theory counts like "State two reasons" — not numeric solve.
  if (
    /\b(state|list|name|identify|explain|describe|compare|define|nyatakan|senaraikan|terangkan|huraikan)\b/.test(
      stem,
    ) &&
    !/\b(find|determine|evaluate|compute|what\s+is\s+(?:the\s+)?(?:value|speed|acceleration|force|mass|distance|mole|volume|rate)|berapa|apakah\s+nilai)\b/.test(
      stem,
    )
  ) {
    return false;
  }

  const hasData =
    /\d/.test(stem) &&
    /\b(m\/s|km\/h|km\b|ms-1|kg|n\b|j\b|w\b|mol|dm3|cm3|s\b|min|hours?|°c|k\b|pa|atm|g\b|%|metres?|meters?|seconds?)\b/i.test(
      stem,
    );
  const asksValue =
    /\b(find|determine|evaluate|compute|obtain|show\s+that|what\s+is\s+(?:its\s+|the\s+)?(?:value|average\s+speed|speed|acceleration|force|mass|distance|displacement|mole|moles|volume|rate|time|momentum|energy|power|pressure|density)|berapa|apakah\s+(?:nilai|halaju|pecutan|daya|jisim|jarak|isipadu|kadar))\b/i.test(
      stem,
    ) ||
    /\b(average\s+speed|resultant\s+force|number\s+of\s+moles|concentration|molarity)\b/i.test(stem);

  return hasData && asksValue;
}

function buildSystemPrompt(): string {
  return [
    "You are an experienced Malaysian SPM examiner.",
    "Your ONLY job is to classify the question type by reading the FULL stem and understanding what the student must DO and PRODUCE.",
    "Classify from the expected solving process and answer structure — NEVER from a single keyword.",
    "",
    "Return JSON only (no markdown, no prose outside JSON):",
    RETURN_JSON_TOP_LEVEL_QUESTION_TYPE,
    "",
    "questionType definitions (binding):",
    "- calculation: the student must obtain a numeric / quantitative result by applying a formula or equation, substituting values, showing arithmetic working, and/or stating a final answer with unit. The stem may NEVER contain the word calculate / kira / hitung.",
    "- theory: explanations, definitions, descriptions, reasons, functions, comparisons, processes, or conceptual understanding — no required arithmetic solve.",
    "- diagram: drawing, labeling, identifying parts on/from a diagram, or interpreting a figure as the main demand.",
    "- structured: multi-part stems (a)/(b)/(i)/(ii) with DIFFERENT marking requirement TYPES across parts (e.g. state + numeric solve, or formula-only + compute).",
    "- other: does not fit the above.",
    "",
    "How to recognise calculation WITHOUT the word calculate:",
    "- Ask: would a full-marks answer look like Formula → Working/substitution → Final answer (with unit)?",
    "- Ask: must the student substitute given numbers into a relationship and compute?",
    "- Verbs/phrases that often mean calc when data is given: find, determine, evaluate, obtain, show that, what is the value of, berapa, apakah nilai — BUT only when a numeric solve is required.",
    "- If Marking points / model answer already split into formula / working / final answer → calculation (or structured if mixed with theory parts).",
    "",
    "Critical anti-misclassification rules:",
    "- NEVER require the word calculate / kira / hitung to choose calculation.",
    "- NEVER classify as calculation only because numbers appear (counts, years, mark totals, 'two reasons', table values used for discussion).",
    "- Words like find / determine / state / give alone do NOT make a calculation question if the answer is a name, reason, definition, or description.",
    "- If the stem asks for meaning, function, reason, compare, explain, or describe with no numeric solve → theory.",
    "- If EVERY part is a numeric solve ask → calculation (NOT structured).",
    "",
    "Examples:",
    '"State the function of the mitochondria." → theory',
    '"Calculate the acceleration of the object." → calculation',
    '"A car travels 100 km in 2 hours. What is its average speed?" → calculation  (no word calculate)',
    '"Find the number of moles of NaOH in 250 cm³ of 0.20 mol dm⁻³ solution." → calculation',
    '"Determine the resultant force acting on the block." → calculation',
    '"Show that the pressure is 1.2 × 10⁵ Pa." → calculation',
    '"The diagram shows a plant cell. Label structure X." → diagram',
    '"(a) State the formula. (b) Find the value of the current." → structured',
    '"(a) Find the acceleration. (b) Find the distance travelled." → calculation',
    '"Explain why rate increases when temperature rises. (3 marks)" → theory',
    '"State TWO differences between arteries and veins." → theory  (number is a count, not a compute)',
  ].join("\n");
}

function buildUserPrompt(subject: string, question: string): string {
  const hints: string[] = [];
  if (looksLikeCalculationAnswerStructure(question)) {
    hints.push(
      "HINT (answer structure): this item already shows a formula / working / final-answer style mark scheme or model answer — lean toward calculation unless parts clearly mix theory demands.",
    );
  }
  if (looksLikeNumericSolveStem(question)) {
    hints.push(
      "HINT (stem demand): given numerical data + ask for a value/quantity — lean toward calculation even if the verb is find/determine/what is, not calculate.",
    );
  }
  return [
    `Subject: ${subject}`,
    "Question:",
    question,
    hints.length > 0 ? `\n${hints.join("\n")}` : "",
    "",
    "Classify by what the student must produce. Do not rely on the word calculate.",
  ]
    .filter(Boolean)
    .join("\n");
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
 * Soft correction: if LLM says theory but the embedded scheme is clearly
 * formula/working/final, upgrade to calculation (process signal, not keyword).
 */
export async function classifyQuestionTypeAgent(params: {
  question: string;
  subject?: string | null;
}): Promise<QuestionClassificationResult> {
  const question = (params.question || "").trim();
  const subject = (params.subject || "General").trim() || "General";
  if (!question) return fallbackTheory("Empty question — default theory.");

  if (!isClassifierEnabled()) {
    if (looksLikeCalculationAnswerStructure(question)) {
      return {
        questionType: "calculation",
        confidence: 0.55,
        reasoning:
          "Classifier disabled — promoted to calculation from formula/working/final answer structure.",
      };
    }
    return fallbackTheory("Question classifier disabled via RAG_LLM_QUESTION_CLASSIFIER.");
  }

  const key = cacheKey(subject, question);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const parsed = await qwenGradingJson(buildSystemPrompt(), buildUserPrompt(subject, question), {
      temperature: 0,
    });
    let questionType = normalizeType(parsed?.questionType);
    if (!questionType) return fallbackTheory("Classifier returned invalid questionType.");

    let confidence = clampConfidence(parsed?.confidence);
    let reasoning =
      typeof parsed?.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 400)
        : `Classified as ${questionType}.`;

    // Process-based safety net: scheme already encodes calc stages.
    if (
      questionType !== "calculation" &&
      questionType !== "structured" &&
      looksLikeCalculationAnswerStructure(question)
    ) {
      questionType = "calculation";
      confidence = Math.max(confidence, 0.7);
      reasoning = `${reasoning} [Upgraded to calculation: formula/working/final answer structure detected.]`.slice(
        0,
        400,
      );
    }

    const result: QuestionClassificationResult = {
      questionType,
      confidence,
      reasoning,
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[questionClassificationAgent] failed — defaulting to theory", msg.slice(0, 160));
    if (looksLikeCalculationAnswerStructure(question)) {
      return {
        questionType: "calculation",
        confidence: 0.5,
        reasoning: `Classifier error — calculation from answer structure (${msg.slice(0, 60)}).`,
      };
    }
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
