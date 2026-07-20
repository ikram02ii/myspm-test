/**
 * Regression: Formula section must survive frontend parsing even when the
 * formula expression has no "=" (weighted averages, mole ratios, chem equations).
 */
import assert from "node:assert/strict";
import {
  parseCalculationModelAnswer,
  prepareCalculationModelAnswerDisplay,
  sanitizeEquationLine,
} from "../utils/parseCalculationSteps.ts";

const cases = [
  {
    name: "chlorine RAM (no equals)",
    raw: "Formula: (percentage × mass) + (percentage × mass) ÷ 100\nWorking: (75 × 35) + (25 × 37) ÷ 100 = 2625 + 925 ÷ 100 = 35.5\nFinal answer: 35.5",
    expectFormula: "(percentage × mass) + (percentage × mass) ÷ 100",
  },
  {
    name: "chem equation",
    raw: "Formula: 2KClO3 → 2KCl + 3O2\nWorking: 0.5 mol × (3/2) = 0.75 mol\nFinal answer: 0.75 mol",
    expectFormula: "2KClO3 → 2KCl + 3O2",
  },
  {
    name: "symbolic equals",
    raw: "Formula: n = m / M\nWorking: n = 10 / 58.5 = 0.171 mol\nFinal answer: 0.171 mol",
    expectFormula: "n = m / M",
  },
];

for (const c of cases) {
  const prepared = prepareCalculationModelAnswerDisplay(c.raw);
  const layout = parseCalculationModelAnswer(prepared.structuredText);
  assert.ok(
    layout.formulaLines.includes(c.expectFormula) || layout.formulaLines[0] === c.expectFormula,
    `${c.name}: expected formula ${JSON.stringify(c.expectFormula)}, got ${JSON.stringify(layout.formulaLines)}`,
  );
  assert.ok(layout.workingLines.length > 0, `${c.name}: missing working`);
  assert.ok(layout.finalLines.length > 0, `${c.name}: missing final`);
}

assert.equal(
  sanitizeEquationLine("0.5 mol × (3/2) = 0.75 mol"),
  "0.5 mol × (3/2) = 0.75 mol",
  "sanitize must not truncate numeric working lines",
);

console.log("parseCalculationSteps regressions passed");
