import { pgTable, serial, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { questionsTable } from "./questions";

export const practiceSetsTable = pgTable("practice_sets", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 100 }).notNull(),
  formLevel: varchar("form_level", { length: 50 }).notNull(),
  questionCount: integer("question_count").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceSetQuestionsTable = pgTable("practice_set_questions", {
  id: serial("id").primaryKey(),
  practiceSetId: integer("practice_set_id").notNull().references(() => practiceSetsTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => questionsTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertPracticeSetSchema = createInsertSchema(practiceSetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPracticeSet = z.infer<typeof insertPracticeSetSchema>;
export type PracticeSet = typeof practiceSetsTable.$inferSelect;
