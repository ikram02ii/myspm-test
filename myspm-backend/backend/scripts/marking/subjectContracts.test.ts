/**
 * Subject marking contracts (deterministic — no LLM, no DB).
 * Run: npm run test:marking:contracts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveOpenEndedMarkingAgent } from "../../src/services/ama/grading/v3/agents/resolveMarkingAgent.js";
import {
  resolveOfficialModelAnswer,
} from "../../src/services/ama/grading/v3/artifactPolicy.js";
import {
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  showWorkingStagePlan,
} from "../../src/services/ama/grading/v3/calculationAcfPolicy.js";
import { reconcileCalculationDemonstration } from "../../src/services/ama/grading/v3/reconcileCalculationDemonstration.js";
import { scoreFromDemonstration } from "../../src/services/ama/grading/v3/scoreFromDemonstration.js";
import type {
  AssessmentCaseFile,
  AssessmentIntent,
  EvidenceUnit,
  UnderstandingDemonstration,
} from "../../src/services/ama/grading/v3/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bankPath = join(__dirname, "fixtures/contracts.json");
const bank = JSON.parse(readFileSync(bankPath, "utf8")) as {
  packs: Array<Record<string, unknown>>;
};

function calcIntent(): AssessmentIntent {
  return {
    category: "calculate",
    family: "calculation",
    assessedUnderstanding: "Calculation",
    isCompound: false,
    analysis: { questionType: "calculation", demandType: "calculation" } as AssessmentIntent["analysis"],
  };
}

function theoryIntent(category: string, family: string): AssessmentIntent {
  return {
    category: category as AssessmentIntent["category"],
    family: family as AssessmentIntent["family"],
    assessedUnderstanding: family,
    isCompound: false,
    analysis: { questionType: family, demandType: family } as AssessmentIntent["analysis"],
  };
}

function chem2MarkUnits(): EvidenceUnit[] {
  return [
    {
      id: "calc_s1",
      type: "stage",
      content: CALCULATION_STAGE_LABELS.formula,
      aliases: [],
      creditWeight: 1,
      required: true,
    },
    {
      id: "calc_s2",
      type: "stage",
      content: CALCULATION_STAGE_LABELS.final,
      aliases: [],
      creditWeight: 1,
      required: true,
    },
  ];
}

function baseCalcAcf(overrides: Partial<AssessmentCaseFile>): AssessmentCaseFile {
  return {
    v: 3,
    question: overrides.question ?? "Calculate.",
    subject: overrides.subject ?? "Chemistry",
    form: overrides.form ?? "Form 4",
    maxScore: overrides.maxScore ?? 2,
    intent: overrides.intent ?? calcIntent(),
    assessedUnderstanding: "Calculation",
    units: overrides.units ?? chem2MarkUnits(),
    relations: [],
    markRule: overrides.markRule ?? { kind: "ordered_stages", calcPolicy: "show_working" },
    referenceModelAnswer: overrides.referenceModelAnswer,
    chunkRefs: [],
    contextSource: "textbook",
  };
}

describe("Phase 4 subject marking contracts", () => {
  for (const pack of bank.packs) {
    const packId = String(pack.id);
    const kind = String(pack.kind);
    const cases = (pack.cases as Array<Record<string, unknown>>) ?? [];

    describe(packId, () => {
      for (const c of cases) {
        const id = String(c.id);

        test(id, () => {
          if (kind === "stage_plan") {
            const maxScore = Number(c.maxScore);
            const domain = c.domain as "chemistry" | "physics" | "general";
            const stages = showWorkingStagePlan(maxScore, domain);
            const labels = stages.map((s) => s.label);

            if (Array.isArray(c.expectStageLabels)) {
              assert.deepEqual(labels, c.expectStageLabels);
            }
            if (Array.isArray(c.expectStageLabelSubstrings)) {
              for (const sub of c.expectStageLabelSubstrings as string[]) {
                assert.ok(
                  labels.some((l) => l.toLowerCase().includes(sub.toLowerCase())),
                  `expected a stage containing "${sub}", got ${labels.join(" | ")}`,
                );
              }
            }
            if (Array.isArray(c.forbidStageSubstrings)) {
              for (const sub of c.forbidStageSubstrings as string[]) {
                assert.ok(
                  !labels.some((l) => l.toLowerCase().includes(sub.toLowerCase())),
                  `forbidden stage substring "${sub}" found in ${labels.join(" | ")}`,
                );
              }
            }
            if (typeof c.expectFinalWeight === "number") {
              const final = stages.find((s) => /final/i.test(s.label));
              assert.ok(final);
              assert.equal(final!.weight, c.expectFinalWeight);
            }
            return;
          }

          if (kind === "agent_route") {
            const acf = baseCalcAcf({
              intent: theoryIntent(String(c.intentCategory), String(c.intentFamily)),
              maxScore: 2,
              units: [
                {
                  id: "u1",
                  type: "fact",
                  content: "point",
                  aliases: [],
                  creditWeight: 1,
                  required: true,
                },
              ],
              markRule: { kind: "count_distinct_units" },
            });
            if (String(c.intentFamily) === "calculation") {
              acf.intent = calcIntent();
              acf.units = chem2MarkUnits();
              acf.markRule = { kind: "ordered_stages", calcPolicy: "show_working" };
            }
            assert.equal(resolveOpenEndedMarkingAgent(acf), c.expectAgent);
            return;
          }

          if (kind === "ma_ownership") {
            const isCalc = Boolean(c.isCalculation);
            const acf = baseCalcAcf({
              question: String(c.question),
              intent: isCalc ? calcIntent() : theoryIntent("state", "recall"),
              maxScore: isCalc ? 2 : 1,
              units: isCalc
                ? chem2MarkUnits()
                : [
                    {
                      id: "u1",
                      type: "fact",
                      content: "Ionises in water",
                      aliases: [],
                      creditWeight: 1,
                      required: true,
                    },
                  ],
              markRule: isCalc
                ? { kind: "ordered_stages", calcPolicy: "show_working" }
                : { kind: "count_distinct_units" },
              referenceModelAnswer: String(c.caseReference),
              subject: isCalc ? "Chemistry" : "Biology",
            });
            const resolved = resolveOfficialModelAnswer({
              question: String(c.question),
              acf,
              caseReference: String(c.caseReference),
            });
            assert.equal(resolved.source, c.expectSource);
            for (const needle of (c.expectIncludes as string[]) ?? []) {
              assert.match(resolved.text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
            }
            return;
          }

          if (kind === "calc_score") {
            const acf = baseCalcAcf({
              question: String(c.question),
              maxScore: Number(c.maxScore),
              referenceModelAnswer: String(c.referenceModelAnswer),
              subject: "Chemistry",
            });
            const raw = c.udm as {
              unitsDemonstrated: Array<{ unitId: string; quote: string; valid: boolean }>;
              unitsMissing: Array<{ id: string; reason: string }>;
              invalidClaims: Array<{ text: string; reason: string }>;
            };
            const udmIn: UnderstandingDemonstration = {
              unitsDemonstrated: raw.unitsDemonstrated,
              relationsDemonstrated: [],
              unitsMissing: (raw.unitsMissing ?? []).map((g) => ({
                id: g.id,
                kind: "unit" as const,
                label: g.id,
                reason: g.reason,
              })),
              relationsMissing: [],
              invalidClaims: raw.invalidClaims ?? [],
            };
            const udm = reconcileCalculationDemonstration({
              question: String(c.question),
              studentAnswer: String(c.studentAnswer),
              acf,
              udm: udmIn,
              referenceModelAnswer: String(c.referenceModelAnswer),
            });
            const scored = scoreFromDemonstration(acf, udm);
            if (typeof c.expectScore === "number") {
              assert.equal(scored.score, c.expectScore);
            }
            if (typeof c.expectScoreMax === "number") {
              assert.ok(scored.score <= Number(c.expectScoreMax));
            }
            if (c.expectFinalAwarded === false) {
              const finalRow = scored.markBreakdown.find((r) => /final/i.test(r.idea));
              assert.ok(finalRow);
              assert.equal(finalRow!.awarded, false);
            }
            return;
          }

          assert.fail(`unknown contract kind: ${kind}`);
        });
      }
    });
  }
});

// Sanity: generic labels still available for math pack expectations
void GENERIC_CALCULATION_STAGE_LABELS;
