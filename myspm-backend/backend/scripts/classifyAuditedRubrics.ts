/**
 * Classify rows in rubric-pipeline-audit-bio-50-final.json
 * npx tsx scripts/classifyAuditedRubrics.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = join(__dirname, "output/rubric-pipeline-audit-bio-50-final.json");
const OUT = join(__dirname, "output/rubric-row-classification-bio-50.json");

type RowKind =
  | "atomic_concept"
  | "compound_concept"
  | "umbrella_concept"
  | "procedural_statement"
  | "textbook_copy";

type AuditRow = {
  id: string;
  idea: string;
  marks: number;
  gradingMode?: string;
  wordCount: number;
  rowClass: string;
};

type AuditCase = {
  id: string;
  question: string;
  maxScore: number;
  primaryFailureLayer: string;
  failureLayers: string[];
  retrieval: {
    topChunks: Array<{ chunkId: string; preview: string }>;
    topChunkScore: number;
    textbookChunkCount: number;
    dskpChunkCount: number;
    isSufficientContext: boolean;
  };
  rubric: {
    rubricId?: string;
    rowCount: number;
    markSum: number;
    ideas: AuditRow[];
    textbookAnchoredRowPct: number;
  };
  grading: Array<{ label: string; score: number; maxScore: number; revokedByEvidence?: number }>;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function overlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

const UMBRELLA_RE =
  /\b(any valid|any scientifically valid|any correct|any acceptable|one valid|valid (?:example|answer|procedure|precaution|member)|e\.g\.|for example)\b/i;
const PROCEDURAL_RE =
  /\b(first|second|then|next|after|before|finally|step\s*\d|procedure|using appropriate|according to|dispose|contain the|wash hands|inform the teacher|restricted zone|scooped)\b/i;
const COMPOUND_RE = /\b(and|while|whereas|both|as well as|as well|kerana|supaya|so that|in order to|because)\b/i;
const SLASH_VARIANT = /\s\/\s| \/ /;

function classifyRow(
  idea: string,
  marks: number,
  maxScore: number,
  chunkText: string,
): { kind: RowKind; reasons: string[] } {
  const reasons: string[] = [];
  const words = idea.trim().split(/\s+/).length;
  const chunkOv = chunkText ? overlap(idea, chunkText) : 0;

  if (chunkOv >= 0.55 && words >= 12) {
    reasons.push(`high token overlap (${Math.round(chunkOv * 100)}%) with retrieved chunk`);
    return { kind: "textbook_copy", reasons };
  }
  if (UMBRELLA_RE.test(idea) || (marks > 1 && maxScore > 1)) {
    reasons.push(marks > 1 ? `single row carries ${marks} marks` : "umbrella phrasing");
    return { kind: "umbrella_concept", reasons };
  }
  if (
    words >= 16 ||
    PROCEDURAL_RE.test(idea) ||
    (idea.match(/,/g) ?? []).length >= 2 ||
    (COMPOUND_RE.test(idea) && words >= 10)
  ) {
    if (PROCEDURAL_RE.test(idea)) reasons.push("procedural action language");
    if (words >= 16) reasons.push(`long sentence (${words} words)`);
    if (SLASH_VARIANT.test(idea)) reasons.push("slash-packed variant list in idea field");
    return { kind: "procedural_statement", reasons };
  }
  if (
    (COMPOUND_RE.test(idea) && words >= 7) ||
    SLASH_VARIANT.test(idea) ||
    (idea.includes(";") && words >= 8)
  ) {
    reasons.push("bundles multiple ideas or variants in one row");
    return { kind: "compound_concept", reasons };
  }
  if (chunkOv >= 0.4) {
    reasons.push(`moderate chunk overlap (${Math.round(chunkOv * 100)}%)`);
    return { kind: "textbook_copy", reasons };
  }
  reasons.push("short single mark point");
  return { kind: "atomic_concept", reasons };
}

function markingDifficulty(
  kind: RowKind,
  idea: string,
  marks: number,
  maxScore: number,
  gradingMode?: string,
): string {
  const parts: string[] = [];
  if (kind === "umbrella_concept")
    parts.push("Examiner cannot map one student phrase to a single mark; verifier has no concrete target.");
  if (kind === "procedural_statement")
    parts.push("Row reads as SOP step or model answer, not a creditable concept label.");
  if (kind === "textbook_copy")
    parts.push("Matcher rewards textbook wording, not student paraphrase.");
  if (kind === "compound_concept")
    parts.push("Partial credit ambiguous — one clause may satisfy row while another is missing.");
  if (SLASH_VARIANT.test(idea))
    parts.push("Synonyms live in idea string; verbatim oracle can fail while short forms pass.");
  if (marks > 1)
    parts.push(`Row worth ${marks} marks but encodes one vague bucket.`);
  if (gradingMode === "open_pool" && kind !== "atomic_concept")
    parts.push("open_pool expects pool members; row shape fights categoryMembership verifier.");
  if (parts.length === 0) parts.push("Generally markable if acceptedConcepts are populated.");
  return parts.join(" ");
}

function main(): void {
  const data = JSON.parse(readFileSync(IN, "utf8")) as { cases: AuditCase[] };
  const counts: Record<RowKind, number> = {
    atomic_concept: 0,
    compound_concept: 0,
    umbrella_concept: 0,
    procedural_statement: 0,
    textbook_copy: 0,
  };

  const rowDetails: Array<{
    caseId: string;
    rowId: string;
    idea: string;
    marks: number;
    kind: RowKind;
    reasons: string[];
  }> = [];

  const failures: Array<{
    caseId: string;
    question: string;
    maxScore: number;
    primaryFailure: string;
    layers: string[];
    retrievedText: string;
    rubricRows: Array<{
      id: string;
      idea: string;
      marks: number;
      kind: RowKind;
      whyHardToMark: string;
    }>;
    gradingNote: string;
  }> = [];

  for (const c of data.cases) {
    const chunkText = c.retrieval.topChunks.map((x) => x.preview).join(" ");
    for (const row of c.rubric.ideas) {
      const { kind, reasons } = classifyRow(row.idea, row.marks, c.maxScore, chunkText);
      counts[kind] += 1;
      rowDetails.push({
        caseId: c.id,
        rowId: row.id,
        idea: row.idea,
        marks: row.marks,
        kind,
        reasons,
      });
    }

    const isFailure =
      c.primaryFailureLayer === "rubric_generation_failure" ||
      c.failureLayers.includes("rubric_generation_failure");

    if (isFailure) {
      const oracle = c.grading.find((g) => g.label === "oracle_rubric_ideas");
      const short = c.grading.find((g) => g.label === "short_concept_answer");
      let gradingNote = "";
      if (oracle && short) {
        gradingNote = `oracle ${oracle.score}/${oracle.maxScore}, short ${short.score}/${short.maxScore}`;
      } else if (oracle) {
        gradingNote = `oracle ${oracle.score}/${oracle.maxScore}`;
      }

      failures.push({
        caseId: c.id,
        question: c.question.replace(/\n/g, " ").slice(0, 160),
        maxScore: c.maxScore,
        primaryFailure: c.primaryFailureLayer,
        layers: c.failureLayers,
        retrievedText:
          c.retrieval.topChunks.length > 0
            ? c.retrieval.topChunks.map((ch) => `[${ch.chunkId}] ${ch.preview}`).join("\n")
            : "(no chunks retrieved)",
        rubricRows: c.rubric.ideas.map((row) => {
          const { kind } = classifyRow(row.idea, row.marks, c.maxScore, chunkText);
          return {
            id: row.id,
            idea: row.idea,
            marks: row.marks,
            kind,
            whyHardToMark: markingDifficulty(kind, row.idea, row.marks, c.maxScore, row.gradingMode),
          };
        }),
        gradingNote,
      });
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = (n: number) => Math.round((n / totalRows) * 1000) / 10;

  const summary = {
    totalRows,
    totalCases: data.cases.length,
    counts,
    percentages: {
      atomic_concept: pct(counts.atomic_concept),
      compound_concept: pct(counts.compound_concept),
      umbrella_concept: pct(counts.umbrella_concept),
      procedural_statement: pct(counts.procedural_statement),
      textbook_copy: pct(counts.textbook_copy),
    },
    examinerFriendlyRows: pct(counts.atomic_concept),
    failureCaseCount: failures.length,
    failures: failures.slice(0, 15),
    failureSamplesRemaining: Math.max(0, failures.length - 15),
    allRowClassifications: rowDetails,
  };

  mkdirSync(join(__dirname, "output"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({
    totalRows: summary.totalRows,
    counts: summary.counts,
    percentages: summary.percentages,
    failureCaseCount: summary.failureCaseCount,
    outPath: OUT,
  }, null, 2));
}

main();
