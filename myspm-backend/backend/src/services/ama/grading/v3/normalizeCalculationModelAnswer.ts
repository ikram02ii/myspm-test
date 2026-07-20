/**
 * Deterministic cleanup for calculation model answers before cache / student display.
 * Always aims for Formula + Working + Final answer — recovers missing sections from
 * numbered bullets / conversion lines / substitution equations when the LLM omits a label.
 */

import { normalizeOcrExtractedText } from "../../ocr/ocrTextNormalize";
import { hasCompleteCalculationModelAnswerSections } from "./calculationAcfPolicy";

const SECTION_LABEL_RE =
  /(?:^|\n)\s*((?:Formula|Working|Final answer|Data)\s*:)\s*/gi;

export function calculationModelAnswerLooksDirty(text: string): boolean {
  const t = text || "";
  if (/\\n/.test(t)) return true;
  if (/\\[a-zA-Z]/.test(t)) return true;
  if (/\\\\/.test(t)) return true;
  if (/\[\d*ex\]/i.test(t)) return true;
  if (/\bext[a-z]/i.test(t)) return true; // broken \text{kg} → extkg
  if (!hasCompleteCalculationModelAnswerSections(t) && looksPartiallySectioned(t)) return true;
  return false;
}

function looksPartiallySectioned(text: string): boolean {
  return /(?:^|\n)\s*(?:Formula|Working|Final answer|Data)\s*:/im.test((text || "").trim());
}

function unescapeLiteralEscapes(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ");
}

/** Strip LaTeX / pseudo-LaTeX that students should never see. */
function stripLatexArtifacts(text: string): string {
  return text
    .replace(/\\\[\d*ex\]/gi, "")
    .replace(/\[\d*ex\]/gi, "")
    .replace(/\\begin\{[^}]+\}/gi, "")
    .replace(/\\end\{[^}]+\}/gi, "")
    .replace(/\\left|\\right/gi, "")
    .replace(/\\times/gi, "×")
    .replace(/\\div/gi, "÷")
    .replace(/\\cdot/gi, "·")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/gi, "($1)/($2)")
    .replace(/\\text\{([^}]*)\}/gi, "$1")
    .replace(/\\mathrm\{([^}]*)\}/gi, "$1")
    .replace(/\\mathbf\{([^}]*)\}/gi, "$1")
    // Broken leftovers like "extkg", "extm"
    .replace(/\bext([a-zA-Z]+)/g, "$1")
    .replace(/\\\[|\\\]/g, "")
    .replace(/\\\(|\\\)/g, "")
    .replace(/\$+/g, "")
    .replace(/\\([a-zA-Z])/g, "$1")
    .replace(/\\\\/g, " ")
    .replace(/\\+$/gm, "")
    .replace(/\s+\\+\s*$/gm, "")
    // Orphan bracket lines from broken math mode
    .replace(/^\s*\[\s*/gm, "")
    .replace(/\s*\]\s*$/gm, "")
    .replace(/^\s*\]\s*$/gm, "");
}

function stripTrailingJunk(line: string): string {
  return line
    .replace(/\\+\s*$/g, "")
    .replace(/^\d+[.)]\s+/, "") // drop "1. " / "2. " list markers inside sections
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeSectionLabel(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("formula")) return "Formula:";
  if (lower.startsWith("working")) return "Working:";
  if (lower.startsWith("data")) return "Data:";
  if (lower.startsWith("final")) return "Final answer:";
  return raw.trim().replace(/\s+/g, " ");
}

type SectionKey = "formula" | "working" | "final" | "data";

function classifySection(label: string): SectionKey | null {
  const lower = label.toLowerCase();
  if (lower.startsWith("formula")) return "formula";
  if (lower.startsWith("working")) return "working";
  if (lower.startsWith("data")) return "data";
  if (lower.startsWith("final") || lower.startsWith("answer")) return "final";
  return null;
}

function collectSections(text: string): Map<SectionKey, string[]> {
  const bodies = new Map<SectionKey, string[]>();
  const matches = [...text.matchAll(SECTION_LABEL_RE)];
  if (matches.length === 0) return bodies;

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i]!;
    const key = classifySection(m[1] ?? "");
    if (!key) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;
    const body = text
      .slice(start, end)
      .split("\n")
      .map(stripTrailingJunk)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!body) continue;
    const list = bodies.get(key) ?? [];
    list.push(body);
    bodies.set(key, list);
  }
  return bodies;
}

function joinBodies(bodies: string[] | undefined): string {
  if (!bodies?.length) return "";
  return bodies
    .join("\n")
    .split("\n")
    .map(stripTrailingJunk)
    .filter(Boolean)
    .join("\n");
}

