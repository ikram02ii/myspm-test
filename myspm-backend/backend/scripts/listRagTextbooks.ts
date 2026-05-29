import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main(): Promise<void> {
  const { listTextbooks } = await import("../src/services/rag/ingestion/textbookService");
  const { ragDb, ragTextbookChunksTable, ragTextbooksTable } = await import("../src/lib/ragDb");

  const subjectFilter = process.argv.find((a) => a.startsWith("--subject="))?.split("=")[1];

  const books = await listTextbooks();
  const filtered = subjectFilter
    ? books.filter((b) => b.subject.toLowerCase() === subjectFilter.toLowerCase())
    : books;

  for (const b of filtered) {
    const [row] = await ragDb
      .select({ count: sql<number>`count(*)::int` })
      .from(ragTextbookChunksTable)
      .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
      .where(eq(ragTextbooksTable.textbookId, b.textbookId));
    console.log(
      `${b.subject} | ${b.form} | ${b.title} | textbookId=${b.textbookId} | chunks=${row?.count ?? 0}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
