/**
 * Generic coverage_chain test harness — no LLM, no DB.
 * Run: npm run test:coverage-chain
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "../../src/services/ama/grading/v3/types.js";
import {
  findChainRootUnitIds,
  scoreCoverageChain,
  unitDemonstrated,
} from "../../src/services/ama/grading/v3/coverageChainScorer.js";
import { scoreFromDemonstration } from "../../src/services/ama/grading/v3/scoreFromDemonstration.js";

function makeChainAcf(overrides?: Partial<AssessmentCaseFile>): AssessmentCaseFile {
  return {
    v: 3,
    question: "Explain a process.",
    subject: "Chemistry",
    form: "Form 4",
    maxScore: 4,
    intent: {
      category: "explain",
      family: "explanation",
      assessedUnderstanding: "Cause-effect chain",
      isCompound: false,
      analysis: {} as AssessmentCaseFile["intent"]["analysis"],
    },
    assessedUnderstanding: "Cause-effect chain",
    units: [
      { id: "u1", type: "fact", content: "A", aliases: [], creditWeight: 1, required: true },
      { id: "u2", type: "fact", content: "B", aliases: [], creditWeight: 1, required: true },
      { id: "u3", type: "fact", content: "C", aliases: [], creditWeight: 1, required: true },
      { id: "u4", type: "fact", content: "D", aliases: [], creditWeight: 1, required: false },
      { id: "s1", type: "fact", content: "Support", aliases: [], creditWeight: 0, required: false, supports: ["u2"] },
    ],
    relations: [
      { id: "r1", type: "causes", from: "u1", to: "u2", requiredForMarks: true },
      { id: "r2", type: "causes", from: "u2", to: "u3", requiredForMarks: true },
      { id: "r3", type: "causes", from: "u3", to: "u4", requiredForMarks: true },
    ],
    markRule: { kind: "coverage_chain", maxMarks: 4 },
    chunkRefs: [],
    contextSource: "llm_fallback",
    ...overrides,
  };
}

function udmForMatched(unitIds: string[], relationIds: string[] = []): UnderstandingDemonstration {
  return {
    unitsDemonstrated: unitIds.map((unitId) => ({ unitId, quote: unitId, valid: true })),
    relationsDemonstrated: relationIds.map((relationId) => ({ relationId, quote: relationId })),
    unitsMissing: [],
    relationsMissing: [],
    invalidClaims: [],
  };
}

function expectedPrefixScore(acf: AssessmentCaseFile, depth: number): number {
  const roots = findChainRootUnitIds(acf);
  const root = roots[0]!;
  const order: string[] = [root];
  let current = root;
  while (true) {
    const next = acf.relations.find((r) => r.from === current)?.to;
    if (!next) break;
    order.push(next);
    current = next;
  }
  return order.slice(0, depth).reduce((sum, id) => {
    const unit = acf.units.find((u) => u.id === id);
    return sum + (unit && unit.creditWeight > 0 ? unit.creditWeight : 0);
  }, 0);
}

export function runCoverageChainHarness(acf: AssessmentCaseFile): void {
  const roots = findChainRootUnitIds(acf);
  assert.ok(roots.length > 0, "chain must have at least one root");

  const root = roots[0]!;
  const chainOrder: string[] = [root];
  let cursor = root;
  while (true) {
    const edge = acf.relations.find((r) => r.from === cursor);
    if (!edge) break;
    chainOrder.push(edge.to);
    cursor = edge.to;
  }

  const creditChain = chainOrder.filter((id) => {
    const u = acf.units.find((unit) => unit.id === id);
    return u && u.creditWeight > 0;
  });

  for (let depth = 0; depth <= creditChain.length; depth += 1) {
    const matched = creditChain.slice(0, depth);
    const relations = acf.relations
      .filter((r) => r.requiredForMarks && matched.includes(r.from) && matched.includes(r.to))
      .map((r) => r.id);
    const udm = udmForMatched(matched, relations);
    const walk = scoreCoverageChain(acf, udm);
    const scored = scoreFromDemonstration(acf, udm);

    assert.equal(walk.score, scored.score, `depth ${depth}: scoreFromDemonstration must match chain walk`);
    assert.equal(
      walk.score,
      Math.min(acf.maxScore, expectedPrefixScore(acf, depth)),
      `depth ${depth}: score must equal prefix sum`,
    );
    assert.deepEqual(
      walk.creditedUnits,
      scored.chainWalk?.creditedUnits,
      `depth ${depth}: credited units must match between scorer and scoreFromDemonstration`,
    );

    if (depth > 0) {
      assert.ok(walk.score >= 0, "score must be non-negative");
      const prevMatched = creditChain.slice(0, depth - 1);
      const prevWalk = scoreCoverageChain(acf, udmForMatched(prevMatched, []));
      assert.ok(walk.score >= prevWalk.score, `depth ${depth}: score must be monotonic with chain depth`);
    }
  }

  // Broken link: A,B,D matched but C missing — D must not credit
  if (creditChain.length >= 4) {
    const broken = udmForMatched([creditChain[0]!, creditChain[1]!, creditChain[3]!], ["r1"]);
    const brokenWalk = scoreCoverageChain(acf, broken);
    assert.ok(!brokenWalk.creditedUnits.includes(creditChain[3]!), "downstream unit must not credit when link broken");
    assert.ok(brokenWalk.blockedUnits.includes(creditChain[3]!), "downstream isolated match must be blocked");
    assert.equal(brokenWalk.score, 2, "broken link example: credit prefix only");
  }

  // Zero-weight unit never credits
  const zeroUnits = acf.units.filter((u) => u.creditWeight === 0);
  for (const z of zeroUnits) {
    const withZero = udmForMatched([...creditChain, z.id]);
    const zWalk = scoreCoverageChain(acf, withZero);
    assert.ok(!zWalk.creditedUnits.includes(z.id), `zero-weight unit ${z.id} must never credit`);
  }
}

describe("coverage_chain scorer", () => {
  test("generic harness passes on standard A->B->C->D chain", () => {
    runCoverageChainHarness(makeChainAcf());
  });

  test("required relation gate stops downstream credit", () => {
    const acf = makeChainAcf();
    const udm = udmForMatched(["u1", "u2", "u3", "u4"], ["r1"]);
    const walk = scoreCoverageChain(acf, udm);
    assert.equal(walk.score, 2);
    assert.deepEqual(walk.creditedUnits, ["u1", "u2"]);
    assert.ok(walk.blockedUnits.includes("u3"));
  });

  test("zero-weight invariant throws if violated", () => {
    const acf = makeChainAcf({
      units: [
        { id: "u1", type: "fact", content: "A", aliases: [], creditWeight: 0, required: true },
      ],
      relations: [],
      maxScore: 1,
      markRule: { kind: "coverage_chain", maxMarks: 1 },
    });
    const udm = udmForMatched(["u1"]);
    const walk = scoreCoverageChain(acf, udm);
    assert.equal(walk.score, 0);
    assert.deepEqual(walk.creditedUnits, []);
  });

  test("score never exceeds maxMarks", () => {
    const acf = makeChainAcf({ maxScore: 2, markRule: { kind: "coverage_chain", maxMarks: 2 } });
    const udm = udmForMatched(["u1", "u2", "u3", "u4"], ["r1", "r2", "r3"]);
    const walk = scoreCoverageChain(acf, udm);
    assert.equal(walk.score, 2);
  });

  test("pressure-cooker style chain semantics (representative)", () => {
    const acf = makeChainAcf({
      question: "Explain why food cooks faster in a pressure cooker.",
      maxScore: 2,
      markRule: { kind: "coverage_chain", maxMarks: 2 },
      units: [
        { id: "u1", type: "fact", content: "Higher pressure in cooker", aliases: [], creditWeight: 1, required: true },
        { id: "u2", type: "fact", content: "Water boils above 100°C", aliases: [], creditWeight: 1, required: true },
        { id: "u3", type: "fact", content: "Food cooks faster", aliases: [], creditWeight: 0, required: false, supports: ["u2"] },
      ],
      relations: [
        { id: "r1", type: "causes", from: "u1", to: "u2", requiredForMarks: true },
        { id: "r2", type: "causes", from: "u2", to: "u3", requiredForMarks: false },
      ],
    });

    const partial = udmForMatched(["u1"], []);
    assert.equal(scoreCoverageChain(acf, partial).score, 1);

    const skipLink = udmForMatched(["u1", "u3"], []);
    const skipWalk = scoreCoverageChain(acf, skipLink);
    assert.equal(skipWalk.score, 1);
    assert.ok(!skipWalk.creditedUnits.includes("u3"));

    runCoverageChainHarness(acf);
  });
});
