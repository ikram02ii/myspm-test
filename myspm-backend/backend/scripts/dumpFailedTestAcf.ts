/**
 * Dump ACF rows from rag.rag_rubrics for failed test-marking.js cases.
 * Usage: npx tsx ./scripts/dumpFailedTestAcf.ts
 */

import * as dotenv from "dotenv";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

function normalizeQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionHash(subject: string, form: string, maxScore: number, question: string): string {
  const base = `${subject.toLowerCase()}|${form.toLowerCase()}|${maxScore}|${normalizeQuestion(question)}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 64);
}

const FAILED = [
  { label: "CHEM2-005", question: "Define atom.", maxScore: 2, expected: 2, actual: 1 },
  { label: "CHEM2-008", question: "State the charges of a proton, a neutron and an electron.", maxScore: 3, expected: 3, actual: 2 },
  { label: "CHEM2-009", question: "State the charges of a proton, a neutron and an electron.", maxScore: 3, expected: 3, actual: 2 },
  { label: "CHEM2-011", question: "Define proton number.", maxScore: 2, expected: 2, actual: 1 },
  { label: "CHEM2-012", question: "Define proton number.", maxScore: 2, expected: 2, actual: 1 },
  { label: "CHEM2-019", question: "State two subatomic particles found in the nucleus of an atom.", maxScore: 2, expected: 0, actual: 1 },
  { label: "CHEM2-022", question: "State the difference between an element and a compound.", maxScore: 2, expected: 0, actual: 1 },
  {
    label: "CHEM2-023",
    question:
      "Chlorine has two isotopes: chlorine-35 (75%) and chlorine-37 (25%). Calculate the relative atomic mass of chlorine.",
    maxScore: 3,
    expected: 3,
    actual: 2,
  },
  {
    label: "CHEM2-024",
    question:
      "Chlorine has two isotopes: chlorine-35 (75%) and chlorine-37 (25%). Calculate the relative atomic mass of chlorine.",
    maxScore: 3,
    expected: 2,
    actual: 0,
  },
  {
    label: "CHEM2-026",
    question:
      "Chlorine has two isotopes: chlorine-35 (75%) and chlorine-37 (25%). Calculate the relative atomic mass of chlorine.",
    maxScore: 3,
    expected: 3,
    actual: 2,
  },
  { label: "CHEM2-028", question: "State the electron arrangement of a sodium atom.", maxScore: 2, expected: 2, actual: 1 },
  { label: "CHEM2-029", question: "State the electron arrangement of a sodium atom.", maxScore: 2, expected: 2, actual: 1 },
];

async function main(): Promise<void> {
  const { ragDb, ragRubricsTable } = await import("../src/lib/ragDb");
  const { parseAssessmentCaseFromDbRow } = await import(
    "../src/services/rag/grading/v3/assessmentCaseService"
  );
  if (!ragDb) throw new Error("RAG database not configured");

  const subject = "Chemistry";
  const form = "4";
  const seen = new Set<string>();

  for (const f of FAILED) {
    const key = `${f.question}|${f.maxScore}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const qHash = questionHash(subject, form, f.maxScore, f.question);
    const rows = await ragDb
      .select()
      .from(ragRubricsTable)
      .where(eq(ragRubricsTable.questionHash, qHash))
      .limit(5);

    console.log("\n" + "=".repeat(72));
    console.log(
      "FAILED:",
      FAILED.filter((x) => x.question === f.question && x.maxScore === f.maxScore)
        .map((x) => `${x.label}(exp=${x.expected},got=${x.actual})`)
        .join(", "),
    );
    console.log("Question:", f.question);
    console.log("maxScore:", f.maxScore);
    console.log("questionHash:", qHash);
    console.log("Rows found:", rows.length);

    if (rows.length === 0) {
      const all = await ragDb
        .select({
          rubricId: ragRubricsTable.rubricId,
          questionText: ragRubricsTable.questionText,
          maxScore: ragRubricsTable.maxScore,
        })
        .from(ragRubricsTable)
        .where(eq(ragRubricsTable.subject, subject));

      const needle = f.question.slice(0, 24).toLowerCase();
      const partial = all.filter((r) => r.questionText.toLowerCase().includes(needle));
      console.log("No exact hash match. Partial matches:", partial.length);
      for (const p of partial.slice(0, 5)) {
        console.log(`  - ${p.rubricId} | max=${p.maxScore} | ${p.questionText}`);
      }
      continue;
    }

    for (const row of rows) {
      console.log("rubricId:", row.rubricId);
      console.log("questionType:", row.questionType);
      console.log("source:", row.source);
      const stored = parseAssessmentCaseFromDbRow(row);
      if (stored?.acf) {
        console.log("ACF:");
        console.log(JSON.stringify(stored.acf, null, 2));
      } else {
        console.log("ideas (raw, first 800 chars):", row.ideas?.slice(0, 800));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
