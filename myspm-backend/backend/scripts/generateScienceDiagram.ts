/**
 * Quick test for Qwen image API (RAG_IMAGE_* in .env).
 *
 * Usage:
 *   npx tsx scripts/generateScienceDiagram.ts biology "animal cell structure"
 *   npx tsx scripts/generateScienceDiagram.ts chemistry "ionic bond between Na and Cl"
 *   npx tsx scripts/generateScienceDiagram.ts physics "simple series circuit with bulb"
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  buildEducationalDiagramPrompt,
  EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,
} from "../src/services/ai gen/educationalDiagramService";
import { generateImage } from "../src/services/ai gen/llmProvider";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main() {
  const subject = (process.argv[2] ?? "biology").trim();
  const stem = (process.argv[3] ?? "labelled diagram of an animal cell").trim();

  const prompt = buildEducationalDiagramPrompt({
    subject,
    questionStem: stem,
    userQuery: `SPM ${subject} practice`,
  });

  console.log("Subject:", subject);
  console.log("Prompt:", prompt.slice(0, 200), "...");
  console.log("Calling image API...");

  const urls = await generateImage(prompt, {
    promptExtend: false,
    n: 1,
    negativePrompt: EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,
  });
  if (urls.length === 0) {
    console.error("No image URL returned. Check RAG_IMAGE_ENDPOINT and API key in .env");
    process.exit(1);
  }

  urls.forEach((url, i) => {
    console.log(`\nImage ${i + 1}:`);
    console.log(url.startsWith("data:") ? "(base64 data URL, length " + url.length + ")" : url);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
