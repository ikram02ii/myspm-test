import { analyzeQuestion } from "../shared/questionAnalysisService";
import { questionInvitesOpenTopicRecall } from "../shared/gradingPolicy";
import { parseStemRequiredItemCount } from "../case/acfFinalizePolicy";
import {
  showWorkingStagePlan,
} from "../case/calculationAcfPolicy";
import { resolveCalculationDomain } from "../case/calculationSubjectPolicy";
import {
  buildMarkingPointDecompositionGuidance,
  planIdentifyPlusElaborationMarks,
  stemLeadsWithIdentificationPlusElaboration,
} from "../extraction/markingPointDecomposition";
import type { QuestionAnalysis } from "../../types";
import type { AssessmentIntent, AssessmentIntentCategory, AssessmentIntentFamily } from "../shared/types";
import { topLevelUsesCalculationAgent } from "./questionClassificationAgent";

function familyForCategory(category: AssessmentIntentCategory): AssessmentIntentFamily {
  switch (category) {
    case "state":
    case "name":
    case "list":
    case "identify":
      return "recall";
    case "explain":
    case "why":
      return "explanation";
    case "describe":
      return "description";
    case "compare":
    case "differentiate":
      return "comparison";
    case "advantages":
    case "disadvantages":
    case "effects":
      return "effects_evaluative";
    case "process":
      return "process";
    case "justify":
    case "evaluate":
    case "predict":
      return "humanities";
    case "define":
      return "definition";
    case "calculate":
      return "calculation";
    default:
      return "general";
  }
}

/**
 * Map theory-subtype LLM intent → assessment category.
 * Calculation is NEVER taken from semantic intent — only from topLevelQuestionType.
 */
function categoryFromSemanticIntent(
  intent: NonNullable<QuestionAnalysis["llmSemanticIntent"]>,
): AssessmentIntentCategory | null {
  switch (intent) {
    case "comparison":
      return "compare";
    case "explanation":
      return "explain";
    case "definition":
      return "define";
    case "process":
      return "process";
    case "description":
      return "describe";
    case "calculation":
      // Top-level agent owns calc routing; ignore subtype "calculation" here.
      return null;
    case "recall":
    case "application":
    case "general":
    default:
      return null;
  }
}

/**
 * Resolve assessment category.
 *
 * Calculation routing authority: `analysis.topLevelQuestionType` from the
 * Question Classification Agent ONLY. Regex / numeric / keyword heuristics must
 * not force "calculate".
 */
function categoryFromAnalysis(analysis: QuestionAnalysis, _question: string): AssessmentIntentCategory {
  const cmd = analysis.commandWord;
  const qt = analysis.questionType;

  // Sole calc gate — dedicated LLM Question Classification Agent.
  if (topLevelUsesCalculationAgent(analysis.topLevelQuestionType)) {
    return "calculate";
  }

  // Theory subtyping (command word / fine-grained type / semantic intent).
  if (analysis.llmSemanticIntent) {
    const semanticCategory = categoryFromSemanticIntent(analysis.llmSemanticIntent);
    if (semanticCategory) return semanticCategory;
  }

  if (cmd === "define" || (qt === "fixed_answer" && analysis.demandType === "definition")) return "define";
  if (qt === "compare_contrast") return "compare";
  if (qt === "sequence_order") return "process";
  if (qt === "cause_effect" || analysis.demandType === "explanation") {
    return cmd === "explain" || cmd === "discuss" ? "explain" : "why";
  }
  if (qt === "structure_description" || cmd === "describe") return "describe";
  if (qt === "open_ended_example") return "list";
  if (qt === "function_purpose") return "why";
  // Never treat legacy questionType=calculation as calc without top-level agent.
  if (qt === "calculation") return "general";

  switch (cmd) {
    case "state":
      return "state";
    case "name":
    case "identify":
      return "identify";
    case "list":
      return "list";
    case "compare":
      return "compare";
    case "calculate":
      // Verb alone is not enough — top-level agent must have set calculation.
      return "general";
    case "explain":
      return "explain";
    case "discuss":
      return "evaluate";
    case "give":
      return "list";
    default:
      return "general";
  }
}

function defaultAssessedUnderstanding(
  family: AssessmentIntentFamily,
  analysis: QuestionAnalysis,
  question: string,
  maxScore: number,
  subject?: string,
): string {
  const style = analysis.expectedAnswerStyle || "SPM-level response";
  switch (family) {
    case "recall":
      return `Valid syllabus-level recall items required by the stem (${style}).`;
    case "explanation":
      return `Demonstrated understanding of cause, mechanism, purpose, or consequence (${style}).`;
    case "comparison":
      return `Valid comparison between entities named in the stem (${style}).`;
    case "process":
      return `Correct meaningful stages of the process (${style}).`;
    case "effects_evaluative":
      return `Independently creditworthy effects, advantages, or disadvantages (${style}).`;
    case "humanities":
      return `Significance, justification, evaluation, or supported prediction (${style}).`;
    case "definition":
      return `Complete SPM definition with category and differentiating detail (${style}).`;
    case "calculation": {
      const domain = resolveCalculationDomain(subject ?? "");
      return `Sequential calculation marks: ${showWorkingStagePlan(maxScore, domain).map((s) => s.label).join("; ")} (${style}).`;
    }
    default:
      return `Understanding required by the question at SPM level (${style}).`;
  }
}

