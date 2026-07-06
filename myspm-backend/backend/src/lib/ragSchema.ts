import {
  boolean,
  integer,
  pgSchema,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** Postgres schema for RAG tables (default: `rag`). Override with RAG_PG_SCHEMA in .env. */
export function getRagPgSchemaName(): string {
  const name = process.env["RAG_PG_SCHEMA"]?.trim() || "rag";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid RAG_PG_SCHEMA: ${name}`);
  }
  return name;
}

export const ragPgSchema = pgSchema(getRagPgSchemaName());

export const ragTextbooksTable = ragPgSchema.table("rag_textbooks", {
  id: serial("id").primaryKey(),
  textbookId: varchar("textbook_id", { length: 64 }).notNull().unique(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceName: varchar("source_name", { length: 255 }),
  chunkSizeChars: integer("chunk_size_chars").notNull(),
  overlapChars: integer("overlap_chars").notNull(),
  createdByUserId: integer("created_by_user_id"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const ragTextbookChunksTable = ragPgSchema.table("rag_textbook_chunks", {
  id: serial("id").primaryKey(),
  textbookDbId: integer("textbook_db_id")
    .notNull()
    .references(() => ragTextbooksTable.id, { onDelete: "cascade" }),
  chunkId: varchar("chunk_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  conceptTitle: varchar("concept_title", { length: 255 }),
  conceptSummary: text("concept_summary"),
  keywords: text("keywords"),
  /** e.g. "Chapter 1: Introduction to Biology" or "Bab 2: Sel" — set per chunk at ingest */
  chapter: varchar("chapter", { length: 512 }),
  sourceName: varchar("source_name", { length: 255 }),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  isComplete: boolean("is_complete").notNull().default(true),
  content: text("content").notNull(),
});

/**
 * Vision-language (VL) textbook ingestion — book-level row.
 *
 * Separate from `rag_textbooks` so the new vision pipeline can coexist with the
 * old text-extraction pipeline without disturbing existing data. Each page of
 * the PDF is rendered to an image and transcribed by a vision model so that no
 * word, table, or figure is lost.
 */
export const ragTbTable = ragPgSchema.table("rag_tb", {
  id: serial("id").primaryKey(),
  tbId: varchar("tb_id", { length: 64 }).notNull().unique(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceName: varchar("source_name", { length: 255 }),
  /** How this book was ingested — always "vision" for this table. */
  ingestMethod: varchar("ingest_method", { length: 32 }).notNull().default("vision"),
  /** Vision model used for transcription, e.g. "qwen-vl-plus". */
  visionModel: varchar("vision_model", { length: 64 }),
  /** Total PDF pages processed. */
  totalPages: integer("total_pages"),
  /** Primary language of the book: "en" | "bm" | "bilingual". */
  language: varchar("language", { length: 32 }),
  createdByUserId: integer("created_by_user_id"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

/**
 * VL textbook chunks. `content` is the verbatim transcription (no paraphrase),
 * while `figures` and `tables` capture graphs/diagrams/tables as structured text
 * so nothing visual is lost. `pageImagePath` keeps a reference to the original
 * rendered page for audit. `chapterNo` is the numeric chapter for reliable
 * filtering regardless of how the chapter title is worded.
 */
export const ragTbChunksTable = ragPgSchema.table("rag_tb_chunks", {
  id: serial("id").primaryKey(),
  tbDbId: integer("tb_db_id")
    .notNull()
    .references(() => ragTbTable.id, { onDelete: "cascade" }),
  chunkId: varchar("chunk_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  /** Numeric chapter for robust filtering (e.g. 5). Null if not determinable. */
  chapterNo: integer("chapter_no"),
  /** Full chapter label, e.g. "Chapter 5 Metabolism and Enzymes". */
  chapter: varchar("chapter", { length: 512 }),
  conceptTitle: varchar("concept_title", { length: 255 }),
  conceptSummary: text("concept_summary"),
  keywords: text("keywords"),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  /** Verbatim transcribed body text for this chunk. */
  content: text("content").notNull(),
  /** True when the source page(s) contained a diagram/graph/figure. */
  hasFigure: boolean("has_figure").notNull().default(false),
  /** JSON array describing diagrams/graphs/charts found on the page(s). */
  figures: text("figures"),
  /** JSON/markdown of tables found on the page(s). */
  tables: text("tables"),
  /** Reference to the stored rendered page image (path or URL) for audit. */
  pageImagePath: varchar("page_image_path", { length: 512 }),
  /** "text" | "table" | "figure" | "mixed". */
  contentType: varchar("content_type", { length: 32 }).notNull().default("text"),
  isComplete: boolean("is_complete").notNull().default(true),
});

/** One row per official past paper (or trial paper) you ingest, grouped like rag_textbooks. */
export const ragPastPapersTable = ragPgSchema.table("rag_past_papers", {
  id: serial("id").primaryKey(),
  paperId: varchar("paper_id", { length: 96 }).notNull().unique(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  /** Calendar year of the exam, e.g. 2022 */
  year: integer("year"),
  /** e.g. Paper 1, Paper 2, Paper 3 / Objective / Structured */
  paperLabel: varchar("paper_label", { length: 80 }),
  title: varchar("title", { length: 255 }).notNull(),
  sourceName: varchar("source_name", { length: 255 }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

/**
 * One chunk = usually one question part (or one structured section) with stem + mark scheme + notes.
 * Same retrieval fields as textbook chunks so lexical search behaves consistently.
 */
export const ragPastPaperChunksTable = ragPgSchema.table("rag_past_paper_chunks", {
  id: serial("id").primaryKey(),
  pastPaperDbId: integer("past_paper_db_id")
    .notNull()
    .references(() => ragPastPapersTable.id, { onDelete: "cascade" }),
  chunkId: varchar("chunk_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  /** e.g. Q7(a), Section B */
  questionRef: varchar("question_ref", { length: 80 }),
  conceptTitle: varchar("concept_title", { length: 255 }),
  conceptSummary: text("concept_summary"),
  keywords: text("keywords"),
  maxMarks: integer("max_marks"),
  content: text("content").notNull(),
});

/**
 * Cached rubrics for grading. One row per (subject, form, question hash, maxScore).
 * `ideas` is a JSON array of structured mark points. `embedding` is the question's
 * embedding vector serialized as JSON (number[]) for portable nearest-neighbor lookup
 * without requiring pgvector.
 */
export const ragRubricsTable = ragPgSchema.table("rag_rubrics", {
  id: serial("id").primaryKey(),
  rubricId: varchar("rubric_id", { length: 96 }).notNull().unique(),
  questionHash: varchar("question_hash", { length: 96 }).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  questionText: text("question_text").notNull(),
  questionType: varchar("question_type", { length: 32 }).notNull(),
  maxScore: integer("max_score").notNull(),
  /** JSON array: [{ id, idea, marks, kind, linkedToId? }] */
  ideas: text("ideas").notNull(),
  /** JSON array of numbers, length = embedding dimension */
  embedding: text("embedding"),
  /** "past_paper" | "llm_generated" | "manual" */
  source: varchar("source", { length: 32 }).notNull(),
  /** Free-form back-reference for traceability */
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ragGradingResultsTable = ragPgSchema.table("rag_grading_results", {
  id: serial("id").primaryKey(),
  submissionId: varchar("submission_id", { length: 120 }).notNull(),
  userId: integer("user_id"),
  subject: varchar("subject", { length: 120 }),
  form: varchar("form", { length: 50 }),
  rubricVersion: varchar("rubric_version", { length: 60 }),
  score: integer("score"),
  maxScore: integer("max_score"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
