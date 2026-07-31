/**
 * Subject OCR profile resolver smoke tests.
 * Run: npx tsx ./scripts/ocr/ocrSubjectProfiles.test.ts
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { resolveOcrSubjectProfile } from "../../src/services/ama/ocr/ocrSubjectProfiles.ts";

describe("resolveOcrSubjectProfile", () => {
  test("maps Chemistry / Kimia", () => {
    assert.equal(resolveOcrSubjectProfile("Chemistry").id, "chemistry");
    assert.equal(resolveOcrSubjectProfile("Kimia").id, "chemistry");
  });

  test("maps Physics / Fizik", () => {
    assert.equal(resolveOcrSubjectProfile("Physics").id, "physics");
    assert.equal(resolveOcrSubjectProfile("Fizik").id, "physics");
  });

  test("maps Biology", () => {
    assert.equal(resolveOcrSubjectProfile("Biology").id, "biology");
  });

  test("maps Math / Additional Math", () => {
    assert.equal(resolveOcrSubjectProfile("Math").id, "math");
    assert.equal(resolveOcrSubjectProfile("Additional Math").id, "math");
  });

  test("unknown falls back to general", () => {
    assert.equal(resolveOcrSubjectProfile("Sejarah").id, "general");
    assert.equal(resolveOcrSubjectProfile("").id, "general");
  });

  test("chemistry prompt mentions equations", () => {
    const p = resolveOcrSubjectProfile("Chemistry");
    assert.match(p.extractionPrompt, /Chemistry/i);
    assert.match(p.extractionPrompt, /H2SO4|chemical/i);
  });

  test("biology prompt emphasizes prose", () => {
    const p = resolveOcrSubjectProfile("Biology");
    assert.equal(p.normalizeMode, "prose");
    assert.match(p.extractionPrompt, /Biology/i);
  });
});
