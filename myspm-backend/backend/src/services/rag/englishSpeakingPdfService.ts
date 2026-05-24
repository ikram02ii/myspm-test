/**
 * Load SPM English Speaking (Part 2 & 3) reference PDF text for LLM question generation.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { extractPdfPages, type PdfPage } from "./pdfTextExtract";
import type { EnglishSpeakingPart } from "./englishSpeakingTypes";

const DEFAULT_FILENAME = "SPM Speaking- Part 2 & Part 3.pdf";

/** Max characters sent to the LLM (excerpt from full PDF). */
const DEFAULT_MAX_CHARS = 14_000;

function candidatePdfPaths(override?: string | null): string[] {
  const out: string[] = [];
  const explicit = override?.trim() || process.env["ENGLISH_SPEAKING_SOURCE_PDF"]?.trim();
  if (explicit) out.push(explicit);

  const cwd = process.cwd();
  out.push(
    resolve(cwd, "Knowledge Base", "English", DEFAULT_FILENAME),
    resolve(cwd, "..", "Knowledge Base", "English", DEFAULT_FILENAME),
    resolve(cwd, "../..", "Knowledge Base", "English", DEFAULT_FILENAME),
    resolve(cwd, "../../..", "Knowledge Base", "English", DEFAULT_FILENAME),
    resolve("C:/Users/User/Desktop/myspm/Knowledge Base/English", DEFAULT_FILENAME),
  );

  return [...new Set(out)];
}

export function resolveEnglishSpeakingPdfPath(override?: string | null): string | null {
  for (const p of candidatePdfPaths(override)) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function isSubstantivePage(text: string): boolean {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length >= 60;
}

function partFilter(part: EnglishSpeakingPart | "all"): RegExp | null {
  if (part === "all" || part === "part1") return null;
  if (part === "part2") {
    return /\bpart\s*2\b|cue\s*card|individual\s+long|long\s+turn|talk\s+about|you\s+should\s+say|fic\s+card/i;
  }
  return /\bpart\s*3\b|group\s+discussion|discussion\s+task|follow[- ]?up|social\s+issue/i;
}

function selectPagesForPart(pages: PdfPage[], part: EnglishSpeakingPart | "all"): PdfPage[] {
  const substantive = pages.filter((p) => isSubstantivePage(p.text));
  const pool = substantive.length > 0 ? substantive : pages;

  const re = partFilter(part);
  if (!re) return pool;

  const matched = pool.filter((p) => re.test(p.text));
  if (matched.length >= 3) return matched;

  if (part === "part3") {
    const half = Math.floor(pool.length / 2);
    const latter = pool.slice(half);
    if (latter.length >= 3) return latter;
  }

  if (part === "part2") {
    const cueLike = pool.filter((p) =>
      /talk\s+about|you\s+should\s+say|topic:|recycling|part-time|favourite/i.test(p.text),
    );
    if (cueLike.length >= 3) return cueLike;
  }

  if (matched.length > 0) return matched;

  return pool;
}

function truncateExcerpt(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n[…excerpt truncated for length…]`;
}

export type EnglishSpeakingPdfContext = {
  pdfPath: string;
  pageCount: number;
  usedPageNumbers: number[];
  excerpt: string;
};

export async function buildEnglishSpeakingPdfContext(params: {
  pdfPath?: string | null;
  part?: EnglishSpeakingPart | "all";
  maxChars?: number;
}): Promise<EnglishSpeakingPdfContext> {
  const pdfPath = resolveEnglishSpeakingPdfPath(params.pdfPath);
  if (!pdfPath) {
    throw new Error(
      `English speaking PDF not found. Set ENGLISH_SPEAKING_SOURCE_PDF or place the file at Knowledge Base/English/${DEFAULT_FILENAME}`,
    );
  }

  const pages = await extractPdfPages(pdfPath);
  if (pages.length === 0) {
    throw new Error(`PDF has no extractable text: ${pdfPath}`);
  }

  const part = params.part ?? "all";
  const selected = selectPagesForPart(pages, part);
  const body = selected.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n");
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;

  return {
    pdfPath,
    pageCount: pages.length,
    usedPageNumbers: selected.map((p) => p.pageNumber),
    excerpt: truncateExcerpt(body, maxChars),
  };
}
