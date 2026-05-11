import { pgTable, text, serial, timestamp, varchar, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const teacherPostsTable = pgTable("teacher_posts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  excerpt: text("excerpt"),
  content: text("content"),
  category: varchar("category", { length: 50 }).notNull().default("announcement"),
  audience: varchar("audience", { length: 100 }).notNull().default("All Forms"),
  pinned: boolean("pinned").notNull().default(false),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  author: integer("author").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTeacherPostSchema = createInsertSchema(teacherPostsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeacherPost = z.infer<typeof insertTeacherPostSchema>;
export type TeacherPost = typeof teacherPostsTable.$inferSelect;
