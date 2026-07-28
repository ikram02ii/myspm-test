/**
 * Independent verification for cached calculation reference answers.
 * Textbook chunks inform method — never the sole source of the final numeric result.
 */

import { qwenCalculationJson } from "../shared/qwenGradingClient";

export type CalculationVerificationMethod = "reverse_check" | "dual_computation" | "pending_review";

export type CalculationVerificationResult = {
  status: "verified" | "pending_review";
  answer?: string;
  verifiedAt?: string;
  verificationMethod?: CalculationVerificationMethod;
  verificationNote?: string;
};

const PERCENT_TOLERANCE = 1.0;

const ELEMENT_META: Record<string, { names: RegExp; defaultMass: number }> = {
  C: { names: /\b(carbon|c)\b/i, defaultMass: 12 },
  H: { names: /\b(hydrogen|h)\b/i, defaultMass: 1 },
  O: { names: /\b(oxygen|o)\b/i, defaultMass: 16 },
  N: { names: /\b(nitrogen|n)\b/i, defaultMass: 14 },
  S: { names: /\b(sulphur|sulfur|s)\b/i, defaultMass: 32 },
  Cl: { names: /\b(chlorine|cl)\b/i, defaultMass: 35.5 },
  Na: { names: /\b(sodium|na)\b/i, defaultMass: 23 },
  Mg: { names: /\b(magnesium|mg)\b/i, defaultMass: 24 },
  Al: { names: /\b(aluminium|aluminum|al)\b/i, defaultMass: 27 },
  Fe: { names: /\b(iron|fe)\b/i, defaultMass: 56 },
  Cu: { names: /\b(copper|cu)\b/i, defaultMass: 64 },
  Zn: { names: /\b(zinc|zn)\b/i, defaultMass: 65 },
};

export type ParsedCompositionQuestion = {
  kind: "empirical_formula";
  elements: Array<{ symbol: string; percent: number; atomicMass: number }>;
};

