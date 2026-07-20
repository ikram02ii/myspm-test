/**
 * Calculation-only chunk rubric pipeline (generic — no hardcoded question types):
 *   Chunk → extract method/formula → generate question → solve → verify → store
 */

import { qwenGradingJson } from "../qwenGradingClient";
import { formatSpmStudentFriendlyRulesBlock } from "../gradingPolicy";
import { RETURN_JSON_QUESTION_TEXT } from "../prompts/shared/jsonRules";
import {
  applyVerificationToAcf,
  computeEmpiricalFormulaFromComposition,
  parseEmpiricalCompositionQuestion,
  solveCalculationQuestion,
  verifyCalculationReferenceAnswer,
  type CalculationVerificationResult,
} from "./calculationAnswerVerification";
import { buildCalculationWorkedModelAnswer } from "./calculationModelAnswer";
import type { VerifiedCalculationAnswer } from "./types";

export type CalculationMethodContext = {
  methodSummary: string;
  formulas: string[];
  unitsConvention?: string;
  roundingNotes?: string;
  topicLabel?: string;
};

export type CalculationChunkContext = {
  subject: string;
  form: string;
  chapter?: string | null;
  conceptTitle?: string | null;
  conceptSummary?: string | null;
  content: string;
};

function formatMethodContext(method: CalculationMethodContext): string {
  return [
    method.topicLabel ? `Topic: ${method.topicLabel}` : "",
    `Method: ${method.methodSummary}`,
    method.formulas.length > 0 ? `Formulas: ${method.formulas.join("; ")}` : "",
    method.unitsConvention ? `Units convention: ${method.unitsConvention}` : "",
    method.roundingNotes ? `Rounding: ${method.roundingNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseMethodContext(raw: Record<string, unknown>): CalculationMethodContext | null {
  const suitable = raw["suitable"] === true;
  if (!suitable) return null;

  const methodSummary =
    typeof raw["methodSummary"] === "string" ? raw["methodSummary"].trim() : "";
  if (!methodSummary) return null;

  const formulas = Array.isArray(raw["formulas"])
    ? raw["formulas"]
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  return {
    methodSummary,
    formulas,
    unitsConvention:
      typeof raw["unitsConvention"] === "string" ? raw["unitsConvention"].trim() : undefined,
    roundingNotes:
      typeof raw["roundingNotes"] === "string" ? raw["roundingNotes"].trim() : undefined,
    topicLabel: typeof raw["topicLabel"] === "string" ? raw["topicLabel"].trim() : undefined,
  };
}

/**
 * Step 1–2: From a textbook chunk, extract calculable method/formula context only (no numeric results).
 * Returns null when the chunk is not suitable for a calculation question.
 */
export async function extractCalculationMethodFromChunk(
  chunk: CalculationChunkContext,
): Promise<CalculationMethodContext | null> {
  const system = [
    "You analyse one SPM textbook excerpt for calculable content.",
    "Extract ONLY method, formulas, unit conventions, and rounding rules.",
    "Do NOT include numeric results, worked-example answers, or final values from the excerpt.",
    "",
    'Return JSON: {',
    '  "suitable": boolean,',
    '  "methodSummary": string,',
    '  "formulas": string[],',
    '  "unitsConvention"?: string,',
    '  "roundingNotes"?: string,',
    '  "topicLabel"?: string',
    "}",
    "",
    "Set suitable=true only when the excerpt supports a short SPM calculation question",
    "(numeric answer derivable from given values using syllabus-level method).",
    "Set suitable=false for purely descriptive, definitional, or non-quantitative excerpts.",
  ].join("\n");

  const user = [
    `Subject: ${chunk.subject}`,
    `Form: ${chunk.form}`,
    chunk.chapter ? `Chapter: ${chunk.chapter}` : "",
    chunk.conceptTitle ? `Concept: ${chunk.conceptTitle}` : "",
    chunk.conceptSummary ? `Summary: ${chunk.conceptSummary}` : "",
    "Textbook excerpt:",
    chunk.content.slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await qwenGradingJson(system, user, { temperature: 0 });
  if (!parsed || typeof parsed !== "object") return null;
  return parseMethodContext(parsed as Record<string, unknown>);
}

/**
 * Step 3: Generate a calculation question stem only — fresh given values, no model answer.
 */
export async function generateCalculationQuestionFromMethod(params: {
  chunk: CalculationChunkContext;
  method: CalculationMethodContext;
  maxMarks: number;
  commandHint?: string;
}): Promise<string> {
  const { chunk, method, maxMarks } = params;

  const system = [
    "You write one short Malaysian SPM Form 4/5 calculation question.",
    formatSpmStudentFriendlyRulesBlock(),
    RETURN_JSON_QUESTION_TEXT,
    "questionText must be a CALCULATION question (Calculate / Hitung / Kirakan).",
    `questionText must end with mark allocation, e.g. '(${maxMarks} marks)' or '(${maxMarks} markah)'.`,
    `maxMarks for the question must be ${maxMarks}.`,
    "Use the provided method and formulas — but invent NEW given values.",
    "Do NOT copy numeric values from the textbook worked example; change all inputs.",
    "Include every value the student needs to solve the question.",
    "Do NOT include the answer, working, or model solution.",
  ].join("\n");

  const user = [
    `Subject: ${chunk.subject}`,
    `Form: ${chunk.form}`,
    chunk.chapter ? `Chapter: ${chunk.chapter}` : "",
    params.commandHint ? `Style hint: ${params.commandHint}` : "",
    "Method context (use for approach only — not for copying numbers):",
    formatMethodContext(method),
    "Textbook excerpt (for syllabus grounding only — do not reuse its example numbers):",
    chunk.content.slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await qwenGradingJson(system, user, { temperature: 0.3 });
  const questionTextRaw =
    typeof parsed?.questionText === "string" ? parsed.questionText.trim() : "";
  if (!questionTextRaw) throw new Error("Calculation question generation returned empty questionText");

  return /\bmarks?\)|\bmarkah\)/i.test(questionTextRaw)
    ? questionTextRaw
    : `${questionTextRaw} (${maxMarks} marks)`;
}

export type CalculationChunkPipelineResult = {
  questionText: string;
  verification: CalculationVerificationResult;
  verifiedAnswer?: VerifiedCalculationAnswer;
  methodContext: CalculationMethodContext;
};

/**
 * Full calculation pipeline for one chunk: generate → solve → verify.
 */
export async function runCalculationChunkPipeline(params: {
  chunk: CalculationChunkContext;
  method: CalculationMethodContext;
  maxMarks: number;
  commandHint?: string;
}): Promise<CalculationChunkPipelineResult> {
  const { chunk, method, maxMarks } = params;
  const methodContext = formatMethodContext(method);

  const questionText = await generateCalculationQuestionFromMethod(params);

  let candidateAnswer = await solveCalculationQuestion({
    question: questionText,
    subject: chunk.subject,
    form: chunk.form,
    methodContext,
  });

  const compositionQ = parseEmpiricalCompositionQuestion(questionText);
  if (compositionQ) {
    const deterministic = computeEmpiricalFormulaFromComposition(compositionQ);
    if (deterministic) candidateAnswer = deterministic;
  }

  const verification = await verifyCalculationReferenceAnswer({
    question: questionText,
    subject: chunk.subject,
    form: chunk.form,
    candidateAnswer,
    textbookExcerpt: methodContext,
  });

  const verifiedAnswer: VerifiedCalculationAnswer | undefined =
    verification.status === "verified" &&
    verification.answer &&
    verification.verifiedAt &&
    verification.verificationMethod &&
    verification.verificationMethod !== "pending_review"
      ? {
          referenceModelAnswer: await buildCalculationWorkedModelAnswer({
            question: questionText,
            subject: chunk.subject,
            form: chunk.form,
            maxScore: maxMarks,
            verifiedFinalAnswer: verification.answer,
            methodContext,
          }),
          verifiedAt: verification.verifiedAt,
          verificationMethod: verification.verificationMethod,
        }
      : undefined;

  return { questionText, verification, verifiedAnswer, methodContext: method };
}

export { applyVerificationToAcf };
