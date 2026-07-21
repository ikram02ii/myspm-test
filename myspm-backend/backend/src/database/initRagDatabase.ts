import { ragPool } from "../lib/ragDb";
import { getRagPgSchemaName } from "../lib/ragSchema";

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function ensureRagSchema(): Promise<void> {
  if (!ragPool) {
    throw new Error("RAG database pool is not configured");
  }

  const schema = qIdent(getRagPgSchemaName());
  const t = (table: string) => `${schema}.${qIdent(table)}`;

  await ragPool.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_textbooks")} (
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
    CREATE TABLE IF NOT EXISTS ${t("rag_textbook_chunks")} (
      id SERIAL PRIMARY KEY,
      textbook_db_id INTEGER NOT NULL REFERENCES ${t("rag_textbooks")}(id) ON DELETE CASCADE,
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
    ALTER TABLE ${t("rag_textbook_chunks")}
      ADD COLUMN IF NOT EXISTS concept_title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS concept_summary TEXT,
      ADD COLUMN IF NOT EXISTS keywords TEXT,
      ADD COLUMN IF NOT EXISTS chapter VARCHAR(120),
      ADD COLUMN IF NOT EXISTS source_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS page_start INTEGER,
      ADD COLUMN IF NOT EXISTS page_end INTEGER,
      ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  // Vision-language (VL) textbook ingestion tables.
  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_tb")} (
      id SERIAL PRIMARY KEY,
      tb_id VARCHAR(64) NOT NULL UNIQUE,
      subject VARCHAR(120) NOT NULL,
      form VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      source_name VARCHAR(255),
      ingest_method VARCHAR(32) NOT NULL DEFAULT 'vision',
      vision_model VARCHAR(64),
      total_pages INTEGER,
      language VARCHAR(32),
      created_by_user_id INTEGER,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_tb_chunks")} (
      id SERIAL PRIMARY KEY,
      tb_db_id INTEGER NOT NULL REFERENCES ${t("rag_tb")}(id) ON DELETE CASCADE,
      chunk_id VARCHAR(64) NOT NULL,
      chunk_index INTEGER NOT NULL,
      chapter_no INTEGER,
      chapter VARCHAR(512),
      concept_title VARCHAR(255),
      concept_summary TEXT,
      keywords TEXT,
      page_start INTEGER,
      page_end INTEGER,
      content TEXT NOT NULL,
      has_figure BOOLEAN NOT NULL DEFAULT FALSE,
      figures TEXT,
      tables TEXT,
      page_image_path VARCHAR(512),
      content_type VARCHAR(32) NOT NULL DEFAULT 'text',
      is_complete BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_tb_subject_form
      ON ${t("rag_tb")} (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_tb_chunks_tb_id
      ON ${t("rag_tb_chunks")} (tb_db_id);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_tb_chunks_chapter_no
      ON ${t("rag_tb_chunks")} (tb_db_id, chapter_no);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_tb_chunks_concept_title
      ON ${t("rag_tb_chunks")} (concept_title);
  `);

  await ragPool.query(`
    ALTER TABLE ${t("rag_tb_chunks")} DROP COLUMN IF EXISTS section;
  `);

  await ragPool.query(`
    ALTER TABLE ${t("rag_textbook_chunks")}
      ADD COLUMN IF NOT EXISTS source_image_url TEXT,
      ADD COLUMN IF NOT EXISTS embedding TEXT,
      ADD COLUMN IF NOT EXISTS chunk_kind VARCHAR(32);
  `);

  await ragPool.query(`
    ALTER TABLE ${t("rag_past_paper_chunks")}
      ADD COLUMN IF NOT EXISTS page_start INTEGER,
      ADD COLUMN IF NOT EXISTS page_end INTEGER,
      ADD COLUMN IF NOT EXISTS source_image_url TEXT,
      ADD COLUMN IF NOT EXISTS embedding TEXT,
      ADD COLUMN IF NOT EXISTS chunk_kind VARCHAR(32);
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_grading_results")} (
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
      ON ${t("rag_textbooks")} (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_textbook_id
      ON ${t("rag_textbook_chunks")} (textbook_db_id);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_concept_title
      ON ${t("rag_textbook_chunks")} (concept_title);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_grading_submission_id
      ON ${t("rag_grading_results")} (submission_id);
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_past_papers")} (
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
    CREATE TABLE IF NOT EXISTS ${t("rag_past_paper_chunks")} (
      id SERIAL PRIMARY KEY,
      past_paper_db_id INTEGER NOT NULL REFERENCES ${t("rag_past_papers")}(id) ON DELETE CASCADE,
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
      ON ${t("rag_past_papers")} (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_past_paper_chunks_paper_id
      ON ${t("rag_past_paper_chunks")} (past_paper_db_id);
  `);

  await ragPool.query(`
    CREATE TABLE IF NOT EXISTS ${t("rag_rubrics")} (
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
      ON ${t("rag_rubrics")} (subject, form);
  `);

  await ragPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rag_rubrics_question_hash
      ON ${t("rag_rubrics")} (question_hash);
  `);
}
