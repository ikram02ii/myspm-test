import { randomUUID } from "node:crypto";
import {
  ragDb,
  ragPastPaperChunksTable,
  ragPastPapersTable,
  ragTextbookChunksTable,
  ragTextbooksTable,
} from "../../../lib/ragDb";
import { llmConceptChunkSection, type ConceptChunk } from "./conceptChunkingService";
import { cleanText, extractPdfPages, type PdfPage } from "./pdfTextExtract";

export { cleanText, extractPdfText } from "./pdfTextExtract";

export type IngestPdfInput = {
  pdfPath: string;
  subject: string;
  form: string;
  title: string;
  sourceName?: string;
  chapter?: string;
  chunkSize?: number;
  overlap?: number;
  createdByUserId?: number | null;
};

/** Same chunking pipeline as textbooks; extra fields only for `rag_past_papers` metadata. */
export type IngestPastPaperPdfInput = IngestPdfInput & {
  paperId?: string;
  year?: number | null;
  paperLabel?: string | null;
};

type DeterministicSection = {
  text: string;
  pageStart?: number;
  pageEnd?: number;
  /** Chapter label from scanning PDF headings by page (Bab 2, Chapter 3, …) */
  sectionChapter?: string;
};

const CHAPTER_TITLE_MAX = 180;

/**
 * Parse one line that looks like a main chapter/unit heading (BM or EN textbooks).
 */
function parseChapterHeadingLine(line: string): string | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (t.length < 4 || t.length > 220) return null;

  const bahagian = t.match(/^bahagian\s+([A-Z])\s*[.:]?\s*(.+)?$/i);
  if (bahagian && t.length <= 100) {
    const letter = bahagian[1].toUpperCase();
    const rest = bahagian[2]?.trim();
    return rest ? `Bahagian ${letter}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Bahagian ${letter}`;
  }

  const babCap = t.match(/^BAB\s+(\d{1,2})\b\s*(.*)$/i);
  if (babCap) {
    const num = babCap[1];
    const rest = babCap[2].trim().replace(/^[\u2013\u2014:.\-–—]+\s*/, "");
    return rest ? `Bab ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Bab ${num}`;
  }

  const chapCap = t.match(/^CHAPTER\s+(\d{1,2})\b\s*(.*)$/i);
  if (chapCap) {
    const num = chapCap[1];
    const rest = chapCap[2].trim().replace(/^[\u2013\u2014:.\-–—]+\s*/, "");
    return rest ? `Chapter ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Chapter ${num}`;
  }

  const m = t.match(
    /^(bab|chapter|ch\.?|unit|topik|topic)\s*[#.:]?\s*(\d{1,2})\b(?:\s*[:\u2013\u2014.\-–—]\s*)?(.+)?$/i,
  );
  if (m) {
    const kind = m[1].toLowerCase().replace(/\.$/, "");
    const num = m[2];
    let rest = (m[3] ?? "").trim().replace(/^\d{1,2}\s*$/, "");
    if (kind === "bab") return rest ? `Bab ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Bab ${num}`;
    if (kind === "chapter" || kind === "ch") {
      return rest ? `Chapter ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Chapter ${num}`;
    }
    if (kind === "unit") return rest ? `Unit ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Unit ${num}`;
    return rest ? `Topik ${num}: ${rest.slice(0, CHAPTER_TITLE_MAX)}` : `Topik ${num}`;
  }

  return null;
}

/** After each page, the chapter label in effect (from headings scanned in order). */
function buildChapterByPageMap(pages: PdfPage[], documentHint?: string): Map<number, string> {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  let active = documentHint?.trim() ?? "";
  const map = new Map<number, string>();

  for (const page of sorted) {
    if (!page.text) {
      map.set(page.pageNumber, active);
      continue;
    }
    const lines = page.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parsed = parseChapterHeadingLine(line);
      if (parsed) active = parsed;
    }
    map.set(page.pageNumber, active);
  }
  return map;
}

