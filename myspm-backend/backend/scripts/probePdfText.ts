import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: npx tsx ./scripts/probePdfText.ts <pdfPath> [maxPages=5]");
  process.exit(1);
}

const maxPages = Number(process.argv[3] ?? 5);

async function main(): Promise<void> {
  const buffer = await readFile(pdfPath);
  console.log("fileBytes:", buffer.length);

  const doc = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  const totalPages = doc.numPages;
  const pagesToCheck = Math.min(maxPages, totalPages);

  console.log("totalPages:", totalPages);
  console.log("checkingFirstPages:", pagesToCheck);

  let totalChars = 0;
  for (let pageNum = 1; pageNum <= pagesToCheck; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    totalChars += text.length;
    console.log(`page ${pageNum}: chars=${text.length}`);
    if (text.length > 0) {
      console.log(`  preview: ${text.slice(0, 180)}`);
    } else {
      console.log("  preview: (empty — likely image-only page)");
    }
  }

  const verdict =
    totalChars === 0
      ? "NOT_EXTRACTABLE — no text on sampled pages (image/scanned PDF; OCR needed)"
      : totalChars < 100
        ? "WEAK — very little text; may be mostly images"
        : "EXTRACTABLE — text layer present on sampled pages";

  console.log("\nverdict:", verdict);
}

main().catch((error) => {
  console.error("probe failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
