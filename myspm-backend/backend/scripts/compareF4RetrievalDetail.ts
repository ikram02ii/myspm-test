/**
 * Benchmark retrieval + marking: legacy textbook vs VL-ingested textbook (Form 4).
 *
 * One shared question bank: scripts/fixtures/f4Compare30.json — edit it when testing a new subject/set.
 *
 * Usage:
 *   npx tsx ./scripts/compareF4RetrievalDetail.ts --subject Biology
 *   npx tsx ./scripts/compareF4RetrievalDetail.ts --subject Chemistry --limit 5
 *   npx tsx ./scripts/compareF4RetrievalDetail.ts --subject Physics --grounding-only
 */
import * as dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RetrievedChunk } from "../src/services/ama/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const FORM = "Form 4";
const CONTENT_PREVIEW = 700;
const DEFAULT_BANK = "fixtures/f4Compare30.json";

type SubjectKey = "Biology" | "Chemistry" | "Physics";

type SubjectConfig = {
  legacyTbId: string;
  defaultVlTbId?: string;
};

const SUBJECT_CONFIG: Record<SubjectKey, SubjectConfig> = {
  Biology: {
    legacyTbId: "tb-1779617399534-c2867e38",
    defaultVlTbId: "tb-vl-bio-f4",
  },
  Chemistry: {
    legacyTbId: "tb-1779691166638-723504e0",
  },
  Physics: {
    legacyTbId: "tb-1781598779520-9ae3e7de",
  },
};

type CompareCase = {
  id: string;
  label?: string;
  expectedChapter?: number;
  answerQuality?: string;
  questionType?: string;
  question: string;
  studentAnswer: string;
  maxScore: number;
  expectedScore: number;
};

type ChunkDetail = {
  chunkId: string;
  score: number;
  chapter: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  conceptTitle: string | null;
  contentLength: number;
  contentPreview: string;
  content: string;
};

type SourceResult = {
  source: "legacy" | "vl";
  contextSource: string;
  chapterMatch: boolean;
  topScore: number;
  chunkCount: number;
  chunks: ChunkDetail[];
  rubricUnits: number;
  score: number | null;
  expectedScore: number;
  scoreMatch: boolean;
  mergedExcerptPreview: string;
};

type QuestionResult = {
  id: string;
  label: string;
  answerQuality: string | null;
  questionType: string | null;
  expectedChapter: number | null;
  question: string;
  studentAnswer: string;
  maxScore: number;
  legacy: SourceResult;
  vl: SourceResult | null;
  retrievalWinner: "legacy" | "vl" | "tie" | "n/a";
  markingWinner: "legacy" | "vl" | "tie" | "n/a";
};

function resolveScriptPath(arg: string): string {
  return arg.includes("/") || arg.includes("\\") ? join(__dirname, "..", arg) : join(__dirname, arg);
}

function parseArgs(argv: string[]) {
  let subject: SubjectKey | undefined;
  let limit: number | undefined;
  let groundingOnly = false;
  let bankPath = "";
  let outJson = "";
  let outMd = "";
  let vlTb = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--limit" && next) {
      limit = Number(next);
      i += 1;
    } else if (arg === "--grounding-only") groundingOnly = true;
    else if (arg === "--subject" && next) {
      subject = next as SubjectKey;
      i += 1;
    } else if (arg === "--bank" && next) {
      bankPath = resolveScriptPath(next);
      i += 1;
    } else if (arg === "--out" && next) {
      outJson = resolveScriptPath(next);
      i += 1;
    } else if (arg === "--md" && next) {
      outMd = resolveScriptPath(next);
      i += 1;
    } else if (arg === "--vl-tb" && next) {
      vlTb = next.trim();
      i += 1;
    }
  }

  if (!subject || !SUBJECT_CONFIG[subject]) {
    throw new Error(`--subject is required (${Object.keys(SUBJECT_CONFIG).join(" | ")})`);
  }

  const cfg = SUBJECT_CONFIG[subject];
  const subjectSlug = subject.toLowerCase();
  return {
    subject,
    cfg,
    limit,
    groundingOnly,
    bankPath: bankPath || join(__dirname, DEFAULT_BANK),
    outJson: outJson || join(__dirname, `output/${subjectSlug}-retrieval-detail.json`),
    outMd: outMd || join(__dirname, `output/${subjectSlug}-retrieval-detail.md`),
    vlTb,
  };
}

