import * as dotenv from "dotenv";
import pg from "pg";
import { RAG_DB_SCHEMA_NAME } from "../src/lib/ragSchema";

dotenv.config({ path: new URL("../.env", import.meta.url) });

async function main(): Promise<void> {
  const schema = RAG_DB_SCHEMA_NAME;
  const pool = new pg.Pool({
    connectionString: process.env.RAG_DATABASE_URL ?? process.env.DATABASE_URL,
    connectionTimeoutMillis: 20000,
  });

  try {
    const tables = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM ${schema}.rag_textbooks) AS textbooks,
        (SELECT count(*)::int FROM ${schema}.rag_textbook_chunks) AS textbook_chunks,
        (SELECT count(*)::int FROM ${schema}.rag_past_papers) AS past_papers,
        (SELECT count(*)::int FROM ${schema}.rag_past_paper_chunks) AS past_paper_chunks
    `);
    console.log(`RAG table counts (${schema} schema):`, tables.rows[0]);

    const bySubject = await pool.query(`
      SELECT subject, count(*)::int AS chunks
      FROM ${schema}.rag_textbook_chunks c
      JOIN ${schema}.rag_textbooks t ON t.id = c.textbook_db_id
      GROUP BY subject
      ORDER BY chunks DESC
    `);
    console.log("\nTextbook chunks by subject:", bySubject.rows);

    const papersBySubject = await pool.query(`
      SELECT subject, count(*)::int AS chunks
      FROM ${schema}.rag_past_paper_chunks c
      JOIN ${schema}.rag_past_papers p ON p.id = c.past_paper_db_id
      GROUP BY subject
      ORDER BY chunks DESC
    `);
    console.log("\nPast paper chunks by subject:", papersBySubject.rows);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
