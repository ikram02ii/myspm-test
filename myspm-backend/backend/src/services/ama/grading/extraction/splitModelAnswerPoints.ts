/**
 * Split a model-answer string into independent marking-point blocks.
 * Prefer structural markers (numbered / bullets / blank lines). Never cut on
 * mid-sentence ";" when numbered points are present (that caused Card1/Card2 bleed).
 */

function stripPointPrefix(chunk: string): string {
  return chunk
    .trim()
    .replace(/^[•\-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function looksLikePointStart(line: string): boolean {
  const t = line.trim();
  return /^[•\-*]\s+\S/.test(t) || /^\d+[.)]\s+\S/.test(t);
}

/**
 * @param expectedCount — when set, merge orphan continuations / extras toward this count
 */
export function splitModelAnswerIntoPoints(raw: string, expectedCount?: number): string[] {
  const text = (raw || "").trim();
  if (!text) return [];

  const target =
    typeof expectedCount === "number" && expectedCount > 0 ? Math.floor(expectedCount) : undefined;

  // 1) Blank-line paragraphs (preferred for explain/compare exemplars)
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => stripPointPrefix(p.replace(/\n+/g, " ").trim()))
    .filter((p) => p.length >= 2);
  if (paragraphs.length >= 2 && (!target || paragraphs.length === target || paragraphs.length >= target)) {
    return finalizePointCount(paragraphs, target);
  }

  // 2) Numbered / bulleted lines — merge soft-wrapped continuations into previous point
  const rawLines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length >= 2) {
    const merged: string[] = [];
    for (const line of rawLines) {
      if (merged.length === 0 || looksLikePointStart(line)) {
        merged.push(stripPointPrefix(line));
      } else {
        // Continuation of previous point (soft wrap / mid-sentence newline)
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${stripPointPrefix(line)}`.trim();
      }
    }
    const cleaned = merged.filter((p) => p.length >= 2);
    if (cleaned.length >= 2) return finalizePointCount(cleaned, target);
  }

  // 3) Inline bullets on one line
  const bulletCount = (text.match(/•/g) || []).length;
  if (bulletCount >= 2) {
    const parts = text
      .split(/\s*•\s*/)
      .map(stripPointPrefix)
      .filter((p) => p.length >= 2);
    if (parts.length >= 2) return finalizePointCount(parts, target);
  }

  // 4) Numbered inline: "1. … 2. …" on one or few lines
  const numberedInline = text.match(/(?:^|\s)\d+[.)]\s+\S/g);
  if (numberedInline && numberedInline.length >= 2) {
    const parts = text
      .split(/(?:^|\s)(?=\d+[.)]\s+\S)/)
      .map(stripPointPrefix)
      .filter((p) => p.length >= 2);
    if (parts.length >= 2) return finalizePointCount(parts, target);
  }

  // 5) Semicolon ONLY when every part is a short fact (state-style) — never for long prose
  if (text.includes(";")) {
    const parts = text
      .split(";")
      .map((p) => stripPointPrefix(p))
      .filter((p) => p.length >= 2);
    const allShort = parts.length >= 2 && parts.every((p) => p.split(/\s+/).length <= 18);
    if (allShort) return finalizePointCount(parts, target);
  }

  // 6) Sentence split as last resort when target known
  if (target && target >= 2) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);
    if (sentences.length >= target) return finalizePointCount(sentences, target);
  }

  return finalizePointCount([text], target);
}

function finalizePointCount(points: string[], target?: number): string[] {
  const cleaned = points.map((p) => p.trim()).filter(Boolean);
  if (!target || target <= 0) return cleaned;
  if (cleaned.length === target) return cleaned;

  if (cleaned.length > target) {
    // Merge extras into the last kept slot (usually a soft-wrap bleed)
    const head = cleaned.slice(0, target - 1);
    const tail = cleaned.slice(target - 1).join(" ").trim();
    return [...head, tail];
  }

  // Fewer than expected — leave as-is (caller may fall back to rubric labels)
  return cleaned;
}

/** Join points for API string field — never use ";" (breaks UI card split). */
export function joinModelAnswerPoints(points: string[], style: "numbered" | "bullets" | "paragraphs" = "numbered"): string {
  const cleaned = points.map((p) => stripPointPrefix(p)).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (style === "bullets") return cleaned.map((p) => `• ${p}`).join("\n");
  if (style === "paragraphs") return cleaned.join("\n\n");
  return cleaned.map((p, i) => `${i + 1}. ${p}`).join("\n\n");
}