function dedupeWorkingAgainstFormula(formula: string, working: string): string {
  if (!formula || !working) return working;
  const fFlat = formula.replace(/\s+/g, " ").trim().toLowerCase();
  let remaining = working.trim();
  const wFlat = remaining.replace(/\s+/g, " ").trim().toLowerCase();
  if (wFlat === fFlat) return "";
  if (wFlat.startsWith(fFlat)) {
    remaining = remaining.slice(formula.trim().length).replace(/^[\s,;:.-]+/, "").trim();
  }
  const lines = remaining
    .split("\n")
    .map(stripTrailingJunk)
    .filter((line) => {
      const flat = line.replace(/\s+/g, " ").trim().toLowerCase();
      return flat.length > 0 && flat !== fFlat;
    });
  return lines.join("\n");
}

function isMostlySymbolic(line: string): boolean {
  const digitCount = (line.match(/\d/g) || []).length;
  return /=/.test(line) && digitCount <= 1 && line.length >= 3;
}

/** Conversion or definition line that can stand as Formula. */
function looksLikeFormulaLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isMostlySymbolic(t)) return true;
  // 1 km = 1000 m, 1 MW = 1,000,000 W
  if (/^\d+(\.\d+)?\s*[a-zA-Zµμ°/%]+\s*=\s*[\d,.]+\s*[a-zA-Zµμ°/%²³⁻⁰-⁹]*$/i.test(t)) return true;
  if (/\bformula\b/i.test(t) && /=/.test(t)) return true;
  if (/^[ρa-zA-Z]+\s*=\s*[^=\d]*[a-zA-Z]/i.test(t) && (t.match(/\d/g) || []).length <= 2) return true;
  return false;
}

function recoverFormulaFromWorking(working: string): { formula: string; working: string } {
  const lines = working.split("\n").map(stripTrailingJunk).filter(Boolean);
  if (lines.length === 0) return { formula: "", working: "" };

  // Prefer an explicit formula mention / symbolic first line
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i]!;
    if (looksLikeFormulaLine(line) || /\bformula\b/i.test(line)) {
      // Extract "formula is X" → X when possible
      const m = line.match(/\bformula(?:\s+for[^=]+)?\s*(?:is|:)\s*(.+)$/i);
      const formula = m?.[1]?.trim() || line;
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
      return { formula: stripTrailingJunk(formula), working: rest };
    }
  }

  if (isMostlySymbolic(lines[0]!)) {
    return { formula: lines[0]!, working: lines.slice(1).join("\n") };
  }
  const sym = lines[0]!.match(/^([A-Za-zρ][A-Za-z0-9₀-₉]*\s*=\s*[^=]+?)(?:\s*=\s*.+)?$/);
  if (sym?.[1] && isMostlySymbolic(sym[1])) {
    return { formula: stripTrailingJunk(sym[1]), working };
  }
  // Conversion factor as formula when that is the only definitional line
  if (looksLikeFormulaLine(lines[0]!) && lines.length >= 2) {
    return { formula: lines[0]!, working: lines.slice(1).join("\n") };
  }
  return { formula: "", working };
}

function recoverWorkingFromFinal(finalAnswer: string): { working: string; finalAnswer: string } {
  const lines = finalAnswer.split("\n").map(stripTrailingJunk).filter(Boolean);
  if (lines.length <= 1) {
    // Single line with chained equals: keep last segment as final, rest as working
    const parts = finalAnswer.split(/\s*=\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return {
        working: parts.slice(0, -1).join(" = "),
        finalAnswer: parts[parts.length - 1]!,
      };
    }
    return { working: "", finalAnswer };
  }
  const last = lines[lines.length - 1]!;
  return {
    working: lines.slice(0, -1).join("\n"),
    finalAnswer: last,
  };
}

/**
 * When Final is labeled but also contains "Working:" prose / calculation sentence,
 * peel the calc into Working.
 */
function peelWorkingEmbeddedInFinal(finalAnswer: string): { working: string; finalAnswer: string } {
  const m = finalAnswer.match(/^(.*?)(?:working\s*:?\s*)(.+?)(?:final answer\s*:?\s*)(.+)$/i);
  if (m) {
    return {
      working: stripTrailingJunk([m[1], m[2]].filter(Boolean).join(" ")),
      finalAnswer: stripTrailingJunk(m[3]!),
    };
  }
  const calcThenAnswer = finalAnswer.match(
    /^(.+?=\s*[\d.,]+(?:\s*[a-zA-Zµμ°/%²³⁻⁰-⁹]*)?)\.?\s*(?:final answer\s*:?\s*)?(.+)$/i,
  );
  if (calcThenAnswer && /=/.test(calcThenAnswer[1]!) && calcThenAnswer[2]!.length > 2) {
    return {
      working: stripTrailingJunk(calcThenAnswer[1]!),
      finalAnswer: stripTrailingJunk(calcThenAnswer[2]!),
    };
  }
  return { working: "", finalAnswer };
}

function emitLabeled(label: string, body: string): string[] {
  const lines = body.split("\n").map(stripTrailingJunk).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length === 1) return [`${label} ${lines[0]}`];
  return [`${label} ${lines[0]}`, ...lines.slice(1)];
}

