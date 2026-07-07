import type { RetrievedChunk } from "../types";

export type RagGenerationSource = {
  sourceType: "textbook" | "past_paper";
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  title: string | null;
  subject: string | null;
  form: string | null;
  chapter: string | null;
  year: number | null;
  paperLabel: string | null;
  questionRef: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  sourceName: string | null;
  relevanceScore: number;
  /** Human-readable line for UI, e.g. "2021 SPM Physics K2 · Paper 2 · p. 14" */
  label: string;
  excerpt: string;
};

function formatPageRange(pageStart?: number | null, pageEnd?: number | null): string | null {
  if (pageStart == null || !Number.isFinite(pageStart)) return null;
  const start = Math.floor(pageStart);
  if (pageEnd != null && Number.isFinite(pageEnd) && pageEnd !== start) {
    return `p. ${start}–${Math.floor(pageEnd)}`;
  }
  return `p. ${start}`;
}

export function formatRetrievedChunkLabel(chunk: RetrievedChunk): string {
  if (chunk.sourceType === "past_paper") {
    const parts: string[] = [];
    if (chunk.year != null && Number.isFinite(chunk.year)) parts.push(String(chunk.year));
    if (chunk.title?.trim()) parts.push(chunk.title.trim());
    else parts.push("Past year paper");
    if (chunk.paperLabel?.trim()) parts.push(chunk.paperLabel.trim());
    if (chunk.questionRef?.trim()) parts.push(chunk.questionRef.trim());
    const pages = formatPageRange(chunk.pageStart, chunk.pageEnd);
    if (pages) parts.push(pages);
    return parts.join(" · ");
  }

  const parts: string[] = ["Textbook"];
  if (chunk.title?.trim()) parts.push(chunk.title.trim());
  if (chunk.chapter?.trim()) parts.push(chunk.chapter.trim());
  const pages = formatPageRange(chunk.pageStart, chunk.pageEnd);
  if (pages) parts.push(pages);
  return parts.join(" · ");
}

export function chunkToGenerationSource(chunk: RetrievedChunk): RagGenerationSource {
  const excerpt =
    chunk.content.length > 400 ? `${chunk.content.slice(0, 400)}…` : chunk.content;
  return {
    sourceType: chunk.sourceType,
    documentId: chunk.textbookId,
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    title: chunk.title ?? null,
    subject: chunk.subject ?? null,
    form: chunk.form ?? null,
    chapter: chunk.chapter?.trim() || null,
    year: chunk.year ?? null,
    paperLabel: chunk.paperLabel?.trim() || null,
    questionRef: chunk.questionRef?.trim() || null,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
    sourceName: chunk.sourceName?.trim() || null,
    relevanceScore: chunk.score ?? 0,
    label: formatRetrievedChunkLabel(chunk),
    excerpt,
  };
}

export function chunksToGenerationSources(chunks: RetrievedChunk[]): RagGenerationSource[] {
  const seen = new Set<string>();
  const out: RagGenerationSource[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.sourceType}:${chunk.textbookId}:${chunk.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunkToGenerationSource(chunk));
  }
  return out;
}

/** One-line attribution for mobile (BM label). */
export function formatSourcesSummary(sources: RagGenerationSource[]): string {
  if (sources.length === 0) return "";
  const labels = [...new Set(sources.map((s) => s.label).filter(Boolean))];
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  const head = labels.slice(0, 2).join("; ");
  return labels.length > 2 ? `${head}; +${labels.length - 2} lagi` : head;
}