function chapterForPageSpan(
  chapterByPage: Map<number, string>,
  pageStart?: number,
  pageEnd?: number,
): string | undefined {
  if (pageStart == null || pageEnd == null) return undefined;
  const a = Math.min(pageStart, pageEnd);
  const b = Math.max(pageStart, pageEnd);
  const mid = Math.floor((a + b) / 2);
  const c = chapterByPage.get(mid) ?? chapterByPage.get(b) ?? chapterByPage.get(a);
  return c && c.trim().length > 0 ? c.trim() : undefined;
}
type PersistableChunk = {
  /** Inferred or LLM-provided chapter label for topic-specific retrieval */
  chapter?: string;
  conceptTitle?: string;
  conceptSummary?: string;
  chunkText: string;
  keywords: string[];
  isComplete: boolean;
  pageStart?: number;
  pageEnd?: number;
};

/** Best-effort chapter heading from the start of a section excerpt when the LLM omits `chapter`. */
function inferChapterFromSectionText(sectionText: string): string | undefined {
  const lines = sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines.slice(0, 24)) {
    const parsed = parseChapterHeadingLine(line);
    if (parsed) return parsed;
    if (/^\d+\.\d+\s+\S/.test(line) && line.length <= 160) {
      return line.slice(0, 220);
    }
  }
  return undefined;
}

function isEnvTrue(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function removeRepeatedPageNoise(pages: PdfPage[]): PdfPage[] {
  const firstLineCount = new Map<string, number>();
  const lastLineCount = new Map<string, number>();

  for (const page of pages) {
    const lines = page.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const first = lines[0];
    const last = lines[lines.length - 1];
    if (first) firstLineCount.set(first, (firstLineCount.get(first) ?? 0) + 1);
    if (last) lastLineCount.set(last, (lastLineCount.get(last) ?? 0) + 1);
  }

  const repeatedFirst = new Set(Array.from(firstLineCount.entries()).filter(([, c]) => c >= 3).map(([line]) => line));
  const repeatedLast = new Set(Array.from(lastLineCount.entries()).filter(([, c]) => c >= 3).map(([line]) => line));

  return pages.map((page) => {
    const lines = page.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const filtered = lines.filter((line, idx) => {
      if (idx === 0 && repeatedFirst.has(line)) return false;
      if (idx === lines.length - 1 && repeatedLast.has(line)) return false;
      return true;
    });
    return { ...page, text: cleanText(filtered.join("\n")) };
  });
}

export function splitIntoChunks(text: string, chunkSize = 1200, overlap = 200): string[] {
  const normalizedSize =
    Number.isFinite(chunkSize) && chunkSize >= 400 && chunkSize <= 5000 ? Math.floor(chunkSize) : 1200;
  const normalizedOverlap =
    Number.isFinite(overlap) && overlap >= 0 && overlap < normalizedSize ? Math.floor(overlap) : 200;

  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const chunks: string[] = [];
  const safeOverlap = Math.max(0, Math.min(normalizedOverlap, Math.floor(normalizedSize / 2)));
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + normalizedSize);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }
  return chunks;
}

function splitSectionsDeterministically(
  pages: PdfPage[],
  documentChapterHint?: string,
): DeterministicSection[] {
  const sections: DeterministicSection[] = [];
  const chapterByPage = buildChapterByPageMap(pages, documentChapterHint);
  const maxCharsPerWindowRaw = process.env["RAG_SECTION_MAX_CHARS_PER_WINDOW"];
  const maxCharsPerWindow = Number.isFinite(Number(maxCharsPerWindowRaw)) ? Number(maxCharsPerWindowRaw) : 3400;
  let currentText = "";
  let startPage: number | undefined;
  let endPage: number | undefined;

  const flush = () => {
    const cleaned = cleanText(currentText);
    if (cleaned.length > 0) {
      const sectionChapter = chapterForPageSpan(chapterByPage, startPage, endPage);
      sections.push({ text: cleaned, pageStart: startPage, pageEnd: endPage, sectionChapter });
    }
    currentText = "";
    startPage = undefined;
    endPage = undefined;
  };

  for (const page of pages) {
    if (!page.text) continue;
    const nextText = currentText.length === 0 ? page.text : `${currentText}\n\n${page.text}`;
    if (nextText.length > maxCharsPerWindow && currentText.length > 0) flush();
    if (!startPage) startPage = page.pageNumber;
    endPage = page.pageNumber;
    currentText = currentText.length === 0 ? page.text : `${currentText}\n\n${page.text}`;
  }
  flush();
  return sections;
}

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function qualityFilter(chunks: PersistableChunk[]): PersistableChunk[] {
  if (chunks.length === 0) return [];
  const anyComplete = chunks.some((chunk) => chunk.isComplete);
  const seen = new Set<string>();
  const result: PersistableChunk[] = [];
  for (const chunk of chunks) {
    const text = cleanText(chunk.chunkText);
    if (text.length < 180) continue;
    if (anyComplete && !chunk.isComplete) continue;
    const normalized = normalizeForDedup(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...chunk, chunkText: text });
  }
  return result;
}

