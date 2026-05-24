import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const EQ_Q =
  /\b(half[\s-]?equation|setengah\s+persamaan|balanced\s+equation|ionic\s+equation|word\s+equation|write\s+the\s+equation|persamaan|→|->)\b/i;

async function main(): Promise<void> {
  const subject = "Chemistry";
  const { ragDb, ragRubricsTable } = await import("../src/lib/ragDb");
  const { parseRubricIdeas } = await import("../src/services/rag/rubricService");
  const { analyzeQuestion } = await import("../src/services/rag/questionAnalysisService");

  const rows = await ragDb
    .select({
      rubricId: ragRubricsTable.rubricId,
      questionText: ragRubricsTable.questionText,
      maxScore: ragRubricsTable.maxScore,
      ideas: ragRubricsTable.ideas,
      source: ragRubricsTable.source,
    })
    .from(ragRubricsTable)
    .where(eq(ragRubricsTable.subject, subject));

  let eqQuestions = 0;
  const kindCounts = new Map<string, number>();
  let rowsWithEquationKind = 0;
  let rowsWithPointKindOnEqQ = 0;
  let rowsWithExplanationKind = 0;
  let totalRowsOnEqQ = 0;
  let hasEquationType = 0;
  let hasDemandTypeEquation = 0;
  let hasKeywords = 0;
  let hasAcceptedConcepts = 0;
  const samples: Array<{ rubricId: string; question: string; ideas: unknown[] }> = [];

  for (const row of rows) {
    const q = row.questionText;
    if (!EQ_Q.test(q) && !analyzeQuestion(q, subject).isEquationQuestion) continue;
    eqQuestions += 1;
    let ideas: ReturnType<typeof parseRubricIdeas>;
    try {
      ideas = parseRubricIdeas(row.ideas);
    } catch {
      continue;
    }
    if (samples.length < 6) {
      samples.push({
        rubricId: row.rubricId,
        question: q.slice(0, 120),
        ideas: ideas.map((i) => ({
          id: i.id,
          idea: i.idea.slice(0, 80),
          marks: i.marks,
          kind: i.kind,
          demandType: i.demandType,
          equationType: i.equationType,
          keywords: i.keywords?.slice(0, 6),
          acceptedConcepts: i.acceptedConcepts?.slice(0, 4),
        })),
      });
    }
    for (const idea of ideas) {
      totalRowsOnEqQ += 1;
      kindCounts.set(idea.kind, (kindCounts.get(idea.kind) ?? 0) + 1);
      if (idea.kind === "equation") rowsWithEquationKind += 1;
      if (idea.kind === "point") rowsWithPointKindOnEqQ += 1;
      if (idea.kind === "explanation") rowsWithExplanationKind += 1;
      if (idea.equationType) hasEquationType += 1;
      if (idea.demandType === "equation") hasDemandTypeEquation += 1;
      if (idea.keywords && idea.keywords.length > 0) hasKeywords += 1;
      if (idea.acceptedConcepts && idea.acceptedConcepts.length > 0) hasAcceptedConcepts += 1;
    }
  }

  console.log(`Chemistry rubrics total: ${rows.length}`);
  console.log(`Equation-like questions: ${eqQuestions}`);
  console.log(`Rubric rows on those questions: ${totalRowsOnEqQ}`);
  console.log(`Rows kind=equation: ${rowsWithEquationKind} (${pct(rowsWithEquationKind, totalRowsOnEqQ)})`);
  console.log(`Rows kind=point: ${rowsWithPointKindOnEqQ} (${pct(rowsWithPointKindOnEqQ, totalRowsOnEqQ)})`);
  console.log(`Rows kind=explanation: ${rowsWithExplanationKind}`);
  console.log(`Rows with equationType set: ${hasEquationType}`);
  console.log(`Rows with demandType=equation: ${hasDemandTypeEquation}`);
  console.log(`Rows with keywords[]: ${hasKeywords} (${pct(hasKeywords, totalRowsOnEqQ)})`);
  console.log(`Rows with acceptedConcepts[]: ${hasAcceptedConcepts}`);
  console.log("\nKind distribution (equation questions):");
  for (const [k, n] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${k}`);
  }
  console.log("\nSamples:");
  console.log(JSON.stringify(samples, null, 2));
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${((100 * n) / d).toFixed(1)}%`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
