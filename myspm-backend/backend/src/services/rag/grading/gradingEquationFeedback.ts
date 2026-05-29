/**
 * Chemical-equation feedback helpers: detect partial credit in the student's text,
 * filter contradictory "gaps", and post-process LLM feedback.
 */

import { studentAnswerContainsSpecies } from "./gradingFairness";
import { normalizeAnswerText, normalizeFormulaText } from "./gradingTextUtils";

const ARROW_RE = /→|⟶|↔|←|=>|->|—>|⟹|==>/;
const STATE_SYMBOL_RE = /\(([slgaq]{1,3})\)/gi;
/** SPM-style chemical tokens (H2O, CO2, Na+, CaCO3, NH4+, etc.). */
const CHEM_TOKEN_RE = /\b(\d+\s*)?([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*(?:\([A-Za-z]+\)\d*)?|[A-Z][a-z]?\+|\([A-Za-z]+\)\d*)\b/g;

const FORMULA_STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "in",
  "at",
  "to",
  "for",
  "an",
  "as",
  "by",
  "on",
  "of",
  "is",
  "are",
  "was",
  "be",
  "do",
  "if",
  "no",
  "so",
  "it",
  "we",
  "he",
  "she",
  "dan",
  "atau",
  "untuk",
  "dalam",
  "pada",
  "yang",
  "ini",
  "itu",
]);

function extractChemTokens(answer: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CHEM_TOKEN_RE.source, "g");
  while ((m = re.exec(answer)) !== null) {
    const raw = (m[2] ?? m[0]).trim();
    if (raw.length < 2) continue;
    if (FORMULA_STOPWORDS.has(raw.toLowerCase())) continue;
    const norm = normalizeFormulaText(raw);
    if (norm.length < 2 || seen.has(norm)) continue;
    if (!/[a-z]/.test(norm) && norm.length < 2) continue;
    seen.add(norm);
    out.push(raw);
  }
  return out.slice(0, 8);
}

function answerHasReactionArrow(answer: string): boolean {
  return ARROW_RE.test(answer);
}

function answerUsesPlusBetweenSpecies(answer: string): boolean {
  return /\+\s*[A-Za-z0-9(]/.test(answer) || /[A-Za-z0-9)]\s*\+/.test(answer);
}

/** Parts of the equation the student already wrote — for feedback validation (Stage 9). */
export function detectEquationPartialWins(studentAnswer: string): string[] {
  const ans = (studentAnswer || "").trim();
  if (!ans) return [];

  const wins: string[] = [];

  if (answerHasReactionArrow(ans)) {
    const m = ans.match(ARROW_RE);
    wins.push(
      m
        ? `Reaction arrow present in your answer (${m[0]}) — this shows you know reactants convert to products.`
        : "Reaction arrow present in your answer.",
    );
  }

  if (answerUsesPlusBetweenSpecies(ans)) {
    wins.push("Plus sign (+) used to separate species — correct way to show multiple reactants or products.");
  }

  const states = [...ans.matchAll(STATE_SYMBOL_RE)].map((x) => x[0]);
  for (const sym of [...new Set(states)].slice(0, 3)) {
    wins.push(`State symbol written: ${sym}`);
  }

  for (const tok of extractChemTokens(ans)) {
    wins.push(`Chemical formula or ion written: ${tok}`);
  }

  return wins.slice(0, 10);
}

/** Drop mark-scheme gaps that duplicate species or arrows already in the student's text. */
export function filterEquationGapsNotInAnswer(missingIdeas: string[], studentAnswer: string): string[] {
  const ans = (studentAnswer || "").trim();
  if (!ans) return missingIdeas;

  return missingIdeas.filter((gap) => {
    const gapTrim = gap.trim();
    if (!gapTrim) return false;

    for (const tok of extractChemTokens(gapTrim)) {
      if (studentAnswerContainsSpecies(ans, tok)) return false;
    }

    if (studentAnswerContainsSpecies(ans, gapTrim)) return false;

    if (answerHasReactionArrow(ans) && /\barrow|→|reaction|hasil|hasilan|produk|reactant|hasil tindak balas/i.test(gapTrim)) {
      return false;
    }

    const gapNorm = normalizeAnswerText(gapTrim);
    const ansNorm = normalizeAnswerText(ans);
    if (gapNorm.length >= 4 && ansNorm.includes(gapNorm)) return false;

    return true;
  });
}