function toPersistableFromFallback(
  section: DeterministicSection,
  chunks: string[],
  subject: string,
  documentChapterHint?: string,
): PersistableChunk[] {
  const inferred = inferChapterFromSectionText(section.text);
  const chapter =
    section.sectionChapter?.trim() ||
    documentChapterHint?.trim() ||
    inferred ||
    undefined;
  return chunks.map((chunkText, index) => ({
    chapter,
    conceptTitle: `Concept ${index + 1}`,
    conceptSummary: `${subject} concept extracted via deterministic fallback chunking.`,
    chunkText,
    keywords: [],
    isComplete: true,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  }));
}

async function chunkSectionWithLlmOrFallback(params: {
  section: DeterministicSection;
  subject: string;
  form: string;
  sourceName: string;
  chapter?: string;
  chunkSize?: number;
  overlap?: number;
  allowLlmChunking?: boolean;
  requireLlmChunking?: boolean;
  llmRetries?: number;
}): Promise<{ chunks: PersistableChunk[]; disableLlmForRemainingSections: boolean }> {
  const resolvedSectionChapter =
    params.section.sectionChapter?.trim() ||
    inferChapterFromSectionText(params.section.text) ||
    params.chapter?.trim() ||
    undefined;
  if (!params.allowLlmChunking) {
    if (params.requireLlmChunking) {
      throw new Error("[rag][ingest] LLM chunking is required but disabled for this section.");
    }
    const deterministic = splitIntoChunks(params.section.text, params.chunkSize, params.overlap);
    return {
      chunks: qualityFilter(
        toPersistableFromFallback(params.section, deterministic, params.subject, params.chapter),
      ),
      disableLlmForRemainingSections: false,
    };
  }

  try {
    const retries = Number.isFinite(params.llmRetries) ? Math.max(0, Math.floor(params.llmRetries as number)) : 1;
    let llmChunks: ConceptChunk[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        llmChunks = await llmConceptChunkSection({
          sectionText: params.section.text,
          subject: params.subject,
          form: params.form,
          sourceName: params.sourceName,
          chapter: params.chapter,
          sectionChapterFromPdf: params.section.sectionChapter,
          pageStart: params.section.pageStart,
          pageEnd: params.section.pageEnd,
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          console.warn("[rag][ingest] LLM chunking attempt failed, retrying.", {
            pageStart: params.section.pageStart,
            pageEnd: params.section.pageEnd,
            attempt: attempt + 1,
            retries,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (!llmChunks) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    return {
      chunks: qualityFilter(
        llmChunks.map((chunk) => {
          const ch =
            chunk.chapter?.trim() ||
            resolvedSectionChapter ||
            undefined;
          return {
            chapter: ch,
            conceptTitle: chunk.conceptTitle,
            conceptSummary: chunk.conceptSummary,
            chunkText: chunk.chunkText,
            keywords: chunk.keywords,
            isComplete: chunk.isComplete,
            pageStart: params.section.pageStart,
            pageEnd: params.section.pageEnd,
          };
        }),
      ),
      disableLlmForRemainingSections: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldDisableLlmForRun =
      message.toLowerCase().includes("incorrect api key") || message.toLowerCase().includes("apikey-error");
    if (params.requireLlmChunking) {
      throw new Error(
        `[rag][ingest] LLM chunking required, refusing deterministic fallback for pages ${params.section.pageStart ?? "?"}-${params.section.pageEnd ?? "?"}. ${message}`,
      );
    }
    console.warn("[rag][ingest] LLM chunking failed, falling back to deterministic chunking.", {
      pageStart: params.section.pageStart,
      pageEnd: params.section.pageEnd,
      message,
    });
    const deterministic = splitIntoChunks(params.section.text, params.chunkSize, params.overlap);
    return {
      chunks: qualityFilter(
        toPersistableFromFallback(params.section, deterministic, params.subject, params.chapter),
      ),
      disableLlmForRemainingSections: shouldDisableLlmForRun,
    };
  }
}

/**
 * Shared pipeline: PDF pages → noise removal → section windows → LLM or deterministic chunks → quality filter.
 * Used by both textbook and past-paper ingest.
 */
export async function buildFinalChunksFromPdf(input: IngestPdfInput): Promise<PersistableChunk[]> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const chapter = input.chapter?.trim();
  const sourceName = (input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || "").trim();
  if (!subject || !form || !title) throw new Error("subject, form, and title are required");

  const llmConcurrencyRaw = process.env["RAG_CHUNKING_CONCURRENCY"];
  const llmConcurrency = Number.isFinite(Number(llmConcurrencyRaw)) ? Math.max(1, Math.floor(Number(llmConcurrencyRaw))) : 2;
  const requireLlmChunking = isEnvTrue(process.env["RAG_INGEST_REQUIRE_LLM"]);
  const llmRetriesRaw = process.env["RAG_CHUNKING_LLM_RETRIES"];
  const llmRetries = Number.isFinite(Number(llmRetriesRaw)) ? Math.max(0, Math.floor(Number(llmRetriesRaw))) : 1;

  console.info("[rag][ingest] concurrency/window settings", {
    llmConcurrency,
    sectionWindowChars: process.env["RAG_SECTION_MAX_CHARS_PER_WINDOW"] ?? 3400,
    chunkingMaxTokens: process.env["QWEN_CHUNKING_MAX_TOKENS"] ?? null,
    requireLlmChunking,
    llmRetries,
  });

  console.info("[rag][ingest] start ingest", {
    pdfPath: input.pdfPath,
    subject,
    form,
    title,
    llmChunkingConfig: {
      keySet: Boolean(process.env["QWEN_CHUNKING_API_KEY"]?.trim()),
      baseUrlSet: Boolean(process.env["QWEN_CHUNKING_BASE_URL"]?.trim()),
      model: process.env["QWEN_CHUNKING_MODEL"]?.trim() || null,
    },
  });

  console.info("[rag][ingest] extracting pdf pages...");
  const rawPages = await extractPdfPages(input.pdfPath);
  const pages = removeRepeatedPageNoise(rawPages);
  console.info("[rag][ingest] extracted pages", {
    rawPages: rawPages.length,
    afterNoiseRemoval: pages.length,
  });

  const sections = splitSectionsDeterministically(pages, chapter);
  console.info("[rag][ingest] split into sections", { sectionCount: sections.length });
  if (sections.length === 0) throw new Error("Extracted PDF text is empty");

  const allChunksBySection: PersistableChunk[][] = new Array(sections.length);
  let allowLlmChunking = true;
  console.info("[rag][ingest] chunking sections", {
    totalSections: sections.length,
    allowLlmChunkingInitial: allowLlmChunking,
    llmConcurrency,
  });

  let nextSectionIndex = 0;
  const workers = Array.from({ length: Math.min(llmConcurrency, sections.length) }, async (_, workerId) => {
    while (true) {
      const sectionIndex = nextSectionIndex++;
      if (sectionIndex >= sections.length) return;

      const section = sections[sectionIndex];
      if (sectionIndex === 0) {
        console.info("[rag][ingest] starting first section chunking", {
          workerId,
          chunkSizeChars: input.chunkSize,
          overlapChars: input.overlap,
          allowLlmChunking,
        });
      }

      const sectionResult = await chunkSectionWithLlmOrFallback({
        section,
        subject,
        form,
        sourceName,
        chapter,
        chunkSize: input.chunkSize,
        overlap: input.overlap,
        allowLlmChunking,
        requireLlmChunking,
        llmRetries,
      });

      if (sectionResult.disableLlmForRemainingSections) {
        allowLlmChunking = false;
        console.warn("[rag][ingest] Disabling LLM chunking for remaining sections due to API key/auth error.");
      }

      allChunksBySection[sectionIndex] = sectionResult.chunks;
    }
  });

  await Promise.all(workers);

  const allChunks = allChunksBySection.flat();
  const finalChunks = qualityFilter(allChunks);
  if (finalChunks.length === 0) throw new Error("No chunks produced from PDF text");
  return finalChunks;
}

export async function ingestPdfToRagDb(input: IngestPdfInput): Promise<{ textbookId: number; chunkCount: number }> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const chapter = input.chapter?.trim();
  const sourceName = (input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || "").trim();
  if (!subject || !form || !title) throw new Error("subject, form, and title are required");

  const finalChunks = await buildFinalChunksFromPdf(input);

  const externalTextbookId = `tb-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const inserted = await ragDb
    .insert(ragTextbooksTable)
    .values({
      textbookId: externalTextbookId,
      subject,
      form,
      title,
      sourceName,
      chunkSizeChars: Number.isFinite(input.chunkSize) ? Math.floor(input.chunkSize as number) : 1200,
      overlapChars: Number.isFinite(input.overlap) ? Math.floor(input.overlap as number) : 200,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: ragTextbooksTable.id });

  const textbookDbId = inserted[0]?.id;
  if (!textbookDbId) throw new Error("Failed to create textbook record");

  await ragDb.insert(ragTextbookChunksTable).values(
    finalChunks.map((chunk, index) => ({
      textbookDbId,
      chunkId: `chunk-${index + 1}`,
      chunkIndex: index,
      conceptTitle: chunk.conceptTitle,
      conceptSummary: chunk.conceptSummary,
      keywords: chunk.keywords.join(", "),
      chapter: chunk.chapter?.trim() || null,
      sourceName,
      pageStart: chunk.pageStart ?? null,
      pageEnd: chunk.pageEnd ?? null,
      isComplete: chunk.isComplete,
      content: chunk.chunkText,
    })),
  );

  return { textbookId: textbookDbId, chunkCount: finalChunks.length };
}

export async function ingestPastPaperPdfToRagDb(
  input: IngestPastPaperPdfInput,
): Promise<{ pastPaperDbId: number; paperId: string; chunkCount: number }> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const sourceName = (input.sourceName?.trim() || input.pdfPath.split(/[\\/]/).pop() || "").trim();
  if (!subject || !form || !title) throw new Error("subject, form, and title are required");

  const finalChunks = await buildFinalChunksFromPdf(input);

  const externalPaperId =
    input.paperId?.trim() || `pp-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const insertedPaper = await ragDb
    .insert(ragPastPapersTable)
    .values({
      paperId: externalPaperId,
      subject,
      form,
      year: input.year ?? null,
      paperLabel: input.paperLabel?.trim() || null,
      title,
      sourceName: sourceName || null,
    })
    .returning({ id: ragPastPapersTable.id });

  const pastPaperDbId = insertedPaper[0]?.id;
  if (!pastPaperDbId) throw new Error("Failed to create past paper record");

  await ragDb.insert(ragPastPaperChunksTable).values(
    finalChunks.map((chunk, index) => ({
      pastPaperDbId,
      chunkId: `chunk-${index + 1}`,
      chunkIndex: index,
      questionRef: null,
      conceptTitle: chunk.conceptTitle,
      conceptSummary: chunk.conceptSummary,
      keywords: chunk.keywords.join(", "),
      maxMarks: null,
      content: chunk.chunkText,
    })),
  );

  console.info("[rag][past-paper] ingested", { paperId: externalPaperId, pastPaperDbId, chunkCount: finalChunks.length });
  return { pastPaperDbId, paperId: externalPaperId, chunkCount: finalChunks.length };
}
