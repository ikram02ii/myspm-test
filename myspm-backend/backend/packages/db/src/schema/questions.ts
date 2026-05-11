import { pgTable, text, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const questionsTable = pgTable("questions", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 100 }).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  questionType: varchar("question_type", { length: 50 }).notNull(),
  difficulty: varchar("difficulty", { length: 50 }).notNull(),
  questionText: text("question_text").notNull(),
  options: text("options"),
  correctAnswer: text("correct_answer"),
  explanation: text("explanation"),
  source: varchar("source", { length: 50 }).notNull().default("teacher"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdBy: varchar("created_by", { length: 255 }).notNull().default("System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;
