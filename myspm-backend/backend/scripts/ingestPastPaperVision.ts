import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

type CliOptions = {
  pdfPath?: string;
  subject?: string;
  form?: string;
  title?: string;
  paperId?: string;
  year?: number;
  paperLabel?: string;
  sourceName?: string;
  maxPages?: number;
  noOss?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) continue;

    switch (key) {
      case "--pdfPath":
        options.pdfPath = value;
        i += 1;
        break;
      case "--subject":
        options.subject = value;
        i += 1;
        break;
      case "--form":
        options.form = value;
        i += 1;
        break;
      case "--title":
        options.title = value;
        i += 1;
        break;
      case "--paperId":
        options.paperId = value;
        i += 1;
        break;
      case "--year":
        options.year = Number(value);
        i += 1;
        break;
      case "--paperLabel":
        options.paperLabel = value;
        i += 1;
        break;
      case "--sourceName":
        options.sourceName = value;
        i += 1;
        break;
      case "--maxPages":
        options.maxPages = Number(value);
        i += 1;
        break;
      case "--noOss":
        options.noOss = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Ingest past paper via Qwen VL: PDF → page PNG → vision on EVERY page → rag_past_paper_chunks (one chunk per page).

Usage (PowerShell — use npx tsx, not npm run, so flags are preserved):
npx tsx ./scripts/ingestPastPaperVision.ts \\
  --pdfPath "C:/path/2021 SPM Physics K2.pdf" \\
  --subject "Physics" \\
  --form "Form 5" \\
  --title "2021 SPM Physics K2" \\
  --year 2021 \\
  --paperLabel "Paper 2"

Optional: --paperId, --sourceName, --maxPages 40, --noOss (skip OSS upload; VL still runs)

Requires: QWEN_VISION_MODEL or QWEN_OCR_MODEL, QWEN_*_API_KEY, QWEN_*_BASE_URL, OSS_* (unless --noOss)
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.subject || !args.form || !args.title) {
    printUsage();
    throw new Error("Missing required arguments: --pdfPath, --subject, --form, --title");
  }

  const { ensureRagSchema } = await import("../src/database/initRagDatabase");
  const { ingestPastPaperPdfViaVisionToRagDb } = await import("../src/services/ai gen/ingestPastPaperViaVision");

  await ensureRagSchema();

  const result = await ingestPastPaperPdfViaVisionToRagDb({
    pdfPath: args.pdfPath,
    subject: args.subject,
    form: args.form,
    title: args.title,
    paperId: args.paperId,
    year: args.year != null && Number.isFinite(args.year) ? args.year : null,
    paperLabel: args.paperLabel ?? null,
    sourceName: args.sourceName,
    maxPages: args.maxPages,
    uploadToOss: !args.noOss,
  });

  console.log("Past paper vision ingest completed.");
  console.log(`paperId: ${result.paperId}`);
  console.log(`pastPaperDbId: ${result.pastPaperDbId}`);
  console.log(`chunkCount: ${result.chunkCount} (one chunk per page)`);
}

run().catch((error) => {
  console.error("[ingest:past-paper-vision] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
