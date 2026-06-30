/**
 * Diagnostic: what textbooks/forms are ingested, and do Chemistry chunks exist?
 * Usage: npx tsx ./scripts/checkTextbookGrounding.ts
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main(): Promise<void> {
  const { ragDb, ragTextbooksTable, ragTextbookChunksTable } = await import("../src/lib/ragDb");
  if (!ragDb) throw new Error("RAG database not configured");

  const books = await ragDb
    .select({
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      title: ragTextbooksTable.title,
      textbookId: ragTextbooksTable.textbookId,
    })
    .from(ragTextbooksTable);

  console.log("\n=== Ingested textbooks (subject | form | title) ===");
  if (books.length === 0) {
    console.log("  (none — no textbooks ingested at all)");
  }
  for (const b of books) {
    console.log(`  ${b.subject} | ${b.form} | ${b.title} | ${b.textbookId}`);
  }

  console.log("\n=== DISTINCT form values per table (checking for inconsistency) ===");
  const tablesToCheck: Array<{ name: string; table: any }> = [
    { name: "rag_textbooks", table: ragTextbooksTable },
  ];
  try {
    const { ragPastPapersTable } = await import("../src/lib/ragDb");
    if (ragPastPapersTable) tablesToCheck.push({ name: "rag_past_papers", table: ragPastPapersTable });
  } catch {
    /* table may not be exported */
  }
  for (const t of tablesToCheck) {
    const distinct = await ragDb
      .select({ form: t.table.form, c: sql<number>`count(*)` })
      .from(t.table)
      .groupBy(t.table.form);
    console.log(`  ${t.name}:`);
    for (const d of distinct) {
      console.log(`     form="${d.form}"  (rows=${d.c})`);
    }
  }

  const totalChunks = await ragDb.select({ c: sql<number>`count(*)` }).from(ragTextbookChunksTable);
  console.log(`\nTotal textbook chunks: ${totalChunks[0]?.c ?? 0}`);

  console.log("\n=== Chunk counts by textbook ===");
  const byBook = await ragDb
    .select({
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      c: sql<number>`count(${ragTextbookChunksTable.chunkId})`,
    })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, sql`${ragTextbookChunksTable.textbookDbId} = ${ragTextbooksTable.id}`)
    .groupBy(ragTextbooksTable.subject, ragTextbooksTable.form);
  for (const r of byBook) {
    console.log(`  ${r.subject} | form="${r.form}" | chunks=${r.c}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
