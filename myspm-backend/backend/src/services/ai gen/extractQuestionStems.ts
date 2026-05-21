/** Extract question stems from RAG generate answer text (MCQ or subjective). */

function normalizeAiText(s: string): string {
  return (s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*/g, "");
}

/** LLM-authored flag: must appear after BM: and before A. for science MCQ (when instructed). */
const PERLU_RAJAH_LINE =
  /^(?:Perlu rajah|Diagram needed|Need diagram|Rajah diperlukan)\s*:\s*(ya|tidak|yes|no|y|n)\b/i;

export type GeneratedQuestionStem = {
  questionIndex: number;
  /** Stem text only (EN/BM); diagram flag line removed. */
  stem: string;
  /**
   * Whether the question author asked for an educational diagram.
   * Only present when the model emitted the Perlu rajah line; otherwise undefined (no diagram).
   */
  needsDiagram?: boolean;
};

function parseNeedsDiagramFromLine(line: string): boolean | undefined {
  const m = line.trim().match(PERLU_RAJAH_LINE);
  if (!m) return undefined;
  const v = m[1].toLowerCase();
  if (v === "ya" || v === "yes" || v === "y") return true;
  if (v === "tidak" || v === "no" || v === "n") return false;
  return undefined;
}

export function extractGeneratedQuestionStems(answer: string): GeneratedQuestionStem[] {
  const text = normalizeAiText(answer);
  if (!text.trim()) return [];

  const blocks: Array<{ index: number; body: string }> = [];
  const re =
    /(?:^|\n)\s*(?:Soalan|Question)\s+(\d+)\s*[:.)-]?\s*([\s\S]*?)(?=\n\s*(?:Soalan|Question)\s+\d+\s*[:.)-]?|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = Number(m[1]);
    const body = (m[2] ?? "").trim();
    if (body) blocks.push({ index, body });
  }

  if (blocks.length === 0) {
    const numberedRe = /(?:^|\n)\s*(\d+)\s*[.)]\s+([\s\S]*?)(?=\n\s*\d+\s*[.)]\s+|$)/g;
    while ((m = numberedRe.exec(text))) {
      const index = Number(m[1]);
      const body = (m[2] ?? "").trim();
      if (body) blocks.push({ index, body });
    }
  }

  const out: GeneratedQuestionStem[] = [];

  for (const block of blocks) {
    const lines = block.body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let needsDiagram: boolean | undefined;
    const linesWithoutFlag: string[] = [];
    for (const line of lines) {
      const parsed = parseNeedsDiagramFromLine(line);
      if (parsed !== undefined) {
        needsDiagram = parsed;
        continue;
      }
      linesWithoutFlag.push(line);
    }

    const firstOption = linesWithoutFlag.findIndex((line) => /^[A-Da-d]\s*[\).:\-]\s+/.test(line));
    const answerLine = linesWithoutFlag.findIndex((line) =>
      /^(?:Jawapan|Answer|Markah|Marks?|Marking points?)\s*:/i.test(line),
    );

    let end = linesWithoutFlag.length;
    if (firstOption >= 0) end = Math.min(end, firstOption);
    if (answerLine >= 0) end = Math.min(end, answerLine);

    const stem = linesWithoutFlag
      .slice(0, end > 0 ? end : 1)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    if (!stem) continue;

    const row: GeneratedQuestionStem = { questionIndex: block.index, stem };
    if (needsDiagram !== undefined) {
      row.needsDiagram = needsDiagram;
    }
    out.push(row);
  }

  return out;
}
