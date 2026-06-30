import { analyzeQuestion } from "../questionAnalysisService";
import { questionInvitesOpenTopicRecall } from "../gradingPolicy";
import { parseStemRequiredItemCount } from "./acfFinalizePolicy";
import {
  inferCalculationPolicy,
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  showWorkingStagePlan,
} from "./calculationAcfPolicy";
import { resolveCalculationDomain } from "./calculationSubjectPolicy";
import type { QuestionAnalysis } from "../../types";
import type { AssessmentIntent, AssessmentIntentCategory, AssessmentIntentFamily } from "./types";

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

function categoryFromAnalysis(analysis: QuestionAnalysis): AssessmentIntentCategory {
  const cmd = analysis.commandWord;
  const qt = analysis.questionType;

  if (qt === "calculation" || analysis.demandType === "calculation") return "calculate";
  if (cmd === "define" || (qt === "fixed_answer" && analysis.demandType === "definition")) return "define";
  if (qt === "compare_contrast") return "compare";
  if (qt === "sequence_order") return "process";
  if (qt === "cause_effect" || analysis.demandType === "explanation") {
    return cmd === "explain" || cmd === "discuss" ? "explain" : "why";
  }
  if (qt === "structure_description" || cmd === "describe") return "describe";
  if (qt === "open_ended_example") return "list";
  if (qt === "function_purpose") return "why";

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
      return "calculate";
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
      const policy = inferCalculationPolicy(question, maxScore, subject);
      if (policy === "show_working") {
        return `Sequential calculation marks: ${showWorkingStagePlan(maxScore, domain).map((s) => s.label).join("; ")} (${style}).`;
      }
      const finalLabel =
        domain === "chemistry" ? CALCULATION_STAGE_LABELS.final : GENERIC_CALCULATION_STAGE_LABELS.final;
      return `${finalLabel} (${style}).`;
    }
    default:
      return `Understanding required by the question at SPM level (${style}).`;
  }
}

export function defaultMarkRuleKind(family: AssessmentIntentFamily, openPool: boolean): import("./types").MarkRuleKind {
  if (openPool || family === "recall" || family === "effects_evaluative") return "count_distinct_units";
  if (family === "calculation") return "count_distinct_units";
  if (family === "explanation" || family === "definition" || family === "description") return "count_distinct_units";
  if (family === "process") return "ordered_stages";
  if (family === "comparison") return "count_distinct_units";
  if (family === "humanities") return "claim_plus_reason";
  return "count_distinct_units";
}

export function classifyAssessmentIntent(params: {
  question: string;
  subject?: string;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
}): AssessmentIntent {
  const question = params.question.trim();
  const analysis = params.questionAnalysis ?? analyzeQuestion(question, params.subject);
  const category = categoryFromAnalysis(analysis);
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
  const policy = inferCalculationPolicy(question, maxScore, subject);
  if (policy === "show_working") {
    const stages = showWorkingStagePlan(maxScore, domain);
    const header =
      domain === "chemistry"
        ? "CHEMISTRY CALCULATION (SPM sequential marks): use ONLY these credit-bearing stages in order:"
        : "CALCULATION (show working): use these credit-bearing stages in order:";
    return [
      header,
      ...stages.map((s, i) => `${i + 1}) ${s.label} (${s.weight} mark${s.weight === 1 ? "" : "s"})`),
      `creditWeight values MUST sum exactly to ${maxScore}.`,
      "Prose definitions (e.g. 'X is defined as...') are NEVER credit units — creditWeight=0, not in requiredForMarks relations.",
      "Relation convention: relation.from = prerequisite, relation.to = dependent; dependent.supports lists prerequisite ids.",
      "Mark rule: ordered_stages, openPool=false, calcPolicy=show_working.",
      "Do NOT use coverage_chain for calculations.",
    ];
  }
  const finalLabel =
    domain === "chemistry" ? CALCULATION_STAGE_LABELS.final : GENERIC_CALCULATION_STAGE_LABELS.final;
  return [
    `CALCULATION (answer only): ONE credit unit — ${finalLabel}.`,
    `That unit creditWeight MUST equal ${maxScore} exactly.`,
    "Prose definitions or formula recitation without working are creditWeight=0 and must NOT gate the answer.",
    "A correct final answer alone earns full marks — reconstructed working is NOT required.",
    "Mark rule: count_distinct_units, openPool=false, calcPolicy=answer_only.",
    "Do NOT use coverage_chain for calculations.",
  ];
}

export function intentGuidanceForLlm(
  intent: AssessmentIntent,
  maxScore: number,
  question = "",
  subject?: string,
): string[] {
  switch (intent.family) {
    case "recall":
      return [
        "Each creditworthy item: creditWeight=1 unless stem specifies otherwise.",
        "creditWeight values MUST sum exactly to max marks.",
        parseStemRequiredItemCount(question) != null
          ? `Stem requires exactly ${parseStemRequiredItemCount(question)} specific items — openPool=false, each item is a separate credit unit.`
          : "Mark rule: count_distinct_units, openPool=true only when any valid syllabus item from a broad category is accepted.",
      ];
    case "explanation":
      return [
        `Extract ${maxScore} independently creditworthy concept unit(s), each creditWeight=1 (or one unit with creditWeight=${maxScore} if a single linked explanation).`,
        "A concise correct explanation earns full marks — do NOT split into mandatory micro-facts.",
        "Supporting facts: creditWeight=0, required=false — never load-bearing.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
    case "definition":
      return [
        `For ${maxScore} mark(s): create ${maxScore} component unit(s) OR one unit with creditWeight=${maxScore} and rich aliases.`,
        "Include SPM paraphrases in aliases (BM/EN, short forms, full-sentence definitions).",
        "Each credit unit creditWeight MUST sum exactly to max marks.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
    case "process":
      return [
        "Extract meaningful stages only — not micro-facts within a stage.",
        "Link stages with sequence_next relations.",
        "Mark rule: ordered_stages.",
      ];
    case "comparison":
      return [
        "Extract one creditworthy contrast point per side (e.g. element vs compound) — max 2 units for 2 marks.",
        "Do NOT use abstract dimension labels without the actual contrasting fact.",
        "Mark rule: count_distinct_units, openPool=false.",
      ];
    case "effects_evaluative":
      return [
        "Each independently creditworthy effect/advantage/disadvantage is one unit.",
        "Do not add supporting-detail units for the same effect.",
        "Mark rule: count_distinct_units.",
      ];
    case "humanities":
      return [
        "Extract claim units and justification units with justifies relations.",
        "Mark rule: claim_plus_reason.",
      ];
    case "calculation":
      return calculationIntentGuidance(maxScore, question, subject);
    default:
      return [
        "Extract examiner-creditable understanding units only.",
        "Apply independence test before creating multiple units.",
      ];
  }
}
