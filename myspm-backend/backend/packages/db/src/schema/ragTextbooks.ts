import { pgTable, serial, timestamp, varchar, integer, text } from "drizzle-orm/pg-core";

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
  content: text("content").notNull(),
});

