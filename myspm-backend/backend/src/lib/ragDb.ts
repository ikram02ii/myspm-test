import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./ragSchema";

const { Pool } = pg;

export function isRagDatabaseConfigured(): boolean {
  if (process.env["RAG_DATABASE_URL"]?.trim()) return true;
  const user = process.env["RAG_DB_USER"]?.trim();
  const password = process.env["RAG_DB_PASSWORD"]?.trim();
  return Boolean(user && password);
}

function buildRagDatabaseUrl(): string | null {
  const directUrl = process.env["RAG_DATABASE_URL"]?.trim();
  if (directUrl) return directUrl;

  const user = process.env["RAG_DB_USER"]?.trim();
  const password = process.env["RAG_DB_PASSWORD"]?.trim();
  if (!user || !password) return null;

  const host = process.env["RAG_DB_HOST"] ?? "localhost";
  const port = process.env["RAG_DB_PORT"] ?? "5432";
  const dbName = process.env["RAG_DB_NAME"] ?? "myspm_rag";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

const ragConnectionString = buildRagDatabaseUrl();
export const ragPool: pg.Pool | null = ragConnectionString
  ? new Pool({ connectionString: ragConnectionString })
  : null;

export const ragDb = ragPool ? drizzle(ragPool, { schema }) : null;

export * from "./ragSchema";
