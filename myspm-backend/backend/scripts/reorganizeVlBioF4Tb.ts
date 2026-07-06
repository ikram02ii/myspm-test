/**
 * Fix tb-vl-bio-f4 page chunks: correct chapter labels + clean noise (keeps one row per page).
 *
 * Usage:
 *   npx tsx ./scripts/reorganizeVlBioF4Tb.ts
 *   npx tsx ./scripts/reorganizeVlBioF4Tb.ts --dry-run
 */
import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const TB_ID = "tb-vl-bio-f4";
const CHAPTER_MAP = join(__dirname, "data/biology-form4-chapters.json");

async function main(): Promise<void> {
  const { loadChapterPageMap } = await import("../src/services/ama/ingestion/textbookChapterMap");
  const { fixVlTbPageChunks } = await import("../src/services/ama/ingestion/reorganizeVlTbChunks");

  const dryRun = process.argv.includes("--dry-run");
  const ranges = loadChapterPageMap(CHAPTER_MAP);

  console.log(`\n=== Fix VL Bio F4 page chunks (${TB_ID}) ===`);
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"} — page-level only, no chapter merge\n`);

  const result = await fixVlTbPageChunks({ tbId: TB_ID, ranges, dryRun });

  console.log(`Before:                    ${result.beforeCount} chunks`);
  console.log(`Split from chapter blobs:  ${result.splitFromChapters} pages`);
  console.log(`Updated (chapter/clean):   ${result.updated}`);
  console.log(`Duplicates removed:        ${result.deletedDuplicates}`);
  console.log(`Noise pages removed:       ${result.deletedNoise}`);
  console.log(`After:                     ${result.afterCount} page chunks`);
  if (dryRun) console.log("\n[dry-run] No database changes written.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
