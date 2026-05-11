import { pgTable, serial, timestamp, varchar, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  avatarUrl: varchar("avatar_url", { length: 2048 }),
  password: varchar("password", { length: 255 }).notNull().default(""),
  role: varchar("role", { length: 50 }).notNull().default("student"),
  school: integer("school_id"),
  formLevel: integer("form_level"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  // Auth fields
  passwordResetToken: varchar("password_reset_token", { length: 255 }).unique(),
  passwordResetExpires: timestamp("password_reset_expires"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  lastLogin: timestamp("last_login"),
  loginAttempts: integer("login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  oauthProvider: varchar("oauth_provider", { length: 50 }),
  oauthId: varchar("oauth_id", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
