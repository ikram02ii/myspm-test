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
  tbId?: string;
  sourceName?: string;
  language?: string;
  maxPages?: number;
  startPage?: number;
  endPage?: number;
  noOss?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--")) continue;

    if (key === "--noOss") {
      options.noOss = true;
      continue;
    }

    if (value == null) continue;

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
      case "--tbId":
        options.tbId = value;
        i += 1;
        break;
      case "--sourceName":
        options.sourceName = value;
        i += 1;
        break;
      case "--language":
        options.language = value;
        i += 1;
        break;
      case "--maxPages":
        options.maxPages = Number(value);
        i += 1;
        break;
      case "--startPage":
        options.startPage = Number(value);
        i += 1;
        break;
      case "--endPage":
        options.endPage = Number(value);
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Ingest textbook via qwen-vl-max: PDF → page PNG → vision on EVERY page → rag_tb / rag_tb_chunks.

Usage (PowerShell):
npx tsx ./scripts/ingestTextbookVision.ts \\
  --pdfPath "C:/books/biology_form4.pdf" \\
  --subject "Biology" \\
  --form "Form 4" \\
  --title "Biology Form 4"

Optional: --tbId, --sourceName, --language en, --maxPages 500, --startPage 1, --endPage 321, --noOss

Model: qwen-vl-max (override with QWEN_TEXTBOOK_VISION_MODEL or QWEN_VISION_MODEL)
Requires: QWEN_*_API_KEY, QWEN_*_BASE_URL, OSS_* (unless --noOss)
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.subject || !args.form || !args.title) {
    printUsage();
    throw new Error("Missing required arguments: --pdfPath, --subject, --form, --title");
  }

  const { ensureRagSchema } = await import("../src/database/initRagDatabase");
  const { ingestTextbookPdfViaVisionToRagDb } = await import("../src/services/ama/ingestion/ingestTextbookViaVision");

  await ensureRagSchema();

  const result = await ingestTextbookPdfViaVisionToRagDb({
    pdfPath: args.pdfPath,
    subject: args.subject,
    form: args.form,
    title: args.title,
    tbId: args.tbId,
    sourceName: args.sourceName,
    language: args.language,
    startPage: args.startPage,
    endPage: args.endPage,
    maxPages: args.maxPages,
    uploadToOss: !args.noOss,
  });

  console.log("Textbook vision ingest completed.");
  console.log(`tbId: ${result.tbId}`);
  console.log(`tbDbId: ${result.tbDbId}`);
  console.log(`visionModel: ${result.visionModel}`);
  console.log(`chunkCount: ${result.chunkCount} (one chunk per page)`);
}

run().catch((error) => {
  console.error("[ingest:textbook-vision] failed:", error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
