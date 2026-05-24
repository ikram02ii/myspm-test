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

function replaceFractions(text: string): string {
  let out = text;
  let guard = 0;
  while (/\\frac\s*\{/.test(out) && guard < 32) {
    guard += 1;
    out = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, num, den) => {
      const n = num.trim();
      const d = den.trim();
      if (!n || !d) return `${n} / ${d}`;
      return `${n} / (${d})`;
    });
  }
  return out;
}

function unwrapLatexWrappers(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:latex|tex)?\s*/i, "").replace(/```\s*$/i, "");

  const display = t.match(/^\\displaylines\s*\{([\s\S]*)\}\s*$/);
  if (display?.[1]) t = display[1];

  t = t.replace(/\\displaylines\s*\{([\s\S]*)\}/g, "$1");
  t = t.replace(/\\begin\{[^{}]*\}/g, "").replace(/\\end\{[^{}]*\}/g, "");

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

/**
 * Normalize raw OCR model output to clean multi-line plain text.
 */
export function normalizeOcrExtractedText(raw: string): string {
  if (!raw?.trim()) return "";

  let t = unwrapLatexWrappers(raw);
  t = replaceLineBreaksAndSpacing(t);
  t = replaceFractions(t);
  t = replaceChemAndMathSymbols(t);
  t = replaceSubscriptsAndSuperscripts(t);
  t = stripRemainingLatexCommands(t);
  return cleanupPlainText(t);
}

/** LaTeX / displaylines cleanup used by the OCR post-process pipeline. */
export function parseOcrMathStructure(raw: string): string {
  return normalizeOcrExtractedText(raw);
}

export const OCR_EXTRACTION_PROMPT = [
  "Transcribe all visible handwriting or printed text from this image.",
  "Output clean plain text only — suitable for a student answer box.",
  "Rules:",
  "- One step per line, in the same order as the image.",
  "- Do NOT use LaTeX, \\displaylines, markdown, or code fences.",
  "- Chemical formulas: write with subscripts in the text (e.g. C2H5OH, CH3COOH, H2SO4) — not C_{2}H_{5}OH.",
  "- Fractions: use a slash, e.g. mass / (12 + 3 + 32 + 1), or put numerator and denominator on separate lines.",
  "- Use = for equals; use × or x for multiplication as shown.",
  "- Keep units with numbers (mol, g, cm, etc.).",
  "- Copy numbers exactly; do not solve or add steps not in the image.",
  "- No commentary before or after the transcription.",
].join("\n");
