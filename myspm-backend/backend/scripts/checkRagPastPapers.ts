import * as dotenv from "dotenv";
import pg from "pg";
import { RAG_DB_SCHEMA_NAME } from "../src/lib/ragSchema";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const pool = new pg.Pool({
  connectionString: process.env.RAG_DATABASE_URL ?? process.env.DATABASE_URL,
});

async function main(): Promise<void> {
  const db = await pool.query("SELECT current_database() AS db");
  console.log("database:", db.rows[0]?.db);

  const tables = await pool.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename = 'rag_past_papers'
    ORDER BY schemaname
  `);
  console.log("rag_past_papers tables:", tables.rows);

  for (const t of tables.rows) {
    const fq = `${t.schemaname}.rag_past_papers`;
    const count = await pool.query(`SELECT count(*)::int AS n FROM ${fq}`);
    const sample = await pool.query(`SELECT id, paper_id, subject, title FROM ${fq} ORDER BY id LIMIT 10`);
    console.log(`\n${fq} count:`, count.rows[0]?.n);
    console.log("rows:", sample.rows);
  }

  const hasRagSchema = await pool.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'rag') AS exists
  `);
  console.log("\nschema 'rag' exists:", hasRagSchema.rows[0]?.exists);

  const chunkCount = await pool.query(
    `SELECT count(*)::int AS n FROM ${RAG_DB_SCHEMA_NAME}.rag_past_paper_chunks`,
  );
  console.log(`${RAG_DB_SCHEMA_NAME}.rag_past_paper_chunks count:`, chunkCount.rows[0]?.n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