export function defaultMarkRuleKind(family: AssessmentIntentFamily, openPool: boolean): import("../shared/types").MarkRuleKind {
  if (openPool || family === "recall" || family === "effects_evaluative") return "count_distinct_units";
  if (family === "calculation") return "count_distinct_units";
  if (family === "explanation" || family === "definition" || family === "description") return "count_distinct_units";
  if (family === "process") return "ordered_stages";
  if (family === "comparison") return "count_distinct_units";
  if (family === "humanities") return "claim_plus_reason";
  return "count_distinct_units";
}

/**
 * Cross-cutting SPM/LPM marking principle: the question command word sets the
 * required answer depth. Used by BOTH marking-point generation and student-answer
 * evaluation so the rubric, the model answer, and the grade stay aligned with
 * what the question actually asks — never with extra detail from the textbook or
 * model answer.
 */
export const COMMAND_WORD_DEPTH_POLICY_LINES: readonly string[] = [
  "ANSWER DEPTH — COMMAND-WORD ALIGNED (binding):",
  "- Always follow the question command word when deciding the required answer depth.",
  "- The marking scheme MUST represent only what the question asks — NOT additional detail from the textbook or model answer.",
  "- Do NOT require explanations, reasons, functions, or mechanisms unless the command word explicitly requires them.",
  "- Do NOT reduce marks because a student did not add detail beyond the command-word requirement.",
] as const;

/**
 * Depth expectation for a specific assessment intent (derived from the command
 * word). Tells the evaluator/generator how much a mark requires for THIS family,
 * so identification questions are not held to explanation-level detail and vice
 * versa. Subject-agnostic — no topic strings.
 */
export function answerDepthDirectiveForIntent(intent: AssessmentIntent): string[] {
  switch (intent.family) {
    case "recall":
      return [
        "COMMAND-WORD DEPTH — State / Name / List / Identify (recall):",
        "- A correct term, keyword, fact, or feature earns the mark on its own.",
        "- Do NOT require any explanation, reason, mechanism, or elaboration.",
        "- Do NOT withhold a mark because the student did not justify or expand a correct answer.",
      ];
    case "definition":
      return [
        "COMMAND-WORD DEPTH — Define:",
        "- Award when the required category and differentiating detail are stated.",
        "- Do NOT require an example, mechanism, or reasoning unless the stem asks for it.",
      ];
    case "description":
      return [
        "COMMAND-WORD DEPTH — Describe:",
        "- Award each correct feature/characteristic/step stated at the required level.",
        "- Require reasoning ONLY when the stem asks how or why.",
      ];
    case "explanation":
      return [
        "COMMAND-WORD DEPTH — Explain / Why / How:",
        "- Award when the required reason, mechanism, or relationship is written.",
        "- A concise correct explanation earns the mark; do NOT require textbook length.",
      ];
    case "comparison":
      return [
        "COMMAND-WORD DEPTH — Compare / Differentiate:",
        "- Award each side's contrast independently when that side's point is stated.",
        "- Require the contrasted attribute; do NOT require extra explanation unless the stem asks for it.",
      ];
    case "process":
      return [
        "COMMAND-WORD DEPTH — Process / Sequence:",
        "- Award correct stages named in the required order.",
        "- Do NOT require the mechanism of each stage unless the stem asks for it.",
      ];
    case "effects_evaluative":
      return [
        "COMMAND-WORD DEPTH — Effects / Advantages / Disadvantages:",
        "- Award each independently correct effect, advantage, or disadvantage.",
        "- Do NOT require justification unless the stem asks for it.",
      ];
    case "humanities":
      return [
        "COMMAND-WORD DEPTH — Justify / Evaluate / Discuss:",
        "- Award a claim together with the supporting reason/evidence the stem requires.",
      ];
    case "calculation":
      return [
        "COMMAND-WORD DEPTH — Calculate:",
        "- Award the credit-bearing stages (and final answer) the mark scheme defines.",
      ];
    default:
      return [
        "COMMAND-WORD DEPTH: match the depth the command word requires — do NOT demand more than the question asks.",
      ];
  }
}

export function classifyAssessmentIntent(params: {
  question: string;
  subject?: string;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
}): AssessmentIntent {
  const question = params.question.trim();
  const analysis = params.questionAnalysis ?? analyzeQuestion(question, params.subject);
  const category = categoryFromAnalysis(analysis, question);
  const family = familyForCategory(category);
  const openPool =
    family !== "calculation" && (questionInvitesOpenTopicRecall(question) || family === "recall");

  return {
    category,
    family,
    assessedUnderstanding: defaultAssessedUnderstanding(family, analysis, question, params.maxScore, params.subject),
    isCompound: analysis.isCompoundQuestion,
    analysis,
  };
}

