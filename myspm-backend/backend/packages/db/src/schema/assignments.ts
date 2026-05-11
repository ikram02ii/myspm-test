import { pgTable, serial, timestamp, varchar, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { examsTable } from "./exams";
import { usersTable } from "./users";

export const assignmentsTable = pgTable("assignments", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  examId: integer("exam_id").notNull().references(() => examsTable.id),
  dueDate: timestamp("due_date").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdBy: varchar("created_by", { length: 255 }).notNull().default("System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const assignmentStudentsTable = pgTable("assignment_students", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => usersTable.id),
  submitted: boolean("submitted").notNull().default(false),
  score: real("score"),
});

export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({ id: true, createdAt: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignmentsTable.$inferSelect;
