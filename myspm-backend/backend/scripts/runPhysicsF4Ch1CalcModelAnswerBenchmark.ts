/**
 * Physics Form 4 Chapter 1 — calculation MODEL ANSWER quality benchmark.
 *
 * Focus: student-facing worked exemplar (Formula / Working / Final answer),
 * not score accuracy (use theory bank for that).
 *
 * For each question, grades a weak student answer (so modelAnswer is emitted),
 * then checks:
 *   - complete Formula + Working + Final answer sections
 *   - no dirty LaTeX / literal \n
 *   - final numeric value (+ unit cue) present
 *   - formula hints appear somewhere in the exemplar
 *
 * Usage:
 *   npx tsx ./scripts/runPhysicsF4Ch1CalcModelAnswerBenchmark.ts
 *   npx tsx ./scripts/runPhysicsF4Ch1CalcModelAnswerBenchmark.ts --limit 5
 *   npx tsx ./scripts/runPhysicsF4Ch1CalcModelAnswerBenchmark.ts --dry
 *   npx tsx ./scripts/runPhysicsF4Ch1CalcModelAnswerBenchmark.ts --question P4C1C-03
 */
import * as dotenv from "dotenv";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SUBJECT = "Physics";
const FORM = "Form 4";
const CHAPTER = "Chapter 1";
const BANK_PATH = join(__dirname, "fixtures/physicsF4Ch1Calc30.json");
const OUT_DIR = join(__dirname, "output");

type ExpectedFinal = {
  value: number;
  unit: string;
  tolerance: number;
};

type BankQuestion = {
  id: string;
  topic: string;
  maxScore: number;
  question: string;
  expectedFinal: ExpectedFinal;
  expectedFormulaHints: string[];
  weakStudentAnswer: string;
};

type Bank = {
  meta: Record<string, unknown>;
  questions: BankQuestion[];
};

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1]?.trim() || undefined;
}

