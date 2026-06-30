import { extractPdfPages } from "../src/services/rag/ingestion/pdfTextExtract";

const pdfPath =
  process.argv[2] ??
  "C:\\Users\\User\\Desktop\\myspm\\Knowledge Base\\Biology\\KSSM Biology Form 5 textbook.pdf";

async function main() {
  const pages = await extractPdfPages(pdfPath);
  for (const p of pages.filter((x) => x.pageNumber <= 25)) {
    console.log(`\n===== PAGE ${p.pageNumber} =====\n`);
    console.log(p.text.slice(0, 3500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
