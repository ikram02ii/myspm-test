/**
 * Dump stored ACF for failed Chem F4 calc benchmark questions.
 * npx tsx ./scripts/inspectChemF4FailedCalcAcf.ts
 */
import * as dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SUBJECT = "Chemistry";
const FORM = "Form 4";

const FAILED_IDS = [
  "calc-mass-nacl-full",
  "calc-mass-nacl-no-formula",
  "calc-particles-full",
  "calc-mr-full",
  "calc-answer-only-1mk",
];

type BenchCase = {
  id: string;
  question: string;
  studentAnswer: string;
  maxScore: number;
};

async function main() {
  const bank = JSON.parse(
    readFileSync(join(__dirname, "fixtures/chemF4CalcTheory30.json"), "utf8"),
  ) as { tests: BenchCase[] };

  const { getOrCreateAssessmentCase, getReferenceModelAnswer } = await import(
    "../src/services/ama/grading/v3/assessmentCaseService.js"
  );
  const { evaluateCalculationUnderstanding } = await import(
    "../src/services/ama/grading/v3/evaluateCalculationUnderstanding.js"
  );
  const { reconcileCalculationDemonstration } = await import(
    "../src/services/ama/grading/v3/reconcileCalculationDemonstration.js"
  );
  const { scoreFromDemonstration } = await import(
    "../src/services/ama/grading/v3/scoreFromDemonstration.js"
  );

  const out: unknown[] = [];

  for (const id of FAILED_IDS) {
    const t = bank.tests.find((x) => x.id === id);
    if (!t) continue;

    const stored = await getOrCreateAssessmentCase({
      question: t.question,
      subject: SUBJECT,
      form: FORM,
      maxScore: t.maxScore,
    });

    const acf = stored.acf;
    const reference =
      acf.referenceModelAnswer?.trim() || getReferenceModelAnswer(stored.sourceRef) || null;

    const rawUdm = await evaluateCalculationUnderstanding({
      question: t.question,
      studentAnswer: t.studentAnswer,
      acf,
      referenceModelAnswer: reference ?? undefined,
    });

    const udm = reconcileCalculationDemonstration({
      question: t.question,
      studentAnswer: t.studentAnswer,
      acf,
      udm: rawUdm,
      referenceModelAnswer: reference ?? undefined,
    });

    const scored = scoreFromDemonstration(acf, udm);

    out.push({
      id,
      question: t.question,
      studentAnswer: t.studentAnswer,
      caseId: stored.caseId,
      intent: acf.intent,
      markRule: acf.markRule,
      referenceModelAnswer: reference,
      creditUnits: acf.units
        .filter((u) => u.creditWeight > 0)
        .map((u) => ({
          id: u.id,
          type: u.type,
          weight: u.creditWeight,
          content: u.content,
          aliases: u.aliases,
        })),
      llmRawDemonstrated: rawUdm.unitsDemonstrated,
      afterReconcile: udm.unitsDemonstrated,
      invalidClaims: udm.invalidClaims,
      score: scored.score,
      markBreakdown: scored.markBreakdown,
    });
  }

  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "chemF4FailedCalcAcfInspect.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.info(`Wrote ${path}`);

  for (const row of out as { id: string; creditUnits: { id: string; content: string; weight: number }[]; score: number; afterReconcile: { unitId: string; valid: boolean; quote: string }[] }[]) {
    console.info(`\n=== ${row.id} score=${row.score} ===`);
    console.info("ACF stages:");
    for (const u of row.creditUnits) {
      console.info(`  ${u.id} (${u.weight}mk): ${u.content}`);
    }
    console.info("UDM after reconcile:");
    for (const d of row.afterReconcile) {
      console.info(`  ${d.unitId} valid=${d.valid}: "${d.quote}"`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
