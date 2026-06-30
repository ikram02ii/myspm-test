/**
 * Full worked chemistry calculation model answers (formula → steps → final with unit).
 * Chemistry only — other subjects use generic reference answers until dedicated profiles exist.
 */

import { qwenGradingJson } from "../qwenGradingClient";
import {
  CALCULATION_STAGE_LABELS,
  inferCalculationPolicy,
  showWorkingStagePlan,
} from "./calculationAcfPolicy";
import { isChemistryCalculationSubject } from "./calculationSubjectPolicy";
import {
  extractFormulaFromText,
  parseEmpiricalCompositionQuestion,
} from "./calculationAnswerVerification";
import type { EvidenceUnit } from "./types";

export function extractVerificationCandidate(workedAnswer: string, question: string): string {
  const trimmed = workedAnswer.trim();
  if (!trimmed) return trimmed;

  const compositionQ = parseEmpiricalCompositionQuestion(question);
  if (compositionQ) {
    const formula = extractFormulaFromText(trimmed);
    if (formula) return formula;
  }

  const finalLinePatterns = [
    /(?:final answer|jawapan akhir|answer)[:\s]+(.+)$/im,
    /(?:therefore|maka|jadi)[,:]?\s*(.+)$/im,
  ];
  for (const re of finalLinePatterns) {
    const m = trimmed.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (/\d/.test(line) && /(?:mol|g|kg|dm|cm|kJ|J|%|atoms|molecules|mol⁻|s⁻|L|Pa|N|W|V|A|Ω)/i.test(line)) {
      return line.replace(/^[-*•\d.)]+\s*/, "").trim();
    }
  }

  const nums = trimmed.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g);
  if (nums?.length === 1) return nums[0]!;
  if (nums?.length) return nums[nums.length - 1]!;

  return trimmed;
}

function workedAnswerStructureHint(maxScore: number, question: string, subject: string): string {
  if (!isChemistryCalculationSubject(subject)) {
    return "Show method, working, and final answer with units as appropriate.";
  }
  const policy = inferCalculationPolicy(question, maxScore, subject);
  if (policy === "answer_only") {
    return [
      "Structure (brief — 1 mark):",
      `1. ${CALCULATION_STAGE_LABELS.formula} (if applicable)`,
      `2. ${CALCULATION_STAGE_LABELS.final}`,
    ].join("\n");
  }
  return showWorkingStagePlan(maxScore, "chemistry")
    .map((s, i) => `${i + 1}. ${s.label}`)
    .join("\n");
}

/** Build a full worked model answer after the numeric result has been verified. */
export async function buildCalculationWorkedModelAnswer(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  verifiedFinalAnswer: string;
  excerpt?: string;
  units?: EvidenceUnit[];
  methodContext?: string;
}): Promise<string> {
  if (!isChemistryCalculationSubject(params.subject)) {
    throw new Error("buildCalculationWorkedModelAnswer is for chemistry calculations only");
  }

  const unitLines = (params.units ?? [])
    .filter((u) => u.creditWeight > 0)
    .map((u) => `- ${u.content}`)
    .join("\n");

  const system = [
    "Write an SPM calculation model answer with clear working shown.",
    'Return JSON only: { "modelAnswer": string }',
    "Use newline-separated sections with these labels only:",
    "Formula:",
    "Working:",
    "Final answer:",
    "",
    "Working section rules:",
    "- Formula: write the general symbolic relationship only (variables, RAM, syllabus symbols — no substituted numbers).",
    "- Working: substitute values from the question and show numeric calculation steps.",
    "- One line per given quantity: <descriptive label> = <value with unit>",
    "- Use ÷ for division; do not use step numbers (1., 2.)",
    "",
    "Required structure:",
    workedAnswerStructureHint(params.maxScore, params.question, params.subject),
    "",
    "Rules:",
    "- Compute using ONLY the numbers given in the question.",
    `- The final result MUST match this verified answer: ${params.verifiedFinalAnswer}`,
    "- Include correct SI/syllabus units on the final answer.",
    "- Match the question language (if bilingual EN:/BM:, write the model answer in English unless the question is BM-only).",
    "- Do NOT add meta-commentary or mark-scheme notes.",
    "- Do NOT prefix working lines with step numbers (1., 2.).",
    "- Labels, values, units, and formulas must come from the question — do not copy fixed examples.",
    "- Keep intermediate sums grouped naturally without over-expanding nested parentheses.",
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Verified final result (must appear in Final answer): ${params.verifiedFinalAnswer}`,
    params.methodContext ? `Method context:\n${params.methodContext.slice(0, 3000)}` : "",
    params.excerpt ? `Textbook evidence (method/units only):\n${params.excerpt.slice(0, 4000)}` : "",
    unitLines ? `Mark stages:\n${unitLines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user, { temperature: 0 });
    const ma = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
    if (ma.length > 0) return ma;
  } catch {
    /* fallback below */
  }

  return [
    `${CALCULATION_STAGE_LABELS.formula}: (see syllabus formula for this question type)`,
    `${CALCULATION_STAGE_LABELS.substitution}: Substitute the given values from the question.`,
    `${CALCULATION_STAGE_LABELS.final}: ${params.verifiedFinalAnswer}`,
  ].join("\n");
}
