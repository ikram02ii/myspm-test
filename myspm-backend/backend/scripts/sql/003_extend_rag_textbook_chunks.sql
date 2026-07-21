-- Extend rag_textbook_chunks for OSS page images + optional embeddings (hybrid ingest).
-- Past-paper columns: see 002_extend_rag_past_paper_chunks.sql

BEGIN;

ALTER TABLE rag.rag_textbook_chunks
  ADD COLUMN IF NOT EXISTS source_image_url TEXT,
  ADD COLUMN IF NOT EXISTS embedding TEXT,
  ADD COLUMN IF NOT EXISTS chunk_kind VARCHAR(32);

COMMENT ON COLUMN rag.rag_textbook_chunks.source_image_url IS 'Public OSS URL for page/diagram image when vision route was used';
COMMENT ON COLUMN rag.rag_textbook_chunks.embedding IS 'JSON array of floats from text-embedding-v3';
COMMENT ON COLUMN rag.rag_textbook_chunks.chunk_kind IS 'e.g. hybrid_text | hybrid_vision | ingested_pdf';

COMMIT;
