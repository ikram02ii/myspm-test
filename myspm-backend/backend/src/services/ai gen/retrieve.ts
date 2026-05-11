import { pool } from "@workspace/db";

export type RetrievedChunk = {
  chunkId: number;
  documentId: number;
  chunkIndex: number;
  content: string;
  title: string | null;
  subject: string | null;
  sourceType: string;
  distance: number;
};

/**
 * Cosine distance via pgvector `<=>` (smaller = closer). Requires HNSW/column opclass compatible with <=>.
 */
export async function retrieveSimilarChunks(
  queryEmbedding: number[],
  options: { topK: number; subject?: string | null },
): Promise<RetrievedChunk[]> {
  const topK = Math.min(Math.max(options.topK, 1), 32);
  const vectorLiteral = JSON.stringify(queryEmbedding);

  const subject = options.subject?.trim();
  const res = await pool.query<{
    chunk_id: number;
    document_id: number;
    chunk_index: number;
    content: string;
    title: string | null;
    subject: string | null;
    source_type: string;
    distance: string;
  }>(
    `
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.chunk_index,
      c.content,
      d.title,
      d.subject,
      d.source_type,
      (c.embedding <=> $1::vector) AS distance
    FROM rag_document_chunks c
    INNER JOIN rag_documents d ON d.id = c.document_id
    WHERE d.status = 'ready'
      AND ($2::text IS NULL OR TRIM($2) = '' OR d.subject ILIKE $2)
    ORDER BY c.embedding <=> $1::vector
    LIMIT $3
    `,
    [vectorLiteral, subject ? `%${subject}%` : null, topK],
  );

  return res.rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    title: row.title,
    subject: row.subject,
    sourceType: row.source_type,
    distance: Number(row.distance),
  }));
}
