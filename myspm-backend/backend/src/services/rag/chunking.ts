import { cleanText } from "./pdfTextExtract";

export { cleanText };
export const DEFAULT_CHUNK_SIZE = 1200;
export const DEFAULT_CHUNK_OVERLAP = 200;

export type RagChunk = {
  id: string;
  index: number;
  content: string;
};

export function normalizeChunkConfig(
  chunkSizeChars?: number,
  overlapChars?: number,
): { chunkSizeChars: number; overlapChars: number } {
  const normalizedChunkSize =
    Number.isFinite(chunkSizeChars) && (chunkSizeChars as number) >= 400 && (chunkSizeChars as number) <= 5000
      ? Math.floor(chunkSizeChars as number)
      : DEFAULT_CHUNK_SIZE;

  const normalizedOverlap =
    Number.isFinite(overlapChars) &&
    (overlapChars as number) >= 0 &&
    (overlapChars as number) < normalizedChunkSize
      ? Math.floor(overlapChars as number)
      : DEFAULT_CHUNK_OVERLAP;

  return {
    chunkSizeChars: normalizedChunkSize,
    overlapChars: normalizedOverlap,
  };
}

export function chunkText(text: string, chunkSizeChars: number, overlapChars: number): RagChunk[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const chunks: RagChunk[] = [];
  const overlap = Math.max(0, Math.min(overlapChars, Math.floor(chunkSizeChars / 2)));
  let start = 0;
  let index = 0;

  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + chunkSizeChars);
    const content = cleaned.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({
        id: `chunk-${index + 1}`,
        index,
        content,
      });
      index += 1;
    }
    if (end >= cleaned.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
