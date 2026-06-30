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

  const embedded = s.match(
    /(?:^|[\s:])((?:[A-Za-z][A-Za-z0-9₀-₉]*|[(][^)]+[)])\s*=\s*.+)$/,
  );
  if (embedded?.[1] && !/^[A-Za-z(]/.test(s)) {
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

/** General symbolic formula before numeric substitution. */
export function isSymbolicFormulaLine(line: string): boolean {
  if (isNumericWorkingLine(line)) return false;

  const t = sanitizeEquationLine(line);
  const split = splitLabelValue(t);
  const expr = split?.value ?? t;

  if (/RAM\s*\(|M[_rR]|A[_rR]\s*\(/i.test(expr)) return true;
  if (!/\d/.test(expr)) return true;
  if (split && /^[A-Za-z]$/.test(split.label.trim()) && !/\d/.test(expr)) return true;
  if (/[a-zA-Z]{4,}/.test(expr) && /[\/÷]/.test(expr) && (expr.match(/=/g) || []).length === 0) {
    return true;
  }

  return false;
}

function rebalanceFormulaAndWorking(layout: CalculationModelAnswerLayout): void {
  const combined = [...layout.formulaLines, ...layout.workingLines];
  const formulas: string[] = [];
  const working: string[] = [];

  for (const line of combined) {
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

function postProcessLayout(layout: CalculationModelAnswerLayout): CalculationModelAnswerLayout {
  rebalanceFormulaAndWorking(layout);
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
      if (rest && (isEquationLine(rest) || /=/.test(rest))) {
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
  const hasStructure =
    /(?:formula|substitution|working|final answer|jawapan)/i.test(t) ||
    (t.includes("\n") && /=/.test(t));
  const hasMath = /\d/.test(t) && (/[=÷×/\^]/.test(t) || /(?:formula|working|answer)/i.test(t));
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