export function parseAtomicMassOverrides(question: string): Map<string, number> {
  const overrides = new Map<string, number>();
  for (const symbol of Object.keys(ELEMENT_META)) {
    const re = new RegExp(`\\b${symbol}\\s*=\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const m = question.match(re);
    if (m?.[1]) overrides.set(symbol, Number(m[1]));
  }
  return overrides;
}

export function parseEmpiricalCompositionQuestion(question: string): ParsedCompositionQuestion | null {
  const lower = question.toLowerCase();
  const isEmpirical =
    /\b(empirical\s+formula|formula\s+empirical|formula\s+molekul\s+empirical|formula\s+empirik)\b/i.test(
      question,
    ) ||
    (/\b(percentage|percent|%)\b/i.test(question) &&
      (lower.includes("carbon") || lower.includes(" hydrogen") || /\b\d+\s*%\s*c\b/i.test(question)));

  if (!isEmpirical && !/\b\d+(?:\.\d+)?\s*%\s*(?:of\s+)?(?:carbon|hydrogen|oxygen|c|h|o)\b/i.test(question)) {
    return null;
  }

  const overrides = parseAtomicMassOverrides(question);
  const elements: ParsedCompositionQuestion["elements"] = [];

  for (const [symbol, meta] of Object.entries(ELEMENT_META)) {
    const percentPatterns = [
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*(?:of\\s+)?${meta.names.source}`, "i"),
      new RegExp(`${meta.names.source}(?:\\s*(?:is|:))?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "i"),
    ];
    for (const re of percentPatterns) {
      const m = question.match(re);
      if (m?.[1]) {
        elements.push({
          symbol,
          percent: Number(m[1]),
          atomicMass: overrides.get(symbol) ?? meta.defaultMass,
        });
        break;
      }
    }
  }

  if (elements.length < 2) return null;
  return { kind: "empirical_formula", elements };
}

export function extractFormulaFromText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, "");
  const match = cleaned.match(/([A-Z][a-z]?\d*){1,6}/g);
  if (!match?.length) return null;
  const candidates = match.filter((f) => /[A-Z]/.test(f) && f.length <= 12);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function parseFormulaCounts(formula: string): Map<string, number> | null {
  const normalized = formula.replace(/\s+/g, "").replace(/·/g, "");
  if (!/^[A-Z][a-z]?\d*([A-Z][a-z]?\d*)*$/.test(normalized)) return null;
  const counts = new Map<string, number>();
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const symbol = m[1]!;
    const n = m[2] ? Number(m[2]) : 1;
    counts.set(symbol, (counts.get(symbol) ?? 0) + n);
  }
  return counts.size > 0 ? counts : null;
}

export function normalizeFormula(formula: string): string {
  const counts = parseFormulaCounts(formula);
  if (!counts) return formula.trim();
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sym, n]) => (n === 1 ? sym : `${sym}${n}`))
    .join("");
}

function impliedPercentComposition(
  formula: string,
  elements: ParsedCompositionQuestion["elements"],
): Map<string, number> | null {
  const counts = parseFormulaCounts(formula);
  if (!counts) return null;
  let totalMass = 0;
  for (const [sym, count] of counts.entries()) {
    const meta = elements.find((e) => e.symbol === sym);
    const mass = meta?.atomicMass ?? ELEMENT_META[sym]?.defaultMass;
    if (!mass) return null;
    totalMass += count * mass;
  }
  if (totalMass <= 0) return null;
  const percents = new Map<string, number>();
  for (const [sym, count] of counts.entries()) {
    const meta = elements.find((e) => e.symbol === sym);
    const mass = meta?.atomicMass ?? ELEMENT_META[sym]?.defaultMass;
    if (!mass) return null;
    percents.set(sym, (100 * count * mass) / totalMass);
  }
  return percents;
}

export type ReverseCheckResult = {
  applicable: boolean;
  pass: boolean;
  detail?: string;
  expectedFormula?: string;
};

export function reverseCheckEmpiricalFormula(
  question: ParsedCompositionQuestion,
  candidateAnswer: string,
): ReverseCheckResult {
  const formula = extractFormulaFromText(candidateAnswer);
  if (!formula) {
    return { applicable: true, pass: false, detail: "No parseable chemical formula in candidate answer." };
  }

  const implied = impliedPercentComposition(formula, question.elements);
  if (!implied) {
    return { applicable: true, pass: false, detail: `Could not derive composition from formula ${formula}.` };
  }

  const mismatches: string[] = [];
  for (const el of question.elements) {
    const got = implied.get(el.symbol);
    if (got == null) {
      mismatches.push(`${el.symbol}: missing in formula ${formula}`);
      continue;
    }
    if (Math.abs(got - el.percent) > PERCENT_TOLERANCE) {
      mismatches.push(
        `${el.symbol}: candidate implies ${got.toFixed(1)}% but question states ${el.percent}%`,
      );
    }
  }

  if (mismatches.length > 0) {
    const impliedStr = [...implied.entries()]
      .map(([s, p]) => `${p.toFixed(1)}% ${s}`)
      .join(", ");
    const statedStr = question.elements.map((e) => `${e.percent}% ${e.symbol}`).join(", ");
    return {
      applicable: true,
      pass: false,
      detail: `Composition mismatch — candidate ${formula} implies ${impliedStr}; question states ${statedStr}. ${mismatches.join("; ")}`,
      expectedFormula: computeEmpiricalFormulaFromComposition(question) ?? undefined,
    };
  }

  return { applicable: true, pass: true, detail: `Formula ${formula} matches stated composition.` };
}

export function computeEmpiricalFormulaFromComposition(question: ParsedCompositionQuestion): string | null {
  const moles = question.elements.map((e) => ({
    symbol: e.symbol,
    ratio: e.percent / e.atomicMass,
  }));
  const min = Math.min(...moles.map((m) => m.ratio));
  if (!Number.isFinite(min) || min <= 0) return null;
  const raw = moles.map((m) => ({ symbol: m.symbol, n: Math.round(m.ratio / min) }));
  if (raw.some((r) => r.n <= 0)) return null;
  return raw.map((r) => (r.n === 1 ? r.symbol : `${r.symbol}${r.n}`)).join("");
}

export function answersAgree(a: string, b: string): boolean {
  const fa = extractFormulaFromText(a);
  const fb = extractFormulaFromText(b);
  if (fa && fb) return normalizeFormula(fa) === normalizeFormula(fb);
  const na = a.replace(/\s+/g, " ").trim().toLowerCase();
  const nb = b.replace(/\s+/g, " ").trim().toLowerCase();
  if (na === nb) return true;
  const numA = a.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g);
  const numB = b.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g);
  if (numA?.length === 1 && numB?.length === 1) {
    const va = Number(numA[0]);
    const vb = Number(numB[0]);
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      const denom = Math.max(Math.abs(va), Math.abs(vb), 1e-9);
      return Math.abs(va - vb) / denom <= 0.01;
    }
  }
  return false;
}

async function computeCalculationAnswer(params: {
  question: string;
  subject: string;
  form: string;
  textbookExcerpt?: string;
  methodContext?: string;
  useTextbook: boolean;
  mismatchContext?: string;
}): Promise<string> {
  const system = [
    "You solve one SPM calculation question. Return JSON only: { \"answer\": string }.",
    "The answer field must contain ONLY the final result (formula, value with units, or both as appropriate).",
    "Compute from the numbers in the question — do NOT copy a worked example from a textbook if its data differs.",
    params.useTextbook
      ? "You may use the method context for formula choice, units, and rounding convention only."
      : "Derive the method from the question text and standard SPM syllabus only. Ignore any method context.",
  ].join("\n");

  const contextBlock = params.methodContext?.trim() || params.textbookExcerpt?.trim();

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    params.mismatchContext ? `IMPORTANT — prior attempt failed verification:\n${params.mismatchContext}` : "",
    params.useTextbook && contextBlock
      ? `Method context (formulas/units only — compute from the question's given values):\n${contextBlock.slice(0, 4000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = await qwenCalculationJson(system, user, { temperature: 0 });
    const answer = typeof parsed?.answer === "string" ? parsed.answer.trim() : "";
    if (answer) return answer;
  }
  throw new Error("Could not compute a reliable calculation answer");
}

/** Step 4: Solve a generated calculation question using method context (not chunk example numbers). */
export async function solveCalculationQuestion(params: {
  question: string;
  subject: string;
  form: string;
  methodContext?: string;
  textbookExcerpt?: string;
  mismatchContext?: string;
}): Promise<string> {
  const compositionQ = parseEmpiricalCompositionQuestion(params.question);
  if (compositionQ) {
    const formula = computeEmpiricalFormulaFromComposition(compositionQ);
    if (formula) return formula;
  }

  return computeCalculationAnswer({
    question: params.question,
    subject: params.subject,
    form: params.form,
    methodContext: params.methodContext,
    textbookExcerpt: params.textbookExcerpt,
    useTextbook: Boolean(params.methodContext?.trim() || params.textbookExcerpt?.trim()),
    mismatchContext: params.mismatchContext,
  });
}

async function dualComputationVerify(params: {
  question: string;
  subject: string;
  form: string;
  textbookExcerpt?: string;
  candidateAnswer: string;
}): Promise<{ pass: boolean; detail?: string; confirmedAnswer?: string }> {
  const [withChunk, withoutChunk] = await Promise.all([
    computeCalculationAnswer({
      question: params.question,
      subject: params.subject,
      form: params.form,
      textbookExcerpt: params.textbookExcerpt,
      useTextbook: true,
    }),
    computeCalculationAnswer({
      question: params.question,
      subject: params.subject,
      form: params.form,
      textbookExcerpt: params.textbookExcerpt,
      useTextbook: false,
    }),
  ]);

  if (answersAgree(withChunk, withoutChunk)) {
    return { pass: true, confirmedAnswer: withChunk, detail: "Dual computation paths agree." };
  }

  return {
    pass: false,
    detail: `Dual computation mismatch — with textbook: "${withChunk}" vs independent: "${withoutChunk}"; candidate was "${params.candidateAnswer}".`,
    confirmedAnswer: withoutChunk,
  };
}

export async function verifyCalculationReferenceAnswer(params: {
  question: string;
  subject: string;
  form: string;
  candidateAnswer: string;
  textbookExcerpt?: string;
  maxRetries?: number;
}): Promise<CalculationVerificationResult> {
  const maxRetries = params.maxRetries ?? 2;
  let candidate = params.candidateAnswer.trim();
  let lastMismatch: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const compositionQ = parseEmpiricalCompositionQuestion(params.question);

    if (compositionQ) {
      const reverse = reverseCheckEmpiricalFormula(compositionQ, candidate);
      if (reverse.pass) {
        return {
          status: "verified",
          answer: candidate,
          verifiedAt: new Date().toISOString(),
          verificationMethod: "reverse_check",
        };
      }
      lastMismatch = reverse.detail;
      if (reverse.expectedFormula && attempt < maxRetries) {
        candidate = reverse.expectedFormula;
        continue;
      }
    }

    try {
      const dual = await dualComputationVerify({
        question: params.question,
        subject: params.subject,
        form: params.form,
        textbookExcerpt: params.textbookExcerpt,
        candidateAnswer: candidate,
      });

      if (dual.pass && dual.confirmedAnswer) {
        if (compositionQ) {
          const reverseDual = reverseCheckEmpiricalFormula(compositionQ, dual.confirmedAnswer);
          if (reverseDual.applicable && !reverseDual.pass) {
            lastMismatch = reverseDual.detail;
            if (attempt < maxRetries && reverseDual.expectedFormula) {
              candidate = reverseDual.expectedFormula;
              continue;
            }
          } else {
            return {
              status: "verified",
              answer: dual.confirmedAnswer,
              verifiedAt: new Date().toISOString(),
              verificationMethod: "dual_computation",
            };
          }
        } else {
          return {
            status: "verified",
            answer: dual.confirmedAnswer,
            verifiedAt: new Date().toISOString(),
            verificationMethod: "dual_computation",
          };
        }
      }

      lastMismatch = dual.detail ?? lastMismatch;
      if (attempt < maxRetries) {
        candidate = await computeCalculationAnswer({
          question: params.question,
          subject: params.subject,
          form: params.form,
          textbookExcerpt: params.textbookExcerpt,
          useTextbook: false,
          mismatchContext: lastMismatch,
        });
        continue;
      }
    } catch (error) {
      lastMismatch = error instanceof Error ? error.message : String(error);
      if (attempt >= maxRetries) break;
    }
  }

  return {
    status: "pending_review",
    verificationMethod: "pending_review",
    verificationNote:
      lastMismatch ??
      "Calculation answer could not be independently verified after retries — requires human review.",
  };
}

export function applyVerificationToAcf<T extends {
  referenceModelAnswer?: string;
  verifiedAt?: string;
  verificationMethod?: CalculationVerificationMethod;
  verificationNote?: string;
}>(
  acf: T,
  result: CalculationVerificationResult,
  displayModelAnswer?: string,
): T {
  if (result.status === "verified" && result.answer) {
    return {
      ...acf,
      referenceModelAnswer: displayModelAnswer?.trim() || result.answer,
      verifiedAt: result.verifiedAt,
      verificationMethod: result.verificationMethod,
      verificationNote: undefined,
    };
  }
  return {
    ...acf,
    referenceModelAnswer: undefined,
    verifiedAt: undefined,
    verificationMethod: "pending_review",
    verificationNote: result.verificationNote,
  };
}
