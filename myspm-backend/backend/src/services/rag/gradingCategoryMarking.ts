/**
 * Heuristics for open-ended SPM questions that should use category-based
 * rubrics and verification (examples, uses, etc.), vs stems bound to a figure.
 */

function normalizeStem(question: string): string {
  return (question || "")
    .toLowerCase()
    .replace(/\r/g, "\n")
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stem ties the answer to a given diagram, text, experiment, or named target → closed set from that source. */
export function isStrictContextBindingQuestion(question: string): boolean {
  const q = normalizeStem(question);
  return (
    /\bbased\s+on\s+(?:the\s+)?(?:diagram|figure|graph|text|passage|table|information|experiment|data|results?|photo|image)\b/.test(
      q,
    ) ||
    /\b(?:refer(?:\s+to)?|using)\s+(?:the\s+)?(?:diagram|figure|graph|text|passage|table|experiment)\b/.test(q) ||
    /\b(?:from|in)\s+the\s+(?:diagram|figure|graph|text|passage|table|experiment)\s+(?:above|below|shown)\b/.test(q) ||
    /\bberdasarkan\s+(?:rajah|graf|teks|jadual|maklumat|eksperimen|data)\b/.test(q) ||
    /\bdaripada\s+(?:rajah|graf|teks|jadual|eksperimen)\b/.test(q) ||
    /\b(?:di|dari)\s+(?:rajah|graf)\s+(?:di\s+)?(?:atas|bawah)\b/.test(q) ||
    /\baccording\s+to\s+the\s+(?:diagram|figure|graph|passage|table|experiment)\b/.test(q)
  );
}

/** Asks for category-style open answers (examples, uses, pros/cons, etc.). */
export function isOpenCategoryMarkingQuestion(question: string): boolean {
  const q = normalizeStem(question);
  return (
    /\b(examples?|for\s+example|such\s+as|one\s+example|give\s+an\s+example|uses?\b|usage\b|function\s+of|functions\s+of|properties?\b|property\b|advantages?|disadvantages?|suggestions?|applications?|benefits?|limitations?)\b/i.test(
      q,
    ) ||
    /\b(contoh|contohnya|sebagai\s+contoh|satu\s+contoh|berikan\s+contoh|kegunaan|fungsi|sifat|ciri|kelebihan|kelemahan|kekurangan|cadangan|aplikasi|faedah|keburukan)\b/i.test(
      q,
    )
  );
}

/** Question asks for an example and a matching use/function (verify separately). */
export function isExampleAndUseComboQuestion(question: string): boolean {
  const q = normalizeStem(question);
  const hasEx = /\b(example|examples|contoh)\b/i.test(q);
  const hasUse = /\b(use|uses|usage|function|functions|purpose|application|kegunaan|fungsi|tujuan|aplikasi)\b/i.test(q);
  if (!hasEx || !hasUse) return false;
  return /\b(and|dan|beserta|serta|with|together\s+with)\b/i.test(q);
}

/** Extra system/user lines for qwenBuildRubric (category vs context-bound stems). */
export function buildCategoryRubricPromptInstructions(question: string): string[] {
  const strict = isStrictContextBindingQuestion(question);
  const open = isOpenCategoryMarkingQuestion(question);
  const lines: string[] = [];
  if (strict) {
    lines.push(
      "CONTEXT-BOUND STEM: the question refers to a specific diagram, text, passage, table, or experiment. Use that source to shape expected rubric points only. Marks still require the student to state each point in their written answer — the diagram/figure is never evidence of what the student knows.",
    );
  }
  if (open) {
    const intro = strict
      ? "The stem is context-bound, so answers must fit that source — still do not require one arbitrary example phrase copied only from retrieval snippets."
      : "OPEN-CATEGORY STEM: the question invites examples, uses, functions, properties, advantages, disadvantages, suggestions, or applications without naming one fixed item.";
    lines.push(
      [
        intro,
        "RUBRIC RULES:",
        '- Prefer GENERAL criteria rows (e.g. "scientifically valid example of the requested category", "correct matching use/function/property for the student\'s example", "valid advantage/disadvantage relevant to the question").',
        "- Do NOT create separate rubric rows that each demand one specific example taken only from retrieved context (treat retrieval as illustration, not a closed answer list).",
        "- Only treat the answer set as CLOSED if the stem is context-bound (diagram/text/experiment above) OR the question names a specific item students must use.",
        '- If the stem asks for BOTH an example AND a use/function (or equivalent), split marks into at least two ideas: (1) valid example in the category, (2) scientifically correct use/function that matches the student\'s chosen example — use linkedToId on the use row pointing at the example row id when helpful.',
      ].join("\n"),
    );
  }
  return lines;
}

function tokenCount(s: string): number {
  return s
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
}

/**
 * Two marking demands joined by "and" / "dan" (e.g. preamble + "state … and explain …").
 * Uses the last "and"/"dan" so stems like "Table 1 … State the hypothesis and explain" still match.
 */
export function hasTwoDistinctDemandsJoinedByAnd(question: string): boolean {
  const t = normalizeStem(question);
  if (/^\s*(?:compare|bandingkan|differentiate|distinguish|bezakan)\b/i.test(t)) return false;
  const matches = [...t.matchAll(/\s+(?:and|dan)\s+/gi)];
  if (matches.length === 0) return false;
  const m = matches[matches.length - 1];
  if (m.index === undefined) return false;
  const left = t.slice(0, m.index).trim();
  const right = t.slice(m.index + m[0].length).trim();
  if (tokenCount(left) < 3 || tokenCount(right) < 3) return false;
  const imperative =
    /\b(state|give|list|name|identify|explain|describe|define|calculate|discuss|outline|suggest|predict|how|why|what|which|nyatakan|senaraikan|namakan|kenal\s*pasti|terangkan|huraikan|jelaskan|takrifkan|hitung|kira|bincangkan|cadangkan|bagaimana|mengapa|apa)\b/i;
  if (imperative.test(left) && imperative.test(right)) return true;
  return imperative.test(right) && imperative.test(t);
}
