/**
 * Show the REAL grounding of saved rubrics: the `source` column is always
 * "llm_generated" for AI questions, but textbook-grounding is the ACF
 * `contextSource` (textbook | llm_fallback) + chunkRefs. This prints both.
 * Usage: npx tsx ./scripts/inspectRubricGrounding.ts
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desc } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function main(): Promise<void> {
  const { ragDb, ragRubricsTable } = await import("../src/lib/ragDb");
  const { parseAssessmentCaseFromDbRow } = await import(
    "../src/services/rag/grading/v3/assessmentCaseService"
  );
  if (!ragDb) throw new Error("RAG database not configured");

  const rows = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      questionText: ragRubricsTable.questionText,
      source: ragRubricsTable.source,
      ideas: ragRubricsTable.ideas,
      sourceRef: ragRubricsTable.sourceRef,
      maxScore: ragRubricsTable.maxScore,
    })
    .from(ragRubricsTable)
    .orderBy(desc(ragRubricsTable.updatedAt))
    .limit(20);

  console.log(`\nShowing ${rows.length} most recent rubrics:\n`);
  let textbook = 0;
  let fallback = 0;
  for (const row of rows) {
    const stored = parseAssessmentCaseFromDbRow(row as any);
    const cs = stored?.acf.contextSource ?? "(unparsed)";
    const refs = stored?.acf.chunkRefs?.length ?? 0;
    if (cs === "textbook") textbook++;
    else if (cs === "llm_fallback") fallback++;
    console.log(`- [source=${row.source}] [contextSource=${cs}] [chunks=${refs}]`);
    console.log(`    ${row.questionText.slice(0, 90)}`);
  }
  console.log(`\nSummary of recent 20: textbook=${textbook}, llm_fallback=${fallback}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