export function calculationIntentGuidance(maxScore: number, question = "", subject?: string): string[] {
  const domain = resolveCalculationDomain(subject ?? "");
  const stages = showWorkingStagePlan(maxScore, domain);
  const marks = stages.reduce((sum, s) => sum + s.weight, 0);
  const header =
    domain === "chemistry"
      ? "CHEMISTRY CALCULATION (SPM sequential marks): ALWAYS these 3 credit-bearing stages in order:"
      : "CALCULATION (show working): ALWAYS these 3 credit-bearing stages in order:";
  void question;
  return [
    header,
    ...stages.map((s, i) => `${i + 1}) ${s.label} (${s.weight} mark${s.weight === 1 ? "" : "s"})`),
    `creditWeight values MUST sum exactly to ${marks}.`,
    "Prose definitions (e.g. 'X is defined as...') are NEVER credit units — creditWeight=0, not in requiredForMarks relations.",
    "Relation convention: relation.from = prerequisite, relation.to = dependent; dependent.supports lists prerequisite ids.",
    "Mark rule: ordered_stages, openPool=false, calcPolicy=show_working.",
    "Do NOT use coverage_chain for calculations.",
  ];
}

export function intentGuidanceForLlm(
  intent: AssessmentIntent,
  maxScore: number,
  question = "",
  subject?: string,
): string[] {
  const decomposition = buildMarkingPointDecompositionGuidance(
    question,
    maxScore,
    intent.analysis,
  );

  // "Identify X and explain/state roles of X" stems must credit naming each item
  // separately from the elaboration — and use whole marks only (no 0.5).
  const allocation = planIdentifyPlusElaborationMarks(question, intent.analysis);
  const identifyPlusExplain = allocation != null || stemLeadsWithIdentificationPlusElaboration(
    question,
    intent.analysis,
  );
  const splitHint = allocation
    ? `Split into exactly ${allocation.nameUnitCount} identification unit(s) (name alone earns each) + ${allocation.elaborationUnitCount} role/function/explanation unit(s) = ${maxScore} whole marks. NEVER fuse name+role into one unit.`
    : `Split the ${maxScore} marks per the decomposition above: one identification unit per named item (name alone earns it) PLUS separate explanation/function unit(s) — do NOT stop at the identification items.`;

  let familyLines: string[];
  switch (intent.family) {
    case "recall":
      familyLines = [
        "Each creditworthy item: creditWeight=1 unless stem specifies otherwise.",
        "creditWeight values MUST sum exactly to max marks.",
        identifyPlusExplain
          ? splitHint
          : parseStemRequiredItemCount(question) != null
            ? `Stem requires exactly ${parseStemRequiredItemCount(question)} specific items — openPool=false, each item is a separate credit unit.`
            : "Mark rule: count_distinct_units, openPool=true only when any valid syllabus item from a broad category is accepted.",
      ];
      break;
    case "explanation":
      familyLines = [
        identifyPlusExplain
          ? `Create exactly ${maxScore} credit unit(s) total (creditWeight=1 each). ${splitHint}`
          : `Extract exactly ${maxScore} independently creditworthy concept unit(s), each creditWeight=1.`,
        "Never use one unit with creditWeight > 1 — each mark is a separate tick.",
        "A concise correct explanation earns full marks when all units are demonstrated.",
        "Supporting facts: creditWeight=0, required=false — never load-bearing.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
      break;
    case "definition":
      familyLines = [
        `For ${maxScore} mark(s): create exactly ${maxScore} separate component units, each creditWeight=1.`,
        "Never combine all marks into one unit — partial answers must be able to earn 1 mark.",
        "Include SPM paraphrases in aliases (BM/EN, short forms, full-sentence definitions).",
        "Each credit unit creditWeight MUST sum exactly to max marks.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
      break;
    case "process":
      familyLines = [
        "Extract meaningful stages only — not micro-facts within a stage.",
        "Link stages with sequence_next relations.",
        "Mark rule: ordered_stages.",
      ];
      break;
    case "comparison":
      familyLines = [
        "Extract one creditworthy contrast point per side — prefer separate 1-mark units, not one dual-side blob.",
        "Do NOT use abstract dimension labels without the actual contrasting fact.",
        'Also output the structured "comparison" object: name the entities being compared and, per contrasted concept, a dimension with what EACH entity must express and its marks.',
        "Derive dimensions from the underlying concepts, not from contrast words in the text.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
      break;
    case "effects_evaluative":
      familyLines = [
        "Each independently creditworthy effect/advantage/disadvantage is one unit.",
        "Do not add supporting-detail units for the same effect.",
        "Mark rule: count_distinct_units.",
      ];
      break;
    case "humanities":
      familyLines = [
        "Extract claim units and justification units with justifies relations.",
        "Mark rule: claim_plus_reason.",
      ];
      break;
    case "calculation":
      return calculationIntentGuidance(maxScore, question, subject);
    default:
      familyLines = [
        "Extract examiner-creditable understanding units only.",
        "Apply independence test before creating multiple units.",
      ];
      break;
  }

  return [...decomposition, ...familyLines];
}
