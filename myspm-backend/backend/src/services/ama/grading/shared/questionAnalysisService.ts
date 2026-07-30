/**
 * Deterministic question analysis for SPM grading (command words, demand shape,
 * suggested marks). No LLM — keeps behaviour stable across subjects.
 */

import { hasCompoundAndDemand } from "../shared/gradingChecks";
import { hasTwoDistinctDemandsJoinedByAnd } from "../shared/gradingPolicy";
import { recommendWholeMarkCountForStem } from "../extraction/markingPointDecomposition";
import { recommendCalculationMaxScore } from "../case/calculationPartDetect";
import { inferMaxScoreFromMarkScheme } from "../case/markSchemeInference";
import type {
  DemandType,
  EquationType,
  QuestionAnalysis,
  QuestionGradingStrictness,
  QuestionUnderstandingDepth,
} from "../../types";

const STOP = new Set([
  "the", "and", "for", "are", "was", "with", "from", "that", "this", "into", "each", "their", "they", "them",
  "when", "than", "then", "will", "been", "being", "have", "has", "had", "not", "but", "its", "one", "two",
  "may", "can", "use", "uses", "used", "using", "also", "only", "very", "such", "more", "most", "less", "like",
  "just", "even", "other", "onto", "upon", "over", "under", "both", "some", "any", "all", "per", "via", "your",
  "diagram", "figure", "graph", "table", "text", "experiment", "based", "according", "passage",
]);

function norm(q: string): string {
  return (q || "")
    .toLowerCase()
    .replace(/\r/g, "\n")
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopicKeywords(question: string): string[] {
  const t = norm(question).replace(/[^a-z0-9\s]/g, " ");
  const words = t.split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12);
}

