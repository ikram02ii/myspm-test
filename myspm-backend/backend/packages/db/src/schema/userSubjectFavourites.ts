import { pgTable, serial, timestamp, varchar, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const userSubjectFavouritesTable = pgTable(
  "user_subject_favourites",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    subjectCode: varchar("subject_code", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userSubjectCodeUnique: uniqueIndex("user_subject_favourites_user_subject_code_unique").on(table.userId, table.subjectCode),
  })
);

export const insertUserSubjectFavouriteSchema = createInsertSchema(userSubjectFavouritesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserSubjectFavourite = z.infer<typeof insertUserSubjectFavouriteSchema>;
export type UserSubjectFavourite = typeof userSubjectFavouritesTable.$inferSelect;
