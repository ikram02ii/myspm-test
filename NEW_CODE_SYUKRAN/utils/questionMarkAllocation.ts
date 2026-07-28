/**
 * Structure/type-driven mark allocation for AI-generated questions.
 * Mirrors backend `suggestMaxMarksFromQuestionStructure` (ama/grading/questionAnalysisService).
 */

type CommandWord =
  | "state"
  | "name"
  | "list"
  | "identify"
  | "define"
  | "give"
  | "explain"
  | "describe"
  | "discuss"
  | "compare"
  | "calculate"
  | "other";

type QuestionKind =
  | "mcq"
  | "calculation"
  | "compare_contrast"
  | "cause_effect"
  | "function_purpose"
  | "structure_description"
  | "open_ended_example"
  | "sequence_order"
  | "fixed_answer"
  | "general";

function norm(q: string): string {
  return (q || "")
    .toLowerCase()
    .replace(/\r/g, "\n")
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCommandWord(q: string): CommandWord {
  const s = norm(q);
  if (/\b(calculate|kira|hitung|compute)\b/i.test(s)) return "calculate";
  if (/\b(compare|contrast|beza|bandingkan|bezakan)\b/i.test(s)) return "compare";
  if (/\b(discuss|bincangkan)\b/i.test(s)) return "discuss";
  if (/\b(explain|terangkan|huraikan|mengapa|why)\b/i.test(s)) return "explain";
  if (/\b(describe|perihalkan|lukiskan)\b/i.test(s)) return "describe";
  if (/\b(define|takrifkan|maksud)\b/i.test(s)) return "define";
  if (/\b(list|senaraikan)\b/i.test(s)) return "list";
  if (/\b(identify|kenal\s*pasti)\b/i.test(s)) return "identify";
  if (/\b(name|namakan)\b/i.test(s)) return "name";
  if (/\b(state|nyatakan|give|berikan)\b/i.test(s)) return "state";
  return "other";
}

function classifyQuestionType(q: string, commandWord: CommandWord): QuestionKind {
  const s = norm(q);
  if (
    /\b(which of the following|pilih|choose the|options?:|a\.\s+.+\nb\.\s+)/i.test(s) ||
    /\n\s*[A-D][\).]\s+\S/.test(q)
  ) {
    return "mcq";
  }
  if (commandWord === "calculate" || /\b(calculate|kira|hitung|show\s+working)\b/i.test(s)) {
    return "calculation";
  }
  if (commandWord === "compare" || /\b(compare|contrast|beza|persamaan|perbezaan)\b/i.test(s)) {
    return "compare_contrast";
  }
  if (/\b(example|contoh|suggest|cadangkan)\b/i.test(s)) return "open_ended_example";
  if (
    /\b(arrange|order|sequence|urutan|peringkat|hierarchy)\b/i.test(s) &&
    /\b(list|state|arrange|describe|explain|outline|nyatakan|senaraikan)\b/i.test(s)
  ) {
    return "sequence_order";
  }
  if (commandWord === "explain" || /\b(explain|why|because|kerana|effect|cause|mengapa)\b/i.test(s)) {
    return "cause_effect";
  }
  if (/\b(purpose|function|fungsi|tujuan)\b/i.test(s)) return "function_purpose";
  if (commandWord === "describe" || /\b(structure|struktur|labelled|label)\b/i.test(s)) {
    return "structure_description";
  }
  if (
    ["state", "name", "list", "give", "identify", "define"].includes(commandWord) ||
    /\b(state|name|list|give|identify|define)\b/i.test(s)
  ) {
    return "fixed_answer";
  }
  return "general";
}

function hasCompoundDemand(q: string): boolean {
  const s = norm(q);
  return (
    /\b(and\s+(then\s+)?(explain|describe|calculate|state|name|list|compare))\b/i.test(s) &&
    /\b(explain|describe|calculate|state|name|list|compare)\b/i.test(s)
  );
}

function simpleFallback(commandWord: CommandWord, questionType: QuestionKind): number {
  if (questionType === "mcq") return 1;
  if (questionType === "calculation") return 3;
  if (questionType === "compare_contrast") return 4;
  if (commandWord === "explain" || commandWord === "discuss") return 4;
  if (commandWord === "describe") return 3;
  if (["state", "name", "list", "identify", "define", "give"].includes(commandWord)) return 2;
  return 2;
}

/** Suggested total marks from stem structure / question type (not Markah line). */
export function suggestMaxMarksFromQuestionStructure(question: string): number {
  const q = (question || "").trim();
  const s = norm(q);
  const commandWord = detectCommandWord(q);
  const questionType = classifyQuestionType(q, commandWord);

  if (questionType === "mcq") return 1;

  const evolutionLike =
    /\b(evolution\s+of|development\s+of|history\s+of|sequence\s+of|from\s+.+\s+to\s+.+)\b/i.test(s) &&
    /\b(dalton|thomson|rutherford|bohr|model|stage|scientist|teori|teori atom)\b/i.test(s);

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
  if (/\b(one|1|a\s+single|only\s+one)\b/.test(s) && /\b(state|give|name|identify|nyatakan|namakan)/i.test(s)) {
    return 1;
  }
  if (/\bwhich\s+(type|kind|sort)\s+of\b/.test(s) || /\bidentify\b|\bkenal\s*pasti\b/i.test(s)) return 1;

  if (hasCompoundDemand(q)) return Math.max(2, simpleFallback(commandWord, questionType));

  if (evolutionLike) return 4;
  if (questionType === "calculation") {
    if (/\b(show|working|kerja|langkah)\b/i.test(s)) return 3;
    return 2;
  }
  if (questionType === "sequence_order") return 3;
  if (questionType === "compare_contrast") return 4;
  if (questionType === "cause_effect" || /\bexplain\s+why\b|\bmengapa\b/i.test(s)) {
    if (/\b(process|mechanism|sequence|stages?|development|evolution|langkah|urutan|peringkat)\b/i.test(s)) {
      return 4;
    }
    return 3;
  }
  if (questionType === "function_purpose" || /\b(primary\s+)?purpose\b|\bmain\s+function\b/i.test(s)) {
    return 2;
  }
  if (questionType === "structure_description") return 3;
  if (questionType === "open_ended_example") return 2;
  if (questionType === "fixed_answer") return 2;

  return simpleFallback(commandWord, questionType);
}

/**
 * Combine thin mark-scheme signals with structure analysis.
 * Prefer multi-point schemes; lift under-allocated 1-mark schemes when stem demand is richer.
 */
export function resolveMarksPreferringStructure(params: {
  questionText: string;
  fromScheme?: number | null;
  isMcq?: boolean;
}): number {
  const { questionText, fromScheme, isMcq } = params;
  if (isMcq) return 1;
  const structural = suggestMaxMarksFromQuestionStructure(questionText);
  if (typeof fromScheme === "number" && Number.isFinite(fromScheme)) {
    const n = Math.floor(fromScheme);
    if (n >= 2 && n <= 20) return n;
    if (n === 1) return Math.max(1, structural);
  }
  return Math.max(1, Math.min(20, structural));
}
