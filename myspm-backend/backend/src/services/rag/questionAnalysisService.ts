/**
 * Deterministic question analysis for SPM grading (command words, demand shape,
 * suggested marks). No LLM — keeps behaviour stable across subjects.
 */

import { hasCompoundAndDemand } from "./gradingMaxScoreInference";
import { hasTwoDistinctDemandsJoinedByAnd } from "./gradingCategoryMarking";
import type { DemandType, EquationType, QuestionAnalysis } from "./types";

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
    re: /\b(compare|difference\s+between|similarities|bandingkan|perbezaan|persamaan|differentiate|distinguish|bezakan)\b/i,
  },
  {
    type: "calculation",
    re: /\b(calculate|find\s+the|determine|compute|work\s+out|kira|cari|tentukan|hitungkan)\b/i,
  },
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
  if (/\bcompare\b|\bbandingkan\b|\bdifferentiate\b|\bbezakan\b/i.test(s)) return "compare_contrast";
  if (/\b(calculate|hitung|kira|find\s+the\s+value|hitungkan)\b/i.test(s)) return "calculation";
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

function suggestedMaxFromStem(q: string, analysis: Pick<QuestionAnalysis, "commandWord" | "questionType" | "isCompoundQuestion">): number {
  const s = norm(q);
  const compound = analysis.isCompoundQuestion || hasCompoundAndDemand(q) || hasTwoDistinctDemandsJoinedByAnd(q);
  const evolutionLike =
    /\b(evolution\s+of|development\s+of|history\s+of|sequence\s+of|from\s+.+\s+to\s+.+)\b/i.test(s) &&
    /\b(dalton|thomson|rutherford|bohr|model|stage|scientist|teori|teori atom)\b/i.test(s);

  if (/\b(five|5|lima)\s+(reason|point|factor|example|item)/i.test(s)) return 5;
  if (/\b(four|4|empat)\b/.test(s) && /\b(state|give|list|name|nyatakan|senaraikan)/i.test(s)) return 4;
  if (/\b(three|3|tiga)\b/.test(s) && /\b(state|give|list|name|nyatakan|senaraikan)/i.test(s)) return 3;
  if (/\b(two|2|dua)\b/.test(s) && /\b(state|give|list|property|properties|nyatakan|senaraikan)/i.test(s)) return 2;
  if (/\b(one|1|a\s+single|only\s+one)\b/.test(s) && /\b(state|give|name|identify|nyatakan|namakan)/i.test(s)) return 1;
  if (/\bwhich\s+(type|kind|sort)\s+of\b/.test(s) || /\bidentify\b|\bkenal\s*pasti\b/i.test(s)) return 1;

  if (compound) return Math.max(2, suggestedMaxFromStemSimple(analysis));

  if (evolutionLike) return 4;
  if (analysis.questionType === "compare_contrast") return Math.min(6, 4);
  if (analysis.questionType === "cause_effect" || /\bexplain\s+why\b|\bmengapa\b/i.test(s)) {
    if (/\b(process|mechanism|sequence|stages?|development|evolution|langkah|urutan|peringkat)\b/i.test(s)) return 4;
    return 3;
  }
  if (analysis.questionType === "function_purpose" || /\b(primary\s+)?purpose\b|\bmain\s+function\b/i.test(s)) return 2;
  if (analysis.questionType === "structure_description") return Math.min(4, 3);
  if (analysis.questionType === "open_ended_example") return 2;
  if (analysis.questionType === "fixed_answer") {
    if (/\b(two|2|dua)\b/.test(s)) return 2;
    return 2;
  }
  return suggestedMaxFromStemSimple(analysis);
}

function suggestedMaxFromStemSimple(analysis: Pick<QuestionAnalysis, "commandWord" | "questionType">): number {
  if (analysis.questionType === "mcq") return 1;
  if (analysis.commandWord === "explain" || analysis.commandWord === "discuss") return 4;
  return 2;
}

/**
 * Maps analysis bucket → legacy rubric builder questionType string in DB/cache.
 */
export function mapAnalysisToRubricQuestionType(a: QuestionAnalysis): string {
  switch (a.questionType) {
    case "mcq":
      return "general";
    case "compare_contrast":
      return "compare";
    case "calculation":
      return "calculate";
    case "cause_effect":
      return "explain";
    case "structure_description":
      return "describe";
    case "function_purpose":
      return "general";
    case "open_ended_example":
      return "general";
    case "sequence_order":
      return "list";
    case "fixed_answer":
      if (a.commandWord === "define") return "define";
      if (a.commandWord === "identify") return "identify";
      if (a.commandWord === "list") return "list";
      if (a.commandWord === "name") return "name";
      if (a.commandWord === "state") return "state";
      return "general";
    default:
      if (a.commandWord === "discuss") return "discuss";
      return "general";
  }
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
  };
}
