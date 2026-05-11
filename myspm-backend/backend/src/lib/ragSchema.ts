import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const ragTextbooksTable = pgTable("rag_textbooks", {
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

export const ragTextbookChunksTable = pgTable("rag_textbook_chunks", {
  id: serial("id").primaryKey(),
  textbookDbId: integer("textbook_db_id")
    .notNull()
    .references(() => ragTextbooksTable.id, { onDelete: "cascade" }),
  chunkId: varchar("chunk_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  conceptTitle: varchar("concept_title", { length: 255 }),
  conceptSummary: text("concept_summary"),
  keywords: text("keywords"),
  chapter: varchar("chapter", { length: 120 }),
  sourceName: varchar("source_name", { length: 255 }),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  isComplete: boolean("is_complete").notNull().default(true),
  content: text("content").notNull(),
});

/** One row per official past paper (or trial paper) you ingest, grouped like rag_textbooks. */
export const ragPastPapersTable = pgTable("rag_past_papers", {
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
export const ragPastPaperChunksTable = pgTable("rag_past_paper_chunks", {
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
export const ragRubricsTable = pgTable("rag_rubrics", {
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

export const ragGradingResultsTable = pgTable("rag_grading_results", {
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
