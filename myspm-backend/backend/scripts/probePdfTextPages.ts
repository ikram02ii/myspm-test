import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv[2];
const pageList = (process.argv[3] ?? "1,2,3,10,50,100,150,200")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

async function main(): Promise<void> {
  if (!pdfPath) throw new Error("Usage: npx tsx ./scripts/probePdfTextPages.ts <pdfPath> [pageList]");
  const buffer = await readFile(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  console.log("fileBytes:", buffer.length);
  console.log("totalPages:", doc.numPages);

  let totalChars = 0;
  for (const pageNum of pageList) {
    if (pageNum > doc.numPages) continue;
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    totalChars += text.length;
    console.log(`page ${pageNum}: chars=${text.length}`);
    console.log(text.length > 0 ? `  preview: ${text.slice(0, 160)}` : "  preview: (empty)");
  }

  console.log("\nverdict:", totalChars === 0 ? "NOT_EXTRACTABLE" : "EXTRACTABLE (at least some pages have text)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
