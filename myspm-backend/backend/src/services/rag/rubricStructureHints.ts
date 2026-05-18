/**
 * Subject-agnostic rubric-building hints from question shape (command word, demand type).
 * Used in LLM prompts — not hardcoded per-topic answer keys.
 */

import type { DemandType, EquationType, QuestionAnalysis } from "./types";

export type RubricStructureContext = Pick<
  QuestionAnalysis,
  | "questionType"
  | "commandWord"
  | "isCompoundQuestion"
  | "expectedAnswerStyle"
  | "demandType"
  | "isEquationQuestion"
  | "equationType"
>;

export function buildDemandTypeRubricHintLines(
  demandType: DemandType,
  maxScore: number,
  equationType: EquationType,
): string[] {
  switch (demandType) {
    case "recall":
      return [
        "recall: Build ONE row worth all marks. Fixed answer. openEnded: false. Never split a single-answer question into multiple rows. kind: \"point\".",
      ];
    case "definition":
      return [
        "definition: Minimum two rows — one for the concept being defined, one for its mechanism or meaning. Each independently markable. kind: \"point\" for both rows. Never merge the term and its meaning into one row.",
      ];
    case "explanation":
      return [
        "explanation: One row per mechanism step. If step B requires step A, set linkedToId. Do not require causal link words — award if the science of the step is present. kind: \"explanation\" for all rows.",
      ];
    case "comparison":
      return [
        "comparison: Rows come in pairs — one row per item per criterion. Label each row with which item it describes. Never merge both sides into one row. kind: \"point\" for all rows.",
      ];
    case "calculation":
      return [
        "calculation: Two rows per calculation step — one kind \"method\", one kind \"accuracy\". The accuracy row must have dependsOnRowId pointing to its method row. Accuracy cannot be awarded if method was not awarded.",
      ];
    case "example":
      return [
        "example: ONE row. openEnded: true. kind: \"example\". keywords describe the category only — never a specific answer. acceptedConcepts: 2–3 illustrative members only, not an exhaustive answer list.",
      ];
    case "application":
      return [
        "application: One row per valid reasoning path. openEnded: true. kind: \"application\". keywords describe the type of reasoning expected, not a specific answer.",
      ];
    case "equation":
      if (equationType === "word") {
        return ["equation (word): Treat as recall. One row. Fixed answer. kind: \"point\"."];
      }
      if (maxScore <= 1) {
        return [
          "equation (symbol/ionic/half): ONE row [max marks]. kind: \"equation\". openEnded: false. keywords must list every chemical species required in the correct answer (reactants AND products). Award only if ALL species are present AND the equation is balanced.",
        ];
      }
      if (maxScore === 2) {
        return [
          "equation: Row 1 [1m] complete equation present (all species), kind \"equation\". Row 2 [1m] equation balanced, kind \"equation\", dependsOnRowId = Row 1 id.",
        ];
      }
      return [
        "equation (3+ marks): Row 1 correct reactants, Row 2 correct complete products, Row 3 balanced — Row 3 dependsOnRowId = Row 2 id. kind \"equation\" for species/balance rows.",
      ];
    case "diagram_label":
      return [
        "diagram_label: One row per label position. Fixed answer. openEnded: false. kind: \"point\". keywords: accepted spellings for that label.",
      ];
    case "essay":
      return [
        "essay: Separate content rows (openEnded: true, kind: \"explanation\") from format/language rows (openEnded: false, kind: \"point\"). Award content and format marks independently.",
      ];
    default:
      return [];
  }
}

export function buildRubricStructureHintLines(ctx: RubricStructureContext, maxScore: number): string[] {
  const lines: string[] = [
    `Demand shape: ${ctx.questionType}; command word: ${ctx.commandWord}; demandType: ${ctx.demandType}; maxScore: ${maxScore}.`,
    `Expected answer style: ${ctx.expectedAnswerStyle}`,
    "Every rubric row = one independently markable point. No paragraph summaries that bundle several points.",
    ...buildDemandTypeRubricHintLines(ctx.demandType, maxScore, ctx.equationType),
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
    case "sequence_order":
      lines.push(
        "Sequence / order / hierarchy / staged process: ONE rubric row per stage IN CORRECT ORDER (row 1 = first stage, row 2 = second, etc.).",
        "Phrase each row as that position (e.g. 'Second level: tissue' or 'Stage 2: Thomson model').",
        "Marks are awarded only when the student puts that stage in the right position — wrong order gets zero for that row.",
        "Do NOT merge the whole sequence into one row unless maxScore is 1.",
        "keywords: accepted names for that stage only; acceptedConcepts: 2–3 valid synonyms.",
        "For 'list the sequence' with maxScore >= 2, split marks across ordered stages — not one monolithic row.",
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
