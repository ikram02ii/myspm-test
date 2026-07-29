/**
 * Deterministic numeric / unit / stage-shape checks for calculation marking.
 * Used by reconcileCalculationDemonstration after the calc-specific LLM evaluator.
 */

import { answersAgree, extractFormulaFromText } from "../matching/calculationAnswerVerification";
import {
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  PHYSICS_CALCULATION_STAGE_LABELS,
} from "../case/calculationAcfPolicy";

const UNIT_TOKEN =
  /\b(mol|g|kg|mg|dm3|cm3|m3|ml|mL|l|L|kJ|J|s-1|g\/s|mol\/dm3|mol\s*dm-3|%|°C|K|Pa|kPa|atm)\b/i;

/** True when the quoted line looks like a formula or equation (not just a bare number). */
export function quoteLooksLikeFormula(quote: string): boolean {
  const q = quote.trim();
  if (q.length < 2) return false;
  if (/[=→⟶]/.test(q)) return true;
  if (extractFormulaFromText(q)) return true;
  if (/\b(n|V|m|c|M|Q|I|E|F|R|P|W|U|A|p|v|t)\s*=/i.test(q)) return true;
  if (/[A-Z][a-z]?\d*.*[=+\-*/]/.test(q)) return true;
  return false;
}

/** True when the quote shows substituted values or arithmetic working (+, −, ×, ÷). */
export function quoteLooksLikeSubstitution(quote: string): boolean {
  const q = quote.trim();
  if (!/\d/.test(q)) return false;
  return /[=×x\*\/÷]/.test(q) || /\d\s*[+\-]\s*\d/.test(q);
}

export function extractUnitTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(new RegExp(UNIT_TOKEN.source, "gi"))) {
    const token = m[0]?.toLowerCase().replace(/\s+/g, "");
    if (token) found.add(token);
  }
  return [...found];
}

function normalizeUnitToken(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/mol\/dm3|moldm-3/g, "mol/dm3")
    .replace(/ml/g, "ml");
}

/** Returns a reason string when units conflict; null when compatible or unknown. */
export function detectUnitMismatch(
  studentText: string,
  referenceText: string,
  options?: { question?: string },
): string | null {
  const ref = extractComparableFinalAnswer(referenceText);
  const student = studentText.trim();

  if (options?.question && isRelativeFormulaMassQuestion(options.question)) {
    if (answersAgree(student, ref) || answersAgree(student, ref.replace(/\s*g\s*mol-?1/gi, ""))) {
      return null;
    }
  }

  const studentUnits = extractUnitTokens(student).map(normalizeUnitToken);
  const referenceUnits = extractUnitTokens(ref).map(normalizeUnitToken);
  if (studentUnits.length === 0 || referenceUnits.length === 0) return null;

  const refPrimary = referenceUnits[referenceUnits.length - 1]!;
  const stuPrimary = studentUnits[studentUnits.length - 1]!;

  if (stuPrimary === refPrimary) return null;

  // Same numeric value but different dimension (e.g. g vs mol).
  if (answersAgree(student, ref)) {
    return `Unit mismatch: expected "${refPrimary}" but answer used "${stuPrimary}".`;
  }

  return `Expected unit "${refPrimary}" but found "${stuPrimary}".`;
}

/** Pull a short comparable final (value + unit) from a long worked reference answer. */
export function extractComparableFinalAnswer(referenceText: string): string {
  const text = referenceText.trim();
  if (!text) return "";

  const labelled = text.match(/(?:final\s+answer|jawapan\s+akhir)\s*:\s*([^\n]+)/i);
  if (labelled?.[1]?.trim()) return labelled[1].trim();

  if (!text.includes("\n") && text.length <= 120) return text;

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (/\d/.test(line) && !/^(formula|working|method)\s*:/i.test(line)) return line;
  }

  return text;
}

export function isRelativeFormulaMassQuestion(question: string): boolean {
  return /\b(relative\s+(?:formula|molecular)\s+mass|formula\s+mass|relative\s+atomic\s+mass\s+of|Mr\b|jisim\s+(?:formula|relatif))/i.test(
    question,
  );
}

