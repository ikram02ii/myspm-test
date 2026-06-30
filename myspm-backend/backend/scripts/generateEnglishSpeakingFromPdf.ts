/**
 * Extract SPM English Speaking PDF text and generate practice prompts via LLM.
 *
 *   npx tsx scripts/generateEnglishSpeakingFromPdf.ts --part part2
 *   npx tsx scripts/generateEnglishSpeakingFromPdf.ts --part part3 --topic "School Life"
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1]?.trim() || undefined;
}

async function main(): Promise<void> {
  const part = (arg("part") ?? "part2") as "part1" | "part2" | "part3";
  const form = arg("form") ?? "Form 4";
  const topic = arg("topic") ?? "Random";
  const pdfPath = arg("pdfPath");

  const { buildEnglishSpeakingPdfContext } = await import("../src/services/rag/speaking/englishSpeakingPdfService.js");
  const ctx = await buildEnglishSpeakingPdfContext({ pdfPath, part });

  console.log("PDF:", ctx.pdfPath);
  console.log("Pages used:", ctx.usedPageNumbers.join(", "));
  console.log("Excerpt length:", ctx.excerpt.length);
  console.log("\n--- excerpt preview ---\n");
  console.log(ctx.excerpt.slice(0, 800));
  console.log("\n--- generating ---\n");

  const { generateWithRag } = await import("../src/services/ai gen/generateFromRag.js");

  const query =
    part === "part3"
      ? [
          `Generate 3 SPM English Speaking Part 3 (Group Discussion) practice prompts for Malaysian ${form} students.`,
          `Topic focus: ${topic}.`,
          "Use discussion-style questions an examiner would ask the group.",
          "Output format: Soalan 1\\n<prompt>\\nSoalan 2\\n...",
        ].join("\n")
      : [
          `Generate 1 SPM English Speaking Part 2 cue card for Malaysian ${form} students.`,
          `Topic focus: ${topic}.`,
          "Output format: Soalan 1\\nTopic: ...\\nYou should talk about:\\n- ...",
        ].join("\n");

  const result = await generateWithRag({
    query,
    subject: "English",
    form,
    skipRetrieval: true,
    englishSpeaking: true,
    englishSpeakingPdfPath: ctx.pdfPath,
  });

  console.log(result.answer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
