/**
 * Chemistry Form 4 — calculation vs theory grading benchmark (live LLM + DB).
 *
 * Usage:
 *   npm run test:chem-f4-calc-theory
 *   npm run test:chem-f4-calc-theory -- --mode calc-only
 *   npm run test:chem-f4-calc-theory -- --mode mixed
 *   npm run test:chem-f4-calc-theory -- --limit 5
 *
 * Requires QWEN_GRADING_* and DATABASE_URL in .env.
 */
import * as dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SUBJECT = "Chemistry";
const FORM = "Form 4";
const BANK_PATH = join(__dirname, "fixtures/chemF4CalcTheory30.json");

type TestKind = "calculation" | "theory";

type BenchCase = {
  id: string;
  kind: TestKind;
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
  kind: TestKind;
  label?: string;
  score: number;
  maxScore: number;
  pass: boolean;
  intentFamily?: string;
  markRule?: string;
  calcRoute?: boolean;
  errs: string[];
  matchedIdeas: string[];
  missingIdeas: string[];
};

function parseArgs(argv: string[]): { mode: "all" | "calc-only" | "theory-only" | "mixed"; limit?: number } {
  let mode: "all" | "calc-only" | "theory-only" | "mixed" = "all";
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode" && argv[i + 1]) {
      const m = argv[i + 1] as typeof mode;
      if (["all", "calc-only", "theory-only", "mixed"].includes(m)) mode = m;
      i += 1;
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Number(argv[i + 1]);
      i += 1;
    }
  }

  return { mode, limit };
}

function scoreOk(score: number, t: BenchCase): string[] {
  const errs: string[] = [];
  if (score < t.expectedMinScore) errs.push(`score ${score} < min ${t.expectedMinScore}`);
  if (score > t.expectedMaxScore) errs.push(`score ${score} > max ${t.expectedMaxScore}`);
  return errs;
}

function interleaveMixed(tests: BenchCase[]): BenchCase[] {
  const calc = tests.filter((t) => t.kind === "calculation");
  const theory = tests.filter((t) => t.kind === "theory");
  const out: BenchCase[] = [];
  const n = Math.max(calc.length, theory.length);
  for (let i = 0; i < n; i += 1) {
    if (i < calc.length) out.push(calc[i]!);
    if (i < theory.length) out.push(theory[i]!);
  }
  return out;
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
    rubricVersion: "chem-f4-bench",
  });

  const score = Number(result.score ?? 0);
  const errs = scoreOk(score, t);

  let intentFamily: string | undefined;
  let markRule: string | undefined;
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
    calcRoute = isCalculationIntent(stored.acf);
    if (t.kind === "calculation" && !calcRoute) {
      errs.push(`expected calculation route but intent=${intentFamily}`);
    }
    if (t.kind === "theory" && calcRoute) {
      errs.push(`expected theory route but got calculation intent`);
    }
  } catch {
    // non-fatal metadata
  }

  return {
    id: t.id,
    kind: t.kind,
    label: t.label,
    score,
    maxScore: Number(result.maxScore ?? t.maxScore),
    pass: errs.length === 0,
    intentFamily,
    markRule,
    calcRoute,
    errs,
    matchedIdeas: result.matchedIdeas ?? [],
    missingIdeas: result.missingIdeas ?? [],
  };
}

async function runBatch(label: string, tests: BenchCase[]): Promise<RunResult[]> {
  console.info(`\n${"═".repeat(70)}`);
  console.info(`Batch: ${label} (${tests.length} questions)`);
  console.info("═".repeat(70));

  const results: RunResult[] = [];
  for (const t of tests) {
    const heading = `${t.id}${t.label ? ` — ${t.label}` : ""}`;
    try {
      const r = await gradeOne(t);
      results.push(r);
      console.info(
        `\n${r.pass ? "✓" : "✗"} ${heading} [${t.kind}] → ${r.score}/${r.maxScore}` +
          (r.intentFamily ? ` intent=${r.intentFamily}` : "") +
          (r.calcRoute != null ? ` calcRoute=${r.calcRoute}` : ""),
      );
      if (!r.pass) console.info(`   fail: ${r.errs.join("; ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        id: t.id,
        kind: t.kind,
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
  return results;
}

function summarize(kind: string, results: RunResult[]) {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.info(`\n── ${kind}: ${pass}/${results.length} passed, ${fail} failed`);
  return { pass, fail, total: results.length };
}

function compareCalcRuns(alone: RunResult[], mixed: RunResult[]) {
  console.info("\n── Calc score comparison (alone vs mixed batch)");
  const mixedById = new Map(mixed.map((r) => [r.id, r]));
  let drift = 0;
  for (const a of alone) {
    const m = mixedById.get(a.id);
    if (!m) continue;
    const delta = m.score - a.score;
    const flag = delta !== 0 ? " ⚠ drift" : "";
    if (delta !== 0) drift += 1;
    console.info(`   ${a.id}: alone=${a.score} mixed=${m.score}${flag}`);
  }
  console.info(`   drift count: ${drift}/${alone.length}`);
}

async function main(): Promise<void> {
  const { mode, limit } = parseArgs(process.argv.slice(2));
  const bank = JSON.parse(readFileSync(BANK_PATH, "utf8")) as Bank;
  const all = bank.tests;
  const calc = all.filter((t) => t.kind === "calculation");
  const theory = all.filter((t) => t.kind === "theory");
  const mixed = interleaveMixed(all);

  console.info("Chemistry Form 4 calc + theory benchmark");
  console.info(`  bank: ${BANK_PATH}`);
  console.info(`  total: ${all.length} (${calc.length} calc, ${theory.length} theory)`);
  console.info(`  mode: ${mode}`);

  const applyLimit = (arr: BenchCase[]) =>
    typeof limit === "number" && limit > 0 ? arr.slice(0, limit) : arr;

  let calcAlone: RunResult[] = [];
  let mixedResults: RunResult[] = [];
  let theoryResults: RunResult[] = [];

  if (mode === "all" || mode === "calc-only") {
    calcAlone = await runBatch("calculation only", applyLimit(calc));
    summarize("calculation only", calcAlone);
  }

  if (mode === "all" || mode === "theory-only") {
    theoryResults = await runBatch("theory only", applyLimit(theory));
    summarize("theory only", theoryResults);
  }

  if (mode === "all" || mode === "mixed") {
    mixedResults = await runBatch("mixed calc+theory (interleaved)", applyLimit(mixed));
    const calcInMixed = mixedResults.filter((r) => r.kind === "calculation");
    const theoryInMixed = mixedResults.filter((r) => r.kind === "theory");
    summarize("mixed — calculation", calcInMixed);
    summarize("mixed — theory", theoryInMixed);
    summarize("mixed — all", mixedResults);
  }

  if ((mode === "all" || mode === "mixed") && calcAlone.length > 0 && mixedResults.length > 0) {
    compareCalcRuns(
      calcAlone,
      mixedResults.filter((r) => r.kind === "calculation"),
    );
  }

  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "chemF4CalcTheoryBenchmark.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        calcAlone,
        theoryOnly: theoryResults,
        mixed: mixedResults,
      },
      null,
      2,
    ),
  );
  console.info(`\nResults written to ${outPath}`);

  const failed =
    calcAlone.filter((r) => !r.pass).length +
    theoryResults.filter((r) => !r.pass).length +
    (mode === "mixed" || mode === "all" ? mixedResults.filter((r) => !r.pass).length : 0);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
