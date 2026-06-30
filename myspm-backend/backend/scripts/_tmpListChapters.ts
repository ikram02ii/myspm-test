import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { and, asc, eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main() {
  const { ragDb, ragTextbookChunksTable, ragTextbooksTable } = await import("../src/lib/ragDb");
  const subject = process.argv[2] ?? "Biology";
  const form = process.argv[3] ?? "Form 5";

  const [tb] = await ragDb
    .select()
    .from(ragTextbooksTable)
    .where(and(eq(ragTextbooksTable.subject, subject), eq(ragTextbooksTable.form, form)))
    .orderBy(asc(ragTextbooksTable.id))
    .limit(1);

  if (!tb) {
    console.log("No textbook found");
    return;
  }

  const chunks = await ragDb
    .select({
      chapter: ragTextbookChunksTable.chapter,
      pageStart: ragTextbookChunksTable.pageStart,
      pageEnd: ragTextbookChunksTable.pageEnd,
    })
    .from(ragTextbookChunksTable)
    .where(eq(ragTextbookChunksTable.textbookDbId, tb.id))
    .orderBy(asc(ragTextbookChunksTable.chunkIndex));

  const byChapter = new Map<string, { n: number; pmin: number; pmax: number }>();
  let unmapped = 0;
  for (const c of chunks) {
    const ch = c.chapter?.trim() || "(no chapter)";
    if (ch === "(no chapter)") unmapped++;
    const ps = c.pageStart ?? 9999;
    const pe = c.pageEnd ?? ps;
    const cur = byChapter.get(ch) ?? { n: 0, pmin: ps, pmax: pe };
    cur.n += 1;
    cur.pmin = Math.min(cur.pmin, ps);
    cur.pmax = Math.max(cur.pmax, pe);
    byChapter.set(ch, cur);
  }

  console.log(`${tb.subject} ${tb.form} | ${tb.title}`);
  console.log(`textbookDbId=${tb.id} externalId=${tb.textbookId} chunks=${chunks.length}`);
  console.log(`unmapped/null chapter: ${unmapped}`);
  console.log("\nChapters (by min page):");
  for (const [ch, v] of [...byChapter.entries()].sort((a, b) => a[1].pmin - b[1].pmin)) {
    console.log(`  pp ${String(v.pmin).padStart(3)}–${String(v.pmax).padStart(3)}  (${v.n} chunks)  ${ch}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
