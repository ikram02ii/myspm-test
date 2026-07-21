import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "node:fs/promises";
import { classifyAllPagesFromText } from "../src/services/ai gen/pageVisionClassifier";
import { extractPdfPages } from "../src/services/rag/ingestion/pdfTextExtract";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function parseArgs(argv: string[]): { pdfPath?: string; maxPages?: number } {
  const options: { pdfPath?: string; maxPages?: number } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--pdfPath" && value) {
      options.pdfPath = value;
      i += 1;
    } else if (key === "--maxPages" && value) {
      options.maxPages = Number(value);
      i += 1;
    }
  }
  return options;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdfPath) {
    console.log(`Classify PDF pages: text-only vs vision (no ingest).

Usage:
  npx tsx ./scripts/classifyPdfPages.ts --pdfPath "C:/path/book.pdf" [--maxPages 40]
`);
    process.exit(1);
  }

  await readFile(args.pdfPath);
  const pages = await extractPdfPages(args.pdfPath);
  const max = args.maxPages ?? 200;
  const limited = pages.filter((p) => p.pageNumber <= max);
  const classifications = classifyAllPagesFromText(limited);

  const vision = classifications.filter((c) => c.route === "vision");
  const text = classifications.filter((c) => c.route === "text");

  console.log(`\nPDF: ${args.pdfPath}`);
  console.log(`Pages analysed: ${classifications.length}`);
  console.log(`Vision recommended: ${vision.length} → [${vision.map((v) => v.pageNumber).join(", ")}]`);
  console.log(`Text-only OK: ${text.length} → [${text.map((t) => t.pageNumber).join(", ")}]\n`);

  for (const c of classifications) {
    console.log(
      `Page ${String(c.pageNumber).padStart(3)} | ${c.route.padEnd(6)} | score=${c.heuristicScore} chars=${c.textCharCount} | ${c.reasons.join(", ")}`,
    );
  }
}

run().catch((error) => {
  console.error("[classify-pdf-pages] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
