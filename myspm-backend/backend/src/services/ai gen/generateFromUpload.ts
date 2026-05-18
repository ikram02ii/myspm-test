import { db } from "@workspace/db";
import { questionsTable } from "@workspace/db/schema";
import { chatCompletion } from "./llmProvider";
import {
  extractAllPagesFromPdfWithVision,
  extractImageWithVision,
  toUploadedPageAsset,
  type UploadedPageAsset,
} from "./visionPdfExtract";

export type { UploadedPageAsset };

export type GenerateFromUploadInput = {
  fileBuffer: Buffer;
  mimeType: string;
  originalName?: string | null;
  subject: string;
  topic: string;
  questionType: string;
  difficulty: string;
  /** Natural-language instruction, e.g. how many questions and format */
  query: string;
  /** When true, insert rows into main `questions` table */
  saveToQuestionsTable: boolean;
  createdBy: string;
  /** Stored in `questions.source` (max 50 chars in schema) */
  source: string;
  /** Optional cap for PDF pages */
  maxPdfPages?: number;
};

export type GeneratedQuestionRow = {
  questionText: string;
  options: string[] | null;
  correctAnswer: string | null;
  explanation: string | null;
};

export type GenerateFromUploadResult = {
  sourceUrls: string[];
  pages: UploadedPageAsset[];
  combinedExtractedText: string;
  questions: GeneratedQuestionRow[];
  insertedQuestionIds: number[];
};

function isPdf(mime: string, name?: string | null): boolean {
  const m = mime.toLowerCase();
  if (m === "application/pdf" || m.includes("pdf")) return true;
  return Boolean(name?.toLowerCase().endsWith(".pdf"));
}

function isImage(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const parsed = JSON.parse(candidate) as unknown;
  if (!Array.isArray(parsed)) {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const inner = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      if (Array.isArray(inner)) return inner;
    }
    throw new Error("Expected a JSON array of questions from the model");
  }
  return parsed;
}

function normalizeQuestionRow(raw: unknown): GeneratedQuestionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const questionText = String(o.questionText ?? o.question_text ?? "").trim();
  if (!questionText) return null;

  let options: string[] | null = null;
  if (Array.isArray(o.options)) {
    options = o.options.map((x) => String(x).trim()).filter(Boolean);
  } else if (typeof o.options === "string" && o.options.trim()) {
    try {
      const p = JSON.parse(o.options) as unknown;
      if (Array.isArray(p)) options = p.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      options = null;
    }
  }

  const correctAnswer =
    o.correctAnswer != null
      ? String(o.correctAnswer)
      : o.correct_answer != null
        ? String(o.correct_answer)
        : null;
  const explanation =
    o.explanation != null ? String(o.explanation) : o.penjelasan != null ? String(o.penjelasan) : null;

  return {
    questionText,
    options: options && options.length > 0 ? options : null,
    correctAnswer: correctAnswer?.trim() || null,
    explanation: explanation?.trim() || null,
  };
}

async function llmExtractQuestions(params: {
  subject: string;
  topic: string;
  questionType: string;
  difficulty: string;
  query: string;
  documentText: string;
}): Promise<GeneratedQuestionRow[]> {
  const system = `You are an assistant for Malaysian SPM. You convert extracted exam material into rows for a relational questions table.
Return ONLY a JSON array. No markdown. No prose before or after.
Each element must be an object with keys:
- questionText (string, required)
- options (string[] or null) — for MCQ use exactly 4 strings A–D order; for non-MCQ use null
- correctAnswer (string or null) — for MCQ a single letter A/B/C/D when known, else null
- explanation (string or null) — short marking-style note when appropriate

Rules:
- Do not invent facts not supported by the document text.
- If the document is a mark scheme, turn each content block into a practice-style question where sensible.
- If uncertain, set correctAnswer and explanation to null.`;

  const user = [
    `Subject: ${params.subject}`,
    `Topic: ${params.topic}`,
    `Target questionType label: ${params.questionType}`,
    `Difficulty label: ${params.difficulty}`,
    "",
    "User generation instruction:",
    params.query,
    "",
    "Extracted document text (OCR + diagram descriptions):",
    params.documentText.slice(0, 120_000),
  ].join("\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { subject: params.subject, query: params.query },
  );

  const items = parseJsonArray(raw);
  const rows = items.map(normalizeQuestionRow).filter((r): r is GeneratedQuestionRow => Boolean(r));
  if (rows.length === 0) throw new Error("Model returned no usable questions");
  return rows;
}

export async function runGenerateFromUpload(input: GenerateFromUploadInput): Promise<GenerateFromUploadResult> {
  const mime = (input.mimeType || "").trim().toLowerCase();
  const name = input.originalName ?? null;

  let visionPages: Awaited<ReturnType<typeof extractAllPagesFromPdfWithVision>>;
  if (isPdf(mime, name)) {
    visionPages = await extractAllPagesFromPdfWithVision({
      pdfBuffer: input.fileBuffer,
      originalName: name,
      maxPages: input.maxPdfPages ?? 30,
      uploadToOss: true,
    });
  } else if (isImage(mime)) {
    const single = await extractImageWithVision({
      imageBuffer: input.fileBuffer,
      originalName: name,
      uploadToOss: true,
    });
    visionPages = [single];
  } else {
    throw new Error("Unsupported file type. Upload application/pdf or an image/* file.");
  }

  const pages: UploadedPageAsset[] = visionPages.map(toUploadedPageAsset);
  const urls = pages.map((p) => p.ossUrl).filter(Boolean);

  const combinedExtractedText = pages
    .map((p) => `--- Page ${p.pageNumber} (source: ${p.ossUrl}) ---\n${p.extractedText}`)
    .join("\n\n");

  const questions = await llmExtractQuestions({
    subject: input.subject.trim(),
    topic: input.topic.trim(),
    questionType: input.questionType.trim(),
    difficulty: input.difficulty.trim(),
    query: input.query.trim(),
    documentText: combinedExtractedText,
  });

  const insertedQuestionIds: number[] = [];
  if (input.saveToQuestionsTable) {
    const source = input.source.trim().slice(0, 50) || "generated_upload";
    const createdBy = input.createdBy.trim() || "System";

    for (const q of questions) {
      const [row] = await db
        .insert(questionsTable)
        .values({
          subject: input.subject.trim(),
          topic: input.topic.trim(),
          questionType: input.questionType.trim(),
          difficulty: input.difficulty.trim(),
          questionText: q.questionText,
          options: q.options && q.options.length > 0 ? JSON.stringify(q.options) : null,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          source,
          createdBy,
        })
        .returning({ id: questionsTable.id });

      if (row?.id != null) insertedQuestionIds.push(row.id);
    }
  }

  return {
    sourceUrls: urls,
    pages,
    combinedExtractedText,
    questions,
    insertedQuestionIds,
  };
}