function chapterNumber(chapter: string | null | undefined): number | null {
  if (!chapter) return null;
  const m = chapter.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function toChunkDetail(c: RetrievedChunk): ChunkDetail {
  const content = c.content.trim();
  return {
    chunkId: c.chunkId,
    score: c.score,
    chapter: c.chapter ?? null,
    pageStart: c.pageStart ?? null,
    pageEnd: c.pageEnd ?? null,
    conceptTitle: c.conceptTitle ?? null,
    contentLength: content.length,
    contentPreview: content.slice(0, CONTENT_PREVIEW),
    content,
  };
}

async function resolveVlTbId(
  subject: SubjectKey,
  cliOverride: string,
  defaultVlTbId?: string,
): Promise<string> {
  if (cliOverride) return cliOverride;
  if (defaultVlTbId) return defaultVlTbId;
  try {
    const { ragDb } = await import("../src/lib/ragDb");
    const { ragTbTable } = await import("../src/lib/ragSchema");
    const { eq, and } = await import("drizzle-orm");
    if (!ragDb) return "";
    const rows = await ragDb
      .select({ tbId: ragTbTable.tbId })
      .from(ragTbTable)
      .where(and(eq(ragTbTable.subject, subject), eq(ragTbTable.form, FORM)))
      .limit(1);
    return rows[0]?.tbId ?? "";
  } catch {
    return "";
  }
}

async function runSource(
  test: CompareCase,
  source: "legacy" | "vl",
  subject: SubjectKey,
  vlTbId: string,
  groundingOnly: boolean,
): Promise<SourceResult> {
  const { retrieveEvidenceContext } = await import("../src/services/ama/grading/v3/groundingChunks");
  const { getOrCreateAssessmentCase } = await import("../src/services/ama/grading/v3/assessmentCaseService");
  const { evaluateUnderstanding } = await import("../src/services/ama/grading/v3/evaluateUnderstanding");
  const { reconcileUnderstandingDemonstration } = await import("../src/services/ama/grading/v3/reconcileUdmDemonstration");
  const { scoreFromDemonstration } = await import("../src/services/ama/grading/v3/scoreFromDemonstration");

  const evidence = await retrieveEvidenceContext({
    question: test.question,
    subject,
    form: FORM,
    maxScore: test.maxScore,
    vlTbId: source === "vl" ? vlTbId : undefined,
  });

  const tbChunks = evidence.textbookChunks ?? [];
  const top = tbChunks[0];
  const retrievedChapter = chapterNumber(top?.chapter);
  const chapterMatch =
    test.expectedChapter != null &&
    retrievedChapter != null &&
    retrievedChapter === test.expectedChapter;

  let rubricUnits = 0;
  let score: number | null = null;

  if (!groundingOnly) {
    try {
      const stored = await getOrCreateAssessmentCase({
        question: test.question,
        subject,
        form: FORM,
        maxScore: test.maxScore,
        seedChunkContent: evidence.mergedExcerpt || undefined,
      });
      const acf = stored.acf;
      rubricUnits = acf.units.filter((u) => u.creditWeight > 0).length;
      const udm = await reconcileUnderstandingDemonstration({
        question: test.question,
        studentAnswer: test.studentAnswer,
        acf,
        udm: await evaluateUnderstanding({
          question: test.question,
          studentAnswer: test.studentAnswer,
          acf,
        }),
      });
      score = scoreFromDemonstration(acf, udm).score;
    } catch (err) {
      console.warn(`  marking failed for ${test.id} (${source}):`, err instanceof Error ? err.message : err);
    }
  }

  return {
    source,
    contextSource: evidence.contextSource,
    chapterMatch,
    topScore: top?.score ?? 0,
    chunkCount: tbChunks.length,
    chunks: tbChunks.map(toChunkDetail),
    rubricUnits,
    score,
    expectedScore: test.expectedScore,
    scoreMatch: score != null ? score === test.expectedScore : false,
    mergedExcerptPreview: evidence.mergedExcerpt.slice(0, CONTENT_PREVIEW),
  };
}

function winnerRetrieval(l: SourceResult, v: SourceResult | null): "legacy" | "vl" | "tie" | "n/a" {
  if (!v) return "n/a";
  if (l.chapterMatch && !v.chapterMatch) return "legacy";
  if (v.chapterMatch && !l.chapterMatch) return "vl";
  if (l.topScore > v.topScore) return "legacy";
  if (v.topScore > l.topScore) return "vl";
  return "tie";
}

function winnerMarking(
  test: CompareCase,
  l: SourceResult,
  v: SourceResult | null,
): "legacy" | "vl" | "tie" | "n/a" {
  if (l.score == null) return "n/a";
  if (!v || v.score == null) return "n/a";
  const lDist = Math.abs(l.score - test.expectedScore);
  const vDist = Math.abs(v.score - test.expectedScore);
  if (lDist < vDist) return "legacy";
  if (vDist < lDist) return "vl";
  return "tie";
}

function buildMarkdown(
  subject: SubjectKey,
  results: QuestionResult[],
  groundingOnly: boolean,
  hasVl: boolean,
): string {
  const lines: string[] = [
    `# ${subject} Form 4 — Legacy vs VL retrieval detail`,
    "",
    `Generated: ${new Date().toISOString()}`,
    hasVl ? "" : "_VL textbook not available — legacy marking only._",
    "",
  ].filter(Boolean);

  for (const r of results) {
    lines.push(`## ${r.id}: ${r.label}`);
    lines.push("");
    lines.push(`**Question:** ${r.question}`);
    lines.push("");
    lines.push(
      `**Student answer (${r.answerQuality ?? "n/a"}${r.questionType ? `, ${r.questionType}` : ""}):** ${r.studentAnswer}`,
    );
    lines.push("");
    lines.push(`**Retrieval winner:** ${r.retrievalWinner} | **Marking winner:** ${r.markingWinner}`);
    if (!groundingOnly) {
      if (r.vl) {
        lines.push(
          `**Scores:** legacy ${r.legacy.score}/${r.maxScore} (exp ${r.legacy.expectedScore}) | VL ${r.vl.score}/${r.maxScore} (exp ${r.vl.expectedScore})`,
        );
      } else {
        lines.push(`**Scores:** legacy ${r.legacy.score}/${r.maxScore} (exp ${r.legacy.expectedScore})`);
      }
    }
    lines.push("");
    const sources = r.vl ? [r.legacy, r.vl] : [r.legacy];
    for (const src of sources) {
      const name = src.source === "legacy" ? "Legacy (normal TB)" : "VL TB";
      lines.push(`### ${name}`);
      lines.push(
        `- Grounding: ${src.contextSource} | top score: ${src.topScore.toFixed(3)} | chapter match: ${src.chapterMatch ? "yes" : "no"} | chunks: ${src.chunkCount}`,
      );
      const top = src.chunks[0];
      if (top) {
        lines.push(`- Top chunk: \`${top.chunkId}\` | ch: ${top.chapter ?? "?"} | page: ${top.pageStart ?? "?"}`);
        lines.push("");
        lines.push("```");
        lines.push(top.contentPreview);
        if (top.contentLength > CONTENT_PREVIEW) lines.push("... [truncated]");
        lines.push("```");
      } else {
        lines.push("- No textbook chunks retrieved.");
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { subject, cfg, limit, groundingOnly, bankPath, outJson, outMd, vlTb } = parseArgs(
    process.argv.slice(2),
  );
  const vlTbId = await resolveVlTbId(subject, vlTb, cfg.defaultVlTbId);
  const hasVl = vlTbId.length > 0;

  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as { tests: CompareCase[] };
  let tests = bank.tests;
  if (limit != null && Number.isFinite(limit)) tests = tests.slice(0, limit);

  const calcCount = tests.filter((t) => t.questionType === "calculation").length;
  const theoryCount = tests.filter((t) => t.questionType !== "calculation").length;

  console.log(`\n=== ${subject} F4 retrieval detail${hasVl ? ": Legacy vs VL" : " (legacy only)"} ===`);
  console.log(`Legacy: ${cfg.legacyTbId}`);
  console.log(`VL:     ${hasVl ? vlTbId : "(not ingested)"}`);
  console.log(
    `Questions: ${tests.length} (${theoryCount} theory, ${calcCount} calculation) | Marking: ${groundingOnly ? "off" : "on"}\n`,
  );

  const results: QuestionResult[] = [];
  const started = Date.now();

  for (let i = 0; i < tests.length; i += 1) {
    const test = tests[i];
    console.log(`[${i + 1}/${tests.length}] ${test.id}: ${test.label ?? ""}`);
    const legacy = await runSource(test, "legacy", subject, vlTbId, groundingOnly);
    const vl = hasVl ? await runSource(test, "vl", subject, vlTbId, groundingOnly) : null;
    const retrievalWinner = winnerRetrieval(legacy, vl);
    const markingWinner = winnerMarking(test, legacy, vl);
    results.push({
      id: test.id,
      label: test.label ?? test.id,
      answerQuality: test.answerQuality ?? null,
      questionType: test.questionType ?? null,
      expectedChapter: test.expectedChapter ?? null,
      question: test.question,
      studentAnswer: test.studentAnswer,
      maxScore: test.maxScore,
      legacy,
      vl,
      retrievalWinner,
      markingWinner,
    });
    const markNote =
      !groundingOnly && legacy.score != null
        ? hasVl && vl?.score != null
          ? ` | marks L=${legacy.score} V=${vl.score} exp=${test.expectedScore}`
          : ` | marks L=${legacy.score} exp=${test.expectedScore}`
        : "";
    const retNote =
      hasVl && vl
        ? `retrieval: ${retrievalWinner} (L top=${legacy.topScore.toFixed(2)} ch=${legacy.chapterMatch} | V top=${vl.topScore.toFixed(2)} ch=${vl.chapterMatch})`
        : `retrieval: legacy (top=${legacy.topScore.toFixed(2)} ch=${legacy.chapterMatch})`;
    console.log(`  ${retNote}${markNote}`);
  }

  const legacyChMatch = results.filter((r) => r.legacy.chapterMatch).length;
  const vlChMatch = hasVl ? results.filter((r) => r.vl?.chapterMatch).length : 0;
  const retLegacy = results.filter((r) => r.retrievalWinner === "legacy").length;
  const retVl = results.filter((r) => r.retrievalWinner === "vl").length;
  const retTie = results.filter((r) => r.retrievalWinner === "tie").length;

  console.log("\n=== SUMMARY ===");
  if (hasVl) {
    console.log(`Chapter match — Legacy: ${legacyChMatch}/${tests.length} | VL: ${vlChMatch}/${tests.length}`);
    console.log(`Retrieval winner — Legacy: ${retLegacy} | VL: ${retVl} | Tie: ${retTie}`);
  } else {
    console.log(`Chapter match — Legacy: ${legacyChMatch}/${tests.length}`);
  }

  if (!groundingOnly) {
    const lExact = results.filter((r) => r.legacy.scoreMatch).length;
    console.log(
      `Marking exact — Legacy: ${lExact}/${tests.length} (${Math.round((lExact / tests.length) * 1000) / 10}%)`,
    );
    if (hasVl) {
      const vExact = results.filter((r) => r.vl?.scoreMatch).length;
      const markLegacy = results.filter((r) => r.markingWinner === "legacy").length;
      const markVl = results.filter((r) => r.markingWinner === "vl").length;
      console.log(
        `Marking exact — VL: ${vExact}/${tests.length} (${Math.round((vExact / tests.length) * 1000) / 10}%)`,
      );
      console.log(`Marking closer — Legacy: ${markLegacy} | VL: ${markVl}`);
    }
    const calcTests = results.filter((r) => r.questionType === "calculation");
    const theoryTests = results.filter((r) => r.questionType !== "calculation");
    if (calcTests.length > 0) {
      const calcExact = calcTests.filter((r) => r.legacy.scoreMatch).length;
      console.log(`Calculations exact — Legacy: ${calcExact}/${calcTests.length}`);
    }
    if (theoryTests.length > 0) {
      const theoryExact = theoryTests.filter((r) => r.legacy.scoreMatch).length;
      console.log(`Theory exact — Legacy: ${theoryExact}/${theoryTests.length}`);
    }
  }

  const elapsed = ((Date.now() - started) / 1000 / 60).toFixed(1);
  console.log(`\nCompleted in ${elapsed} min`);

  const payload = {
    runAt: new Date().toISOString(),
    subject,
    form: FORM,
    questionCount: tests.length,
    calculationCount: calcCount,
    theoryCount,
    groundingOnly,
    legacyTbId: cfg.legacyTbId,
    vlTbId: hasVl ? vlTbId : null,
    summary: {
      legacyChapterMatch: legacyChMatch,
      vlChapterMatch: hasVl ? vlChMatch : null,
      retrievalWinner: hasVl ? { legacy: retLegacy, vl: retVl, tie: retTie } : null,
    },
    results,
  };

  mkdirSync(join(__dirname, "output"), { recursive: true });
  writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(outMd, buildMarkdown(subject, results, groundingOnly, hasVl), "utf8");
  console.log(`JSON: ${outJson}`);
  console.log(`Report: ${outMd}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
