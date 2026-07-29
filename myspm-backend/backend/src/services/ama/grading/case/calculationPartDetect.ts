/**
 * Detect independent calculation asks in a stem (e.g. (a) acceleration + (b) distance)
 * and recommend Markah = printed marks OR N × 3.
 */

import { parseMarkahFromQuestion } from "./markSchemeInference";

/** Keep in sync with CALCULATION_REQUIRED_STAGE_COUNT in calculationAcfPolicy. */
const STAGES_PER_CALC_ASK = 3;

const CALC_DEMAND_RE =
  /\b(calculate|kira(?:kan)?|hitung(?:lah)?|compute|evaluate|find\s+(?:the\s+)?(?:value|acceleration|velocity|speed|distance|displacement|force|mass|volume|rate|mole|moles|halaju|pecutan|sesaran|jisim|isipadu|kadar)|determine\s+(?:the\s+)?(?:value|acceleration|velocity|speed|distance|displacement|force|mass|volume|rate|mole|moles|halaju|pecutan|sesaran))\b/i;

const QUANTITY_RE =
  /\b(acceleration|velocity|speed|distance|displacement|force|mass|volume|rate|mole|moles|halaju|pecutan|sesaran|jisim|isipadu|kadar|time|masa|momentum|energy|kuasa|tekanan|pressure|density|ketumpatan)\b/i;

/** Strip Jawapan / Marking points / Markah blocks so part detection sees the stem only. */
function stemOnly(question: string): string {
  const q = (question || "").trim();
  if (!q) return "";
  const cut = q.search(
    /(?:^|\n)\s*(?:Jawapan|Answer|Model answer|Marking points?|Mark\s+scheme|Skema|Panduan\s+penilaian|Markah|Marks?)\s*[:：]/im,
  );
  return (cut >= 0 ? q.slice(0, cut) : q).trim();
}

/** Marks in trailing "(2 marks)" / "(3 markah)" on the stem. */
export function parseParenMarksFromQuestion(question: string): number | null {
  const m = stemOnly(question).match(/\((\d{1,2})\s*(?:marks?|markah)\)\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null;
}

function looksLikeCalcAsk(text: string): boolean {
  return CALC_DEMAND_RE.test(text);
}

/**
 * Split stem into lettered/numbered parts: (a)/(b), a)/b), (i)/(ii), etc.
 * Returns [] when the stem is not multi-part.
 */
export function splitCalculationStemParts(question: string): string[] {
  const stem = stemOnly(question);
  if (!stem) return [];

  const headerRe =
    /(?:^|\n)\s*(?:\(([a-d])\)|([a-d])[\.)]|\(([ivx]+)\)|([ivx]+)[\.)])\s+/gi;
  const headers: Array<{ index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(stem)) !== null) {
    headers.push({ index: m.index, end: m.index + m[0].length });
  }
  if (headers.length < 2) return [];

  const parts: string[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const start = headers[i]!.end;
    const stop = i + 1 < headers.length ? headers[i + 1]!.index : stem.length;
    const body = stem.slice(start, stop).trim();
    if (body) parts.push(body);
  }
  return parts;
}

function partLabel(index: number): string {
  return `(${String.fromCharCode(97 + index)})`;
}

/**
 * How many independent numeric/calculation asks are in the stem.
 * Minimum 1 when called for a calculation question.
 */
export function countIndependentCalculationAsks(question: string): number {
  const stem = stemOnly(question);
  if (!stem) return 1;

  const parts = splitCalculationStemParts(stem);
  if (parts.length >= 2) {
    const calcParts = parts.filter((p) => looksLikeCalcAsk(p));
    if (calcParts.length >= 2) return calcParts.length;
    // Mixed structured (e.g. state + calculate): one calc ask for scheme sizing
    if (calcParts.length === 1) return 1;
  }

  const verbHits = stem.match(/\b(calculate|kira(?:kan)?|hitung(?:lah)?|compute)\b/gi);
  if (verbHits && verbHits.length >= 2) return verbHits.length;

  // "Calculate the acceleration and the distance …"
  if (
    /\b(calculate|kira(?:kan)?|hitung(?:lah)?)\b/i.test(stem) &&
    /\b(and|dan)\b/i.test(stem)
  ) {
    const after = stem.split(/\b(calculate|kira(?:kan)?|hitung(?:lah)?)\b/i).slice(2).join("");
    const quantities = after.match(
      new RegExp(QUANTITY_RE.source, "gi"),
    );
    if (quantities && quantities.length >= 2) return 2;
  }

  return 1;
}

/** Labels like "(a)", "(b)" for each independent calc ask (length = N). */
export function calculationPartLabels(question: string): string[] {
  const n = countIndependentCalculationAsks(question);
  const parts = splitCalculationStemParts(question);
  if (parts.length >= n && n >= 2) {
    return Array.from({ length: n }, (_, i) => partLabel(i));
  }
  if (n <= 1) return [""];
  return Array.from({ length: n }, (_, i) => partLabel(i));
}

/**
 * Recommended calculation Markah:
 * - Printed Markah: / (N marks) wins when present
 * - Else N × 3 (formula + working + final per independent ask)
 * - Always at least 3 for any calculation
 */
export function recommendCalculationMaxScore(
  question: string,
  requestedMax?: number,
): number {
  const nParts = countIndependentCalculationAsks(question);
  const partBased = nParts * STAGES_PER_CALC_ASK;
  const printed =
    parseMarkahFromQuestion(question) ?? parseParenMarksFromQuestion(question);
  if (printed != null) {
    return Math.max(STAGES_PER_CALC_ASK, Math.floor(printed));
  }
  const client =
    typeof requestedMax === "number" && Number.isFinite(requestedMax)
      ? Math.floor(requestedMax)
      : 0;
  return Math.max(partBased, client, STAGES_PER_CALC_ASK);
}

/** Distribute total marks across N parts (each ≥ 1). */
export function allocateMarksAcrossParts(total: number, partCount: number): number[] {
  const n = Math.max(1, Math.floor(partCount));
  const marks = Math.max(n, Math.floor(total));
  const base = Math.floor(marks / n);
  const rem = marks - base * n;
  return Array.from({ length: n }, (_, i) => Math.max(1, base + (i < rem ? 1 : 0)));
}
