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
  console.log(`Usage:
npm run ingest:textbook -- \
  --pdfPath "C:/books/math_form4.pdf" \
  --subject "Mathematics" \
  --form "Form 4" \
  --title "Mathematics Form 4" \
  --chapter "optional hint before first BAB/Chapter in PDF" \
  --sourceName "math_form4.pdf" \
  --chunkSize 1200 \
  --overlap 200

Notes:
  --chapter is optional. Chunks get Bab 1 / Bab 2 / Chapter 3 / … from headings in the PDF text.
  Use --chapter only for pages before the first detected heading (e.g. preface), or omit it.
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.subject || !args.form || !args.title) {
    printUsage();
    throw new Error("Missing required arguments: --pdfPath, --subject, --form, --title");
  }

  const { ensureRagSchema } = await import("../src/database/initRagDatabase");
  const { ingestPdfToRagDb } = await import("../src/services/rag/ingestion/ingestionService");

  await ensureRagSchema();

  const result = await ingestPdfToRagDb({
    pdfPath: args.pdfPath,
    subject: args.subject,
    form: args.form,
    title: args.title,
    chapter: args.chapter,
    sourceName: args.sourceName,
    chunkSize: args.chunkSize,
    overlap: args.overlap,
  });

  console.log("Textbook ingested successfully.");
  console.log(`textbookId: ${result.textbookId}`);
  console.log(`chunkCount: ${result.chunkCount}`);
}

run().catch((error) => {
  console.error("[ingest:textbook] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
