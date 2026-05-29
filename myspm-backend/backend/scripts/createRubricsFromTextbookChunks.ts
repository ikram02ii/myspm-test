/**
 * Batch-create SPM questions + saved rubrics from ingested textbook chunks.
 *
 * Examples:
 *   npx tsx scripts/createRubricsFromTextbookChunks.ts --subject Biology --form "Form 4" --maxChunks 5
 *   npx tsx scripts/createRubricsFromTextbookChunks.ts --textbookId tb-bio-f4 --maxChunks 10 --offset 0
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

function argNum(name: string): number | undefined {
  const raw = arg(name);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function assertRagDbEnv(): void {
  if (process.env["RAG_DATABASE_URL"]?.trim()) return;
  const missing = ["RAG_DB_USER", "RAG_DB_PASSWORD"].filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `RAG database not configured. Set RAG_DATABASE_URL or ${missing.join(" and ")} in backend/.env`,
    );
  }
}

async function main(): Promise<void> {
  assertRagDbEnv();

  const textbookId = arg("textbookId");
  const subject = arg("subject");
  const form = arg("form");
  if (!textbookId && (!subject || !form)) {
    console.error("Usage: --textbookId <id> OR --subject <s> --form <f> [--maxChunks N] [--offset N]");
    process.exit(1);
  }

  const { createRubricsFromTextbookChunks } = await import(
    "../src/services/rag/rubric/rubricFromTextbookChunksService.js"
  );

  const result = await createRubricsFromTextbookChunks({
    textbookId,
    subject,
    form,
    chapterFilter: arg("chapterFilter"),
    maxChunks: argNum("maxChunks"),
    offset: argNum("offset"),
    maxMarks: argNum("maxMarks"),
    concurrency: argNum("concurrency"),
    skipExisting: !flag("force"),
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
