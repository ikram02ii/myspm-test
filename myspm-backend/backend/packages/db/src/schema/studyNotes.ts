import { pgTable, text, serial, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const studyNotesTable = pgTable("study_notes", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 100 }).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  formLevel: varchar("form_level", { length: 50 }).notNull(),
  content: text("content"),
  wordCount: integer("word_count").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  author: integer("author").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStudyNoteSchema = createInsertSchema(studyNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStudyNote = z.infer<typeof insertStudyNoteSchema>;
export type StudyNote = typeof studyNotesTable.$inferSelect;
