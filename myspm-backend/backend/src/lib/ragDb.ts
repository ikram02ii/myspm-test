import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./ragSchema";

const { Pool } = pg;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for RAG database connection.`);
  }
  return value;
}

function buildRagDatabaseUrl(): string {
  const directUrl = process.env["RAG_DATABASE_URL"];
  if (directUrl) return directUrl;

  const host = process.env["RAG_DB_HOST"] ?? "localhost";
  const port = process.env["RAG_DB_PORT"] ?? "5432";
  const dbName = process.env["RAG_DB_NAME"] ?? "myspm_rag";
  const user = requireEnv("RAG_DB_USER");
  const password = requireEnv("RAG_DB_PASSWORD");

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

const ragConnectionString = buildRagDatabaseUrl();
export const ragPool = new Pool({ connectionString: ragConnectionString });
export const ragDb = drizzle(ragPool, { schema });

export * from "./ragSchema";