/** Compare student text to a verified reference model answer. */
export function studentAnswerMatchesReference(
  studentText: string,
  referenceText: string,
  options?: { question?: string },
): boolean {
  const student = studentText.trim();
  const reference = referenceText.trim();
  if (!student || !reference) return false;

  const comparableRef = extractComparableFinalAnswer(reference);
  const targets = comparableRef !== reference ? [comparableRef, reference] : [reference];

  const studentVariants = [student];
  const tailAfterEquals = student.match(/=\s*([^=]+)$/);
  if (tailAfterEquals?.[1]?.trim()) studentVariants.push(tailAfterEquals[1].trim());

  for (const ref of targets) {
    for (const stu of studentVariants) {
      const studentUnits = extractUnitTokens(stu).map(normalizeUnitToken);
      const referenceUnits = extractUnitTokens(ref).map(normalizeUnitToken);

      if (
        options?.question &&
        isRelativeFormulaMassQuestion(options.question) &&
        studentUnits.length === 0 &&
        answersAgree(stu, ref)
      ) {
        return true;
      }

      // SPM: the unit is part of the final-answer mark. When the expected answer
      // carries a unit but the student stated only a bare number (e.g. a working
      // line ending "= 2"), that is working — not a written final answer — so it
      // must not match the final-answer stage. (Mr / dimensionless answers are
      // handled by the relative-formula-mass exception above.)
      if (referenceUnits.length > 0 && studentUnits.length === 0) continue;

      if (studentUnits.length > 0 && referenceUnits.length > 0) {
        const stuUnit = studentUnits[studentUnits.length - 1]!;
        const refUnit = referenceUnits[referenceUnits.length - 1]!;
        if (stuUnit !== refUnit) continue;
      }

      if (answersAgree(stu, ref)) return true;
    }
  }

  return false;
}

export function findFinalStageUnitId(creditUnitIds: Array<{ id: string; content: string }>): string | null {
  return findFinalStageUnitIds(creditUnitIds)[0] ?? null;
}

export function findFinalStageUnitIds(
  creditUnitIds: Array<{ id: string; content: string }>,
): string[] {
  const finals = creditUnitIds.filter((u) => {
    const c = u.content.toLowerCase();
    if (u.id === "calc_final") return true;
    if (/_s\d+$/.test(u.id) && /\bfinal\s+answer\b/i.test(c)) return true;
    if (u.content === CALCULATION_STAGE_LABELS.final) return true;
    if (u.content === GENERIC_CALCULATION_STAGE_LABELS.final) return true;
    if (u.content === PHYSICS_CALCULATION_STAGE_LABELS.final) return true;
    if (/\bnot\s+the\s+(?:final|concluding)\b/i.test(c)) return false;
    return /\bcorrect\s+final\s+answer\b/i.test(c) || /\bfinal\s+answer\b/i.test(c);
  });
  if (finals.length > 0) return finals.map((u) => u.id);
  const last = creditUnitIds[creditUnitIds.length - 1];
  return last ? [last.id] : [];
}

export function findFormulaStageUnitId(
  creditUnits: Array<{ id: string; content: string }>,
): string | null {
  return findFormulaStageUnitIds(creditUnits)[0] ?? null;
}

export function findFormulaStageUnitIds(
  creditUnits: Array<{ id: string; content: string }>,
): string[] {
  return creditUnits
    .filter(
      (u) =>
        u.content === CALCULATION_STAGE_LABELS.formula ||
        u.content === GENERIC_CALCULATION_STAGE_LABELS.formula ||
        u.content === PHYSICS_CALCULATION_STAGE_LABELS.formula ||
        /\bformula\b/i.test(u.content) ||
        /\bequation\b/i.test(u.content) ||
        /\bmethod\b/i.test(u.content),
    )
    .map((u) => u.id);
}

/** Part prefix for multi-part ids (`calc_p2_s1` → `calc_p2`); null for single-part. */
export function calculationPartIdPrefix(unitId: string): string | null {
  const m = /^(calc_p\d+)_/.exec(unitId);
  return m?.[1] ?? null;
}

export function findSubstitutionStageUnitId(
  creditUnits: Array<{ id: string; content: string }>,
): string | null {
  const sub = creditUnits.find(
    (u) =>
      u.content === CALCULATION_STAGE_LABELS.substitution ||
      u.content === GENERIC_CALCULATION_STAGE_LABELS.substitution ||
      u.content === PHYSICS_CALCULATION_STAGE_LABELS.substitution ||
      u.content.toLowerCase().includes("substitution") ||
      u.content.toLowerCase().includes("steps of solving") ||
      (u.content.toLowerCase().includes("working") &&
        !u.content.toLowerCase().includes("calculation working") &&
        !u.content.toLowerCase().includes("final")),
  );
  return sub?.id ?? null;
}

export function findCalculationStageUnitId(
  creditUnits: Array<{ id: string; content: string }>,
): string | null {
  const calc = creditUnits.find(
    (u) =>
      u.content === PHYSICS_CALCULATION_STAGE_LABELS.calculation ||
      u.content.toLowerCase().includes("calculation working"),
  );
  return calc?.id ?? null;
}
