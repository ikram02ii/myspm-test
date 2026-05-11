import { pgTable, text, serial, timestamp, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { questionsTable } from "./questions";

export const examsTable = pgTable("exams", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 100 }).notNull(),
  formLevel: varchar("form_level", { length: 50 }).notNull(),
  languageMode: varchar("language_mode", { length: 50 }).default("english"),
  timer: integer("timer").default(60),
  strictMode: boolean("strict_mode").default(false),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdBy: varchar("created_by", { length: 255 }).notNull().default("System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const examSectionsTable = pgTable("exam_sections", {
  id: serial("id").primaryKey(),
  examId: integer("exam_id").notNull().references(() => examsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const examQuestionsTable = pgTable("exam_questions", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => examSectionsTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => questionsTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertExamSchema = createInsertSchema(examsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExam = z.infer<typeof insertExamSchema>;
export type Exam = typeof examsTable.$inferSelect;
