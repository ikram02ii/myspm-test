import type { PracticeSetQuestion } from "../services/mobilePracticeSets";
import {
  buildQuestionPayloadForGrade,
  inferMaxScoreFromMarkScheme,
} from "./markSchemeInference";
import {
  resolveMarksPreferringStructure,
} from "./questionMarkAllocation";

function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** MCQ blocks only — do not strip list bullets (needed for subjective marking points). */
function normalizeMcqAiText(s: string): string {
  return normalizeNewlines(s)
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

function normalizeOpenEndedAiText(s: string): string {
  return normalizeNewlines(s)
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*/g, "");
}

/** Keep EN and BM on separate lines; collapse spaces only within each line. */
function parseMarkahFromBlock(lines: string[]): number | undefined {
  for (const line of lines) {
    const m = line.match(/^(?:Markah|Marks?)\s*[:：]\s*(\d{1,2})\b/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
    }
  }
  return undefined;
}

function parseMarkingPointsFromLines(lines: string[]): string[] {
  const headerIndex = lines.findIndex((line) =>
    /^(?:Marking points?|Mark\s+scheme|Skema(?:\s+penilaian)?)\s*:/i.test(line),
  );
  if (headerIndex < 0) return [];

  const points: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(?:Jawapan|Answer|Markah|Marks?|Soalan|Question)\s*:/i.test(line)) break;
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
    const text = (bullet?.[1] ?? line.trim()).trim();
    if (text.length >= 2) points.push(text);
  }
  return points.filter((point) => point.length >= 2);
}

function extractJawapanFromLines(lines: string[]): string {
  const jawapanIndex = lines.findIndex((line) => /^(?:Jawapan|Answer|Model answer)\s*:/i.test(line));
  if (jawapanIndex < 0) return "";

  const markingIndex = lines.findIndex(
    (line, idx) =>
      idx > jawapanIndex &&
      /^(?:Marking points?|Mark\s+scheme|Skema(?:\s+penilaian)?|Markah|Marks?)\s*:/i.test(line),
  );
  const end = markingIndex >= 0 ? markingIndex : lines.length;
  const first = lines[jawapanIndex].replace(/^(?:Jawapan|Answer|Model answer)\s*[:：]\s*/i, "").trim();
  const rest = lines
    .slice(jawapanIndex + 1, end)
    .map((line) => line.trim())
    .filter(Boolean);
  return [first, ...rest].join("\n").trim();
}

function countDistinctModelAnswerPoints(text: string): number {
  const raw = text.trim();
  if (!raw) return 0;

  if (raw.includes(";")) {
    const parts = raw
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    if (parts.length >= 1) return parts.length;
  }

  const bulletLines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-•*]|\d+[.)])\s+\S/.test(line));
  if (bulletLines.length >= 1) return bulletLines.length;

  if (!raw.includes("\n") && raw.length <= 120) return 1;

  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
  if (sentences.length >= 2) return sentences.length;

  return 1;
}

function resolveGeneratedMaxMarks(
  lines: string[],
  jawapan: string,
  markingPoints: string[],
  questionText: string,
): number {
  const fromPoints = markingPoints.length >= 1 ? markingPoints.length : undefined;
  const fromJawapan = countDistinctModelAnswerPoints(jawapan);
  const fromMarkah = parseMarkahFromBlock(lines);
  const schemeCandidate =
    fromPoints != null && fromPoints >= 1
      ? fromPoints
      : fromJawapan >= 2
        ? fromJawapan
        : fromMarkah != null
          ? fromMarkah
          : fromJawapan >= 1
            ? fromJawapan
            : undefined;

  return resolveMarksPreferringStructure({
    questionText,
    fromScheme: schemeCandidate,
    isMcq: false,
  });
}

function buildQuestionForGradePayload(
  questionText: string,
  maxMarks: number | undefined,
  jawapan: string,
  markingPoints: string[],
): string {
  const parts = [questionText.trim()];
  if (typeof maxMarks === "number" && maxMarks >= 1) {
    parts.push(`Markah: ${maxMarks}`);
  }
  if (jawapan.trim()) {
    parts.push(`Jawapan: ${jawapan.trim()}`);
  }
  if (markingPoints.length > 0) {
    parts.push("Marking points:", ...markingPoints.map((point) => `- ${point}`));
  }
  return parts.join("\n").trim();
}

