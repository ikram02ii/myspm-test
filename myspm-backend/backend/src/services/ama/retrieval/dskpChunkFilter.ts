import type { RetrievedChunk } from "../types";

/** True when the parent textbook record is a DSKP syllabus document. */
export function isDskpChunk(chunk: RetrievedChunk): boolean {
  return /\bdskp\b/i.test(chunk.title);
}

export function partitionDskpAndTextbookChunks(chunks: RetrievedChunk[]): {
  dskp: RetrievedChunk[];
  textbook: RetrievedChunk[];
} {
  const dskp: RetrievedChunk[] = [];
  const textbook: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (isDskpChunk(c)) dskp.push(c);
    else textbook.push(c);
  }
  return { dskp, textbook };
}

export function formatChunksExcerpt(chunks: RetrievedChunk[], label: string): string {
  if (chunks.length === 0) return "";
  const body = chunks
    .map((c, i) => {
      const head = [c.conceptTitle, c.chapter].filter(Boolean).join(" — ");
      return [`--- Excerpt ${i + 1}${head ? `: ${head}` : ""} ---`, c.content.trim()].join("\n");
    })
    .join("\n\n");
  return `[${label}]\n${body}`;
}
