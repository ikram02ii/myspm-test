import { pgTable, serial, timestamp, varchar, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemParametersTable = pgTable("system_parameters", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  category: varchar("category", { length: 100 }).notNull(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertParameterSchema = createInsertSchema(systemParametersTable).omit({ id: true, updatedAt: true });
export type InsertParameter = z.infer<typeof insertParameterSchema>;
export type SystemParameter = typeof systemParametersTable.$inferSelect;