export function formatEquationFeedbackBlock(): string {
  return [
    "CHEMICAL EQUATION FEEDBACK (mandatory when demandType=equation):",
    "- Equations are marked as a whole (balance, species, coefficients) — partial marks may still be zero.",
    "- If the student wrote ANY correct formula, ion, arrow, +, or state symbol, your FIRST sentence must validate it using their exact wording.",
    "- Only AFTER acknowledging what is correct, explain the structural problem (missing reactant/product, unbalanced, wrong species, etc.).",
    "- NEVER say they should 'use', 'include', 'write', or 'add' a formula, arrow, or symbol that already appears in their answer — validate it instead.",
    "- Example: if they wrote '+ H2O' or '->', praise that part before saying what is still incomplete.",
    "- Gaps listed for the prompt exclude species/arrows already present — do not re-ask for those.",
  ].join("\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite feedback that tells the student to add something they already wrote. */
export function softenEquationFeedbackContradictions(feedback: string, studentAnswer: string): string {
  let out = (feedback || "").trim();
  const ans = (studentAnswer || "").trim();
  if (!out || !ans) return out;

  for (const tok of extractChemTokens(ans)) {
    if (!studentAnswerContainsSpecies(ans, tok)) continue;
    const esc = escapeRegExp(tok);
    const speciesPatterns = [
      new RegExp(
        `\\b(?:you\\s+)?(should|must|need to|have to|ought to|remember to|don't forget to|try to|perlu|mesti|patut)\\s+(?:use|include|write|show|add|tulis|guna|sertakan)\\s+${esc}\\b`,
        "gi",
      ),
      new RegExp(`\\b${esc}\\s+(?:is|was|were)\\s+missing\\b`, "gi"),
      new RegExp(`\\b(?:tanpa|without)\\s+${esc}\\b`, "gi"),
      new RegExp(`\\b(?:missing|tiada|kurang)\\s+${esc}\\b`, "gi"),
    ];
    for (const re of speciesPatterns) {
      out = out.replace(
        re,
        `Good — you already wrote ${tok}; focus on what is still wrong with the overall equation structure`,
      );
    }
  }

  if (answerHasReactionArrow(ans)) {
    const arrowPatterns = [
      /\b(?:you\s+)?(should|must|need to|perlu|mesti)\s+(?:use|include|write|show|add|tulis|guna|sertakan)\s+(?:an?\s+)?(?:reaction\s+)?arrow\b/gi,
      /\b(?:and\s+)?use\s+(?:an?\s+)?(?:reaction\s+)?arrow\b/gi,
      /\b(?:and\s+)?(?:include|tulis|guna)\s+(?:an?\s+)?(?:reaction\s+)?arrow\b/gi,
    ];
    for (const re of arrowPatterns) {
      out = out.replace(re, "you already used a reaction arrow — check");
    }
  }

  return out
    .replace(/\bYou\s+Good\b/gi, "Good")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** When score is 0 but partial equation parts exist, ensure the first sentence acknowledges them. */
export function ensureEquationPartialAcknowledgment(
  feedback: string,
  studentAnswer: string,
  score: number,
  maxScore: number,
  language: "english" | "malay" | "mixed",
): string {
  const fb = (feedback || "").trim();
  if (score > 0 || score >= maxScore) return fb;

  const wins = detectEquationPartialWins(studentAnswer);
  if (wins.length === 0) return fb;

  const tokens = extractChemTokens(studentAnswer);
  const fbLower = fb.toLowerCase();
  const alreadyAck =
    wins.some((w) => {
      const frag = w.split(":").pop()?.trim().toLowerCase() ?? "";
      return frag.length > 2 && fbLower.includes(frag.slice(0, Math.min(8, frag.length)));
    }) ||
    tokens.some((t) => fbLower.includes(t.toLowerCase())) ||
    /\b(good|well done|betul|correct|right|you (?:wrote|used|included)|anda (?:tulis|guna|sertakan|nyatakan))\b/i.test(
      fb,
    );

  if (alreadyAck) return softenEquationFeedbackContradictions(fb, studentAnswer);

  const highlight =
    tokens.length > 0
      ? tokens.slice(0, 2).join(", ")
      : wins[0].replace(/^[^:]+:\s*/i, "").slice(0, 80);

  const prefix =
    language === "malay"
      ? `Bagus — anda sudah menulis ${highlight}, tetapi persamaan penuh belum lengkap atau tidak seimbang. `
      : language === "mixed"
        ? `Good — you already wrote ${highlight}, but the full equation is not complete or balanced yet. `
        : `Good — you already wrote ${highlight}, but the full equation is not complete or balanced yet. `;

  return softenEquationFeedbackContradictions(prefix + fb, studentAnswer);
}
