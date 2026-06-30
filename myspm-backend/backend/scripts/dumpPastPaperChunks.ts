/**
 * npm run script:dump-past-paper-chunks -- --pastPaperDbId 4
 */
import * as dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { asc, eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function parseId(argv: string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--pastPaperDbId" && argv[i + 1]) return Number(argv[i + 1]);
  }
  const raw = argv.find((a) => /^\d+$/.test(a));
  if (raw) return Number(raw);
  return Number.NaN;
}

async function main(): Promise<void> {
  const id = parseId(process.argv.slice(2));
  if (!Number.isFinite(id) || id < 1) {
    console.error("Usage: npm run script:dump-past-paper-chunks -- --pastPaperDbId <id>");
    process.exit(1);
  }

  const { ragDb, ragPastPaperChunksTable, ragPastPapersTable } = await import("../src/lib/ragDb");

  const paper = await ragDb
    .select()
    .from(ragPastPapersTable)
    .where(eq(ragPastPapersTable.id, id))
    .limit(1);

  const p = paper[0];
  if (!p) {
    console.error(`No rag_past_papers row with id=${id}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ id: p.id, paperId: p.paperId, subject: p.subject, form: p.form, title: p.title }, null, 2));
  console.log("--- CHUNKS ---\n");

  const chunks = await ragDb
    .select()
    .from(ragPastPaperChunksTable)
    .where(eq(ragPastPaperChunksTable.pastPaperDbId, id))
    .orderBy(asc(ragPastPaperChunksTable.chunkIndex));

  for (const c of chunks) {
    console.log(`### chunk_index=${c.chunkIndex} chunk_id=${c.chunkId}`);
    if (c.questionRef) console.log(`questionRef: ${c.questionRef}`);
    if (c.conceptTitle) console.log(`conceptTitle: ${c.conceptTitle}`);
    if (c.maxMarks != null) console.log(`maxMarks: ${c.maxMarks}`);
    console.log("content:\n" + c.content + "\n");
  }

  console.log(`--- total chunks: ${chunks.length} ---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
