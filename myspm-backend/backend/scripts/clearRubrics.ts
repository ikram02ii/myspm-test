/**
 * Inspect / clear saved rubrics (ACFs) in rag.rag_rubrics.
 *
 * Usage:
 *   npx tsx ./scripts/clearRubrics.ts                 -> COUNT only (safe, no delete)
 *   npx tsx ./scripts/clearRubrics.ts --subject=Chemistry --form="Form 4"  -> count filtered
 *   npx tsx ./scripts/clearRubrics.ts --delete        -> DELETE matching rows
 *
 * Add filters with --subject= and --form= ; without them it targets ALL rows.
 */

import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql, type SQL } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function getArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/^"|"$/g, "") : undefined;
}

async function main(): Promise<void> {
  const doDelete = process.argv.includes("--delete");
  const subject = getArg("subject");
  const form = getArg("form");

  const { ragDb, ragRubricsTable } = await import("../src/lib/ragDb");
  if (!ragDb) throw new Error("RAG database not configured");

  const filters: SQL[] = [];
  if (subject) filters.push(eq(ragRubricsTable.subject, subject));
  if (form) filters.push(eq(ragRubricsTable.form, form));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const totalRows = await ragDb
    .select({ c: sql<number>`count(*)` })
    .from(ragRubricsTable);
  console.log(`Total rubrics in table: ${totalRows[0]?.c ?? 0}`);

  const matchRows = where
    ? await ragDb.select({ c: sql<number>`count(*)` }).from(ragRubricsTable).where(where)
    : totalRows;
  console.log(
    `Rows matching filter (subject=${subject ?? "ANY"}, form=${form ?? "ANY"}): ${matchRows[0]?.c ?? 0}`,
  );

  const breakdown = await ragDb
    .select({
      subject: ragRubricsTable.subject,
      form: ragRubricsTable.form,
      c: sql<number>`count(*)`,
    })
    .from(ragRubricsTable)
    .groupBy(ragRubricsTable.subject, ragRubricsTable.form);
  console.log("\nBreakdown by subject | form:");
  for (const b of breakdown) console.log(`  ${b.subject} | ${b.form} | ${b.c}`);

  if (!doDelete) {
    console.log("\n(No --delete flag — nothing deleted. Re-run with --delete to remove the matching rows.)");
    process.exit(0);
  }

  const result = where
    ? await ragDb.delete(ragRubricsTable).where(where)
    : await ragDb.delete(ragRubricsTable);
  console.log(`\nDELETED matching rubrics. (${(result as { rowCount?: number }).rowCount ?? "?"} rows)`);

  const after = await ragDb.select({ c: sql<number>`count(*)` }).from(ragRubricsTable);
  console.log(`Rubrics remaining in table: ${after[0]?.c ?? 0}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
