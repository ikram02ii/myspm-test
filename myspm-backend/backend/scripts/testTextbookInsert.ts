import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main(): Promise<void> {
  const pg = (await import("pg")).default;
  const { eq } = await import("drizzle-orm");
  const { ragDb, ragPool, ragTextbooksTable } = await import("../src/lib/ragDb");

  const cs = process.env.RAG_DATABASE_URL ?? process.env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString: cs, connectionTimeoutMillis: 15000 });

  const who = await pool.query(`SELECT current_user, current_database()`);
  console.log("user:", who.rows[0]);

  const seqCheck = await pool.query(`
    SELECT
      (SELECT max(id) FROM rag.rag_textbooks) AS textbooks_max_id,
      (SELECT last_value FROM rag.rag_textbooks_id_seq) AS textbooks_seq,
      (SELECT max(id) FROM rag.rag_textbook_chunks) AS chunks_max_id,
      (SELECT last_value FROM rag.rag_textbook_chunks_id_seq) AS chunks_seq
  `);
  console.log("sequence check:", seqCheck.rows[0]);

  const priv = await pool.query(`
    SELECT privilege_type FROM information_schema.table_privileges
    WHERE table_schema='rag' AND table_name='rag_textbooks' AND grantee=current_user
  `);
  console.log("privileges:", priv.rows.map((r) => r.privilege_type));

  const testId = `tb-test-${Date.now()}`;
  try {
    const ins = await pool.query(
      `INSERT INTO rag.rag_textbooks (textbook_id,subject,form,title,source_name,chunk_size_chars,overlap_chars)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [testId, "Physics", "Form 4", "KSSM Physics Form 4", "Physics Textbook F4 KSSM.pdf", 1200, 200],
    );
    console.log("raw insert OK:", ins.rows[0]);
    await pool.query(`DELETE FROM rag.rag_textbooks WHERE textbook_id=$1`, [testId]);
  } catch (e) {
    const err = e as { code?: string; message?: string; detail?: string };
    console.error("raw insert FAIL:", err.code, err.message, err.detail);
  }
  await pool.end();

  const testId2 = `tb-drizzle-${Date.now()}`;
  try {
    const r = await ragDb
      .insert(ragTextbooksTable)
      .values({
        textbookId: testId2,
        subject: "Physics",
        form: "Form 4",
        title: "KSSM Physics Form 4",
        sourceName: "Physics Textbook F4 KSSM.pdf",
        chunkSizeChars: 1200,
        overlapChars: 200,
        createdByUserId: null,
      })
      .returning({ id: ragTextbooksTable.id });
    console.log("drizzle insert OK:", r[0]);
    await ragDb.delete(ragTextbooksTable).where(eq(ragTextbooksTable.textbookId, testId2));
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    console.error("drizzle insert FAIL:", err.message);
    if (err.cause) console.error("cause:", err.cause.code, err.cause.message);
  }

  await ragPool.end();
}

main();
