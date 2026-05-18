-- Extend rag_past_paper_chunks for page provenance, diagram/page image URLs,
-- optional embeddings (JSON number[] as text), and chunk classification.
--
-- Requires PostgreSQL 11+ for ADD COLUMN IF NOT EXISTS.
-- Run against the RAG database (same DB as RAG_DATABASE_URL / rag_* tables).

BEGIN;

ALTER TABLE public.rag_past_paper_chunks
  ADD COLUMN IF NOT EXISTS page_start INTEGER,
  ADD COLUMN IF NOT EXISTS page_end INTEGER,
  ADD COLUMN IF NOT EXISTS source_image_url TEXT,
  ADD COLUMN IF NOT EXISTS embedding TEXT,
  ADD COLUMN IF NOT EXISTS chunk_kind VARCHAR(32);

COMMENT ON COLUMN public.rag_past_paper_chunks.page_start IS '1-based PDF page start when chunk maps to a page range';
COMMENT ON COLUMN public.rag_past_paper_chunks.page_end IS '1-based PDF page end (inclusive) when known';
COMMENT ON COLUMN public.rag_past_paper_chunks.source_image_url IS 'Public URL (e.g. OSS) for rendered page or diagram tied to this chunk';
COMMENT ON COLUMN public.rag_past_paper_chunks.embedding IS 'Optional embedding as JSON array of numbers (same idea as rag_rubrics.embedding)';
COMMENT ON COLUMN public.rag_past_paper_chunks.chunk_kind IS 'e.g. ingested_pdf | mark_scheme_image | diagram_transcript | mixed';

CREATE INDEX IF NOT EXISTS idx_rag_past_paper_chunks_page
  ON public.rag_past_paper_chunks (past_paper_db_id, page_start)
  WHERE page_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rag_past_paper_chunks_kind
  ON public.rag_past_paper_chunks (chunk_kind)
  WHERE chunk_kind IS NOT NULL;

COMMIT;

-- Optional: enforce one chunk_id per paper (uncomment only after verifying no duplicates)
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_past_paper_chunks_paper_chunk_id
--   ON public.rag_past_paper_chunks (past_paper_db_id, chunk_id);
