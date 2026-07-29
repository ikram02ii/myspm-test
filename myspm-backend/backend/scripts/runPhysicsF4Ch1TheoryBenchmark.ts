/**
 * Physics Form 4 Chapter 1 (Measurement) — theory marking accuracy benchmark.
 *
 * Builds/loads an assessment case per question, grades each student trial, and
 * reports: score match, model-answer point count, feedback zero-truth, cards.
 *
 * Usage:
 *   npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts
 *   npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --limit 5
 *   npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --question P4C1-01
 *   npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --dry
 *   npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --structureOnly
 *
 * Requires RAG DB + Qwen env (same as live grading).
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
const BANK_PATH = join(__dirname, "fixtures/physicsF4Ch1Theory30.json");
const OUT_DIR = join(__dirname, "output");

type Trial = {
  id: string;
  studentAnswer: string;
  expectedScore: number;
};

type BankQuestion = {
  id: string;
  topic: string;
  maxScore: number;
  question: string;
  expectedMarkingPoints: string[];
  trials: Trial[];
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

type TrialResult = {
  questionId: string;
  trialId: string;
  maxScore: number;
  expectedScore: number;
  actualScore: number | null;
  scoreOk: boolean | null;
  modelAnswerPointCount: number | null;
  expectedPointCount: number;
  pointsOk: boolean | null;
  modelAnswerPreview: string;
  feedbackPreview: string;
  feedbackOkForZero: boolean | null;
  error?: string;
};

async function gradeOne(
  q: BankQuestion,
  trial: Trial,
  structureOnly: boolean,
): Promise<TrialResult> {
  const base: TrialResult = {
    questionId: q.id,
    trialId: trial.id,
    maxScore: q.maxScore,
    expectedScore: trial.expectedScore,
    actualScore: null,
    scoreOk: null,
    modelAnswerPointCount: null,
    expectedPointCount: q.expectedMarkingPoints.length || q.maxScore,
    pointsOk: null,
    modelAnswerPreview: "",
    feedbackPreview: "",
    feedbackOkForZero: null,
  };

  try {
    const { gradeSubmission } = await import("../src/services/ama/grading/gradeService.js");
    const { getOrCreateAssessmentCase } = await import(
      "../src/services/ama/grading/case/assessmentCaseService.js"
    );
    const { splitModelAnswerIntoPoints } = await import(
      "../src/services/ama/grading/extraction/splitModelAnswerPoints.js"
    );

    const stored = await getOrCreateAssessmentCase({
      question: q.question,
      subject: SUBJECT,
      form: FORM,
      maxScore: q.maxScore,
      chapterFilter: CHAPTER,
      chapterHint: "Measurement / Physical Quantities / Scientific Investigation",
    });

    if (structureOnly && trial.id !== "full") {
      // Still need one grade call per question to inspect model answer; skip non-full trials.
      return { ...base, error: "skipped (structureOnly uses full trial only)" };
    }

    const result = await gradeSubmission({
      question: q.question,
      studentAnswer: trial.studentAnswer,
      subject: SUBJECT,
      form: FORM,
      maxScore: q.maxScore,
      rubricId: stored?.caseId,
      chapterFilter: CHAPTER,
      chapterHint: "Measurement",
      rubricVersion: "physics-f4-ch1-theory-bench",
    });

    const cards = result.modelAnswerPointCards ?? [];
    const points =
      cards.length > 0
        ? cards.map((c) => c.text)
        : result.modelAnswerPoints?.length
          ? result.modelAnswerPoints
          : splitModelAnswerIntoPoints(result.modelAnswer || "", q.maxScore);

    const pointCount = points.length;
    const actualScore = result.score;
    const scoreOk = actualScore === trial.expectedScore;
    const pointsOk = pointCount === q.maxScore || pointCount === q.expectedMarkingPoints.length;

    let feedbackOkForZero: boolean | null = null;
    if (trial.expectedScore === 0 && actualScore === 0) {
      const fb = (result.feedback || "").toLowerCase();
      feedbackOkForZero = !/(right track|good start|almost there|needs more detail)/i.test(fb);
    }

    return {
      ...base,
      actualScore,
      scoreOk,
      modelAnswerPointCount: pointCount,
      pointsOk,
      modelAnswerPreview: (result.modelAnswer || points.join(" | ")).slice(0, 240),
      feedbackPreview: (result.feedback || "").slice(0, 180),
      feedbackOkForZero,
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
  const structureOnly = flag("structureOnly");
  const questionFilter = arg("question");
  const limit = argNum("limit", Number.POSITIVE_INFINITY);

  let questions = bank.questions;
  if (questionFilter) {
    questions = questions.filter((q) => q.id === questionFilter);
  }
  if (Number.isFinite(limit)) {
    questions = questions.slice(0, Math.max(0, limit));
  }

  console.info("=".repeat(72));
  console.info("Physics Form 4 Chapter 1 — Theory Marking Benchmark");
  console.info(`Bank: ${BANK_PATH}`);
  console.info(`Questions: ${questions.length} / ${bank.questions.length}`);
  console.info(`Mode: ${dry ? "dry (list only)" : structureOnly ? "structureOnly" : "full grade"}`);
  console.info("=".repeat(72));

  if (dry) {
    for (const q of questions) {
      console.info(`\n${q.id} [${q.topic}] ${q.maxScore} marks`);
      console.info(`  Q: ${q.question}`);
      console.info(`  Expected points (${q.expectedMarkingPoints.length}):`);
      for (const [i, p] of q.expectedMarkingPoints.entries()) {
        console.info(`    ${i + 1}. ${p}`);
      }
      console.info(`  Trials: ${q.trials.map((t) => `${t.id}→${t.expectedScore}`).join(", ")}`);
    }
    return;
  }

  const { assertRagDatabaseEnv } = await import("../src/lib/ragDb.js");
  assertRagDatabaseEnv();

  const results: TrialResult[] = [];
  for (const q of questions) {
    const trials = structureOnly
      ? q.trials.filter((t) => t.id === "full").slice(0, 1)
      : q.trials;

    for (const trial of trials) {
      process.stdout.write(`\n→ ${q.id}/${trial.id} ... `);
      const row = await gradeOne(q, trial, structureOnly);
      results.push(row);
      if (row.error && !row.error.startsWith("skipped")) {
        console.info(`ERROR ${row.error}`);
      } else if (row.error) {
        console.info(row.error);
      } else {
        console.info(
          `score ${row.actualScore}/${row.maxScore} (expect ${row.expectedScore}) ` +
            `${row.scoreOk ? "✓" : "✗"} | points ${row.modelAnswerPointCount} ` +
            `${row.pointsOk ? "✓" : "✗"}`,
        );
        if (row.feedbackPreview) console.info(`   feedback: ${row.feedbackPreview}`);
        if (row.modelAnswerPreview) console.info(`   model: ${row.modelAnswerPreview}`);
      }
    }
  }

  const scored = results.filter((r) => r.scoreOk !== null && !r.error);
  const scoreHits = scored.filter((r) => r.scoreOk).length;
  const pointHits = scored.filter((r) => r.pointsOk).length;
  const zeroFb = results.filter((r) => r.feedbackOkForZero !== null);
  const zeroFbHits = zeroFb.filter((r) => r.feedbackOkForZero).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    subject: SUBJECT,
    form: FORM,
    chapter: CHAPTER,
    questionCount: questions.length,
    trialCount: scored.length,
    scoreAccuracy: scored.length ? scoreHits / scored.length : null,
    scoreHits,
    pointCountAccuracy: scored.length ? pointHits / scored.length : null,
    pointHits,
    zeroFeedbackOkRate: zeroFb.length ? zeroFbHits / zeroFb.length : null,
    mismatches: scored
      .filter((r) => !r.scoreOk || !r.pointsOk)
      .map((r) => ({
        id: `${r.questionId}/${r.trialId}`,
        expectedScore: r.expectedScore,
        actualScore: r.actualScore,
        pointCount: r.modelAnswerPointCount,
        expectedPoints: r.expectedPointCount,
        feedback: r.feedbackPreview,
      })),
    results,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "physicsF4Ch1TheoryBenchmark.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");

  console.info("\n" + "=".repeat(72));
  console.info("SUMMARY");
  console.info(`  Trials graded     : ${scored.length}`);
  console.info(
    `  Score accuracy    : ${scoreHits}/${scored.length}` +
      (scored.length ? ` (${((scoreHits / scored.length) * 100).toFixed(1)}%)` : ""),
  );
  console.info(
    `  Point-count match : ${pointHits}/${scored.length}` +
      (scored.length ? ` (${((pointHits / scored.length) * 100).toFixed(1)}%)` : ""),
  );
  if (zeroFb.length) {
    console.info(
      `  Zero-feedback OK  : ${zeroFbHits}/${zeroFb.length}` +
        ` (${((zeroFbHits / zeroFb.length) * 100).toFixed(1)}%)`,
    );
  }
  console.info(`  Report            : ${outPath}`);
  console.info("=".repeat(72));

  if (summary.mismatches.length > 0) {
    console.info("\nMismatches:");
    for (const m of summary.mismatches.slice(0, 20)) {
      console.info(
        `  - ${m.id}: score ${m.actualScore} (expect ${m.expectedScore}), points ${m.pointCount} (expect ${m.expectedPoints})`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
