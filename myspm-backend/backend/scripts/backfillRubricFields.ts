/**
 * Idempotent backfill of rubric row metadata (kind, openEnded, demandType, keywords).
 * No LLM calls. Safe to run multiple times.
 *
 * npx tsx scripts/backfillRubricFields.ts
 */

import * as dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ragDb, ragRubricsTable } from "../src/lib/ragDb";
import { analyzeQuestion } from "../src/services/rag/questionAnalysisService";
import { finalizeRubricIdeas } from "../src/services/rag/rubricService";
import type { RubricIdea } from "../src/services/rag/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function parseIdeas(text: string): RubricIdea[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as RubricIdea[]) : [];
  } catch {
    return [];
  }
}

function ideasChanged(before: RubricIdea[], after: RubricIdea[]): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function main(): Promise<void> {
  const rows = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionText: ragRubricsTable.questionText,
      subject: ragRubricsTable.subject,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
    })
    .from(ragRubricsTable);

  let updated = 0;
  let clean = 0;

  for (const row of rows) {
    const before = parseIdeas(row.ideas);
    if (before.length === 0) {
      clean += 1;
      continue;
    }
    const analysis = analyzeQuestion(row.questionText, row.subject);
    const after = finalizeRubricIdeas(before, row.questionText, row.maxScore, analysis, row.subject);
    if (!ideasChanged(before, after)) {
      clean += 1;
      continue;
    }
    await ragDb.update(ragRubricsTable).set({ ideas: JSON.stringify(after) }).where(eq(ragRubricsTable.rubricId, row.rubricId));
    updated += 1;
  }

  console.log(
    `backfillRubricFields: checked=${rows.length} updated=${updated} already_clean=${clean}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
