import type { PracticeSetQuestion } from "../services/mobilePracticeSets";

function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeAiText(s: string): string {
  return normalizeNewlines(s)
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

/** Keep EN and BM on separate lines; collapse spaces only within each line. */
export function formatBilingualQuestionStem(raw: string): string {
  let s = normalizeNewlines(raw.trim());
  s = s.replace(/(EN:\s*[^\n]+?)\s+(BM:)/gi, "$1\n$2");
  return s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function letterToIndex(letter: string): number | null {
  const L = letter.trim().toUpperCase();
  if (!/^[A-D]$/.test(L)) return null;
  return L.charCodeAt(0) - 65;
}

function buildQuestionForGrade(questionStem: string, options: string[]): string {
  const lines = [
    questionStem.trim(),
    ...options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`),
  ];
  return lines.join("\n");
}

/**
 * Parses generator output in the template:
 * Soalan N
 * <stem>
 * A. <opt>
 * B. <opt>
 * C. <opt>
 * D. <opt>
 * Jawapan: <A-D>
 * Penjelasan: <text>
 */
export function parseAiGeneratedMcqAnswer(answer: string): PracticeSetQuestion[] {
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

  const out: PracticeSetQuestion[] = [];

  for (const b of blocks) {
    const block = b.body.trim();
    if (!block) continue;

    const correctMatch = block.match(/(?:Jawapan|Answer)\s*[:.)-]?\s*([A-D])/i);
    if (!correctMatch) continue;
    const correctLetter = correctMatch[1].toUpperCase();

    const optionsByLetter: Partial<Record<"A" | "B" | "C" | "D", string>> = {};
    const optRegex =
      /(?:^|\n)\s*([A-D])\s*[\).:-]\s*([\s\S]*?)(?=\n\s*[A-D]\s*[\).:-]|\n\s*(?:Jawapan|Answer|Penjelasan|Explanation)\s*:|$)/gi;
    let optMatch: RegExpExecArray | null;
    let firstOptionIndex = -1;
    while ((optMatch = optRegex.exec(block))) {
      const letter = optMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      if (firstOptionIndex < 0) firstOptionIndex = optMatch.index;
      optionsByLetter[letter] = (optMatch[2] ?? "").replace(/\s+/g, " ").trim();
    }

    const options = (["A", "B", "C", "D"] as const).map((letter) => optionsByLetter[letter] ?? "");
    if (options.some((option) => option.length === 0)) continue;

    const explMatch = block.match(/(?:Penjelasan|Explanation)\s*:\s*([\s\S]*)$/i);
    const explanation = explMatch ? explMatch[1].trim().replace(/\s+/g, " ") : null;

    const qStemRaw = firstOptionIndex >= 0 ? block.slice(0, firstOptionIndex) : block;
    const qStem = formatBilingualQuestionStem(qStemRaw);

    const gradeQuestion = buildQuestionForGrade(qStem, options);
    const correctIndex = letterToIndex(correctLetter);

    out.push({
      id: out.length + 1,
      sortOrder: b.index,
      questionText: qStem,
      questionType: "mcq_single",
      difficulty: "mixed",
      options,
      correctAnswer: correctLetter,
      explanation,
      questionForGrade: gradeQuestion,
    });

    // If correctIndex is null it won't be used by UI, but parser already guarded correctLetter.
    void correctIndex;
  }

  return out;
}

export function parseAiGeneratedOpenEnded(
  answer: string,
  type: "short" | "essay",
): PracticeSetQuestion[] {
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

  const out: PracticeSetQuestion[] = [];
  for (const block of blocks) {
    const lines = block.body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    // Keep question stem as first non-empty line, answer/rubric as explanation.
    const answerLabelIndex = lines.findIndex((line) =>
      /^(jawapan|answer|model answer|marking points?|rubric|skema)\s*:/i.test(line),
    );
    const questionLines = answerLabelIndex > 0 ? lines.slice(0, answerLabelIndex) : [lines[0]];
    const explanationLines = answerLabelIndex >= 0 ? lines.slice(answerLabelIndex) : lines.slice(1);
    const questionText = formatBilingualQuestionStem(questionLines.join("\n"));
    const explanation = explanationLines.join("\n").trim() || null;
    if (!questionText) continue;

    out.push({
      id: out.length + 1,
      sortOrder: block.index,
      questionText,
      questionType: type === "short" ? "short_answer" : "essay",
      difficulty: "mixed",
      options: [],
      correctAnswer: "",
      explanation,
      questionForGrade: questionText,
    });
  }

  return out;
}

