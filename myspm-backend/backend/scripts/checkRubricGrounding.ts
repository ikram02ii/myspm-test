/**
 * Diagnostic: when a rubric (ACF) is built for a question, does its own
 * evidence retrieval pull textbook chunks (contextSource="textbook")?
 * Usage: npx tsx ./scripts/checkRubricGrounding.ts
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const QUESTIONS = [
  "State the meaning of an acid.",
  "Explain why ethanoic acid is a weak acid.",
  "State two factors that affect the rate of reaction.",
  "Describe how a catalyst affects the rate of reaction.",
];

async function main(): Promise<void> {
  const { buildAssessmentCaseFile } = await import(
    "../src/services/rag/grading/v3/buildAssessmentCase"
  );

  for (const q of QUESTIONS) {
    const acf = await buildAssessmentCaseFile({
      question: q,
      subject: "Chemistry",
      form: "Form 4",
      maxScore: 2,
    });
    console.log("\n" + "=".repeat(70));
    console.log("Q:", q);
    console.log("contextSource:", acf.contextSource);
    console.log("chunkRefs:", acf.chunkRefs.length, JSON.stringify(acf.chunkRefs));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
