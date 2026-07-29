/**
 * Deterministic OCR plain-text cleanup + topic-bleed heuristics.
 * Run: npx tsx ./scripts/ocr/ocrNormalize.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { normalizeOcrExtractedText } from "../../src/services/ama/ocr/ocrTextNormalize.ts";
import { detectOcrTopicBleed } from "../../src/services/ama/ocr/ocrTopicBleed.ts";

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

describe("detectOcrTopicBleed", () => {
  test("flags physics + chemistry concatenation", () => {
    const hit = detectOcrTopicBleed({
      question: "A car accelerates from rest. Find acceleration and displacement. (m/s)",
      subject: "Physics",
      studentAnswer: [
        "a) V = u + at",
        "V = 10a",
        "a = 2 m/s",
        "b) S = 100 m",
        "Bil mol HA = (0.1)(50)/1000 = 0.005 mol",
        "Isi padu gas hidrogen = 0.0025 × 24 = 0.06 dm³",
      ].join("\n"),
    });
    assert.equal(hit.mixed, true);
    assert.ok(hit.warning);
  });

  test("allows clean physics working", () => {
    const hit = detectOcrTopicBleed({
      question: "Find acceleration using v = u + at",
      subject: "Physics",
      studentAnswer: "V = u + at\nV = 0 + a × 10\na = 2 m/s",
    });
    assert.equal(hit.mixed, false);
  });
});
