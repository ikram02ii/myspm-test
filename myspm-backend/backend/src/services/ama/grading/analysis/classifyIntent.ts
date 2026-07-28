import { analyzeQuestion } from "./questionAnalysisService";
import { questionInvitesOpenTopicRecall } from "../shared/gradingPolicy";
import { parseStemRequiredItemCount } from "../case/acfFinalizePolicy";
import {
  inferCalculationPolicy,
  CALCULATION_STAGE_LABELS,
  GENERIC_CALCULATION_STAGE_LABELS,
  showWorkingStagePlan,
} from "../case/calculationAcfPolicy";
import { resolveCalculationDomain } from "../case/calculationSubjectPolicy";
import { buildMarkingPointDecompositionGuidance } from "../extraction/markingPointDecomposition";
import {
  extractEmbeddedSchemePoints,
  hasEmbeddedMarkScheme,
} from "./markSchemeInference";
import { shouldUseCalculationMarking } from "./calculationStructureDetect";
import type { QuestionAnalysis } from "../../types";
import type { AssessmentIntent, AssessmentIntentCategory, AssessmentIntentFamily } from "../shared/types";

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

function categoryFromAnalysis(analysis: QuestionAnalysis, question: string): AssessmentIntentCategory {
  const cmd = analysis.commandWord;
  const qt = analysis.questionType;
  const embeddedPoints = extractEmbeddedSchemePoints(question);

  // Scheme-first: prose marking points → never calculate. Calc stages / numeric structure → calculate.
  if (hasEmbeddedMarkScheme(question)) {
    if (shouldUseCalculationMarking({ question, embeddedPoints })) return "calculate";
    // Fall through to non-calc category from command / question type (skip calc demand).
  } else if (shouldUseCalculationMarking({ question }) || qt === "calculation") {
    return "calculate";
  }

  // demandType "calculation" alone is never enough — only structural detection above.
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
      // Command verb alone is weak — require structure (already checked above).
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

export function defaultMarkRuleKind(family: AssessmentIntentFamily, openPool: boolean): import("../shared/types").MarkRuleKind {
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
  const decomposition = buildMarkingPointDecompositionGuidance(
    question,
    maxScore,
    intent.analysis,
  );

  let familyLines: string[];
  switch (intent.family) {
    case "recall":
      familyLines = [
        "Each creditworthy item: creditWeight=1 unless stem specifies otherwise.",
        "creditWeight values MUST sum exactly to max marks.",
        parseStemRequiredItemCount(question) != null
          ? `Stem requires exactly ${parseStemRequiredItemCount(question)} specific items — openPool=false, each item is a separate credit unit.`
          : "Mark rule: count_distinct_units, openPool=true only when any valid syllabus item from a broad category is accepted.",
      ];
      break;
    case "explanation":
      familyLines = [
        `Extract exactly ${maxScore} independently creditworthy concept unit(s), each creditWeight=1.`,
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