function argNum(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function loadBank(): Bank {
  return JSON.parse(readFileSync(BANK_PATH, "utf8")) as Bank;
}

function extractSection(text: string, label: string): string {
  const re = new RegExp(
    `(?:^|\\n)\\s*${label}\\s*:\\s*(.+?)(?=(?:\\n\\s*(?:Formula|Working|Final answer|Data)\\s*:)|$)`,
    "is",
  );
  const m = (text || "").match(re);
  return (m?.[1] || "").trim();
}

function parseFinalNumber(finalSection: string): number | null {
  const cleaned = finalSection
    .replace(/×\s*10\s*\^?\s*([+-]?\d+)/gi, (_, e) => `e${e}`)
    .replace(/x\s*10\s*\^?\s*([+-]?\d+)/gi, (_, e) => `e${e}`);
  const matches = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
  if (!matches || matches.length === 0) return null;
  // Prefer the last substantial number (final value usually last).
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = Number(matches[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function unitCuePresent(text: string, unit: string): boolean {
  const hay = text.toLowerCase().replace(/\s+/g, "");
  const variants = [
    unit.toLowerCase(),
    unit.toLowerCase().replace(/\s+/g, ""),
    unit.toLowerCase().replace(/\^|⁻/g, ""),
    unit.toLowerCase().replace("m^{-3}", "m-3").replace("m^{-1}", "m-1").replace("s^{-1}", "s-1"),
  ];
  // Loose: any alphanumeric token from the unit
  const tokens = unit
    .toLowerCase()
    .split(/[^a-z0-9µμ]+/i)
    .filter((t) => t.length >= 1);
  if (tokens.some((t) => hay.includes(t) && t !== "1")) return true;
  return variants.some((v) => v && hay.includes(v.replace(/[^a-z0-9/]/g, "")));
}

function hintsHit(text: string, hints: string[]): number {
  const hay = text.toLowerCase();
  let n = 0;
  for (const h of hints) {
    if (hay.includes(h.toLowerCase())) n += 1;
  }
  return n;
}

type Row = {
  questionId: string;
  topic: string;
  maxScore: number;
  modelAnswer: string;
  completeSections: boolean;
  dirty: boolean;
  hasFormula: boolean;
  hasWorking: boolean;
  hasFinal: boolean;
  finalNumber: number | null;
  finalNumberOk: boolean;
  unitOk: boolean;
  formulaHintHits: number;
  formulaHintOk: boolean;
  qualityPass: boolean;
  error?: string;
};

async function evaluateOne(q: BankQuestion): Promise<Row> {
  const base: Row = {
    questionId: q.id,
    topic: q.topic,
    maxScore: q.maxScore,
    modelAnswer: "",
    completeSections: false,
    dirty: false,
    hasFormula: false,
    hasWorking: false,
    hasFinal: false,
    finalNumber: null,
    finalNumberOk: false,
    unitOk: false,
    formulaHintHits: 0,
    formulaHintOk: false,
    qualityPass: false,
  };

  try {
    const { gradeSubmission } = await import("../src/services/ama/grading/gradeService.js");
    const { getOrCreateAssessmentCase } = await import(
      "../src/services/ama/grading/case/assessmentCaseService.js"
    );
    const { hasCompleteCalculationModelAnswerSections } = await import(
      "../src/services/ama/grading/case/calculationAcfPolicy.js"
    );
    const { calculationModelAnswerLooksDirty, normalizeCalculationModelAnswer } = await import(
      "../src/services/ama/grading/extraction/normalizeCalculationModelAnswer.js"
    );

    const stored = await getOrCreateAssessmentCase({
      question: q.question,
      subject: SUBJECT,
      form: FORM,
      maxScore: q.maxScore,
      chapterFilter: CHAPTER,
      chapterHint: "Measurement calculation",
    });

    // Weak answer → score < max so student-facing modelAnswer is returned.
    const result = await gradeSubmission({
      question: q.question,
      studentAnswer: q.weakStudentAnswer,
      subject: SUBJECT,
      form: FORM,
      maxScore: q.maxScore,
      rubricId: stored?.caseId,
      chapterFilter: CHAPTER,
      chapterHint: "Measurement",
      rubricVersion: "physics-f4-ch1-calc-ma-bench",
      questionType: "calculation",
    });

    let ma =
      (result.modelAnswer || "").trim() ||
      (stored?.acf?.referenceModelAnswer || "").trim() ||
      "";
    if (ma) ma = normalizeCalculationModelAnswer(ma);

    const formula = extractSection(ma, "Formula");
    const working = extractSection(ma, "Working");
    const finalSec = extractSection(ma, "Final answer");
    const complete = hasCompleteCalculationModelAnswerSections(ma);
    const dirty = calculationModelAnswerLooksDirty(ma);
    const finalNumber = parseFinalNumber(finalSec || ma);
    const finalNumberOk =
      finalNumber != null &&
      Math.abs(finalNumber - q.expectedFinal.value) <= Math.max(q.expectedFinal.tolerance, 1e-9);
    const unitOk = unitCuePresent(finalSec || ma, q.expectedFinal.unit);
    const formulaHintHits = hintsHit(ma, q.expectedFormulaHints);
    const formulaHintOk = formulaHintHits >= Math.min(1, q.expectedFormulaHints.length);

    const qualityPass =
      complete && !dirty && finalNumberOk && unitOk && formulaHintOk && Boolean(working);

    return {
      ...base,
      modelAnswer: ma,
      completeSections: complete,
      dirty,
      hasFormula: formula.length > 0,
      hasWorking: working.length > 0,
      hasFinal: finalSec.length > 0,
      finalNumber,
      finalNumberOk,
      unitOk,
      formulaHintHits,
      formulaHintOk,
      qualityPass,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const bank = loadBank();
  const dry = flag("dry");
  const questionFilter = arg("question");
  const limit = argNum("limit", Number.POSITIVE_INFINITY);

  let questions = bank.questions;
  if (questionFilter) questions = questions.filter((q) => q.id === questionFilter);
  if (Number.isFinite(limit)) questions = questions.slice(0, Math.max(0, limit));

  console.info("=".repeat(72));
  console.info("Physics Form 4 Chapter 1 — Calc MODEL ANSWER Quality");
  console.info(`Bank: ${BANK_PATH}`);
  console.info(`Questions: ${questions.length} / ${bank.questions.length}`);
  console.info("=".repeat(72));

  if (dry) {
    for (const q of questions) {
      console.info(`\n${q.id} [${q.topic}] ${q.maxScore} marks`);
      console.info(`  Q: ${q.question}`);
      console.info(
        `  Expect final ≈ ${q.expectedFinal.value} ${q.expectedFinal.unit} (±${q.expectedFinal.tolerance})`,
      );
    }
    return;
  }

  const { assertRagDatabaseEnv } = await import("../src/lib/ragDb.js");
  assertRagDatabaseEnv();

  const rows: Row[] = [];
  for (const q of questions) {
    process.stdout.write(`\n→ ${q.id} ... `);
    const row = await evaluateOne(q);
    rows.push(row);
    if (row.error) {
      console.info(`ERROR ${row.error}`);
      continue;
    }
    console.info(
      `${row.qualityPass ? "PASS" : "FAIL"} | sections ${row.completeSections ? "✓" : "✗"}` +
        ` dirty ${row.dirty ? "✗" : "✓"} final ${row.finalNumberOk ? "✓" : "✗"}` +
        `(${row.finalNumber}) unit ${row.unitOk ? "✓" : "✗"} hints ${row.formulaHintHits}`,
    );
    console.info(`   MA:\n${(row.modelAnswer || "(empty)").split("\n").map((l) => `   ${l}`).join("\n")}`);
  }

  const graded = rows.filter((r) => !r.error);
  const pass = graded.filter((r) => r.qualityPass).length;
  const completeN = graded.filter((r) => r.completeSections).length;
  const cleanN = graded.filter((r) => !r.dirty).length;
  const finalN = graded.filter((r) => r.finalNumberOk).length;
  const unitN = graded.filter((r) => r.unitOk).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    subject: SUBJECT,
    form: FORM,
    chapter: CHAPTER,
    questionCount: questions.length,
    graded: graded.length,
    qualityPassRate: graded.length ? pass / graded.length : null,
    qualityPass: pass,
    completeSectionsRate: graded.length ? completeN / graded.length : null,
    cleanTextRate: graded.length ? cleanN / graded.length : null,
    finalNumberRate: graded.length ? finalN / graded.length : null,
    unitRate: graded.length ? unitN / graded.length : null,
    failures: graded
      .filter((r) => !r.qualityPass)
      .map((r) => ({
        id: r.questionId,
        completeSections: r.completeSections,
        dirty: r.dirty,
        finalNumber: r.finalNumber,
        finalNumberOk: r.finalNumberOk,
        unitOk: r.unitOk,
        formulaHintOk: r.formulaHintOk,
        preview: r.modelAnswer.slice(0, 280),
      })),
    results: rows,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "physicsF4Ch1CalcModelAnswerBenchmark.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");

  console.info("\n" + "=".repeat(72));
  console.info("SUMMARY — Calculation model answer quality");
  console.info(`  Graded              : ${graded.length}`);
  console.info(
    `  Overall quality pass: ${pass}/${graded.length}` +
      (graded.length ? ` (${((pass / graded.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(
    `  Complete F/W/Final  : ${completeN}/${graded.length}` +
      (graded.length ? ` (${((completeN / graded.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(
    `  Clean text (no junk): ${cleanN}/${graded.length}` +
      (graded.length ? ` (${((cleanN / graded.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(
    `  Final number match  : ${finalN}/${graded.length}` +
      (graded.length ? ` (${((finalN / graded.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(
    `  Unit cue present    : ${unitN}/${graded.length}` +
      (graded.length ? ` (${((unitN / graded.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(`  Report              : ${outPath}`);
  console.info("=".repeat(72));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
