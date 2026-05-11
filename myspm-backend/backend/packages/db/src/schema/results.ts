import { pgTable, serial, timestamp, varchar, integer, boolean, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { examsTable } from "./exams";
import { usersTable } from "./users";
import { questionsTable } from "./questions";
import { assignmentStudentsTable } from "./assignments";

export const studentResultsTable = pgTable("student_results", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => usersTable.id),
  examId: integer("exam_id").notNull().references(() => examsTable.id),
  assignmentStudentId: integer("assignment_student_id").references(() => assignmentStudentsTable.id, {
    onDelete: "cascade",
  }),
  score: real("score").notNull(),
  totalMarks: integer("total_marks").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("completed"),
  attemptDate: timestamp("attempt_date").notNull().defaultNow(),
});

export const attemptAnswersTable = pgTable("attempt_answers", {
  id: serial("id").primaryKey(),
  resultId: integer("result_id")
    .notNull()
    .references(() => studentResultsTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => questionsTable.id),
  studentAnswer: text("student_answer").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  marks: real("marks").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertResultSchema = createInsertSchema(studentResultsTable).omit({ id: true });
export type InsertResult = z.infer<typeof insertResultSchema>;
export type StudentResult = typeof studentResultsTable.$inferSelect;
