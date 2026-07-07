import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

type Target = "textbook" | "past-paper";

type CliOptions = {
  pdfPath?: string;
  subject?: string;
  form?: string;
  title?: string;
  target?: Target;
  paperId?: string;
  year?: number;
  paperLabel?: string;
  sourceName?: string;
  maxPages?: number;
  noOss?: boolean;
  noEmbed?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { target: "textbook" };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--")) continue;

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
      case "--target":
        options.target = value === "past-paper" ? "past-paper" : "textbook";
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
      case "--noEmbed":
        options.noEmbed = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Hybrid PDF ingest: classify pages → text OR vision → OSS image URL → RAG chunks + embeddings.

Step 1 (dry run): npx tsx ./scripts/classifyPdfPages.ts --pdfPath "C:/path/file.pdf"

Step 2 (ingest textbook):
npx tsx ./scripts/ingestPdfHybrid.ts \\
  --target textbook \\
  --pdfPath "C:/path/biology-ch3.pdf" \\
  --subject Biology --form "Form 4" --title "Biology Chapter 3"

Step 2 (ingest past paper):
npx tsx ./scripts/ingestPdfHybrid.ts \\
  --target past-paper \\
  --pdfPath "C:/path/2021-physics-k2.pdf" \\
  --subject Physics --form "Form 5" --title "2021 SPM Physics K2" --year 2021

Options: --maxPages 60 --noOss --noEmbed --paperId --paperLabel --sourceName

Env: QWEN_VISION_* / QWEN_OCR_* / QWEN_GRADING_* for VL; OSS_* for uploads; QWEN_EMBEDDING_* for vectors.
Optional: RAG_PAGE_MIN_TEXT_CHARS=160, RAG_HYBRID_VLM_CLASSIFY_ALL=true
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.subject || !args.form || !args.title) {
    printUsage();
    throw new Error("Missing required: --pdfPath, --subject, --form, --title");
  }

  const { ensureRagSchema } = await import("../src/database/initRagDatabase");
  const {
    ingestPastPaperPdfHybridToRagDb,
    ingestTextbookPdfHybridToRagDb,
  } = await import("../src/services/ai gen/ingestHybridToRagDb");

  await ensureRagSchema();

  const common = {
    pdfPath: args.pdfPath,
    subject: args.subject,
    form: args.form,
    title: args.title,
    sourceName: args.sourceName,
    maxPages: args.maxPages,
    uploadToOss: !args.noOss,
  };

  if (args.target === "past-paper") {
    const result = await ingestPastPaperPdfHybridToRagDb({
      ...common,
      paperId: args.paperId,
      year: args.year != null && Number.isFinite(args.year) ? args.year : null,
      paperLabel: args.paperLabel ?? null,
    });
    console.log("Past paper hybrid ingest completed.");
    console.log(`paperId: ${result.documentId}`);
    console.log(`dbId: ${result.dbId}`);
    console.log(`chunks: ${result.chunkCount}`);
    console.log(`vision pages: ${result.visionPageNumbers.join(", ") || "(none)"}`);
    return;
  }

  const result = await ingestTextbookPdfHybridToRagDb(common);
  console.log("Textbook hybrid ingest completed.");
  console.log(`textbookId: ${result.documentId}`);
  console.log(`dbId: ${result.dbId}`);
  console.log(`chunks: ${result.chunkCount}`);
  console.log(`vision pages: ${result.visionPageNumbers.join(", ") || "(none)"}`);
}

run().catch((error) => {
  console.error("[ingest:pdf-hybrid] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
