export type CalculationModelAnswerLayout = {
  formulaLines: string[];
  workingLines: string[];
  finalLines: string[];
};

export type WorkingDisplayRow =
  | { type: "given"; label: string; value: string }
  | { type: "equation"; lhs: string; rhs: string; isContinuation: boolean };

const STEP_NUMBER_RE = /^\s*\d+[\.)]\s+/;
const INLINE_STEP_RE = /\b\d+[\.)]\s+(?=[A-Za-z(])/g;

const SECTION_LABEL_RE =
  /^(formula(?:\s*\/\s*equation)?|substitution(?:\s*\/\s*working)?|substitution|working|calculation|method|substitute|final answer|answer|jawapan(?:\s+akhir)?)\s*:?\s*(.*)$/i;

const FINAL_LABEL_RE = /^(final answer|answer|jawapan(?:\s+akhir)?)\s*:?\s*/i;

const JUNK_PREFIX_RE =
  /^[\s/]*(?:(?:substitution\s*)?(?:\/\s*)?working|substitution|calculation|method)\s*:?\s*/i;

type ActiveSection = "formula" | "working" | null;

/** Remove list numbering that clashes with math coefficients (1., 2., etc.). */
export function stripStepNumberPrefix(line: string): string {
  return line.replace(STEP_NUMBER_RE, "").trim();
}

/** Strip label debris and step numbers from a messy equation line. */
export function sanitizeEquationLine(line: string): string {
  let s = line.trim();
  if (!s) return s;

  s = s.replace(/^\/\s*/, "");
  s = s.replace(JUNK_PREFIX_RE, "");
  s = stripStepNumberPrefix(s);
  s = s.replace(INLINE_STEP_RE, "");

  // Extract an equation buried after junk labels (e.g. "/ Working: n = …"),
  // but never truncate a line that already starts with math (digit / letter / "(").
  const embedded = s.match(
    /(?:^|[\s:])((?:[A-Za-z][A-Za-z0-9₀-₉]*|[(][^)]+[)])\s*=\s*.+)$/,
  );
  if (embedded?.[1] && !/^[A-Za-z(0-9]/.test(s)) {
    s = embedded[1].trim();
  }

  return s.trim();
}

function isEquationLine(line: string): boolean {
  const t = sanitizeEquationLine(line);
  if (!t) return false;
  if (/^=\s*/.test(t)) return true;
  if (/^[A-Za-z(][^=]*=\s*.+/.test(t)) return true;
  if (/=\s*[+\-]?[\d(]/.test(t)) return true;
  return false;
}

function classifySectionLabel(label: string): ActiveSection | "final" {
  const key = label.toLowerCase().trim();
  if (FINAL_LABEL_RE.test(key)) return "final";
  if (/^formula/.test(key)) return "formula";
  if (/substitution|working|calculation|method|substitute/.test(key)) return "working";
  return "working";
}

function isSymbolicFormula(line: string): boolean {
  const rhs = line.split("=")[1]?.trim() ?? "";
  return !/\d/.test(rhs);
}

function pushLine(buffer: string[], line: string) {
  const cleaned = sanitizeEquationLine(line);
  if (cleaned) buffer.push(cleaned);
}

function flushBuffer(
  buffer: string[],
  active: ActiveSection,
  layout: CalculationModelAnswerLayout,
) {
  if (buffer.length === 0) return;

  if (active === "formula") {
    layout.formulaLines.push(...buffer);
  } else if (active === "working") {
    layout.workingLines.push(...buffer);
  } else {
    splitUnlabeledEquations(buffer, layout);
  }
}

function splitUnlabeledEquations(lines: string[], layout: CalculationModelAnswerLayout) {
  if (lines.length === 0) return;

  if (lines.length === 1) {
    if (isGeneralFormulaLine(lines[0]!)) {
      layout.formulaLines.push(lines[0]!);
    } else {
      layout.workingLines.push(lines[0]!);
    }
    return;
  }

  const firstFormula = lines.findIndex(isGeneralFormulaLine);
  if (firstFormula === -1) {
    layout.workingLines.push(...lines);
    return;
  }

  layout.formulaLines.push(lines[firstFormula]!);
  layout.workingLines.push(
    ...lines.slice(0, firstFormula),
    ...lines.slice(firstFormula + 1),
  );
}

function shouldStartWorkingSection(line: string, active: ActiveSection): boolean {
  if (active !== "formula") return false;
  if (isGeneralFormulaLine(line)) return false;
  const t = sanitizeEquationLine(line);
  if (/^=\s*/.test(t)) return true;
  const rhs = t.split("=")[1]?.trim() ?? "";
  return /\d/.test(rhs);
}

export function splitLabelValue(line: string): { label: string; value: string } | null {
  const cleaned = sanitizeEquationLine(line);
  if (/^=\s*/.test(cleaned)) return null;
  const eqIdx = cleaned.indexOf("=");
  if (eqIdx === -1) return null;
  const label = cleaned.slice(0, eqIdx).trim();
  const value = cleaned.slice(eqIdx + 1).trim();
  if (!label || !value) return null;
  return { label, value };
}

/** Symbolic relationship (no numeric substitution yet). */
export function isGeneralFormulaLine(line: string): boolean {
  return isSymbolicFormulaLine(line);
}

/** Evaluated substitution / arithmetic with concrete numbers. */
export function isNumericWorkingLine(line: string): boolean {
  const t = sanitizeEquationLine(line);
  const split = splitLabelValue(t);
  const expr = split?.value ?? t;

  if ((t.match(/=/g) || []).length >= 2) return true;
  if (/\d+\.\d+\s*[×x*]/.test(t)) return true;
  if (/=\s*\d+(?:\.\d+)?\s*(?:g|mol|kg|J|kJ|dm|cm|L|N|W|V|A|Pa|Ω|s|%)\b/i.test(t)) return true;
  if (/\d+\s*[×x*]\s*\d+\s*[+\-]/.test(expr) && !/RAM/i.test(expr)) return true;

  return false;
}

function isReactionEquationLine(line: string): boolean {
  const t = line.trim();
  return /[→⟶⇌↔]/.test(t) || /\s->\s/.test(t) || /\s→\s/.test(t);
}

/** General symbolic formula before numeric substitution. */
export function isSymbolicFormulaLine(line: string): boolean {
  if (isNumericWorkingLine(line)) return false;

  const t = sanitizeEquationLine(line);
  const split = splitLabelValue(t);
  const expr = split?.value ?? t;

  // Balanced chemical / nuclear equations are formulas even with stoichiometric digits.
  if (isReactionEquationLine(t)) return true;
  if (/RAM\s*\(|M[_rR]|A[_rR]\s*\(/i.test(expr)) return true;
  if (!/\d/.test(expr)) return true;
  if (split && /^[A-Za-z]$/.test(split.label.trim()) && !/\d/.test(expr)) return true;
  if (/[a-zA-Z]{4,}/.test(expr) && /[\/÷]/.test(expr) && (expr.match(/=/g) || []).length === 0) {
    return true;
  }

  return false;
}

/**
 * Rebalance Formula vs Working.
 * Explicit Formula: lines from the backend are kept unless they are clearly
 * numeric substitution — heuristics must not demote worded formulas or
 * reaction equations that contain digits (e.g. 2KClO3 → 2KCl + 3O2).
 */
function rebalanceFormulaAndWorking(layout: CalculationModelAnswerLayout): void {
  const formulas: string[] = [];
  const working: string[] = [];

  for (const line of layout.formulaLines) {
    if (isNumericWorkingLine(line) && !isReactionEquationLine(line)) {
      working.push(line);
    } else {
      formulas.push(line);
    }
  }

  for (const line of layout.workingLines) {
    if (isNumericWorkingLine(line)) {
      working.push(line);
    } else if (isSymbolicFormulaLine(line)) {
      formulas.push(line);
    } else if (/\d/.test(line)) {
      working.push(line);
    } else {
      formulas.push(line);
    }
  }

  layout.formulaLines = formulas;
  layout.workingLines = working;
}

/** A single measured quantity from the question — not a multi-step expression. */
export function isSimpleGivenValue(rhs: string): boolean {
  const t = rhs.trim();
  if (!/\d/.test(t)) return false;
  if (/[\/÷×]/.test(t)) return false;
  return true;
}

function isDescriptiveLabel(label: string): boolean {
  return label.trim().length > 0 && /\s/.test(label.trim());
}

function normalizeRepeatedLhs(lines: string[]): string[] {
  let lastLhs: string | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const split = splitLabelValue(line);
    if (!split) {
      out.push(line);
      lastLhs = null;
      continue;
    }
    if (lastLhs && split.label === lastLhs) {
      out.push(`= ${split.value}`);
    } else {
      out.push(line);
      lastLhs = split.label;
    }
  }

  return out;
}

function extractSymbolicFormulaFromWorkedLine(line: string): string | null {
  const match = line.match(
    /(?:^|,\s*)([A-Za-zΔ][\wΔ]*\s*=\s*(?:(?!\s*=\s*-?\d)[^=])+?)(?=\s*=\s*-?\d)/,
  );
  return match?.[1]?.trim() ?? null;
}

function extractFinalAnswerFromWorkedLine(line: string): string | null {
  const numericFinal = line.match(/=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(.+)$/);
  if (numericFinal) {
    const value = numericFinal[1]!.trim();
    const tail = numericFinal[2]!.trim();
    if (/(?:J|kg|mol|g|N|W|V|A|Pa|°C|K|L|Ω|m\/s|%|°|dm|cm)/i.test(tail) || /^[A-Z][A-Za-z₀-₉\d]*$/.test(tail)) {
      return `${value} ${tail}`.trim();
    }
  }

  const formulaMatch = line.match(/=\s*([A-Z][A-Za-z₀-₉\d]*)\s*$/);
  if (formulaMatch) return formulaMatch[1]!;

  return null;
}

function isTheoryProseChunk(part: string): boolean {
  const t = part.trim();
  if (!t) return false;
  if (!/=/.test(t) && !/\d/.test(t)) return true;
  if (
    /\b(?:because|therefore|explain|lower|higher|faster|stores|compared to|useful in)\b/i.test(t) &&
    (t.match(/=/g)?.length ?? 0) <= 1 &&
    !/=\s*-?\d+(?:\.\d+)?\s*(?:J|kg|mol|g|N|W|V|A|Pa|°C|K)/i.test(t)
  ) {
    return true;
  }
  return false;
}

export type PreparedCalculationDisplay = {
  structuredText: string;
  theoryPoints: string[];
};

/** Turn semicolon-separated calc blobs into Formula / Working / Final answer sections. */
export function prepareCalculationModelAnswerDisplay(raw: string): PreparedCalculationDisplay {
  const text = raw.trim();
  if (!text) return { structuredText: "", theoryPoints: [] };

  if (/(?:^|\n)\s*(?:formula|working|final answer)\b/im.test(text)) {
    return { structuredText: text, theoryPoints: [] };
  }

  if (!text.includes(";")) {
    return { structuredText: text, theoryPoints: [] };
  }

  const parts = text.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { structuredText: text, theoryPoints: [] };

  const theoryPoints: string[] = [];
  const workingParts: string[] = [];
  let formulaLine: string | null = null;
  let finalLine: string | null = null;

  for (const part of parts) {
    if (isTheoryProseChunk(part)) {
      theoryPoints.push(part);
      continue;
    }

    const symbolic = extractSymbolicFormulaFromWorkedLine(part);
    const final = extractFinalAnswerFromWorkedLine(part);
    if (symbolic && !formulaLine) formulaLine = symbolic;
    if (final) finalLine = final;
    workingParts.push(part);
  }

  if (workingParts.length === 0 && !formulaLine && !finalLine) {
    return { structuredText: text, theoryPoints };
  }

  const sections: string[] = [];
  if (formulaLine) sections.push(`Formula\n${formulaLine}`);
  if (workingParts.length > 0) sections.push(`Working\n${workingParts.join("\n")}`);
  if (finalLine) sections.push(`Final answer\n${finalLine}`);

  return {
    structuredText: sections.join("\n\n"),
    theoryPoints,
  };
}

function promoteFinalFromWorking(layout: CalculationModelAnswerLayout): void {
  if (layout.finalLines.length > 0) return;
  for (let i = layout.workingLines.length - 1; i >= 0; i -= 1) {
    const final = extractFinalAnswerFromWorkedLine(layout.workingLines[i]!);
    if (final) {
      layout.finalLines.push(final);
      return;
    }
  }
}

function promoteFormulaFromWorking(layout: CalculationModelAnswerLayout): void {
  if (layout.formulaLines.length > 0) return;
  for (const line of layout.workingLines) {
    const symbolic = extractSymbolicFormulaFromWorkedLine(line);
    if (symbolic) {
      layout.formulaLines.push(symbolic);
      return;
    }
    if (isSymbolicFormulaLine(line)) {
      layout.formulaLines.push(line);
      return;
    }
  }
}

function postProcessLayout(layout: CalculationModelAnswerLayout): CalculationModelAnswerLayout {
  rebalanceFormulaAndWorking(layout);
  promoteFormulaFromWorking(layout);
  promoteFinalFromWorking(layout);
  layout.workingLines = normalizeRepeatedLhs(layout.workingLines);
  return layout;
}

export function parseCalculationModelAnswer(raw: string): CalculationModelAnswerLayout {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])(\s*(?:Final answer|Answer|Jawapan)[:\s])/gi, "$1\n$2")
    .trim();

  const layout: CalculationModelAnswerLayout = {
    formulaLines: [],
    workingLines: [],
    finalLines: [],
  };
  if (!text) return layout;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let buffer: string[] = [];
  let active: ActiveSection = null;

  const flush = () => {
    flushBuffer(buffer, active, layout);
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    const sectionMatch = line.match(SECTION_LABEL_RE);
    if (sectionMatch) {
      flush();
      const label = sectionMatch[1]!.trim();
      const rest = (sectionMatch[2] ?? "").trim();
      const section = classifySectionLabel(label);

      if (section === "final") {
        active = null;
        if (rest) layout.finalLines.push(sanitizeEquationLine(rest));
        continue;
      }

      active = section;
      // Keep the section body even when it has no "=" (common for weighted-average
      // formulas, mole ratios, and chemical equations written as expressions).
      // The old gate required isEquationLine / "=" and silently dropped those.
      if (rest) {
        if (active === "formula" && shouldStartWorkingSection(rest, "formula")) {
          flush();
          active = "working";
        }
        pushLine(buffer, rest);
      }
      continue;
    }

    if (isEquationLine(line) || (buffer.length > 0 && /^=\s*/.test(sanitizeEquationLine(line)))) {
      if (shouldStartWorkingSection(line, active)) {
        flush();
        active = "working";
      }
      pushLine(buffer, line);
      continue;
    }

    const prose = sanitizeEquationLine(line);
    if (prose) {
      // Multi-line Formula sections often continue as plain expressions (no "=").
      // Keep them in the formula buffer instead of discarding.
      if (active === "formula") {
        pushLine(buffer, prose);
        continue;
      }
      flush();
      if (active === "working" || active === null) {
        layout.workingLines.push(prose);
      }
    }
  }

  flush();

  layout.formulaLines = layout.formulaLines.map(sanitizeEquationLine).filter(Boolean);
  layout.workingLines = layout.workingLines.map(sanitizeEquationLine).filter(Boolean);
  layout.finalLines = layout.finalLines.map(sanitizeEquationLine).filter(Boolean);

  return postProcessLayout(layout);
}

function formatMathLine(text: string): string {
  return text.replace(/\//g, " ÷ ").replace(/\*/g, " × ").replace(/\s+/g, " ").trim();
}

/** Map working lines to display rows — content from model answer text only. */
export function parseWorkingDisplayRows(workingLines: string[]): WorkingDisplayRow[] {
  const rows: WorkingDisplayRow[] = [];

  for (const line of workingLines) {
    const cleaned = sanitizeEquationLine(line);
    if (!cleaned) continue;

    if (/^=\s*/.test(cleaned)) {
      rows.push({
        type: "equation",
        lhs: "",
        rhs: formatMathLine(cleaned.replace(/^=\s*/, "")),
        isContinuation: true,
      });
      continue;
    }

    const split = splitLabelValue(cleaned);
    if (!split) {
      rows.push({ type: "equation", lhs: formatMathLine(cleaned), rhs: "", isContinuation: false });
      continue;
    }

    if (isDescriptiveLabel(split.label) && isSimpleGivenValue(split.value)) {
      rows.push({ type: "given", label: split.label, value: formatMathLine(split.value) });
      continue;
    }

    rows.push({
      type: "equation",
      lhs: split.label,
      rhs: formatMathLine(split.value),
      isContinuation: false,
    });
  }

  return rows;
}

export function looksLikeCalculationWorking(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const semicolonCalc = (t.match(/;/g)?.length ?? 0) >= 2 && /=/.test(t) && /\d/.test(t);
  const hasStructure =
    /(?:formula|substitution|working|final answer|jawapan)/i.test(t) ||
    (t.includes("\n") && /=/.test(t)) ||
    semicolonCalc;
  const hasMath = /\d/.test(t) && (/[=÷×/^]/.test(t) || /(?:formula|working|answer)/i.test(t));
  return hasStructure && hasMath;
}

export type ParsedEquationRow = {
  lhs: string;
  rhs: string;
  isContinuation: boolean;
};

/** Split lines into lhs/rhs pairs for equal-sign alignment. */
export function parseEquationRows(lines: string[]): ParsedEquationRow[] {
  return lines.map((raw) => {
    const line = sanitizeEquationLine(raw);
    if (/^=\s*(.+)/.test(line)) {
      return { lhs: "", rhs: line.replace(/^=\s*/, ""), isContinuation: true };
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      return { lhs: line, rhs: "", isContinuation: false };
    }
    const lhs = line.slice(0, eqIdx).trim();
    const rhs = line.slice(eqIdx + 1).trim();
    return { lhs, rhs, isContinuation: lhs.length === 0 };
  });
}