function splitQuestionClauses(question: string): string[] {
  const s = norm(question);
  if (!s) return [];
  return s
    .split(/\s*(?:,|;|\band\b|\bdan\b|\bwhereas\b|\bwhile\b|\bbut\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

function normalizeConceptText(text: string): string {
  return text
    .replace(/\b(?:state|name|list|give|define|identify|explain|describe|compare|justify|predict|calculate)\b/gi, "")
    .replace(/\b(?:nyatakan|namakan|senaraikan|beri|takrifkan|kenal\s*pasti|terangkan|huraikan|bandingkan|jelaskan|hitung|kira)\b/gi, "")
    .replace(/\b(?:why|how|what|which|apakah|mengapa|bagaimana)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOptionalDetailClause(clause: string): boolean {
  return /\b(e\.g\.|eg|for example|such as|including|contoh|seperti|misalnya|iaitu)\b/i.test(clause);
}

function extractCoreAndOptionalConcepts(question: string, questionType: QuestionAnalysis["questionType"]): {
  coreConcepts: string[];
  optionalDetails: string[];
} {
  const clauses = splitQuestionClauses(question);
  const core: string[] = [];
  const optional: string[] = [];

  for (const clause of clauses) {
    const concept = normalizeConceptText(clause);
    if (!concept || concept.length < 4) continue;
    if (isOptionalDetailClause(clause)) optional.push(concept);
    else core.push(concept);
  }

  if (core.length === 0) {
    const fallback = normalizeConceptText(question);
    if (fallback.length > 0) core.push(fallback);
  }

  const coreUnique = [...new Set(core)].slice(0, questionType === "compare_contrast" ? 4 : 3);
  const optionalUnique = [...new Set(optional)]
    .filter((item) => !coreUnique.includes(item))
    .slice(0, 6);
  return { coreConcepts: coreUnique, optionalDetails: optionalUnique };
}

function deriveRequiredDepth(suggestedMaxScore: number, questionType: QuestionAnalysis["questionType"]): QuestionUnderstandingDepth {
  if (questionType === "calculation" || questionType === "sequence_order") {
    return suggestedMaxScore >= 4 ? "detailed_multi_step_reasoning" : "linked_multi_concept_explanation";
  }
  if (suggestedMaxScore <= 1) return "single_concept";
  if (suggestedMaxScore <= 2) return "short_conceptual_explanation";
  if (suggestedMaxScore <= 4) return "linked_multi_concept_explanation";
  return "detailed_multi_step_reasoning";
}

function deriveStrictness(
  commandWord: CommandWord,
  questionType: QuestionAnalysis["questionType"],
  suggestedMaxScore: number,
): QuestionGradingStrictness {
  if (["state", "name", "list", "identify", "define"].includes(commandWord) || questionType === "fixed_answer") {
    return "strict";
  }
  if (questionType === "open_ended_example" || questionType === "cause_effect" || questionType === "general") {
    return suggestedMaxScore >= 5 ? "moderate" : "flexible";
  }
  if (questionType === "compare_contrast" || questionType === "calculation" || questionType === "sequence_order") {
    return "moderate";
  }
  return "moderate";
}

function questionRequiresExamples(question: string): boolean {
  return /\b(example|examples|for example|contoh|beri\s+contoh|berikan\s+contoh)\b/i.test(question);
}

export type CommandWord = QuestionAnalysis["commandWord"];

function detectCommandWord(q: string): CommandWord {
  const s = norm(q);
  const tryLead = (w: string, cw: CommandWord) =>
    s.startsWith(`${w} `) || s.startsWith(`${w}:`) || s === w ? cw : null;
  return (
    tryLead("state", "state") ||
    tryLead("nyatakan", "state") ||
    tryLead("name", "name") ||
    tryLead("namakan", "name") ||
    tryLead("list", "list") ||
    tryLead("senaraikan", "list") ||
    tryLead("give", "give") ||
    tryLead("define", "define") ||
    tryLead("takrifkan", "define") ||
    tryLead("explain", "explain") ||
    tryLead("terangkan", "explain") ||
    tryLead("jelaskan", "explain") ||
    tryLead("discuss", "discuss") ||
    tryLead("bincangkan", "discuss") ||
    tryLead("describe", "describe") ||
    tryLead("huraikan", "describe") ||
    tryLead("compare", "compare") ||
    tryLead("bandingkan", "compare") ||
    tryLead("differentiate", "compare") ||
    tryLead("calculate", "calculate") ||
    tryLead("hitung", "calculate") ||
    tryLead("identify", "identify") ||
    tryLead("kenal pasti", "identify") ||
    (/\bwhich\s+(type|kind|sort)\s+of\b/.test(s) ? "identify" : null) ||
    (/\bwhat\s+is\s+the\s+(primary\s+)?purpose\b/.test(s) ? "general" : null) ||
    "general"
  );
}

function detectMcqLike(q: string): boolean {
  const t = q.replace(/\r/g, "\n");
  return /\bA\s*[\.)]\s*\S/m.test(t) && /\bB\s*[\.)]\s*\S/m.test(t);
}

function requiresFeatureFunctionFromStem(q: string, commandWord: CommandWord): boolean {
  const s = norm(q);
  if (commandWord === "explain" || commandWord === "discuss") return true;
  if (/\b(discuss|bincangkan)\b/.test(s)) return true;
  if (commandWord === "describe") {
    return /\b(adapted|adaptation|function|role|effect|importance|how|why|advantage|helps|enable|allows|peranan|fungsi|kesan|mengapa|bagaimana|kepentingan|adaptasi)\b/i.test(
      s,
    );
  }
  return false;
}

function requiresCausalLinkFromStem(q: string, commandWord: CommandWord): boolean {
  const s = norm(q);
  if (commandWord === "explain" || commandWord === "discuss") return true;
  if (/\b(explain\s+why|why\s+does|why\s+do|mengapa|kenapa|give\s+reasons?)\b/i.test(s)) return true;
  if (commandWord === "describe" && requiresFeatureFunctionFromStem(q, commandWord)) return true;
  return false;
}

const DEMAND_DETECTORS: { type: DemandType; re: RegExp }[] = [
  {
    type: "equation",
    re: /\b(write\s+the\s+equation|write\s+a\s+balanced\s+equation|complete\s+the\s+equation|write\s+the\s+chemical\s+equation|tuliskan\s+persamaan|persamaan\s+kimia|persamaan\s+seimbang)\b/i,
  },
  {
    type: "diagram_label",
    re: /\b(label|draw\s+the\s+diagram|complete\s+the\s+diagram|mark\s+on|labelkan|lukiskan|tandakan)\b/i,
  },
  {
    type: "essay",
    re: /\b(discuss|elaborate|write\s+an\s+essay|explain\s+in\s+detail|bincangkan|huraikan\s+dengan\s+terperinci)\b/i,
  },
  {
    type: "comparison",
    re: /\b(compare|differences?\s+between|similarities?\s+between|similarities?\s+and\s+differences?|differences?\s+and\s+similarities?|bandingkan|perbezaan\s+antara|persamaan\s+antara|persamaan\s+dan\s+perbezaan|perbezaan|persamaan|differentiate|distinguish|bezakan)\b/i,
  },
  // Calculation demand is owned by the Question Classification Agent (not stem regex).
  {
    type: "example",
    re: /\b(give\s+an\s+example|state\s+one\s+example|state\s+an\s+example|name\s+one|give\s+one|berikan\s+contoh|nyatakan\s+satu\s+contoh|namakan\s+satu)\b/i,
  },
  {
    type: "application",
    re: /\b(suggest|predict|what\s+would\s+happen|cadangkan|ramalkan|apakah\s+yang\s+akan\s+berlaku)\b/i,
  },
  {
    type: "definition",
    re: /\b(define|what\s+is\s+meant\s+by|takrifkan|apakah\s+yang\s+dimaksudkan)\b/i,
  },
  {
    type: "explanation",
    re: /\b(explain|describe|how|why|account\s+for|terangkan|huraikan|bagaimana|mengapa)\b/i,
  },
  {
    type: "recall",
    re: /\b(state|name|identify|list|give|what\s+is|nyatakan|namakan|kenalpasti|senaraikan)\b/i,
  },
];

function detectDemandTypes(q: string): { demandType: DemandType; compoundDemandTypes: DemandType[] } {
  const s = norm(q);
  const found: DemandType[] = [];
  for (const { type, re } of DEMAND_DETECTORS) {
    if (re.test(s)) found.push(type);
  }
  // Calculation demand is NOT inferred from stem structure / numbers / equations.
  // Top-level Question Classification Agent owns calculation routing.
  if (found.length === 0) return { demandType: "recall", compoundDemandTypes: ["recall"] };
  return { demandType: found[0], compoundDemandTypes: [...new Set(found)] };
}

function detectEquationMeta(q: string, demandType: DemandType): { isEquationQuestion: boolean; equationType: EquationType } {
  if (demandType !== "equation") return { isEquationQuestion: false, equationType: null };
  const s = norm(q);
  if (/\b(word\s+equation|persamaan\s+perkataan)\b/i.test(s)) return { isEquationQuestion: true, equationType: "word" };
  if (/\b(ionic\s+equation|persamaan\s+ion)\b/i.test(s)) return { isEquationQuestion: true, equationType: "ionic" };
  if (/\b(half\s+equation|setengah\s+persamaan)\b/i.test(s)) return { isEquationQuestion: true, equationType: "half" };
  return { isEquationQuestion: true, equationType: "symbol" };
}

function classifyQuestionType(q: string, commandWord: CommandWord): QuestionAnalysis["questionType"] {
  const s = norm(q);
  if (detectMcqLike(q)) return "mcq";
  // Body-level comparison override: check the full sentence, not just the leading verb.
  // Catches "State TWO differences between...", "List the similarities...", etc.
  if (
    /\bcompare\b|\bbandingkan\b|\bdifferentiate\b|\bbezakan\b/i.test(s) ||
    /\bdifferences?\s+between\b/i.test(s) ||
    /\bsimilarities?\s+between\b/i.test(s) ||
    /\bsimilarities?\s+and\s+differences?\b/i.test(s) ||
    /\bperbezaan\s+antara\b/i.test(s) ||
    /\bpersamaan\s+antara\b/i.test(s) ||
    /\bpersamaan\s+dan\s+perbezaan\b/i.test(s) ||
    /\bdifferences?\s+and\s+similarities?\b/i.test(s)
  ) return "compare_contrast";
  // Do NOT classify calculation from numbers/equations/structure — the dedicated
  // Question Classification Agent owns the calculation lane.
  const asksForExample =
    /\b(give\s+(an?\s+)?example|name\s+an?\s+example|state\s+an?\s+example|berikan\s+contoh|beri\s+contoh)\b/i.test(s) ||
    (commandWord === "give" && /\bexample|contoh\b/i.test(s));
  if (asksForExample && /\band\b|\bdan\b/i.test(s)) {
    return "open_ended_example";
  }
  if (
    asksForExample ||
    (/\b(examples|contoh|kegunaan|application|suggest|cadangan|advantage|disadvantage)\b/i.test(s) &&
      !/\bconsidered\s+an?\s+example\s+of\b/i.test(s))
  ) {
    return "open_ended_example";
  }
  if (/\b(purpose|function|role|why\s+does|importance|peranan|fungsi|tujuan)\b/i.test(s) && commandWord !== "describe") {
    return "function_purpose";
  }
  if (commandWord === "describe" && !requiresFeatureFunctionFromStem(q, commandWord)) return "structure_description";
  if (
    /\b(sequence|urutan|order of|correct order|in order|stages?\s+of|steps?\s+in|organisation|organization|hierarchy|levels?\s+of|peringkat|development of|evolution of|history of)\b/i.test(
      s,
    ) &&
    /\b(list|state|arrange|describe|explain|outline|nyatakan|senaraikan|huraikan|terangkan)\b/i.test(s)
  ) {
    return "sequence_order";
  }
  if (/\b(explain|why|because|kerana|effect|cause)\b/i.test(s) || commandWord === "explain") return "cause_effect";
  if (/\b(state|name|list|give|identify|define)\b/i.test(s) || ["state", "name", "list", "give", "identify", "define"].includes(commandWord)) {
    return "fixed_answer";
  }
  return "general";
}

function suggestedMaxFromStem(
  q: string,
  analysis: Pick<QuestionAnalysis, "commandWord" | "questionType" | "isCompoundQuestion">,
): number {
  const fromScheme = inferMaxScoreFromMarkScheme(q, suggestedMaxFromStemSimple(analysis));
  if (fromScheme.source !== "client") {
    return fromScheme.maxScore;
  }
  return suggestMaxMarksFromQuestionStructure(q, analysis);
}

function suggestedMaxFromStemSimple(analysis: Pick<QuestionAnalysis, "commandWord" | "questionType" | "topLevelQuestionType">): number {
  if (analysis.questionType === "mcq") return 1;
  if (analysis.topLevelQuestionType === "calculation" || analysis.commandWord === "calculate") return 3;
  if (analysis.questionType === "compare_contrast") return 4;
  if (analysis.commandWord === "explain" || analysis.commandWord === "discuss") return 4;
  if (analysis.commandWord === "describe") return 3;
  if (["state", "name", "list", "identify", "define", "give"].includes(analysis.commandWord)) return 2;
  return 2;
}

/**
 * Structure/type-driven mark allocation for generated questions when no mark scheme
 * (Markah / marking points) is present yet. Restored from pre-merge question-gen logic.
 */
export function suggestMaxMarksFromQuestionStructure(
  question: string,
  analysis?: Pick<QuestionAnalysis, "commandWord" | "questionType" | "isCompoundQuestion"> | null,
): number {
  // Strip "(N marks)" so a display suffix cannot collapse allocation via \b1\b.
  const q = (question || "")
    .replace(/\(\s*\d{1,2}\s*(?:marks?|markah)\s*\)/gi, " ")
    .replace(/\[\s*\d{1,2}\s*(?:marks?|markah)\s*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const s = norm(q);
  const resolved =
    analysis ??
    (() => {
      const commandWord = detectCommandWord(q);
      const questionType = classifyQuestionType(q, commandWord);
      const isCompoundQuestion = hasCompoundAndDemand(q) || hasTwoDistinctDemandsJoinedByAnd(q);
      return { commandWord, questionType, isCompoundQuestion };
    })();

  if (resolved.questionType === "mcq") return 1;

  // Identify/name/list + role/function/explain: whole marks only (name + elaboration
  // per item). MUST run before the "two + state → 2" / bare "identify → 1" shortcuts,
  // which otherwise fuse name+role into one mark and award 0 when the student names only.
  {
    const { demandType, compoundDemandTypes } = detectDemandTypes(q);
    const wholeMarkPlan = recommendWholeMarkCountForStem(q, {
      commandWord: resolved.commandWord,
      isCompoundQuestion: resolved.isCompoundQuestion,
      demandType,
      compoundDemandTypes,
    });
    if (wholeMarkPlan != null) return wholeMarkPlan;
  }

  const evolutionLike =
    /\b(evolution\s+of|development\s+of|history\s+of|sequence\s+of|from\s+.+\s+to\s+.+)\b/i.test(s) &&
    /\b(dalton|thomson|rutherford|bohr|model|stage|scientist|teori|teori atom)\b/i.test(s);

  // Explicit item counts in the stem ("State three…", "List two…") — pure recall only.
  if (/\b(five|5|lima)\s+(reason|point|factor|example|item|perbezaan|persamaan)/i.test(s)) return 5;
  if (/\b(four|4|empat)\b/.test(s) && /\b(state|give|list|name|nyatakan|senaraikan|bandingkan)/i.test(s)) {
    return 4;
  }
  if (/\b(three|3|tiga)\b/.test(s) && /\b(state|give|list|name|nyatakan|senaraikan|bandingkan)/i.test(s)) {
    return 3;
  }
  if (
    /\b(two|2|dua)\b/.test(s) &&
    /\b(state|give|list|property|properties|difference|differences|nyatakan|senaraikan|bandingkan)/i.test(s)
  ) {
    return 2;
  }
  // Explicit verbal "one" only — never match digit 1 from a "(1 mark)" display suffix.
  if (
    /\b(one|a\s+single|only\s+one)\b/i.test(s) &&
    /\b(state|give|name|identify|nyatakan|namakan)\b/i.test(s)
  ) {
    return 1;
  }
  // Narrow single-answer cue only. Bare "identify" is handled by whole-mark plan / fixed_answer.
  if (/\bwhich\s+(type|kind|sort)\s+of\b/i.test(s)) return 1;

  const compound =
    resolved.isCompoundQuestion || hasCompoundAndDemand(q) || hasTwoDistinctDemandsJoinedByAnd(q);
  if (compound) return Math.max(2, suggestedMaxFromStemSimple(resolved));

  if (evolutionLike) return 4;
  if (resolved.questionType === "calculation") {
    return recommendCalculationMaxScore(q);
  }
  if (resolved.questionType === "sequence_order") return 3;
  if (resolved.questionType === "compare_contrast") return 4;
  if (resolved.questionType === "cause_effect" || /\bexplain\s+why\b|\bmengapa\b/i.test(s)) {
    if (/\b(process|mechanism|sequence|stages?|development|evolution|langkah|urutan|peringkat)\b/i.test(s)) {
      return 4;
    }
    return 3;
  }
  if (resolved.questionType === "function_purpose" || /\b(primary\s+)?purpose\b|\bmain\s+function\b/i.test(s)) {
    return 2;
  }
  if (resolved.questionType === "structure_description") return 3;
  if (resolved.questionType === "open_ended_example") return 2;
  if (resolved.questionType === "fixed_answer") {
    if (/\b(two|2|dua)\b/.test(s)) return 2;
    return 2;
  }

  return suggestedMaxFromStemSimple(resolved);
}

export function analyzeQuestion(question: string, subject?: string | null): QuestionAnalysis {
  const q = (question || "").trim();
  const s = norm(q);
  const commandWord = detectCommandWord(q);
  const { demandType, compoundDemandTypes } = detectDemandTypes(q);
  const { isEquationQuestion, equationType } = detectEquationMeta(q, demandType);
  const questionType = classifyQuestionType(q, commandWord);
  const isCompoundQuestion = hasCompoundAndDemand(q) || hasTwoDistinctDemandsJoinedByAnd(q);
  const isOpenEnded =
    questionType === "open_ended_example" ||
    questionType === "cause_effect" ||
    questionType === "compare_contrast" ||
    /\b(example|examples|suggest|discuss|explain|describe|compare)\b/i.test(s);
  const requiresCausalLink = requiresCausalLinkFromStem(q, commandWord);
  const requiresFeatureFunction = requiresFeatureFunctionFromStem(q, commandWord);
  const suggestedMaxScore = suggestedMaxFromStem(q, {
    commandWord,
    questionType,
    isCompoundQuestion,
  });
  const { coreConcepts, optionalDetails } = extractCoreAndOptionalConcepts(q, questionType);
  const requiredDepth = deriveRequiredDepth(suggestedMaxScore, questionType);
  const gradingStrictness = deriveStrictness(commandWord, questionType, suggestedMaxScore);
  const requiresExamples = questionRequiresExamples(q);

  let expectedAnswerStyle = "Short SPM-style points matching the command word.";
  if (questionType === "structure_description") expectedAnswerStyle = "Name visible structures/parts; causal links optional unless the stem asks for adaptation.";
  if (questionType === "cause_effect") expectedAnswerStyle = "Linked explanation (because / so that / to …) with science ideas.";
  if (questionType === "open_ended_example") expectedAnswerStyle = "Valid category example plus matching use/function where asked.";
  if (questionType === "compare_contrast") expectedAnswerStyle = "Paired similarities and differences.";
  if (questionType === "sequence_order") {
    expectedAnswerStyle =
      "Stages or levels in the correct order only (e.g. cell → tissue → organ → system → organism). Wrong order = wrong even if all names are present.";
  }

  return {
    subject: subject?.trim() || "General",
    topicKeywords: extractTopicKeywords(q),
    commandWord,
    questionType,
    demandType,
    compoundDemandTypes,
    isEquationQuestion,
    equationType,
    isOpenEnded,
    isCompoundQuestion,
    expectedAnswerStyle,
    suggestedMaxScore,
    requiresCausalLink,
    requiresFeatureFunction,
    requiredDepth,
    coreConcepts,
    optionalDetails,
    requiresExamples,
    gradingStrictness,
  };
}
