/**
 * Deterministic OCR plain-text cleanup.
 * Run: npx tsx ./scripts/ocr/ocrNormalize.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { normalizeOcrExtractedText } from "../../src/services/ama/ocr/ocrTextNormalize.ts";
import { repairLooksFaithful } from "../../src/services/ama/ocr/ocrRepairService.ts";

describe("normalizeOcrExtractedText", () => {
  test("strips \\( \\) math delimiters", () => {
    const out = normalizeOcrExtractedText("a) \\( V = u + at \\)\n\\( V = 10a \\)");
    assert.match(out, /V = u \+ at/);
    assert.doesNotMatch(out, /\\\(/);
    assert.doesNotMatch(out, /\\\)/);
  });

  test("formats \\frac as plain slash fractions", () => {
    const out = normalizeOcrExtractedText("S = u + \\frac{1}{2}at^2");
    assert.match(out, /1\/2/);
    assert.doesNotMatch(out, /1\s*\/\s*\(\s*2\s*\)/);
    assert.doesNotMatch(out, /\\frac/);
  });

  test("repairs already-broken 1 / (2) fractions", () => {
    const out = normalizeOcrExtractedText("S = 1 / (2) × 2 × 10^2");
    assert.match(out, /1\/2/);
  });

  test("keeps multi-line calculation order", () => {
    const out = normalizeOcrExtractedText(
      "\\( V = u + at \\)\n\\( V = 0 + a \\times 10 \\)\n\\( a = 2 m/s \\)",
    );
    const lines = out.split("\n").filter(Boolean);
    assert.ok(lines.length >= 3);
    assert.match(lines[0]!, /V = u \+ at/);
    assert.match(lines[lines.length - 1]!, /a = 2 m\/s/);
  });
});

describe("repairLooksFaithful", () => {
  test("accepts light symbol cleanup", () => {
    assert.equal(
      repairLooksFaithful("C3H8 + 5O2 -> 4H2O + 3CO2", "C3H8 + 5O2 → 4H2O + 3CO2"),
      true,
    );
  });

  test("rejects invented answer that replaces equations", () => {
    assert.equal(
      repairLooksFaithful(
        "C3H8 + 5O2 → 4H2O + 3CO2\nCH4 + 2O2 → CO2 + 2H2O",
        "P adalah gas, Q adalah gas, R adalah cecair, S adalah pepejal",
      ),
      false,
    );
  });
});
