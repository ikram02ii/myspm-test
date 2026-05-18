-- Widen rag_textbook_chunks.chapter for LLM labels like "Chapter 12: ..." (run on RAG PostgreSQL DB)
ALTER TABLE rag_textbook_chunks
  ALTER COLUMN chapter TYPE varchar(512);
