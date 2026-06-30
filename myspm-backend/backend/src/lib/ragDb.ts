import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./ragSchema";
import { getRagPgSchemaName } from "./ragSchema";

const { Pool } = pg;

/**
 * RAG tables (textbooks, rubrics, past papers, grading results) connection resolution:
 * 1. RAG_DATABASE_URL — explicit override (e.g. separate local RAG Postgres)
 * 2. DATABASE_URL — main app database (when RAG tables live alongside users/auth)
 * 3. RAG_DB_USER / RAG_DB_PASSWORD — legacy local fallback
 */
export function isRagDatabaseConfigured(): boolean {
  if (process.env["RAG_DATABASE_URL"]?.trim()) return true;
  if (process.env["DATABASE_URL"]?.trim()) return true;
  const user = process.env["RAG_DB_USER"]?.trim();
  const password = process.env["RAG_DB_PASSWORD"]?.trim();
  return Boolean(user && password);
}

export function assertRagDatabaseEnv(): void {
  if (isRagDatabaseConfigured()) return;
  throw new Error(
    "RAG database not configured. Set RAG_DATABASE_URL, or DATABASE_URL (main app DB with rag_* tables), or RAG_DB_USER and RAG_DB_PASSWORD.",
  );
}

function buildRagDatabaseUrl(): string | null {
  const ragUrl = process.env["RAG_DATABASE_URL"]?.trim();
  if (ragUrl) return ragUrl;

  const mainUrl = process.env["DATABASE_URL"]?.trim();
  if (mainUrl) return mainUrl;

  const user = process.env["RAG_DB_USER"]?.trim();
  const password = process.env["RAG_DB_PASSWORD"]?.trim();
  if (!user || !password) return null;

  const host = process.env["RAG_DB_HOST"] ?? "localhost";
  const port = process.env["RAG_DB_PORT"] ?? "5432";
  const dbName = process.env["RAG_DB_NAME"] ?? "myspm_rag";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

/** Which env var supplied the RAG connection (for startup logs). */
export function ragDatabaseSourceLabel(): string {
  if (process.env["RAG_DATABASE_URL"]?.trim()) return "RAG_DATABASE_URL";
  if (process.env["DATABASE_URL"]?.trim()) return "DATABASE_URL";
  return "RAG_DB_USER/RAG_DB_PASSWORD";
}

/** Host/port/database for startup logs (no credentials). */
export function ragDatabaseTarget(): { host: string; port: string; database: string } | null {
  if (!ragConnectionString) return null;
  try {
    const u = new URL(ragConnectionString);
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, "") || "?",
    };
  } catch {
    return { host: "?", port: "?", database: "?" };
  }
}

const ragConnectionString = buildRagDatabaseUrl();
const ragPgSchemaName = getRagPgSchemaName();
export const ragPool: pg.Pool | null = ragConnectionString
  ? new Pool({
      connectionString: ragConnectionString,
      options: `-c search_path=${ragPgSchemaName},public`,
    })
  : null;

export const ragDb = ragPool ? drizzle(ragPool, { schema }) : null;

export * from "./ragSchema";
