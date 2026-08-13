/**
 * Turn Qwen-VL-OCR LaTeX-style output into plain SPM student working
 * (readable in a text field and friendly to /rag/grade).
 */

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

function toSubscriptDigits(num: string): string {
  return num
    .split("")
    .map((d) => {
      const n = Number(d);
      return Number.isFinite(n) && n >= 0 && n <= 9 ? SUBSCRIPT_DIGITS[n]! : d;
    })
    .join("");
}

/** Prefer Unicode subscripts for display; set false for ASCII-only (C2H5OH). */
const USE_UNICODE_SUBSCRIPTS = process.env["OCR_UNICODE_SUBSCRIPTS"]?.trim() !== "false";

function applySubscript(letter: string, digits: string): string {
  if (!digits) return letter;
  return USE_UNICODE_SUBSCRIPTS ? letter + toSubscriptDigits(digits) : letter + digits;
}

function formatPlainFraction(num: string, den: string): string {
  const n = num.trim();
  const d = den.trim();
  if (!n || !d) return [n, d].filter(Boolean).join("/");
  // Simple tokens: 1/2, a/b — avoid awkward "1 / (2)"
  if (/^[\w.]+$/.test(n) && /^[\w.]+$/.test(d)) return `${n}/${d}`;
  return `(${n})/(${d})`;
}

function replaceFractions(text: string): string {
  let out = text;
  let guard = 0;
  while (/\\frac\s*\{/.test(out) && guard < 32) {
    guard += 1;
    out = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, num, den) =>
      formatPlainFraction(num, den),
    );
  }
  // Already-broken OCR forms: "1 / (2)" → "1/2"
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*\/\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g, "$1/$2");
  return out;
}

/** Strip \( \), \[ \], $...$ while keeping inner math as plain text. */
function stripMathDelimiters(text: string): string {
  let t = text;
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, "$1");
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, "$1");
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  t = t.replace(/\$([^$\n]+)\$/g, "$1");
  // Leftover bare delimiters
  t = t.replace(/\\[()\[\]]/g, "");
  t = t.replace(/(^|[^\\])\$+/g, "$1");
  return t;
}

function unwrapLatexWrappers(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:latex|tex)?\s*/i, "").replace(/```\s*$/i, "");

  const display = t.match(/^\\displaylines\s*\{([\s\S]*)\}\s*$/);
  if (display?.[1]) t = display[1];

  t = t.replace(/\\displaylines\s*\{([\s\S]*)\}/g, "$1");
  t = t.replace(/\\begin\{[^{}]*\}/g, "").replace(/\\end\{[^{}]*\}/g, "");
  t = stripMathDelimiters(t);

  return t;
}

function replaceLineBreaksAndSpacing(text: string): string {
  return text
    .replace(/\\\\/g, "\n")
    .replace(/\\newline\b/g, "\n")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\quad\b/g, " ")
    .replace(/\\qquad\b/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n");
}

function replaceChemAndMathSymbols(text: string): string {
  return text
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\to\b/g, "→")
    .replace(/\\approx/g, "≈")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\pm/g, "±")
    .replace(/\\degree/g, "°")
    .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbf\s*\{([^{}]*)\}/g, "$1");
}

function replaceSubscriptsAndSuperscripts(text: string): string {
  let t = text;
  // C_{2}H_{5} — multiple passes for chains like C_{2}H_{5}OH
  for (let i = 0; i < 24; i += 1) {
    const next = t.replace(/([A-Za-z])(?:_\{(\d+)\}|_(\d+))/g, (_, letter, a, b) =>
      applySubscript(letter, (a ?? b) as string),
    );
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\^\{(\d+)\}/g, "^$1");
  t = t.replace(/\^(\d+)/g, "^$1");
  return t;
}

function stripRemainingLatexCommands(text: string): string {
  let t = text;
  for (let i = 0; i < 16; i += 1) {
    const next = t.replace(/\\[a-zA-Z]+\*?(\s*\{[^{}]*\})?/g, " ");
    if (next === t) break;
    t = next;
  }
  return t.replace(/[{}]/g, "");
}

function cleanupPlainText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/,\s*,+/g, ", ")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+=\s+/g, " = ")
        .replace(/\s+×\s+/g, " × ")
        .trim(),
    )
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1]?.length))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type OcrNormalizeMode = "equation" | "prose" | "mixed";

/**
 * Normalize raw OCR model output to clean multi-line plain text.
 * `prose` still strips LaTeX but avoids turning narrative answers into equation-heavy cleanup.
 */
export function normalizeOcrExtractedText(
  raw: string,
  mode: OcrNormalizeMode = "mixed",
): string {
  if (!raw?.trim()) return "";

  let t = unwrapLatexWrappers(raw);
  t = replaceLineBreaksAndSpacing(t);
  t = replaceFractions(t);
  t = replaceChemAndMathSymbols(t);
  // Biology prose: keep latex cleanup, but skip subscript rewriting that can mangle words.
  if (mode !== "prose") {
    t = replaceSubscriptsAndSuperscripts(t);
  } else {
    // Still flatten obvious LaTeX subscripts to plain digits in formulas if present.
    t = t.replace(/([A-Za-z])_\{(\d+)\}/g, "$1$2").replace(/([A-Za-z])_(\d+)/g, "$1$2");
  }
  t = stripRemainingLatexCommands(t);
  t = stripMathDelimiters(t);
  t = replaceFractions(t);
  return cleanupPlainText(t);
}