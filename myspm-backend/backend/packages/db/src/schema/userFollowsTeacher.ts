import { pgTable, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const userFollowsTeacherTable = pgTable(
  "user_follows_teacher",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    teacherId: integer("teacher_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userTeacherUnique: uniqueIndex("user_follows_teacher_user_teacher_unique").on(table.userId, table.teacherId),
  })
);

export const insertUserFollowsTeacherSchema = createInsertSchema(userFollowsTeacherTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserFollowsTeacher = z.infer<typeof insertUserFollowsTeacherSchema>;
export type UserFollowsTeacher = typeof userFollowsTeacherTable.$inferSelect;
