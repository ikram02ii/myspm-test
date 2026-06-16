import { analyzeQuestion } from "../questionAnalysisService";
import { questionInvitesOpenTopicRecall } from "../gradingPolicy";
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

function defaultAssessedUnderstanding(family: AssessmentIntentFamily, analysis: QuestionAnalysis): string {
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
    case "calculation":
      return `Correct method, working, and final answer (${style}).`;
    default:
      return `Understanding required by the question at SPM level (${style}).`;
  }
}

export function defaultMarkRuleKind(family: AssessmentIntentFamily, openPool: boolean): import("./types").MarkRuleKind {
  if (openPool || family === "recall" || family === "effects_evaluative") return "count_distinct_units";
  if (family === "explanation" || family === "definition") return "coverage_chain";
  if (family === "process") return "ordered_stages";
  if (family === "comparison") return "paired_entities";
  if (family === "humanities") return "claim_plus_reason";
  return "coverage_chain";
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
  const openPool = questionInvitesOpenTopicRecall(question) || family === "recall";

  return {
    category,
    family,
    assessedUnderstanding: defaultAssessedUnderstanding(family, analysis),
    isCompound: analysis.isCompoundQuestion,
    analysis,
  };
}

export function intentGuidanceForLlm(intent: AssessmentIntent, maxScore: number): string[] {
  switch (intent.family) {
    case "recall":
      return [
        "Extract a broad pool of independent valid recall items from the evidence.",
        "Each creditworthy item: creditWeight=1, required=false unless stem demands a specific item.",
        `Mark rule: count_distinct_units, openPool=true, max ${maxScore} marks awarded for any correct N.`,
      ];
    case "explanation":
      return [
        "Extract 2–4 concept units and ONE primary relation chain (cause→effect, need→purpose, etc.).",
        "Supporting facts: creditWeight=0, supports=[main unit id].",
        "Do NOT create separate credit units for prerequisites that only support the main explanation.",
        `Default: one complete explanation earns full ${maxScore} marks (coverage_chain).`,
      ];
    case "process":
      return [
        "Extract meaningful stages only — not micro-facts within a stage.",
        "Link stages with sequence_next relations.",
        "Mark rule: ordered_stages.",
      ];
    case "comparison":
      return [
        "Extract entity units and comparison dimension units.",
        "Use contrasts relations requiring both entities.",
        "Mark rule: paired_entities.",
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
    default:
      return [
        "Extract examiner-creditable understanding units only.",
        "Apply independence test before creating multiple units.",
      ];
  }
}