export function formatBilingualQuestionStem(raw: string): string {
  let s = normalizeNewlines(raw.trim());
  s = s.replace(/(EN:\s*[^\n]+?)\s+(BM:)/gi, "$1\n$2");
  return s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Strip LLM diagram flag from displayed stem (same tokens as backend extractQuestionStems). */
const MCQ_DIAGRAM_FLAG_LINE =
  /^\s*(?:Perlu rajah|Diagram needed|Need diagram|Rajah diperlukan)\s*:\s*(?:ya|tidak|yes|no|y|n)\b[^\n]*$/gim;

function stripDiagramFlagFromStem(raw: string): string {
  return raw.replace(MCQ_DIAGRAM_FLAG_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
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
  const text = normalizeMcqAiText(answer);
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

    const correctMatch = block.match(
      /(?:Jawapan(?:\s+betul)?|Answer|Correct answer|Correct Answer)\s*[:.)-]?\s*([A-Da-d])\b/i,
    );
    if (!correctMatch) continue;
    const correctLetter = correctMatch[1].toUpperCase();

    const optionsByLetter: Partial<Record<"A" | "B" | "C" | "D", string>> = {};
    const optRegex =
      /(?:^|\n)\s*([A-Da-d])\s*[\).:\-]\s*([\s\S]*?)(?=\n\s*[A-Da-d]\s*[\).:\-]|\n\s*(?:Jawapan|Answer|Penjelasan|Explanation|Correct answer)\s*:|$)/gi;
    let optMatch: RegExpExecArray | null;
    let firstOptionIndex = -1;
    while ((optMatch = optRegex.exec(block))) {
      const letter = optMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      if (firstOptionIndex < 0) firstOptionIndex = optMatch.index;
      // Keep EN:/BM: on separate lines when the model returns bilingual options.
      optionsByLetter[letter] = formatBilingualQuestionStem(optMatch[2] ?? "");
    }

    const options = (["A", "B", "C", "D"] as const).map((letter) => optionsByLetter[letter] ?? "");
    if (options.some((option) => option.length === 0)) continue;

    const explMatch = block.match(/(?:Penjelasan|Explanation)\s*:\s*([\s\S]*)$/i);
    const explanation = explMatch ? explMatch[1].trim().replace(/\s+/g, " ") : null;

    const qStemRaw = firstOptionIndex >= 0 ? block.slice(0, firstOptionIndex) : block;
    const qStem = formatBilingualQuestionStem(stripDiagramFlagFromStem(qStemRaw));

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
  const text = normalizeOpenEndedAiText(answer);
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

    const markahIndex = lines.findIndex((line) => /^(?:Markah|Marks?)\s*[:：]/i.test(line));
    const answerLabelIndex = lines.findIndex((line) =>
      /^(jawapan|answer|model answer|marking points?|rubric|skema)\s*:/i.test(line),
    );
    const stemEnd =
      markahIndex >= 0
        ? markahIndex
        : answerLabelIndex > 0
          ? answerLabelIndex
          : lines.length;
    const questionLines = lines.slice(0, stemEnd > 0 ? stemEnd : 1);
    const explanationStart =
      markahIndex >= 0 && answerLabelIndex > markahIndex
        ? answerLabelIndex
        : answerLabelIndex >= 0
          ? answerLabelIndex
          : stemEnd < lines.length
            ? stemEnd
            : 1;
    const explanationLines = lines.slice(explanationStart);
    const jawapan = extractJawapanFromLines(lines);
    const markingPoints = parseMarkingPointsFromLines(lines);
    const questionText = formatBilingualQuestionStem(questionLines.join("\n"));
    const explanation = explanationLines.join("\n").trim() || null;
    if (!questionText) continue;

    const maxMarks = resolveGeneratedMaxMarks(lines, jawapan, markingPoints, questionText);
    const questionTextWithMarks = /\(\s*\d+\s*marks?\s*\)|\(\s*\d+\s*markah\s*\)/i.test(questionText)
      ? questionText
      : `${questionText} (${maxMarks} mark${maxMarks === 1 ? "" : "s"})`;
    const questionForGrade = buildQuestionForGradePayload(
      questionTextWithMarks,
      maxMarks,
      jawapan,
      markingPoints,
    );
    const rubricIdeas = markingPoints.map((idea, index) => ({
      id: `mp-${index + 1}`,
      idea,
      marks: 1,
    }));

    out.push({
      id: out.length + 1,
      sortOrder: block.index,
      questionText: questionTextWithMarks,
      questionType: type === "short" ? "short_answer" : "essay",
      difficulty: "mixed",
      options: [],
      correctAnswer: "",
      explanation,
      questionForGrade,
      maxMarks,
      modelAnswer: jawapan || undefined,
      rubricIdeas: rubricIdeas.length > 0 ? rubricIdeas : undefined,
    });
  }

  return out;
}

