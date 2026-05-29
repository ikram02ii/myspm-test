/**
 * Delete a textbook row and its chunks (ON DELETE CASCADE).
 *
 * Usage:
 *   npx tsx scripts/deleteRagTextbook.ts --textbookId tb-1779762719704-9aed2133
 *   npx tsx scripts/deleteRagTextbook.ts --dbId 5
 *   npx tsx scripts/deleteRagTextbook.ts --textbookId tb-... --dry-run
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const eqArg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(flag.length + 1).trim();
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return undefined;
}

async function main(): Promise<void> {
  const textbookId = arg("textbookId");
  const dbIdRaw = arg("dbId");
  const dryRun = process.argv.includes("--dry-run");

  if (!textbookId && !dbIdRaw) {
    console.error("Provide --textbookId tb-... or --dbId <number>");
    process.exit(1);
  }

  const { ragDb, ragTextbookChunksTable, ragTextbooksTable } = await import("../src/lib/ragDb");

  const [book] = await ragDb
    .select()
    .from(ragTextbooksTable)
    .where(
      textbookId
        ? eq(ragTextbooksTable.textbookId, textbookId)
        : eq(ragTextbooksTable.id, Number(dbIdRaw)),
    )
    .limit(1);

  if (!book) {
    console.error("Textbook not found.");
    process.exit(1);
  }

  const [countRow] = await ragDb
    .select({ count: sql<number>`count(*)::int` })
    .from(ragTextbookChunksTable)
    .where(eq(ragTextbookChunksTable.textbookDbId, book.id));

  const chunkCount = countRow?.count ?? 0;
  console.log(
    `${dryRun ? "[dry-run] " : ""}Delete: dbId=${book.id} textbookId=${book.textbookId} | ${book.subject} ${book.form} | ${book.title} | chunks=${chunkCount}`,
  );

  if (dryRun) return;

  await ragDb.delete(ragTextbooksTable).where(eq(ragTextbooksTable.id, book.id));
  console.log("Deleted.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
