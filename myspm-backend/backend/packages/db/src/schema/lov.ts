import { pgTable, serial, varchar, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lovCategoriesTable = pgTable("lov_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
});

export const lovValuesTable = pgTable("lov_values", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => lovCategoriesTable.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 100 }).notNull(),
  displayNameEn: varchar("display_name_en", { length: 255 }).notNull(),
  displayNameMs: varchar("display_name_ms", { length: 255 }),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("active"),
});

export const insertLovCategorySchema = createInsertSchema(lovCategoriesTable).omit({ id: true });
export type InsertLovCategory = z.infer<typeof insertLovCategorySchema>;
export type LovCategory = typeof lovCategoriesTable.$inferSelect;

export const insertLovValueSchema = createInsertSchema(lovValuesTable).omit({ id: true });
export type InsertLovValue = z.infer<typeof insertLovValueSchema>;
export type LovValue = typeof lovValuesTable.$inferSelect;