function ensureThreeSections(formula: string, working: string, finalAnswer: string, data = ""): string {
  let f = formula.trim();
  let w = working.trim();
  let a = finalAnswer.trim();

  // Recover formula from working/final if still missing
  if (!f && w) {
    const recovered = recoverFormulaFromWorking(w);
    f = recovered.formula;
    w = recovered.working;
  }
  if (!f && a) {
    const recovered = recoverFormulaFromWorking(a);
    if (recovered.formula) {
      f = recovered.formula;
      // keep a as final; don't cannibalize unless it was only formula
    }
  }

  // Recover working from final
  if (!w && a) {
    const peeled = peelWorkingEmbeddedInFinal(a);
    if (peeled.working) {
      w = peeled.working;
      a = peeled.finalAnswer;
    } else {
      const recovered = recoverWorkingFromFinal(a);
      w = recovered.working;
      a = recovered.finalAnswer;
    }
  }

  // Still missing working but have formula + final with a numeric equation in final
  if (!w && f && a && /=/.test(a) && (a.match(/\d/g) || []).length >= 2) {
    const parts = a.split(/\s*=\s*/);
    if (parts.length >= 2) {
      w = parts.slice(0, -1).join(" = ");
      a = parts[parts.length - 1]!;
    }
  }

  // Hard guarantees — never ship incomplete student exemplars when we have content
  if (!f && (w || a)) {
    f = "Use the required syllabus relationship / conversion factor for this question.";
  }
  if (!w && (f || a)) {
    w =
      a && /=/.test(a)
        ? a
        : "Substitute the given values into the formula and calculate step by step.";
    if (a && /=/.test(a) && w === a) {
      // avoid identical working/final — keep last token as final
      const parts = a.split(/\s*=\s*/);
      if (parts.length >= 2) {
        w = parts.slice(0, -1).join(" = ");
        a = parts[parts.length - 1]!;
      }
    }
  }
  if (!a && (f || w)) {
    // Last number in working as best-effort final
    const nums = (w || f).match(/-?\d+(?:[.,]\d+)?(?:\s*(?:×|x)\s*10\s*\^?\s*[+-]?\d+)?/gi);
    a = nums?.length ? nums[nums.length - 1]!.replace(/,/g, "") : "See working.";
  }

  // Prefer plain digits without thousand separators in Final answer (easier for students + parsers)
  let prevA = "";
  while (prevA !== a) {
    prevA = a;
    a = a.replace(/(\d),(\d{3})\b/g, "$1$2");
  }

  w = dedupeWorkingAgainstFormula(f, w);

  const out: string[] = [];
  out.push(...emitLabeled(normalizeSectionLabel("Data:"), data));
  out.push(...emitLabeled("Formula:", f));
  out.push(...emitLabeled("Working:", w));
  out.push(...emitLabeled("Final answer:", a));
  return out.filter(Boolean).join("\n").trim();
}

/**
 * Normalize a calculation model answer to plain, sectioned SPM text.
 * Always recovers toward Formula + Working + Final answer.
 */
export function normalizeCalculationModelAnswer(raw: string): string {
  if (!(raw || "").trim()) return "";

  let t = unescapeLiteralEscapes(raw.trim());
  t = stripLatexArtifacts(t);
  t = normalizeOcrExtractedText(t);
  t = unescapeLiteralEscapes(t);
  t = stripLatexArtifacts(t);
  // Collapse leftover empty bracket leftovers
  t = t
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[\s*=/g, "")
    .replace(/=\s*\]/g, "=")
    .trim();

  let sections = collectSections(t);
  if (sections.size === 0) {
    const lines = t.split("\n").map(stripTrailingJunk).filter(Boolean);
    if (lines.length === 0) return "";
    if (lines.length === 1) {
      return ensureThreeSections("", "", lines[0]!);
    }
    const last = lines[lines.length - 1]!;
    const prior = lines.slice(0, -1);
    let formula = "";
    let working = prior.join("\n");
    if (looksLikeFormulaLine(prior[0]!)) {
      formula = prior[0]!;
      working = prior.slice(1).join("\n");
    }
    return ensureThreeSections(formula, working, last);
  }

  const data = joinBodies(sections.get("data"));
  let formula = joinBodies(sections.get("formula"));
  let working = joinBodies(sections.get("working"));
  let finalAnswer = joinBodies(sections.get("final"));

  working = dedupeWorkingAgainstFormula(formula, working);

  if (!working && /working\s*:/i.test(formula)) {
    const split = formula.split(/working\s*:/i);
    formula = stripTrailingJunk(split[0] ?? "");
    working = stripTrailingJunk(split.slice(1).join(" ").trim());
  }

  // Final section accidentally contains working + final prose
  if (finalAnswer && /working\s*:/i.test(finalAnswer)) {
    const peeled = peelWorkingEmbeddedInFinal(finalAnswer);
    if (peeled.working) {
      working = working ? `${working}\n${peeled.working}` : peeled.working;
      finalAnswer = peeled.finalAnswer;
    }
  }

  return ensureThreeSections(formula, working, finalAnswer, data);
}

export { hasCompleteCalculationModelAnswerSections };
