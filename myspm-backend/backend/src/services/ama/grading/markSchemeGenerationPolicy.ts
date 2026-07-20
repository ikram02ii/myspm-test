/**
 * Strict SPM marking-scheme rules for question generation and rubric LLMs.
 * One mark = one distinct, necessary scientific idea — no semantic repetition.
 */

import { buildCalculationMarkSchemeGenerationBlock } from "./v3/calculationAcfPolicy";

export const STRICT_MARK_SCHEME_RULES_LINES = [
  "MANDATORY MARKING SCHEME RULES (binding for every subjective question and rubric):",
  "",
  "1. IDEA-TO-MARK RATIO",
  "- Markah: MUST equal the number of distinct, necessary scientific/chemical ideas required to answer the question.",
  "- If only 2 distinct ideas are needed, Markah: must be 2 — never inflate to 3 by splitting one concept or forcing the student to repeat a phrase.",
  "- Never add a third mark unless a third genuinely independent idea is required.",
  "",
  "2. ELIMINATE SEMANTIC REPETITION",
  "- Each marking point must introduce entirely NEW scientific information or a new layer of analysis.",
  "- Do NOT award separate marks for a general rule and a restatement of that same rule in slightly different words.",
  "- Example (wrong): separate marks for 'Group number = valence electrons' and 'elements in same group have same valence electrons'.",
  "",
  "3. COMPLETE INDEPENDENCE",
  "- A student must be able to earn any individual marking point without being forced to repeat the exact terminology of another.",
  "- Before adding a bullet, ask: could a student demonstrate this point while failing the others? If NO — MERGE into one mark.",
  "",
  "4. FORMATTING (Marking points: section)",
  "- Mark 1: [Core Idea 1] — clear, specific credit criteria.",
  "- Mark 2: [Core Idea 2] — entirely separate, distinct criteria.",
  "- One bullet per mark; bullet count MUST match Markah: exactly.",
  "",
  buildCalculationMarkSchemeGenerationBlock(),
];

export function buildStrictMarkSchemeGenerationBlock(): string {
  return STRICT_MARK_SCHEME_RULES_LINES.join("\n");
}
