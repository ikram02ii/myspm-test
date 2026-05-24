/**
 * Subject-agnostic rubric-building hints from question shape (command word, demand type).
 * Used in LLM prompts — not hardcoded per-topic answer keys.
 */

import type { QuestionAnalysis } from "./types";

export type RubricStructureContext = Pick<
  QuestionAnalysis,
  "questionType" | "commandWord" | "isCompoundQuestion" | "expectedAnswerStyle"
>;

export function buildRubricStructureHintLines(ctx: RubricStructureContext, maxScore: number): string[] {
  const lines: string[] = [
    `Demand shape: ${ctx.questionType}; command word: ${ctx.commandWord}; maxScore: ${maxScore}.`,
    `Expected answer style: ${ctx.expectedAnswerStyle}`,
    "Every rubric row = one independently markable point. No paragraph summaries that bundle several points.",
  ];

  if (ctx.isCompoundQuestion) {
    lines.push(
      "Compound stem (two demands joined by and/dan): allocate at least one mark per distinct demand; do not merge both demands into one row.",
    );
  }

  switch (ctx.questionType) {
    case "cause_effect":
      lines.push(
        "Cause-effect / explain-why: use separate atomic rows for each distinct mechanism step (not one row that lists the whole chain).",
        "Do not require students to repeat context already in the stem (e.g. the condition named in the question).",
        "Accept concise scientific wording without because/therefore if the idea is clear.",
      );
      if (maxScore >= 3) {
        lines.push("When maxScore is 3+, prefer three separate mechanism points rather than one summary row.");
      }
      break;
    case "function_purpose":
      lines.push(
        "Function / purpose / role: if maxScore >= 2, split (1) what the structure/process does or carries, and (2) direction/route/context where relevant (source → destination, input → output, before → after).",
        "A one-line answer that only names the function without route/detail should earn at most one mark when two are available.",
      );
      break;
    case "structure_description":
      lines.push(
        "Structure / describe visible parts: one mark per named part or feature unless the stem asks for adaptation/function links.",
      );
      break;
    case "open_ended_example":
      lines.push(
        "Example + use (or similar): separate rows for valid example/category and for matching use/function where the stem asks both.",
      );
      break;
    case "compare_contrast":
      lines.push("Comparison: separate rows for valid comparison dimensions (similarity and/or difference as appropriate).");
      break;
    case "calculation":
      lines.push("Calculation: separate rows for method/setup, working, and final value/units as appropriate to maxScore.");
      break;
    case "fixed_answer":
      lines.push(
        "Fixed short answer: if only one term or phrase is required, one row worth maxScore; if the stem asks for two items (e.g. two properties), two rows.",
      );
      break;
    default:
      break;
  }

  return lines;
}
