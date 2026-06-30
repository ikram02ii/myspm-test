import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main(): Promise<void> {
  const subject = process.argv.find((a) => a.startsWith("--subject="))?.split("=")[1] ?? "Chemistry";
  const form = process.argv.find((a) => a.startsWith("--form="))?.split("=")[1] ?? "Form 5";

  const { ragDb, ragTextbookChunksTable, ragTextbooksTable } = await import("../src/lib/ragDb");

  const [book] = await ragDb
    .select()
    .from(ragTextbooksTable)
    .where(eq(ragTextbooksTable.subject, subject))
    .limit(10);

  const textbooks = await ragDb
    .select()
    .from(ragTextbooksTable)
    .where(eq(ragTextbooksTable.subject, subject));

  const tb = textbooks.find((t) => t.form === form);
  if (!tb) {
    console.error(`No textbook for ${subject} / ${form}`);
    process.exit(1);
  }

  const chunks = await ragDb
    .select({
      chunkIndex: ragTextbookChunksTable.chunkIndex,
      chapter: ragTextbookChunksTable.chapter,
      pageStart: ragTextbookChunksTable.pageStart,
      pageEnd: ragTextbookChunksTable.pageEnd,
      conceptTitle: ragTextbookChunksTable.conceptTitle,
    })
    .from(ragTextbookChunksTable)
    .where(eq(ragTextbookChunksTable.textbookDbId, tb.id))
    .orderBy(asc(ragTextbookChunksTable.chunkIndex));

  const byChapter = new Map<string, number>();
  let missingChapter = 0;
  let missingPage = 0;
  for (const c of chunks) {
    const ch = c.chapter?.trim() || "(no chapter)";
    if (!c.chapter?.trim()) missingChapter += 1;
    if (c.pageStart == null) missingPage += 1;
    byChapter.set(ch, (byChapter.get(ch) ?? 0) + 1);
  }

  console.log(`${subject} ${form} | ${tb.title} | chunks=${chunks.length}`);
  console.log(`missing chapter: ${missingChapter}, missing pageStart: ${missingPage}`);
  console.log("\nChapter counts:");
  for (const [ch, n] of [...byChapter.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${ch}`);
  }

  console.log("\nSample page ranges per chapter (first chunk in group):");
  let lastCh = "";
  for (const c of chunks) {
    const ch = c.chapter?.trim() || "(no chapter)";
    if (ch === lastCh) continue;
    lastCh = ch;
    console.log(`  ${ch} → pages ${c.pageStart ?? "?"}–${c.pageEnd ?? "?"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
