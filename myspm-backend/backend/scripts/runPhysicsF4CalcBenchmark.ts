/**
 * Physics Form 4 — 30 calculation grading benchmark (live LLM + DB).
 *
 * Usage:
 *   npm run test:physics-f4-calc
 *   npm run test:physics-f4-calc -- --limit 5
 *
 * Requires QWEN_GRADING_* and DATABASE_URL in .env.
 */
import * as dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SUBJECT = "Physics";
const FORM = "Form 4";
const BANK_PATH = join(__dirname, "fixtures/physicsF4Calc30.json");

type BenchCase = {
  id: string;
  label?: string;
  question: string;
  studentAnswer: string;
  maxScore: number;
  expectedMinScore: number;
  expectedMaxScore: number;
};

type Bank = { tests: BenchCase[] };

type RunResult = {
  id: string;
  label?: string;
  score: number;
  maxScore: number;
  pass: boolean;
  intentFamily?: string;
  markRule?: string;
  calcPolicy?: string;
  calcRoute?: boolean;
  errs: string[];
  matchedIdeas: string[];
  missingIdeas: string[];
};

function parseArgs(argv: string[]): { limit?: number } {
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      limit = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { limit };
}

function scoreOk(score: number, t: BenchCase): string[] {
  const errs: string[] = [];
  if (score < 0) errs.push("grading error");
  else if (score < t.expectedMinScore) errs.push(`score ${score} < min ${t.expectedMinScore}`);
  else if (score > t.expectedMaxScore) errs.push(`score ${score} > max ${t.expectedMaxScore}`);
  return errs;
}

async function gradeOne(t: BenchCase): Promise<RunResult> {
  const { gradeSubmission } = await import("../src/services/ama/grading/gradeService");
  const { getOrCreateAssessmentCase } = await import("../src/services/ama/grading/v3/assessmentCaseService");
  const { isCalculationIntent } = await import("../src/services/ama/grading/v3/calculationAcfPolicy");

  const result = await gradeSubmission({
    question: t.question,
    studentAnswer: t.studentAnswer,
    subject: SUBJECT,
    form: FORM,
    maxScore: t.maxScore,
    rubricVersion: "physics-f4-calc-bench",
  });

  const score = Number(result.score ?? 0);
  const errs = scoreOk(score, t);

  let intentFamily: string | undefined;
  let markRule: string | undefined;
  let calcPolicy: string | undefined;
  let calcRoute: boolean | undefined;
  try {
    const stored = await getOrCreateAssessmentCase({
      question: t.question,
      subject: SUBJECT,
      form: FORM,
      maxScore: t.maxScore,
    });
    intentFamily = stored.acf.intent.family;
    markRule = stored.acf.markRule.kind;
    calcPolicy = stored.acf.markRule.calcPolicy;
    calcRoute = isCalculationIntent(stored.acf);
    if (!calcRoute) errs.push(`expected calculation route but intent=${intentFamily}`);
  } catch {
    // metadata optional
  }

  return {
    id: t.id,
    label: t.label,
    score,
    maxScore: Number(result.maxScore ?? t.maxScore),
    pass: errs.length === 0,
    intentFamily,
    markRule,
    calcPolicy,
    calcRoute,
    errs,
    matchedIdeas: result.matchedIdeas ?? [],
    missingIdeas: result.missingIdeas ?? [],
  };
}

async function main(): Promise<void> {
  const { limit } = parseArgs(process.argv.slice(2));
  const bank = JSON.parse(readFileSync(BANK_PATH, "utf8")) as Bank;
  let tests = bank.tests;
  if (typeof limit === "number" && limit > 0) tests = tests.slice(0, limit);

  console.info("Physics Form 4 calculation benchmark");
  console.info(`  bank: ${BANK_PATH}`);
  console.info(`  count: ${tests.length}`);

  const results: RunResult[] = [];
  let passed = 0;
  let failed = 0;
  let notCalcRoute = 0;
  let errors = 0;

  for (const t of tests) {
    const heading = `${t.id}${t.label ? ` — ${t.label}` : ""}`;
    try {
      const r = await gradeOne(t);
      results.push(r);
      if (r.calcRoute === false) notCalcRoute += 1;
      if (r.score < 0) errors += 1;
      if (r.pass) passed += 1;
      else failed += 1;

      console.info(
        `\n${r.pass ? "✓" : "✗"} ${heading} → ${r.score}/${r.maxScore}` +
          (r.intentFamily ? ` intent=${r.intentFamily}` : "") +
          (r.calcPolicy ? ` policy=${r.calcPolicy}` : ""),
      );
      if (!r.pass) console.info(`   ${r.errs.join("; ")}`);
    } catch (err) {
      failed += 1;
      errors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        id: t.id,
        label: t.label,
        score: -1,
        maxScore: t.maxScore,
        pass: false,
        errs: [msg],
        matchedIdeas: [],
        missingIdeas: [],
      });
      console.info(`\n✗ ${heading} ERROR: ${msg}`);
    }
  }

  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "physicsF4CalcBenchmark.json");
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), subject: SUBJECT, form: FORM, results }, null, 2),
  );

  console.info("\n" + "═".repeat(60));
  console.info(`Done: ${passed}/${tests.length} passed, ${failed} failed`);
  console.info(`  calc route: ${tests.length - notCalcRoute}/${tests.length}`);
  console.info(`  API errors: ${errors}`);
  console.info(`  output: ${outPath}`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
