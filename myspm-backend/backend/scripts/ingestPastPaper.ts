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
  chapter?: string;
  sourceName?: string;
  chunkSize?: number;
  overlap?: number;
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
      case "--chapter":
        options.chapter = value;
        i += 1;
        break;
      case "--sourceName":
        options.sourceName = value;
        i += 1;
        break;
      case "--chunkSize":
        options.chunkSize = Number(value);
        i += 1;
        break;
      case "--overlap":
        options.overlap = Number(value);
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Same chunking pipeline as ingest:textbook (LLM or deterministic), stored in rag_past_papers / rag_past_paper_chunks.

Usage:
npm run ingest:past-paper -- \\
  --pdfPath "C:/path/MELAKA_2025_Q_BIO2.pdf" \\
  --subject "Biology" \\
  --form "Form 4" \\
  --title "Melaka 2025 Biology Paper 2 (Questions)" \\
  --year 2025 \\
  --paperLabel "Paper 2" \\
  --paperId "melaka-2025-bio-k2-q" \\
  --chunkSize 1200 \\
  --overlap 200

Optional: --chapter, --sourceName, --paperId (stable id; auto if omitted)
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.subject || !args.form || !args.title) {
    printUsage();
    throw new Error("Missing required arguments: --pdfPath, --subject, --form, --title");
  }

  const { ensureRagSchema } = await import("../src/database/initRagDatabase");
  const { ingestPastPaperPdfToRagDb } = await import("../src/services/rag/ingestionService");

  await ensureRagSchema();

  const result = await ingestPastPaperPdfToRagDb({
    pdfPath: args.pdfPath,
    subject: args.subject,
    form: args.form,
    title: args.title,
    paperId: args.paperId,
    year: args.year != null && Number.isFinite(args.year) ? args.year : null,
    paperLabel: args.paperLabel ?? null,
    chapter: args.chapter,
    sourceName: args.sourceName,
    chunkSize: args.chunkSize,
    overlap: args.overlap,
  });

  console.log("Past paper ingested successfully.");
  console.log(`paperId: ${result.paperId}`);
  console.log(`pastPaperDbId: ${result.pastPaperDbId}`);
  console.log(`chunkCount: ${result.chunkCount}`);
}

run().catch((error) => {
  console.error("[ingest:past-paper] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
