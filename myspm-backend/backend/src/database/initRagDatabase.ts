import { ragPool } from "../lib/ragDb";

export async function ensureRagSchema(): Promise<void> {
  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_textbooks (
      id SERIAL PRIMARY KEY,
      textbook_id VARCHAR(64) NOT NULL UNIQUE,
      subject VARCHAR(120) NOT NULL,
      form VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      source_name VARCHAR(255),
      chunk_size_chars INTEGER NOT NULL,
      overlap_chars INTEGER NOT NULL,
      created_by_user_id INTEGER,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_textbook_chunks (
      id SERIAL PRIMARY KEY,
      textbook_db_id INTEGER NOT NULL REFERENCES rag_textbooks(id) ON DELETE CASCADE,
      chunk_id VARCHAR(64) NOT NULL,
      chunk_index INTEGER NOT NULL,
      concept_title VARCHAR(255),
      concept_summary TEXT,
      keywords TEXT,
      chapter VARCHAR(120),
      source_name VARCHAR(255),
      page_start INTEGER,
      page_end INTEGER,
      is_complete BOOLEAN NOT NULL DEFAULT TRUE,
      content TEXT NOT NULL
    );
  `);

  await ragPool.query(`
    ALTER TABLE rag_textbook_chunks
      ADD COLUMN IF NOT EXISTS concept_title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS concept_summary TEXT,
      ADD COLUMN IF NOT EXISTS keywords TEXT,
      ADD COLUMN IF NOT EXISTS chapter VARCHAR(120),
      ADD COLUMN IF NOT EXISTS source_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS page_start INTEGER,
      ADD COLUMN IF NOT EXISTS page_end INTEGER,
      ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_grading_results (
      id SERIAL PRIMARY KEY,
      submission_id VARCHAR(120) NOT NULL,
      user_id INTEGER,
      subject VARCHAR(120),
      form VARCHAR(50),
      rubric_version VARCHAR(60),
      score INTEGER,
      max_score INTEGER,
      feedback TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_textbooks_subject_form
      ON rag_textbooks (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_textbook_id
      ON rag_textbook_chunks (textbook_db_id);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_concept_title
      ON rag_textbook_chunks (concept_title);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_grading_submission_id
      ON rag_grading_results (submission_id);
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_past_papers (
      id SERIAL PRIMARY KEY,
      paper_id VARCHAR(96) NOT NULL UNIQUE,
      subject VARCHAR(120) NOT NULL,
      form VARCHAR(50) NOT NULL,
      year INTEGER,
      paper_label VARCHAR(80),
      title VARCHAR(255) NOT NULL,
      source_name VARCHAR(255),
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_past_paper_chunks (
      id SERIAL PRIMARY KEY,
      past_paper_db_id INTEGER NOT NULL REFERENCES rag_past_papers(id) ON DELETE CASCADE,
      chunk_id VARCHAR(64) NOT NULL,
      chunk_index INTEGER NOT NULL,
      question_ref VARCHAR(80),
      concept_title VARCHAR(255),
      concept_summary TEXT,
      keywords TEXT,
      max_marks INTEGER,
      content TEXT NOT NULL
    );
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_past_papers_subject_form
      ON rag_past_papers (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_past_paper_chunks_paper_id
      ON rag_past_paper_chunks (past_paper_db_id);
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS rag_rubrics (
      id SERIAL PRIMARY KEY,
      rubric_id VARCHAR(96) NOT NULL UNIQUE,
      question_hash VARCHAR(96) NOT NULL,
      subject VARCHAR(120) NOT NULL,
      form VARCHAR(50) NOT NULL,
      question_text TEXT NOT NULL,
      question_type VARCHAR(32) NOT NULL,
      max_score INTEGER NOT NULL,
      ideas TEXT NOT NULL,
      embedding TEXT,
      source VARCHAR(32) NOT NULL,
      source_ref TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_rubrics_subject_form
      ON rag_rubrics (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_rubrics_question_hash
      ON rag_rubrics (question_hash);
  `);
}
