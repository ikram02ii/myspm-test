/**
 * Calculation-structure helpers for EMBEDDED MARK SCHEMES only
 * (Formula / Working / Final stage labels in Jawapan / Marking points).
 *
 * NOT used for question-type routing. Calc↔theory routing is owned exclusively
 * by the Question Classification Agent (`questionClassificationAgent.ts`).
 */

/** Worked-answer / scheme stage labels (format markers, not topic words). */
const STAGE_LABEL_RE =
  /(?:^|\n)\s*(?:Formula|Working|Final answer|Data|Substitution|Calculation)\s*:/im;

/**
 * Marking-point row whose primary idea is a calculation stage
 * (not prose that happens to mention a word like "formula").
 */
export function isCalculationStagePoint(point: string): boolean {
  const t = point
    .replace(/^mark\s*\d+\s*[:：]\s*/i, "")
    .replace(/^[—–-]\s*/, "")
    .trim();
  if (!t) return false;
  if (STAGE_LABEL_RE.test(t)) return true;
  return /^(?:correct\s+)?(?:formula(?:\s*\/\s*equation)?|formula\s+or\s+equation|equation|steps?\s+of\s+solving|substitution(?:\s*\/\s*working)?|working|final\s+answer)\b/i.test(
    t,
  );
}

/** Algebraic / arithmetic equation: operands on both sides of '='. */
const EQUATION_RE = /[A-Za-z0-9)\]]\s*=\s*[A-Za-z0-9(\[]/;

/** True math operators — never treat markdown/list bullets (`- item`) as minus. */
function hasMathOperator(text: string): boolean {
  if (/[×÷*/^]|\\frac|\b(?:sin|cos|tan|log|ln)\s*\(/i.test(text)) return true;
  // Binary + / - between tokens on the same line (not list bullets after a newline).
  return /(?:[A-Za-z0-9)\]])[ \t]*[+\-][ \t]*(?:[A-Za-z0-9(\[])/.test(text);
}

function countNumericLiterals(text: string): number {
  const matches = text.match(/(?<![A-Za-z])\d+\.?\d*(?![A-Za-z])/g);
  return matches?.length ?? 0;
}

/**
 * True when text has structural calculation evidence (stem, Jawapan, or marking points).
 */
export function textHasCalculationStructure(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;

  if (STAGE_LABEL_RE.test(t)) return true;

  const numbers = countNumericLiterals(t);
  const hasEquation = EQUATION_RE.test(t);
  const hasMathOp = hasMathOperator(t);

  // Clear worked calculation: equation + operator, or several numbers with operators.
  if (hasEquation && hasMathOp) return true;
  if (numbers >= 2 && hasMathOp) return true;
  if (numbers >= 2 && hasEquation) return true;

  // Single numeric result with an explicit equation (e.g. "v = 12").
  if (numbers >= 1 && hasEquation) return true;

  return false;
}

/**
 * True when embedded scheme points look like calculation stages rather than prose ideas.
 */
export function embeddedSchemeLooksLikeCalculation(points: string[]): boolean {
  if (!points.length) return false;
  const joined = points.join("\n");
  if (STAGE_LABEL_RE.test(joined)) return true;

  const stageLike = points.filter((p) => isCalculationStagePoint(p)).length;
  // Majority of points are stage labels → calculation scheme.
  if (stageLike >= Math.ceil(points.length * 0.5) && stageLike >= 1) return true;

  return textHasCalculationStructure(joined);
}

/**
 * Decide whether embedded scheme points look like calculation stages.
 * Used when building ACF units from Jawapan — NOT for stem type routing.
 */
export function shouldUseCalculationMarking(params: {
  question: string;
  embeddedPoints?: string[];
}): boolean {
  const points = params.embeddedPoints ?? [];
  if (points.length >= 1) {
    return embeddedSchemeLooksLikeCalculation(points);
  }
  // Stem alone must not force calculation — Question Classification Agent owns that.
  void params.question;
  return false;
}
