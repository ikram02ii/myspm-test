/**
 * AMA (Evidence-Centric Assessment) marking test runner.
 *
 * Usage (from myspm-backend/backend):
 *   npm run test:ama-marking
 *   npm run test:ama-marking -- --id bio-nucleus-full-1
 *   npm run test:ama-marking -- --http
 *
 * Requires QWEN_GRADING_* and DATABASE_URL in .env.
 * For --http mode, backend must be running (npm run dev).
 */

import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

type AmaTestCase = {
  id: string;
  label?: string;
  subject: string;
  form: string;
  question: string;
  studentAnswer: string;
  maxScore: number;
  rubricId?: string;
  expectedMinScore?: number;
  expectedMaxScore?: number;
  notes?: string;
};

type TestBank = { tests: AmaTestCase[] };

function parseArgs(argv: string[]): { filterId?: string; useHttp: boolean; baseUrl: string } {
  let filterId: string | undefined;
  let useHttp = false;
  let baseUrl = process.env["AMA_TEST_BASE_URL"] ?? "http://localhost:3000/api/rag/grade";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--http") useHttp = true;
    else if (arg === "--id" && argv[i + 1]) {
      filterId = argv[i + 1];
      i += 1;
    } else if (arg === "--url" && argv[i + 1]) {
      baseUrl = argv[i + 1]!;
      i += 1;
    }
  }

  return { filterId, useHttp, baseUrl };
}

function scoreInRange(score: number, t: AmaTestCase): string[] {
  const errs: string[] = [];
  if (typeof t.expectedMinScore === "number" && score < t.expectedMinScore) {
    errs.push(`score ${score} < expectedMin ${t.expectedMinScore}`);
  }
  if (typeof t.expectedMaxScore === "number" && score > t.expectedMaxScore) {
    errs.push(`score ${score} > expectedMax ${t.expectedMaxScore}`);
  }
  return errs;
}

function printBreakdown(markBreakdown: unknown): void {
  if (!Array.isArray(markBreakdown) || markBreakdown.length === 0) {
    console.info("markBreakdown: -");
    return;
  }
  for (const row of markBreakdown) {
    const awarded = row?.awarded ? "✓" : "✗";
    const marks = row?.marks ?? "?";
    const idea = row?.idea ?? row?.label ?? "(no label)";
    const reason = row?.reason ? ` — ${row.reason}` : "";
    console.info(`  ${awarded} [${marks}mk] ${idea}${reason}`);
  }
}

async function gradeViaService(t: AmaTestCase) {
  const { gradeSubmission } = await import("../src/services/rag/grading/gradeService");
  return gradeSubmission({
    question: t.question,
    studentAnswer: t.studentAnswer,
    subject: t.subject,
    form: t.form,
    maxScore: t.maxScore,
    rubricId: t.rubricId,
    rubricVersion: "ama-test",
  });
}

async function gradeViaHttp(t: AmaTestCase, baseUrl: string) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: t.question,
      studentAnswer: t.studentAnswer,
      subject: t.subject,
      form: t.form,
      maxScore: t.maxScore,
      rubricId: t.rubricId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json();
}

async function main(): Promise<void> {
  const { filterId, useHttp, baseUrl } = parseArgs(process.argv.slice(2));
  const bankPath = join(__dirname, "amaMarkingTests.json");
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as TestBank;

  let tests = bank.tests;
  if (filterId) {
    tests = tests.filter((t) => t.id === filterId);
    if (tests.length === 0) {
      console.error(`No test found with id "${filterId}" in ${bankPath}`);
      process.exit(1);
    }
  }

  console.info("AMA marking tests");
  console.info(`  cases file : ${bankPath}`);
  console.info(`  mode       : ${useHttp ? `HTTP → ${baseUrl}` : "in-process (gradeSubmission)"}`);
  console.info(`  count      : ${tests.length}`);

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const heading = t.label ? `${t.id} (${t.label})` : t.id;
    try {
      const result = useHttp ? await gradeViaHttp(t, baseUrl) : await gradeViaService(t);
      const score = Number(result.score ?? 0);
      const maxScore = Number(result.maxScore ?? t.maxScore);
      const errs = scoreInRange(score, t);
      const pass = errs.length === 0;

      if (pass) passed += 1;
      else failed += 1;

      console.info("\n" + "─".repeat(60));
      console.info(heading);
      console.info(`question : ${t.question}`);
      console.info(`answer   : ${t.studentAnswer}`);
      console.info(`score    : ${score} / ${maxScore}`);
      console.info(`result   : ${pass ? "PASS" : "FAIL"}`);
      if (errs.length > 0) console.info(`reason   : ${errs.join("; ")}`);
      if (t.notes) console.info(`notes    : ${t.notes}`);
      if (t.rubricId) console.info(`rubricId : ${t.rubricId}`);

      console.info("markBreakdown:");
      printBreakdown(result.markBreakdown);

      const matched = result.matchedIdeas ?? [];
      const missing = result.missingIdeas ?? [];
      console.info(`matchedIdeas : ${matched.length ? matched.join(" | ") : "-"}`);
      console.info(`missingIdeas : ${missing.length ? missing.join(" | ") : "-"}`);

      if (result.feedback) {
        console.info(`feedback : ${result.feedback}`);
      }
    } catch (error) {
      failed += 1;
      console.info("\n" + "─".repeat(60));
      console.info(heading);
      console.info("result   : FAIL");
      console.info(`reason   : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.info("\n" + "═".repeat(60));
  console.info(`Done: ${passed} passed, ${failed} failed (total ${tests.length}).`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
