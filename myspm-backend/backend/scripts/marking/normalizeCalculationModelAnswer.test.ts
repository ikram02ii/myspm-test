/**
 * Deterministic tests for calculation model-answer sanitizer.
 * Run: npx tsx ./scripts/marking/normalizeCalculationModelAnswer.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  calculationModelAnswerSectionLabels,
  hasCompleteCalculationModelAnswerSections,
} from "../../src/services/ama/grading/case/calculationAcfPolicy.ts";
import {
  calculationModelAnswerLooksDirty,
  normalizeCalculationModelAnswer,
} from "../../src/services/ama/grading/extraction/normalizeCalculationModelAnswer.ts";

describe("calculation model answer three-part layout", () => {
  test("section labels always Formula + Working + Final answer", () => {
    for (const marks of [1, 2, 3]) {
      const labels = calculationModelAnswerSectionLabels(marks, "chemistry", "answer_only");
      assert.deepEqual(labels, ["Formula:", "Working:", "Final answer:"]);
      const labels2 = calculationModelAnswerSectionLabels(marks, "chemistry", "show_working");
      assert.deepEqual(labels2, ["Formula:", "Working:", "Final answer:"]);
    }
  });

  test("hasComplete requires all three non-empty sections", () => {
    assert.equal(
      hasCompleteCalculationModelAnswerSections("Final answer: 11.2 dm³"),
      false,
    );
    assert.equal(
      hasCompleteCalculationModelAnswerSections(
        "Formula: V = n × Vm\nWorking: V = 0.5 × 22.4 = 11.2\nFinal answer: 11.2 dm³",
      ),
      true,
    );
  });
});

describe("normalizeCalculationModelAnswer", () => {
  test("unescapes literal \\n and splits sections", () => {
    const raw =
      "Formula: moles = mass ÷ molar mass \\nFinal answer: \\n0.2 mol";
    assert.equal(calculationModelAnswerLooksDirty(raw), true);
    const out = normalizeCalculationModelAnswer(raw);
    assert.match(out, /^Formula: moles = mass ÷ molar mass$/m);
    assert.match(out, /^Final answer: 0\.2 mol$/m);
    assert.doesNotMatch(out, /\\n/);
    assert.doesNotMatch(out, /\\$/m);
  });

  test("strips LaTeX volume working junk", () => {
    const raw =
      "Formula: V = n × Vm\nWorking: V = 0.5 × 22.4 = 11.2\nFinal answer: 11.2 dm³";
    const dirty =
      "Formula: V = n × Vm\nWorking: \\V = n x Vm \\\\[1ex]\nV = 0.5 × 22.4 = 11.2\nFinal answer: 11.2 dm³";
    const out = normalizeCalculationModelAnswer(dirty);
    assert.doesNotMatch(out, /\\V/);
    assert.doesNotMatch(out, /1ex/);
    assert.match(out, /Final answer: 11\.2/);
    assert.equal(hasCompleteCalculationModelAnswerSections(normalizeCalculationModelAnswer(raw)), true);
  });

  test("does not keep formula duplicated inside working", () => {
    const raw = [
      "Formula: n = (mass %) ÷ (atomic mass)",
      "Working: n = (mass %) ÷ (atomic mass)",
      "C = 40 ÷ 12 = 3.33, H = 6.7 ÷ 1 = 6.7, O = 53.3 ÷ 16 = 3. Ratio C:H:O = 1:2:1.",
      "Final answer: Empirical formula = CH₂O",
    ].join("\n");
    const out = normalizeCalculationModelAnswer(raw);
    const workingBlock = out.split(/^Final answer:/m)[0] ?? out;
    const workingOnly = workingBlock.replace(/^Formula:.*$/m, "").replace(/^Working:\s*/m, "");
    assert.doesNotMatch(workingOnly, /^\s*n = \(mass %\) ÷ \(atomic mass\)\s*$/m);
    assert.match(out, /Final answer:.*CH/);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
  });

  test("recovers Working label embedded as literal escape in Formula", () => {
    const raw =
      "Formula: n = (mass %) ÷ (atomic mass)\\nWorking: C = 40 ÷ 12 = 3.33\\nFinal answer: CH2O";
    const out = normalizeCalculationModelAnswer(raw);
    assert.match(out, /^Formula: n = \(mass %\) ÷ \(atomic mass\)$/m);
    assert.match(out, /^Working:/m);
    assert.match(out, /^Final answer:/m);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
  });

  test("recovers Formula from Working-first layout", () => {
    const raw = [
      "Working: V = n × Vm",
      "V = 0.5 × 22.4 = 11.2",
      "Final answer: 11.2 dm³",
    ].join("\n");
    const out = normalizeCalculationModelAnswer(raw);
    assert.match(out, /^Formula:/m);
    assert.match(out, /^Working:/m);
    assert.match(out, /^Final answer:/m);
  });

  test("recovers Formula from conversion Working+Final (benchmark fail shape)", () => {
    const raw = "Working: 1. 1 km = 1000 m\nFinal answer: 2. 3.5 km = 3.5 × 1000 m = 3500 m";
    const out = normalizeCalculationModelAnswer(raw);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
    assert.match(out, /1000/);
    assert.match(out, /3500/);
  });

  test("recovers Working when Formula+Final only (area case)", () => {
    const raw =
      "Formula: 1. The formula to calculate the area of a rectangle is: Area = length × width.\nFinal answer: 2. The area of the rectangular surface is 0.96 m².";
    const out = normalizeCalculationModelAnswer(raw);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
    assert.match(out, /^Working:/m);
    assert.match(out, /0\.96/);
  });

  test("strips broken LaTeX density blob (benchmark P4C1C-04 shape)", () => {
    const raw = [
      "Working: 1. The formula for density is:",
      "[ = m / (V)",
      "]",
      "2. Substitute the given values into the formula:",
      "[ = 1.8 extkg0.002 extm^3",
      "]",
      "3. Calculate the density:",
      "[ = 900 extkg m^-3",
      "Final answer: ]",
    ].join("\n");
    const out = normalizeCalculationModelAnswer(raw);
    assert.doesNotMatch(out, /\bextkg\b/);
    assert.doesNotMatch(out, /\\/);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
    assert.match(out, /900/);
  });

  test("strips thousand commas in final answer", () => {
    const raw = "Working: 1 MW = 1000000 W\nFinal answer: 2.5 MW = 2,500,000 W";
    const out = normalizeCalculationModelAnswer(raw);
    assert.match(out, /2500000/);
    assert.equal(hasCompleteCalculationModelAnswerSections(out), true);
  });

  test("peels standalone final answer with unit out of Working", () => {
    const raw = [
      "Formula: V = n × Vm",
      "Working: n = 0.5 mol",
      "Vm = 22.4 dm³/mol",
      "V = 0.5 × 22.4 = 11.2",
      "11.2 dm³",
      "Final answer: 11.2 dm³",
    ].join("\n");
    const out = normalizeCalculationModelAnswer(raw);
    assert.match(out, /Working:[\s\S]*V = 0\.5 × 22\.4 = 11\.2/i);
    assert.doesNotMatch(out, /Working:[\s\S]*11\.2 dm³[\s\S]*Final answer/i);
    assert.match(out, /^Final answer: 11\.2 dm³$/m);
  });
});
