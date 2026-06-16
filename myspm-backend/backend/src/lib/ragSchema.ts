import {
  boolean,
  integer,
  pgSchema,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const SCHEMA_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function resolveRagDbSchemaName(): string {
  const raw = process.env["RAG_DB_SCHEMA"]?.trim() || "rag";
  if (!SCHEMA_NAME_PATTERN.test(raw)) {
    throw new Error(`Invalid RAG_DB_SCHEMA "${raw}". Use letters, numbers, underscore only.`);
  }
  return raw;
}

/** Postgres schema for all RAG tables (default: `rag`, not `public`). */
export const RAG_DB_SCHEMA_NAME = resolveRagDbSchemaName();
export const ragPgSchema = pgSchema(RAG_DB_SCHEMA_NAME);

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
  chapter: varchar("chapter", { length: 120 }),
  sourceName: varchar("source_name", { length: 255 }),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  isComplete: boolean("is_complete").notNull().default(true),
  content: text("content").notNull(),
});

export const ragPastPapersTable = ragPgSchema.table("rag_past_papers", {
  id: serial("id").primaryKey(),
  paperId: varchar("paper_id", { length: 96 }).notNull().unique(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  year: integer("year"),
  paperLabel: varchar("paper_label", { length: 80 }),
  title: varchar("title", { length: 255 }).notNull(),
  sourceName: varchar("source_name", { length: 255 }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const ragPastPaperChunksTable = ragPgSchema.table("rag_past_paper_chunks", {
  id: serial("id").primaryKey(),
  pastPaperDbId: integer("past_paper_db_id")
    .notNull()
    .references(() => ragPastPapersTable.id, { onDelete: "cascade" }),
  chunkId: varchar("chunk_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  questionRef: varchar("question_ref", { length: 80 }),
  conceptTitle: varchar("concept_title", { length: 255 }),
  conceptSummary: text("concept_summary"),
  keywords: text("keywords"),
  maxMarks: integer("max_marks"),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  sourceImageUrl: text("source_image_url"),
  embedding: text("embedding"),
  chunkKind: varchar("chunk_kind", { length: 32 }),
  content: text("content").notNull(),
});

export const ragRubricsTable = ragPgSchema.table("rag_rubrics", {
  id: serial("id").primaryKey(),
  rubricId: varchar("rubric_id", { length: 96 }).notNull().unique(),
  questionHash: varchar("question_hash", { length: 96 }).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  form: varchar("form", { length: 50 }).notNull(),
  questionText: text("question_text").notNull(),
  questionType: varchar("question_type", { length: 32 }).notNull(),
  maxScore: integer("max_score").notNull(),
  ideas: text("ideas").notNull(),
  embedding: text("embedding"),
  source: varchar("source", { length: 32 }).notNull(),
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
