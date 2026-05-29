/**
 * Create saved rubrics for every Chemistry Form 4 textbook chunk (batched).
 *
 *   npx tsx scripts/createRubricsChemForm4All.ts
 *   npx tsx scripts/createRubricsChemForm4All.ts --chapterFilter "Chapter 6"
 *   npx tsx scripts/createRubricsChemForm4All.ts --offset 200
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1]?.trim() || undefined;
}

function argNum(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const BATCH_CAP = 200;
const SUBJECT = "Chemistry";
const FORM = "Form 4";

async function main(): Promise<void> {
  if (!process.env["RAG_DATABASE_URL"]?.trim()) {
    const missing = ["RAG_DB_USER", "RAG_DB_PASSWORD"].filter((k) => !process.env[k]?.trim());
    if (missing.length > 0) {
      throw new Error(`Set RAG_DATABASE_URL or ${missing.join(" and ")} in backend/.env`);
    }
  }

  const { createRubricsFromTextbookChunks } = await import(
    "../src/services/rag/rubric/rubricFromTextbookChunksService.js"
  );

  const batchSize = Math.max(1, Math.min(BATCH_CAP, argNum("maxChunks", BATCH_CAP)));
  let offset = Math.max(0, argNum("offset", 0));
  const concurrency = Math.max(1, Math.min(5, argNum("concurrency", 2)));
  const maxMarks = argNum("maxMarks", 2);
  const chapterFilter = arg("chapterFilter");
  const dryRun = flag("dryRun");

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let batchNum = 0;

  console.info(
    `[chem-f4-rubrics] subject=${SUBJECT} form=${FORM} batchSize=${batchSize} concurrency=${concurrency} maxMarks=${maxMarks}` +
      (chapterFilter ? ` chapterFilter=${chapterFilter}` : ""),
  );

  if (dryRun) {
    const { listTextbookChunksForRubricGeneration } = await import(
      "../src/services/rag/rubric/rubricFromTextbookChunksService.js"
    );
    const { textbook, chunks } = await listTextbookChunksForRubricGeneration({
      subject: SUBJECT,
      form: FORM,
      chapterFilter,
      maxChunks: batchSize,
      offset,
    });
    console.info(
      `[chem-f4-rubrics] dry-run textbook=${textbook.textbookId} chunksInBatch=${chunks.length} offset=${offset}`,
    );
    return;
  }

  for (;;) {
    batchNum += 1;
    console.info(`[chem-f4-rubrics] batch ${batchNum} offset=${offset} ...`);

    const result = await createRubricsFromTextbookChunks({
      subject: SUBJECT,
      form: FORM,
      chapterFilter,
      maxChunks: batchSize,
      offset,
      maxMarks,
      concurrency,
      skipExisting: !flag("force"),
    });

    totalCreated += result.created;
    totalSkipped += result.skipped;
    totalFailed += result.failed;

    console.info(
      `[chem-f4-rubrics] batch ${batchNum} done: processed=${result.processed} created=${result.created} skipped=${result.skipped} failed=${result.failed}`,
    );

    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 5)) {
        console.error(`  chunk ${err.chunkId}: ${err.message}`);
      }
      if (result.errors.length > 5) {
        console.error(`  ... and ${result.errors.length - 5} more errors`);
      }
    }

    if (result.processed === 0) {
      console.info("[chem-f4-rubrics] no more chunks at this offset — finished.");
      break;
    }

    offset += batchSize;

    if (result.failed > 0 && result.created === 0) {
      console.error("[chem-f4-rubrics] batch had failures and no creates — stopping.");
      process.exit(1);
    }
  }

  console.info(
    JSON.stringify(
      {
        subject: SUBJECT,
        form: FORM,
        batches: batchNum,
        totalCreated,
        totalSkipped,
        totalFailed,
      },
      null,
      2,
    ),
  );

  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
