/**
 * Full worked chemistry calculation model answers.
 * Student-facing exemplar ALWAYS uses Formula + Working + Final answer.
 */

import { qwenGradingJson } from "../shared/qwenGradingClient";
import {
  CALCULATION_WORKED_EXEMPLAR_SECTIONS,
  hasCompleteCalculationModelAnswerSections,
  inferCalculationPolicy,
  showWorkingStagePlan,
} from "./calculationAcfPolicy";
import { isChemistryCalculationSubject } from "./calculationSubjectPolicy";
import {
  extractFormulaFromText,
  parseEmpiricalCompositionQuestion,
} from "../matching/calculationAnswerVerification";
import type { EvidenceUnit } from "../shared/types";
import { RETURN_JSON_MODEL_ANSWER } from "../prompts/shared/jsonRules";
import { normalizeCalculationModelAnswer } from "../extraction/normalizeCalculationModelAnswer";

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
    return "Show Formula, Working, and Final answer for the student exemplar.";
  }
  const policy = inferCalculationPolicy(question, maxScore, subject);
  const stages = showWorkingStagePlan(maxScore, "chemistry");
  return [
    `Mark-bearing stages for scoring (${maxScore} mark${maxScore === 1 ? "" : "s"}) — for examiner info only:`,
    ...stages.map((s, i) => `${i + 1}. ${s.label} (${s.weight} mark${s.weight === 1 ? "" : "s"})`),
    policy === "answer_only"
      ? "Scoring may be answer-only, but the MODEL ANSWER must still show Formula + Working + Final answer."
      : "MODEL ANSWER must always show Formula + Working + Final answer regardless of mark stages.",
  ]
    .filter(Boolean)
    .join("\n");
}

function fallbackModelAnswer(verifiedFinalAnswer: string): string {
  return [
    "Formula: (use the syllabus formula for this question)",
    "Working: Substitute the given values and show +, −, ×, ÷ steps (not the final answer).",
    `Final answer: ${verifiedFinalAnswer}`,
  ].join("\n");
}

function buildWorkedModelAnswerSystem(params: {
  maxScore: number;
  question: string;
  subject: string;
  verifiedFinalAnswer: string;
  strictRetry?: boolean;
}): string {
  return [
    "Write an SPM calculation model answer with clear working shown.",
    RETURN_JSON_MODEL_ANSWER,
    `Max marks for this question: ${params.maxScore}.`,
    "MANDATORY layout — you MUST include ALL three sections, every time, in this order:",
    ...CALCULATION_WORKED_EXEMPLAR_SECTIONS.map((l) => `- ${l}`),
    "NEVER omit Formula: or Working: — even for 1-mark or answer-only questions.",
    "NEVER return Final answer alone.",
    "",
    "Section rules:",
    "- Formula: general symbolic relationship OR conversion factor only (e.g. ρ = m/V or 1 km = 1000 m). No substituted question numbers in Formula.",
    "- Working: ONLY the solving steps — substitute values and show arithmetic (+, −, ×, ÷). Intermediate results OK. Do NOT put the concluding final answer with unit here.",
    "- Final answer: SEPARATE 1-mark section — verified value WITH correct unit only (digits only, no thousand commas: write 2500000 not 2,500,000).",
    "- You MUST label sections exactly: Formula: / Working: / Final answer: — never number them as '1.' '2.' only.",
    "- One line per given quantity in Working when listing given data.",
    "- Use ÷ for division; do not use step numbers (1., 2.)",
    "- Working MUST show the calculation path with operators; NEVER copy the Final answer line into Working.",
    "",
    "PLAIN TEXT ONLY (binding):",
    "- NEVER use LaTeX (no \\frac, \\V, \\times, \\\\, \\[1ex], $...$).",
    "- NEVER write the characters backslash-n — use real line breaks between sections.",
    "- NEVER put Formula text inside Working, or Working:/Final answer: labels inside another section.",
    "- Example shape:",
    "Formula: V = n × Vm",
    "Working: n = 0.5 mol\nVm = 22.4 dm³/mol\nV = 0.5 × 22.4 = 11.2",
    "Final answer: 11.2 dm³",
    "",
    params.strictRetry
      ? "RETRY: Your previous answer was incomplete. You MUST output Formula, Working, AND Final answer with non-empty content under each label. Working = arithmetic steps only; Final answer = value+unit separately."
      : "",
    "Required mark stages (scoring info):",
    workedAnswerStructureHint(params.maxScore, params.question, params.subject),
    "",
    "Rules:",
    "- Compute using ONLY the numbers given in the question.",
    `- The final result MUST match this verified answer: ${params.verifiedFinalAnswer}`,
    "- Include correct SI/syllabus units on the final answer (unit is part of the final mark — not a separate mark).",
    "- Match the question language (if bilingual EN:/BM:, write the model answer in English unless the question is BM-only).",
    "- Do NOT add meta-commentary or mark-scheme notes.",
    "- Labels, values, units, and formulas must come from the question — do not copy fixed examples.",
  ]
    .filter(Boolean)
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

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Verified final result (must appear in Final answer): ${params.verifiedFinalAnswer}`,
    params.methodContext ? `Method context:\n${params.methodContext.slice(0, 3000)}` : "",
    params.excerpt ? `Textbook evidence (method/units only):\n${params.excerpt.slice(0, 4000)}` : "",
    unitLines ? `Mark stages (scoring — still write full Formula/Working/Final):\n${unitLines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  for (const strictRetry of [false, true]) {
    try {
      const parsed = await qwenGradingJson(
        buildWorkedModelAnswerSystem({
          maxScore: params.maxScore,
          question: params.question,
          subject: params.subject,
          verifiedFinalAnswer: params.verifiedFinalAnswer,
          strictRetry,
        }),
        user,
        { temperature: 0 },
      );
      const ma = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
      if (!ma) continue;
      const normalized = normalizeCalculationModelAnswer(ma);
      if (hasCompleteCalculationModelAnswerSections(normalized)) {
        return normalized;
      }
    } catch {
      /* try again / fallback */
    }
  }

  return normalizeCalculationModelAnswer(fallbackModelAnswer(params.verifiedFinalAnswer));
}
