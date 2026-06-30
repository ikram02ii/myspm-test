/**
 * npm run test:grading-regression
 * Runs gradeSubmission against gradingRegressionTests.json (live Qwen + DB).
 * Set QWEN_GRADING_* and database env in .env before running.
 */

import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

type RegressionCase = {
  id: string;
  subject: string;
  form: string;
  question: string;
  studentAnswer: string;
  requestedMaxScore: number;
  expectedMinScore: number;
  expectedMaxScore: number;
  expectedAdjustedMaxScore?: number;
  mustMention: string[];
  mustNotMention: string[];
  expectedMissingIdeas: string[];
  notes?: string;
};

type Bank = { tests: RegressionCase[] };

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function blobIncludes(haystack: string, needle: string): boolean {
  return norm(haystack).includes(norm(needle));
}

async function main(): Promise<void> {
  const { gradeSubmission } = await import("../src/services/rag/grading/gradeService");
  const path = join(__dirname, "gradingRegressionTests.json");
  const bank = JSON.parse(readFileSync(path, "utf8")) as Bank;
  let passed = 0;
  let failed = 0;

  for (const t of bank.tests) {
    const label = `[${t.id}]`;
    try {
      const result = await gradeSubmission({
        question: t.question,
        studentAnswer: t.studentAnswer,
        subject: t.subject,
        form: t.form,
        maxScore: t.requestedMaxScore,
        rubricVersion: "regression",
      });

      const maxOut = result.maxScore;
      const score = result.score;
      const adj = result.adjustedMaxScore ?? maxOut;
      const feedback = result.feedback ?? "";
      const modelAns = result.modelAnswer ?? "";
      const missingIdeas = result.missingIdeas ?? [];
      const matchedIdeas = result.matchedIdeas ?? [];
      const studentIdeasDetected = result.studentIdeasDetected ?? [];
      const missing = missingIdeas.join(" | ");
      const blob = `${feedback}\n${modelAns}\n${missing}\n${matchedIdeas.join(" | ")}\n${studentIdeasDetected.join(" | ")}`;

      const errs: string[] = [];
      if (score < t.expectedMinScore || score > t.expectedMaxScore) {
        errs.push(`score ${score} not in [${t.expectedMinScore}, ${t.expectedMaxScore}]`);
      }
      if (typeof t.expectedAdjustedMaxScore === "number" && adj !== t.expectedAdjustedMaxScore) {
        errs.push(`adjustedMaxScore ${adj} !== expected ${t.expectedAdjustedMaxScore}`);
      }
      for (const m of t.mustMention) {
        if (!blobIncludes(blob, m)) errs.push(`mustMention missing: "${m}"`);
      }
      for (const m of t.mustNotMention) {
        if (blobIncludes(blob, m)) errs.push(`mustNotMention forbidden appeared: "${m}"`);
      }
      for (const idea of t.expectedMissingIdeas) {
        if (!blobIncludes(missing, idea)) errs.push(`expected missing idea substring not in missingIdeas: "${idea}"`);
      }

      const pass = errs.length === 0;
      if (pass) passed += 1;
      else failed += 1;

      console.info("\n---");
      console.info(`testId: ${t.id}`);
      console.info(`score: ${score}`);
      console.info(`maxScore: ${maxOut}`);
      console.info(`adjustedMaxScore: ${adj}`);
      console.info(`passFail: ${pass ? "PASS" : "FAIL"}`);
      console.info(`reasonIfFailed: ${pass ? "-" : errs.join("; ")}`);
      console.info(`feedback: ${feedback}`);
      console.info(`matchedIdeas: ${matchedIdeas.length > 0 ? matchedIdeas.join(" | ") : "-"}`);
      console.info(`studentIdeasDetected: ${studentIdeasDetected.length > 0 ? studentIdeasDetected.join(" | ") : "-"}`);
      console.info(`missingIdeas: ${missingIdeas.length > 0 ? missingIdeas.join(" | ") : "-"}`);
      console.info(
        `topicConsistencyPassed: ${result.topicConsistencyPassed === undefined ? "(undefined)" : String(result.topicConsistencyPassed)}`,
      );
      console.info(
        `contradictionCheckPassed: ${result.contradictionCheckPassed === undefined ? "(undefined)" : String(result.contradictionCheckPassed)}`,
      );
    } catch (e) {
      failed += 1;
      console.info("\n---");
      console.info(`testId: ${t.id}`);
      console.info("score: -");
      console.info("maxScore: -");
      console.info("adjustedMaxScore: -");
      console.info("passFail: FAIL");
      console.info(`reasonIfFailed: ${e instanceof Error ? e.message : String(e)}`);
      console.info("feedback: -");
      console.info("matchedIdeas: -");
      console.info("studentIdeasDetected: -");
      console.info("missingIdeas: -");
      console.info("topicConsistencyPassed: -");
      console.info("contradictionCheckPassed: -");
    }
  }

  console.info(`\nDone: ${passed} passed, ${failed} failed (total ${bank.tests.length}).`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
