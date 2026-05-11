import type { PracticeSetQuestion } from "../services/mobilePracticeSets";

function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
  const text = normalizeNewlines(answer);
  if (!text.trim()) return [];

  const blocks: Array<{ index: number; body: string }> = [];
  const re = /Soalan\s+(\d+)\s*([\s\S]*?)(?=Soalan\s+\d+\s*|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = Number(m[1]);
    const body = m[2] ?? "";
    blocks.push({ index, body });
  }

  const out: PracticeSetQuestion[] = [];

  for (const b of blocks) {
    const block = b.body.trim();
    if (!block) continue;

    const correctMatch = block.match(/Jawapan:\s*([A-D])/i);
    if (!correctMatch) continue;
    const correctLetter = correctMatch[1].toUpperCase();

    const optRegex =
      /A\.\s*(.*?)\n\s*B\.\s*(.*?)\n\s*C\.\s*(.*?)\n\s*D\.\s*(.*?)(?=\n\s*Jawapan:|\n\s*Penjelasan:|$)/s;
    const optMatch = block.match(optRegex);
    if (!optMatch) continue;

    const optA = (optMatch[1] ?? "").trim();
    const optB = (optMatch[2] ?? "").trim();
    const optC = (optMatch[3] ?? "").trim();
    const optD = (optMatch[4] ?? "").trim();
    const options = [optA, optB, optC, optD].map((o) => o.replace(/\s+/g, " ").trim());

    const explMatch = block.match(/Penjelasan:\s*([\s\S]*)$/i);
    const explanation = explMatch ? explMatch[1].trim().replace(/\s+/g, " ") : null;

    const aPos = block.search(/\n\s*A\.\s*/i);
    const qStemRaw = aPos >= 0 ? block.slice(0, aPos) : block;
    const qStem = qStemRaw
      .replace(/^\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();

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
  const text = normalizeNewlines(answer);
  if (!text.trim()) return [];

  const blocks: Array<{ index: number; body: string }> = [];
  const re = /Soalan\s+(\d+)\s*([\s\S]*?)(?=Soalan\s+\d+\s*|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = Number(m[1]);
    const body = (m[2] ?? "").trim();
    if (body) blocks.push({ index, body });
  }

  const out: PracticeSetQuestion[] = [];
  for (const block of blocks) {
    const lines = block.body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    // Keep question stem as first non-empty line, answer/rubric as explanation.
    const questionText = lines[0];
    const explanation = lines.slice(1).join("\n").trim() || null;

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

