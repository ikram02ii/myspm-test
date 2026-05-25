import { randomUUID } from "node:crypto";
import { ragDb, ragGradingResultsTable } from "../../lib/ragDb";
import { auditRetrievedContext } from "./contextAuditService";
import { buildGradingContextFromChunks, retrieveChunks } from "./retrievalService";
import { gradeWithPipelineV2, extractStudentIdeas } from "./gradePipelineService";
import { analyzeQuestion } from "./questionAnalysisService";
import type {
  DiagramArrow,
  DiagramAxes,
  DiagramContext,
  DiagramDataPoint,
  DiagramKeyValue,
  DiagramLabel,
  DiagramType,
  GradeSubmissionInput,
  GradeSubmissionResult,
  MarkBreakdownItem,
  QuestionAnalysis,
  RetrievedChunk,
} from "./types";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { inferAdjustedMaxScore } from "./gradingMaxScoreInference";
import { fixMissingIdeasAgainstStudentAnswer } from "./gradingFairnessMatch";
import { validateTopicConsistency } from "./gradingTopicConsistency";
import { applyScoreConsistencyRules, computeRetrievalConfidence } from "./validationService";

type QwenGradeShape = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  matchedIdeas?: string[];
  missingIdeas?: string[];
  markBreakdown?: MarkBreakdownItem[];
  strengths?: string[];
  improvements?: string[];
};

const CORE_BIOLOGY_TOPICS: { label: string; pattern: RegExp }[] = [
  { label: "photosynthesis", pattern: /\b(photosynthesis|fotosintesis)\b/i },
  { label: "respiration", pattern: /\b(respiration|respirasi|pernafasan)\b/i },
  { label: "diffusion", pattern: /\b(diffusion|resapan)\b/i },
  { label: "osmosis", pattern: /\b(osmosis|osmosis)\b/i },
  { label: "active transport", pattern: /\b(active transport|pengangkutan aktif)\b/i },
  { label: "enzymes", pattern: /\b(enzyme|enzim)s?\b/i },
  { label: "mitosis", pattern: /\b(mitosis|mitosis)\b/i },
  { label: "meiosis", pattern: /\b(meiosis|meiosis)\b/i },
  { label: "reflex arc", pattern: /\b(reflex arc|lengkung gerak balas|gerak balas refleks)\b/i },
  { label: "villus", pattern: /\b(villus|villi|vilus)\b/i },
  { label: "alveolus", pattern: /\b(alveol(?:us|i)|alveolus)\b/i },
  { label: "vaccine", pattern: /\b(vaccin\w*|vaksin\w*)\b/i },
  { label: "antibodies", pattern: /\b(antibod(?:y|ies)|antibodi)\b/i },
];

function isCoreBiologyTopic(question: string, subject?: string): boolean {
  if (subject && !/biology|biologi/i.test(subject)) return false;
  const text = (question || "").toLowerCase();
  return CORE_BIOLOGY_TOPICS.some((topic) => topic.pattern.test(text));
}

const INTERNAL_LABEL_PATTERNS: RegExp[] = [
  /\[Low-?context-?warning\][^\n]*/gi,
  /\[TEXTBOOK CONTEXT\]/gi,
  /\[PAST PAPER MARK SCHEME\]/gi,
  /\b(?:Internal context note|Context warning)[^\n]*/gi,
];

const CAUSAL_LINK_PATTERN =
  /\b(because|so that|in order to|to (?:reduce|increase|maintain|allow|provide|prevent|speed|slow|enable|cause|ensure|maximi[sz]e|minimi[sz]e)|thus|therefore|as a result|hence|leads to|results in|enables|allows|provides|maintains|reduces|increases)\b/i;
const CAUSAL_LINK_PATTERN_BM =
  /\b(kerana|sebab|supaya|untuk\s+(?:mengurangkan|menambah|mengekalkan|membenarkan|membantu|menghalang|mempercepat|menjamin|memastikan)|menyebabkan|maka|justeru|seterusnya|menghasilkan)\b/i;

function studentHasCausalLink(answer: string): boolean {
  const text = answer || "";
  return CAUSAL_LINK_PATTERN.test(text) || CAUSAL_LINK_PATTERN_BM.test(text);
}

function splitFeatureFunction(idea: string): { feature: string; functionPart: string } | null {
  const match = idea.match(
    /^(.+?)\s+(?:to|so that|in order to|because|kerana|supaya|untuk)\s+(.+)$/i,
  );
  if (!match) return null;
  const feature = match[1]?.trim();
  const functionPart = match[2]?.trim();
  if (!feature || !functionPart) return null;
  return { feature, functionPart };
}

/**
 * SPM Explain/Describe/Discuss questions are scored as feature + function pairs.
 * If the student's answer has NO causal/linking words and the LLM merged a
 * feature+function into a single multi-mark awarded row, split that row so the
 * student gets the feature mark only — never the unearned function mark.
 */
function enforceFeatureFunctionRule(parsed: QwenGradeShape, context: {
  explainExpected: boolean;
  studentAnswer: string;
  maxScore: number;
}): QwenGradeShape {
  if (!context.explainExpected) return parsed;
  if (studentHasCausalLink(context.studentAnswer)) return parsed;
  if (!parsed.markBreakdown || parsed.markBreakdown.length === 0) return parsed;

  let mutated = false;
  const newBreakdown: MarkBreakdownItem[] = [];
  const missing = new Set<string>(parsed.missingIdeas ?? []);

  for (const row of parsed.markBreakdown) {
    const split = splitFeatureFunction(row.idea);
    if (row.awarded && split && row.marks >= 2) {
      mutated = true;
      const featureMarks = Math.floor(row.marks / 2);
      const functionMarks = row.marks - featureMarks;
      newBreakdown.push({
        idea: split.feature,
        awarded: true,
        marks: featureMarks,
        reason: `Feature stated by the student. ${row.reason || ""}`.trim(),
      });
      const functionIdea = `${split.feature} → ${split.functionPart}`;
      newBreakdown.push({
        idea: functionIdea,
        awarded: false,
        marks: functionMarks,
        reason: "Function/explanation not provided by the student (no causal link).",
      });
      missing.add(functionIdea);
    } else {
      newBreakdown.push(row);
    }
  }

  if (!mutated) return parsed;

  const summed = newBreakdown.reduce((sum, r) => sum + (r.awarded ? r.marks : 0), 0);
  const newScore = Math.max(0, Math.min(context.maxScore, Math.round(summed)));
  const newMatched = newBreakdown.filter((r) => r.awarded).map((r) => r.idea);
  const newImprovements = newBreakdown.filter((r) => !r.awarded).map((r) => r.idea);

  const newFeedback = sanitizeFeedback(
    "You gave the right parts, but you did not say what each part does. Add a short link for each part — for example say what it helps or why it matters (use 'because', 'so that', or 'to ...') — to get the rest of the marks.",
  );

  return {
    ...parsed,
    score: newScore,
    feedback: newFeedback,
    markBreakdown: newBreakdown,
    matchedIdeas: newMatched,
    missingIdeas: Array.from(missing),
    strengths: parsed.strengths && parsed.strengths.length > 0 ? parsed.strengths : newMatched,
    improvements: newImprovements,
  };
}

function questionAsksRoleFunctionPurpose(question: string): boolean {
  const text = (question || "").toLowerCase();
  return (
    /\b(?:role|function|purpose|importance|use|used for|adapt(?:ation|ed)?|why|how|effect|benefit|helps?)\b/i.test(text) ||
    /\b(?:peranan|fungsi|tujuan|kepentingan|kegunaan|untuk apa|adaptasi|mengapa|bagaimana|kesan|manfaat|membantu)\b/i.test(text)
  );
}

function questionExplicitlyAsksNaming(question: string): boolean {
  const text = (question || "").toLowerCase();
  return (
    /\b(?:name|identify|label|what is|which is|state the name|named|labelled|labeled)\b/i.test(text) ||
    /\b(?:namakan|kenal\s*pasti|labelkan|nyatakan\s+nama|nama(?:kan)?)\b/i.test(text)
  );
}

function isNamingWeaknessText(text: string): boolean {
  const value = (text || "").toLowerCase();
  const hasNamingCue =
    /\b(?:name|identify|label|labelled|labeled|state the name|named|namakan|kenal\s*pasti|labelkan|nyatakan\s+nama)\b/i.test(
      value,
    );
  const hasRoleFunctionCue =
    /\b(?:role|function|purpose|importance|use|used for|adapt(?:ation|ed)?|why|how|effect|benefit|helps?|peranan|fungsi|tujuan|kepentingan|kegunaan|adaptasi|mengapa|bagaimana|kesan|manfaat|membantu)\b/i.test(
      value,
    );
  return hasNamingCue && !hasRoleFunctionCue;
}

/**
 * For diagram role/function questions, do not penalize missing component-name
 * wording unless the question explicitly asks students to name/identify/label.
 */
function enforceDiagramRoleFeedbackRule(parsed: QwenGradeShape, context: {
  question: string;
  maxScore: number;
  feedbackMaxSentences?: number;
}): QwenGradeShape {
  if (!questionAsksRoleFunctionPurpose(context.question)) return parsed;
  if (questionExplicitlyAsksNaming(context.question)) return parsed;

  let mutated = false;

  const filteredBreakdown = (parsed.markBreakdown ?? []).filter((row) => {
    if (row.awarded) return true;
    const shouldDrop = isNamingWeaknessText(row.idea) || isNamingWeaknessText(row.reason || "");
    if (shouldDrop) mutated = true;
    return !shouldDrop;
  });

  const filteredMissing = (parsed.missingIdeas ?? []).filter((idea) => {
    const keep = !isNamingWeaknessText(idea);
    if (!keep) mutated = true;
    return keep;
  });

  const filteredImprovements = (parsed.improvements ?? []).filter((idea) => {
    const keep = !isNamingWeaknessText(idea);
    if (!keep) mutated = true;
    return keep;
  });

  const feedbackSentences = (parsed.feedback || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const cleanedFeedbackSentences = feedbackSentences.filter((sentence) => {
    const keep = !isNamingWeaknessText(sentence);
    if (!keep) mutated = true;
    return keep;
  });
  const cleanedFeedback = sanitizeFeedback(cleanedFeedbackSentences.join(" ").trim(), {
    maxSentences: context.feedbackMaxSentences,
  });

  if (!mutated) return parsed;

  const recomputedScore = filteredBreakdown.length > 0
    ? Math.max(
        0,
        Math.min(
          context.maxScore,
          Math.round(filteredBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0)),
        ),
      )
    : parsed.score;

  return {
    ...parsed,
    score: recomputedScore,
    markBreakdown: filteredBreakdown.length > 0 ? filteredBreakdown : parsed.markBreakdown,
    missingIdeas: filteredMissing,
    improvements: filteredImprovements,
    feedback: cleanedFeedback || parsed.feedback,
  };
}

function sanitizeFeedback(raw: string, opts?: { maxSentences?: number }): string {
  if (!raw) return "";
  const maxSentences = typeof opts?.maxSentences === "number" && opts.maxSentences > 0 ? opts.maxSentences : 3;
  let cleaned = raw;
  for (const pattern of INTERNAL_LABEL_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  // Drop any "Model answer:" line; modelAnswer is returned separately.
  cleaned = cleaned.replace(/(^|\n)\s*model answer\s*[:\-].*?(?=\n|$)/gi, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/\n{2,}/g, "\n").trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) return cleaned;
  return sentences.slice(0, maxSentences).join(" ").trim();
}

function filterChunksByAudit(chunks: RetrievedChunk[], relevantChunkIds: string[]): RetrievedChunk[] {
  if (relevantChunkIds.length === 0) return [];
  const allowed = new Set(relevantChunkIds);
  return chunks.filter((chunk) => allowed.has(chunk.chunkId));
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function sanitizeMarkBreakdown(value: unknown, maxScore: number): MarkBreakdownItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: MarkBreakdownItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const idea = typeof e["idea"] === "string" ? e["idea"].trim() : "";
    if (!idea) continue;
    const awardedRaw = e["awarded"];
    const awarded =
      typeof awardedRaw === "boolean"
        ? awardedRaw
        : typeof awardedRaw === "string"
          ? /^(true|yes|y|1)$/i.test(awardedRaw)
          : false;
    const marksRaw = typeof e["marks"] === "number" ? e["marks"] : Number(e["marks"]);
    const marks = Number.isFinite(marksRaw) ? Math.max(0, Math.min(maxScore, Math.round(marksRaw))) : 0;
    const reason = typeof e["reason"] === "string" ? e["reason"].trim() : "";
    items.push({ idea, awarded, marks, reason });
  }
  return items.length > 0 ? items : undefined;
}

function parseGradeResponse(
  raw: string,
  maxScore: number,
  opts?: { feedbackMaxSentences?: number },
): QwenGradeShape {
  const jsonText = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      score: 0,
      feedback: `Model response was not valid JSON. Raw response:\n${raw.slice(0, 1000)}`,
    };
  }

  const obj = parsed as Partial<QwenGradeShape>;
  const markBreakdown = sanitizeMarkBreakdown(obj.markBreakdown, maxScore);

  // Score must equal sum of awarded marks in markBreakdown (and never exceed maxScore).
  let safeScore: number;
  if (markBreakdown && markBreakdown.length > 0) {
    const summed = markBreakdown.reduce((sum, item) => sum + (item.awarded ? item.marks : 0), 0);
    safeScore = Math.max(0, Math.min(maxScore, Math.round(summed)));
  } else {
    const fallback = typeof obj.score === "number" ? obj.score : 0;
    safeScore = Math.max(0, Math.min(maxScore, Math.round(fallback)));
  }

  const rawFeedback =
    typeof obj.feedback === "string" && obj.feedback.trim().length > 0
      ? obj.feedback.trim()
      : "No feedback returned by model.";
  const feedback = sanitizeFeedback(rawFeedback, {
    maxSentences: opts?.feedbackMaxSentences,
  });

  const modelAnswer =
    typeof obj.modelAnswer === "string" && obj.modelAnswer.trim().length > 0
      ? obj.modelAnswer.trim()
      : undefined;

  return {
    score: safeScore,
    feedback,
    modelAnswer,
    matchedIdeas: sanitizeStringArray(obj.matchedIdeas),
    missingIdeas: sanitizeStringArray(obj.missingIdeas),
    markBreakdown,
    strengths: sanitizeStringArray(obj.strengths),
    improvements: sanitizeStringArray(obj.improvements),
  };
}

type QuestionType =
  | "state"
  | "name"
  | "list"
  | "explain"
  | "describe"
  | "define"
  | "identify"
  | "compare"
  | "calculate"
  | "discuss"
  | "process"
  | "diagram_label"
  | "graph_reading"
  | "general";

type AnswerStyle = "stating" | "explaining" | "comparing" | "process" | "calculating" | "mixed-or-unknown";

const STATE_STYLE_LIMIT_WORDS = 12;

function detectAnswerStyle(answer: string): AnswerStyle {
  const text = (answer || "").trim();
  if (!text) return "mixed-or-unknown";

  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const sentenceCount = (text.match(/[.!?]+\s|[.!?]+$/g) || []).length || 1;

  const hasCausal =
    /\b(because|so that|in order to|to (?:reduce|increase|maintain|allow|provide|prevent|speed|slow|enable|cause|maximise|minimise))\b/i.test(text) ||
    /\b(kerana|sebab|supaya|untuk(?:\s+(?:mengurangkan|menambah|mengekalkan|membenarkan|membantu|menghalang|mempercepat))?)\b/i.test(text) ||
    /\b(thus|therefore|as a result|hence|leads to|results in)\b/i.test(text) ||
    /\b(menyebabkan|maka|justeru|seterusnya|menghasilkan)\b/i.test(text);

  const hasCompareWords =
    /\b(while|whereas|but|however|on the other hand|compared (?:to|with)|differs?|different from)\b/i.test(text) ||
    /\b(manakala|sementara|berbeza|berbanding)\b/i.test(text);

  const hasProcessOrder =
    /\b(first|firstly|then|next|after that|finally|step\s*\d|\d+\s*[).])\b/i.test(text) ||
    /\b(pertama|kedua|seterusnya|kemudian|akhirnya|langkah\s*\d)\b/i.test(text) ||
    /(?:->|→|=>)/.test(text);

  const hasCalculation =
    /[\d.]+\s*(?:[+\-*/x×÷=]|mol|g\b|kg\b|cm\b|mm\b|ml\b|kj\b|kJ\b)/i.test(text) ||
    /=\s*[\d.]+/.test(text);

  if (hasCalculation) return "calculating";
  if (hasProcessOrder && (sentenceCount >= 2 || wordCount > STATE_STYLE_LIMIT_WORDS)) return "process";
  if (hasCompareWords) return "comparing";
  if (hasCausal) return "explaining";

  // Short list-like answer with no causal words → stating (e.g., "Thin walls and many capillaries.")
  if (wordCount <= STATE_STYLE_LIMIT_WORDS && sentenceCount <= 1) return "stating";

  return "mixed-or-unknown";
}

type AnswerLanguage = "english" | "malay" | "mixed";

function detectAnswerLanguage(text: string): AnswerLanguage {
  const cleaned = (text || "").toLowerCase().replace(/[^a-zA-Z\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "english";

  const malayMarkers = new Set([
    // function words
    "yang","ini","itu","dan","atau","tetapi","tidak","tak","ialah","adalah","akan","sedang","sudah","telah",
    "dengan","untuk","kepada","daripada","pada","dalam","oleh","kerana","sebab","supaya","bagi","jika",
    "ke","di","dari","saya","awak","kamu","kami","kita","mereka","dia","ia","ada","tiada","boleh","mesti","perlu",
    "lagi","juga","pun","sahaja","saja","semua","setiap","banyak","sedikit","besar","kecil",
    // common verbs/nouns from school questions
    "nyatakan","namakan","terangkan","jelaskan","huraikan","bandingkan","bincangkan","kenal","pasti",
    "jawapan","soalan","pelajar","murid","membantu","menjadi","menggunakan","menghasilkan","membentuk",
    "tubuh","sel","badan","tindak","balas","tenaga","makanan","tumbuhan","haiwan","manusia","penyakit",
    "antibodi","vaksin","virus","bakteria","enzim","substrat","pengaktifan","keimunan","limfosit",
  ]);

  const englishMarkers = new Set([
    "the","a","an","is","are","was","were","be","been","being","of","to","in","on","at","for","with","by","from",
    "and","or","but","not","this","that","these","those","it","its","they","them","their","there","here",
    "have","has","had","do","does","did","will","would","can","could","should","must","may","might",
    "because","so","as","than","then","when","while","if","into","onto","about","over","under","through",
    "increase","decrease","cell","cells","body","reaction","reactions","faster","temperature","enzyme","enzymes",
    "happen","happens","activation","energy","substrate","molecule","molecules","antibody","vaccine","virus","bacteria",
  ]);

  let malayHits = 0;
  let englishHits = 0;
  for (const token of tokens) {
    if (malayMarkers.has(token)) malayHits += 1;
    else if (englishMarkers.has(token)) englishHits += 1;
  }

  const total = malayHits + englishHits;
  if (total === 0) return "english";
  const malayRatio = malayHits / total;
  if (malayRatio >= 0.7) return "malay";
  if (malayRatio <= 0.3) return "english";
  return "mixed";
}

function buildLanguageDirective(language: AnswerLanguage): string {
  const level =
    "Use simple, student-friendly wording for SPM Form 4/5: short sentences, common school words, no advanced jargon.";
  if (language === "malay") {
    return `OUTPUT LANGUAGE = BAHASA MELAYU. ${level} Write feedback, strengths, improvements ENTIRELY in Bahasa Melayu. Standard scientific terms (e.g., 'enzyme') may be kept. Do NOT use full English sentences.`;
  }
  if (language === "mixed") {
    return `OUTPUT LANGUAGE = ENGLISH (student wrote mixed language; default to English). ${level} Do NOT switch into full Bahasa Melayu sentences.`;
  }
  return `OUTPUT LANGUAGE = ENGLISH. ${level} Write feedback, strengths, improvements ENTIRELY in English. Do NOT use full Bahasa Melayu sentences.`;
}

function isDiagramLabelQuestion(cleaned: string): boolean {
  // Intent guard: if the question asks for role/function/reason/how, it should
  // be graded as state/explain/describe (based on wording), not diagram_label.
  const asksRoleOrFunction =
    /\b(?:role|function|purpose|importance|use|used for|adapt(?:ation|ed)?|why|how|effect|benefit|helps?)\b/.test(cleaned) ||
    /\b(?:peranan|fungsi|tujuan|kepentingan|kegunaan|untuk apa|adaptasi|mengapa|bagaimana|kesan|manfaat|membantu)\b/.test(cleaned);
  if (asksRoleOrFunction) return false;

  // English: "name the part labelled P", "identify structure X in the diagram",
  // "based on the diagram, name P, Q and R", "name the organ shown in figure 1".
  const enLabelVerb = /\b(?:name|identify|state|label)\b/;
  const enLabelNoun =
    /\b(?:part(?:s)?|structure(?:s)?|organ(?:s)?|tissue(?:s)?|component(?:s)?|apparatus|labelled|labeled|marked|figure|diagram)\b/;
  const enLetterRefs = /\b(?:labelled|labeled|marked)\s+(?:as\s+)?[A-Z](?:\s*(?:,|and|or|to)\s*[A-Z])*\b/;
  const enBasedOnDiagram = /\bbased\s+on\s+(?:the\s+)?(?:diagram|figure|rajah)\b/;

  // Bahasa Melayu: "namakan bahagian berlabel P", "kenal pasti struktur X",
  // "berdasarkan rajah, namakan P, Q dan R".
  const bmLabelVerb = /\b(?:namakan|nyatakan|kenal\s*pasti|labelkan)\b/;
  const bmLabelNoun = /\b(?:bahagian|struktur|organ|tisu|komponen|radas|berlabel|berdasarkan\s+rajah|rajah)\b/;
  const bmLetterRefs = /\bberlabel\s+[A-Z](?:\s*(?:,|dan|atau|hingga)\s*[A-Z])*\b/;

  if (enLabelVerb.test(cleaned) && enLabelNoun.test(cleaned)) return true;
  if (enLetterRefs.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (enBasedOnDiagram.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (bmLabelVerb.test(cleaned) && bmLabelNoun.test(cleaned)) return true;
  if (bmLetterRefs.test(cleaned) && bmLabelVerb.test(cleaned)) return true;
  return false;
}

function isGraphReadingQuestion(cleaned: string): boolean {
  // Reject false positives like "concentration gradient" by requiring graph/line/curve nearby.
  const enGraphRef =
    /\b(?:from|based\s+on|using|refer(?:\s+to)?)\s+(?:the\s+)?graph\b/.test(cleaned) ||
    /\bthe\s+graph\s+(?:shows|above|below|in|illustrates)\b/.test(cleaned) ||
    /\b(?:gradient|slope)\s+of\s+(?:the\s+)?(?:graph|line|curve)\b/.test(cleaned) ||
    /\b(?:y[-\s]?intercept|x[-\s]?intercept|area\s+under\s+(?:the\s+)?(?:graph|curve)|turning\s+point)\b/.test(cleaned) ||
    /\b(?:read|determine|find|calculate|state)\s+(?:the\s+)?value\s+of\s+[a-z]\s+when\s+[a-z]\s*=/.test(cleaned);

  const bmGraphRef =
    /\b(?:daripada|berdasarkan)\s+graf\b/.test(cleaned) ||
    /\bgraf\s+(?:di\s+)?(?:atas|bawah|menunjukkan)\b/.test(cleaned) ||
    /\b(?:cerun|kecerunan)\s+(?:graf|garis|lengkung)\b/.test(cleaned) ||
    /\bpintasan[-\s]?[xy]\b/.test(cleaned) ||
    /\bluas\s+di\s+bawah\s+(?:graf|lengkung)\b/.test(cleaned);

  return enGraphRef || bmGraphRef;
}

function detectQuestionType(question: string): QuestionType {
  let cleaned = question
    .toLowerCase()
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .trim();
  // Bilingual stems from generators, e.g. "EN: Which ..." / "BM: Namakan ..."
  cleaned = cleaned.replace(/^(en|bm)\s*:\s*/i, "").trim();

  // Diagram/graph checks run BEFORE the generic startsWith chain so questions
  // like "Name the part labelled P" route to diagram_label rather than name.
  if (isDiagramLabelQuestion(cleaned)) return "diagram_label";
  if (isGraphReadingQuestion(cleaned)) return "graph_reading";

  // "Which type/kind/sort of ..." asks for a named choice; stem may already state the role.
  if (/\bwhich\s+(type|kind|sort)\s+of\b/.test(cleaned)) return "identify";

  const startsWith = (word: string): boolean =>
    cleaned.startsWith(`${word} `) ||
    cleaned.startsWith(`${word}:`) ||
    cleaned === word;
  if (startsWith("state") || startsWith("nyatakan")) return "state";
  if (startsWith("name") || startsWith("namakan")) return "name";
  if (startsWith("list") || startsWith("senaraikan")) return "list";
  if (startsWith("explain") || startsWith("terangkan") || startsWith("jelaskan")) return "explain";
  if (startsWith("describe") || startsWith("huraikan") || startsWith("perihalkan")) return "describe";
  if (startsWith("define") || startsWith("takrifkan") || startsWith("definisikan")) return "define";
  if (startsWith("identify") || startsWith("kenal pasti") || startsWith("kenalpasti")) return "identify";
  if (
    startsWith("compare") ||
    startsWith("bandingkan") ||
    startsWith("differentiate") ||
    startsWith("distinguish") ||
    startsWith("bezakan")
  ) {
    return "compare";
  }
  if (startsWith("calculate") || startsWith("hitung") || startsWith("kira")) return "calculate";
  if (startsWith("discuss") || startsWith("bincangkan")) return "discuss";

  const isProcess =
    /\b(sequence|process|pathway|stages? of|steps? of)\b/i.test(cleaned) ||
    /\b(urutan|proses|tatacara|peringkat|langkah(?:-langkah)?)\b/i.test(cleaned);
  const isHow =
    /\bhow\s+(?:does|do|is|are|can)\b/i.test(cleaned) || /\bbagaimana(?:kah)?\b/i.test(cleaned);
  const isWhy =
    /\bwhy\b/i.test(cleaned) ||
    /\bgive\s+(?:a\s+)?reasons?\b/i.test(cleaned) ||
    /\bmengapa(?:kah)?\b/i.test(cleaned) ||
    /\bberi(?:kan)?\s+(?:satu\s+)?sebab\b/i.test(cleaned);

  if (isHow && isProcess) return "process";
  if (isHow) return "explain";
  if (isWhy) return "explain";
  if (isProcess) return "process";

  return "general";
}

/** When true, post-process may split merged feature+function rows; LLM rules use the same flag. */
function requiresFeatureFunction(question: string, questionType: QuestionType): boolean {
  const q = (question || "").toLowerCase().replace(/^(en|bm)\s*:\s*/i, "").trim();
  if (questionType === "explain" || questionType === "discuss") return true;
  if (questionType === "describe") {
    return /\b(adapted|adaptation|function|role|effect|importance|how|why|advantage|helps|enable|allows)\b/i.test(q);
  }
  return false;
}

function buildQuestionTypeRules(type: QuestionType): string {
  const header = `Question-type rule (detected: ${type}):`;
  switch (type) {
    case "state":
    case "name":
    case "list":
    case "identify":
      return [
        header,
        "- Short confirmation only — 1 short sentence.",
        "- Do NOT explain, justify, or add 'because' / 'kerana'.",
        "- If the stem already states facts (e.g. what a cell does), that text is GIVEN information — do NOT withhold marks because the student did not repeat it; grade only the name/term they must supply.",
        "- If the student is correct: confirm briefly (e.g., 'Correct — fox and owl are valid secondary consumers.').",
        "- If items are missing: list ONLY the missing items briefly, no elaboration.",
        "- If wrong: give the correct term/items in one short line, nothing more.",
      ].join("\n");
    case "define":
      return [
        header,
        "- Give the precise definition concisely; aim for ~1 short sentence.",
        "- If partial: state which definition components are missing (e.g., 'missing: against the concentration gradient').",
        "- Do NOT add textbook elaboration, examples, or mechanisms beyond the definition.",
      ].join("\n");
    case "explain":
      return [
        header,
        "- SPM Form 4/5 depth only — never A-Level / university depth.",
        "- For an N-mark Explain, expect ~N short mark points (cause/effect at SPM level).",
        "- If partial: name the missing mechanism or reason in 1 short line.",
        "- If full marks: confirm the matched mechanism briefly; do not lecture.",
        "- Do NOT introduce advanced biochem/molecular detail unless the question asks for it.",
      ].join("\n");
    case "describe":
      return [
        header,
        "- SPM-level descriptive points only, in the order an examiner expects.",
        "- For an N-mark Describe, expect ~N short ordered points.",
        "- If partial: name only the missing description points.",
        "- Avoid advanced terminology unless required by the question.",
      ].join("\n");
    case "compare":
      return [
        header,
        "- Compare in pairs: 'X is __ while Y is __'.",
        "- For an N-mark Compare, expect ~N paired differences.",
        "- If partial: state ONLY the missing paired difference(s) in compact form.",
      ].join("\n");
    case "process":
      return [
        header,
        "- Show the correct sequence of steps in order, briefly (use arrows or numbering).",
        "- Match number of steps to maxScore where reasonable.",
        "- If partial: state the missing or wrongly ordered step(s) briefly.",
        "- Do NOT add unrelated background or mechanism beyond the asked process.",
      ].join("\n");
    case "calculate":
      return [
        header,
        "- Show the computation steps and final answer with units, briefly.",
        "- Award method marks: reward correct method even if final value is slightly off.",
        "- Keep working compact, no extra theory.",
      ].join("\n");
    case "discuss":
      return [
        header,
        "- Briefly weigh more than one factor or view.",
        "- For an N-mark Discuss, expect ~N short balanced points.",
        "- Avoid lengthy essay-style elaboration.",
      ].join("\n");
    case "diagram_label":
      return [
        header,
        "- Cross-check student answers against the structured diagram labels block.",
        "- Award 1 mark per correct label/name; the term must match the diagram's `labels[].refersTo` (accept SPM-equivalent terms and BM/EN translations).",
        "- Do NOT award explanation/function marks here — labelling questions test recognition only.",
        "- If the student gives a related-but-wrong term (e.g. 'xylem' for a phloem label), do not award.",
        "- If the diagram's `confidence` is low or the relevant label is missing/ambiguous, be cautious and explain in `reason`; do not penalise the student for the vision model's uncertainty.",
        "- Feedback: short confirmation (e.g., 'P = phloem ✓, Q = xylem ✓.'). For misses, give the correct labels in one short line.",
      ].join("\n");
    case "graph_reading":
      return [
        header,
        "- Use the diagram's axes, dataPoints, and keyValues block as the source of truth — never re-imagine the graph.",
        "- For 'read off' questions, accept values within ±1 small grid square or ±5% of the expected value (whichever is larger).",
        "- For gradient/slope: gradient = Δy / Δx using two clear points on the line; award the formula mark and the value mark separately if both are required.",
        "- For intercepts and turning points, use the diagram's coordinates; require correct axis units when shown.",
        "- Always require correct units in the final answer if the axes have units. Missing units = withhold the unit/answer mark only, not the working mark.",
        "- Do NOT introduce theory beyond what the graph shows.",
        "- Feedback: state the read value(s) the student gave vs the expected value, then the missing/wrong piece in one short line.",
      ].join("\n");
    default:
      return [
        header,
        "- If one correct short factual answer (name, term, value, or single result) satisfies the question, prefer ONE markBreakdown row with marks = maxScore when fully correct.",
        "- Never split the stem into artificial extra marks (e.g. 'named the cell' vs 'repeated what the question already said') unless the question explicitly asks for multiple separate points (e.g. 'State TWO...', 'List three...').",
        "- Match feedback depth to question complexity.",
        "- Short factual questions get short confirmation; reasoning questions get short cause/effect.",
      ].join("\n");
  }
}

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model =
    process.env["QWEN_GRADING_MODEL"]?.trim() || process.env["QWEN_MODEL"]?.trim() || "qwen-plus";

  if (!apiKey || !baseUrl) {
    throw new Error("Qwen grading is not configured (set QWEN_GRADING_API_KEY/BASE_URL or reuse QWEN_OCR_*).");
  }

  return { apiKey, baseUrl, model };
}

function normalizeDiagramDataUrl(imageBase64: string): string {
  const trimmed = imageBase64.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}

const DIAGRAM_TYPES: ReadonlySet<DiagramType> = new Set<DiagramType>([
  "biology_organ",
  "biology_process",
  "physics_circuit",
  "physics_ray",
  "physics_mechanics",
  "chemistry_apparatus",
  "chemistry_reaction",
  "graph",
  "table",
  "geometry",
  "other",
]);

function clamp01(value: number, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : trimmed;
  }
  return null;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value.trim());
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function sanitizeDiagramLabels(value: unknown): DiagramLabel[] {
  if (!Array.isArray(value)) return [];
  const out: DiagramLabel[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = asTrimmedString(r["id"] ?? r["label"] ?? r["letter"]);
    const refersTo = asTrimmedString(r["refersTo"] ?? r["refers_to"] ?? r["name"] ?? r["meaning"]);
    if (!id || !refersTo) continue;
    const confidenceRaw = typeof r["confidence"] === "number" ? r["confidence"] : Number(r["confidence"]);
    const confidence = clamp01(confidenceRaw, 0.7);
    out.push({ id: id.slice(0, 16), refersTo: refersTo.slice(0, 120), confidence });
  }
  return out.slice(0, 24);
}

function sanitizeAxis(value: unknown): NonNullable<DiagramAxes["x"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const quantity = asTrimmedString(r["quantity"] ?? r["label"] ?? r["name"]);
  if (!quantity) return undefined;
  const unit = asTrimmedString(r["unit"] ?? r["units"]);
  const min = asOptionalNumber(r["min"]);
  const max = asOptionalNumber(r["max"]);
  return {
    quantity: quantity.slice(0, 80),
    ...(unit ? { unit: unit.slice(0, 24) } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function sanitizeAxes(value: unknown): DiagramAxes | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const x = sanitizeAxis(r["x"]);
  const y = sanitizeAxis(r["y"]);
  if (!x && !y) return undefined;
  return { ...(x ? { x } : {}), ...(y ? { y } : {}) };
}

function sanitizeDataPoints(value: unknown): DiagramDataPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramDataPoint[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const x = asNumberOrString(r["x"]);
    const y = asNumberOrString(r["y"]);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  return out.length > 0 ? out.slice(0, 50) : undefined;
}

function sanitizeArrows(value: unknown): DiagramArrow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramArrow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const from = asTrimmedString(r["from"]);
    const to = asTrimmedString(r["to"]);
    if (!from || !to) continue;
    const meaning = asTrimmedString(r["meaning"]);
    out.push({
      from: from.slice(0, 80),
      to: to.slice(0, 80),
      ...(meaning ? { meaning: meaning.slice(0, 120) } : {}),
    });
  }
  return out.length > 0 ? out.slice(0, 16) : undefined;
}

function sanitizeKeyValues(value: unknown): DiagramKeyValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramKeyValue[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = asTrimmedString(r["name"]);
    const valueField = asNumberOrString(r["value"]);
    if (!name || valueField === null) continue;
    const unit = asTrimmedString(r["unit"] ?? r["units"]);
    out.push({
      name: name.slice(0, 60),
      value: valueField,
      ...(unit ? { unit: unit.slice(0, 24) } : {}),
    });
  }
  return out.length > 0 ? out.slice(0, 24) : undefined;
}

function sanitizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const text = asTrimmedString(raw);
    if (text) out.push(text.slice(0, 240));
  }
  return out.slice(0, max);
}

/**
 * Parse a model reply into a typed DiagramContext. Returns null if the reply
 * is not parseable JSON or contains no usable content (caller may then build
 * a prose fallback).
 */
function parseDiagramContext(rawText: string): DiagramContext | null {
  const jsonText = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const rawType = asTrimmedString(obj["diagramType"] ?? obj["type"]).toLowerCase();
  const diagramType: DiagramType = DIAGRAM_TYPES.has(rawType as DiagramType)
    ? (rawType as DiagramType)
    : "other";

  const summary = asTrimmedString(obj["summary"] ?? obj["description"]).slice(0, 800);
  const labels = sanitizeDiagramLabels(obj["labels"]);
  const axes = sanitizeAxes(obj["axes"]);
  const dataPoints = sanitizeDataPoints(obj["dataPoints"] ?? obj["data_points"]);
  const arrows = sanitizeArrows(obj["arrows"]);
  const keyValues = sanitizeKeyValues(obj["keyValues"] ?? obj["key_values"]);
  const observations = sanitizeStringList(obj["observations"], 12);
  const ambiguities = sanitizeStringList(obj["ambiguities"], 6);
  const confidenceRaw = typeof obj["confidence"] === "number" ? obj["confidence"] : Number(obj["confidence"]);
  const confidence = clamp01(confidenceRaw, 0.6);

  const hasContent =
    summary.length > 0 ||
    labels.length > 0 ||
    !!axes ||
    !!dataPoints ||
    !!arrows ||
    !!keyValues ||
    observations.length > 0;
  if (!hasContent) return null;

  return {
    diagramType,
    summary,
    labels,
    ...(axes ? { axes } : {}),
    ...(dataPoints ? { dataPoints } : {}),
    ...(arrows ? { arrows } : {}),
    ...(keyValues ? { keyValues } : {}),
    observations,
    ...(ambiguities.length > 0 ? { ambiguities } : {}),
    confidence,
  };
}

/**
 * Render a DiagramContext as a compact, human-readable block. Used both for
 * the grader prompt (so it can mark against typed fields) and as the
 * back-compat string returned to API clients that still expect prose.
 */
function renderDiagramContextForGrader(d: DiagramContext): string {
  const lines: string[] = [];
  lines.push(`Diagram type: ${d.diagramType} (vision confidence: ${d.confidence.toFixed(2)})`);
  if (d.summary) lines.push(`Summary: ${d.summary}`);
  if (d.labels.length > 0) {
    lines.push("Labels:");
    for (const label of d.labels) {
      lines.push(`  - ${label.id} = ${label.refersTo} (conf: ${label.confidence.toFixed(2)})`);
    }
  }
  if (d.axes?.x || d.axes?.y) {
    if (d.axes.x) {
      const x = d.axes.x;
      const range = x.min != null && x.max != null ? ` [${x.min} to ${x.max}]` : "";
      lines.push(`X-axis: ${x.quantity}${x.unit ? ` (${x.unit})` : ""}${range}`);
    }
    if (d.axes.y) {
      const y = d.axes.y;
      const range = y.min != null && y.max != null ? ` [${y.min} to ${y.max}]` : "";
      lines.push(`Y-axis: ${y.quantity}${y.unit ? ` (${y.unit})` : ""}${range}`);
    }
  }
  if (d.dataPoints && d.dataPoints.length > 0) {
    const shown = d.dataPoints.slice(0, 16).map((p) => `(${p.x}, ${p.y})`).join(", ");
    const more = d.dataPoints.length > 16 ? `, ... (+${d.dataPoints.length - 16} more)` : "";
    lines.push(`Data points: ${shown}${more}`);
  }
  if (d.arrows && d.arrows.length > 0) {
    lines.push("Arrows:");
    for (const arrow of d.arrows.slice(0, 10)) {
      lines.push(`  - ${arrow.from} -> ${arrow.to}${arrow.meaning ? `: ${arrow.meaning}` : ""}`);
    }
  }
  if (d.keyValues && d.keyValues.length > 0) {
    lines.push("Key values:");
    for (const kv of d.keyValues.slice(0, 16)) {
      lines.push(`  - ${kv.name} = ${kv.value}${kv.unit ? ` ${kv.unit}` : ""}`);
    }
  }
  if (d.observations.length > 0) {
    lines.push("Observations:");
    for (const obs of d.observations.slice(0, 8)) lines.push(`  - ${obs}`);
  }
  if (d.ambiguities && d.ambiguities.length > 0) {
    lines.push(`Ambiguities (use cautiously): ${d.ambiguities.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Fallback when the vision model returns prose instead of JSON. Wraps the
 * prose in a minimal DiagramContext with low confidence so downstream code
 * always sees a typed object.
 */
function buildDiagramFallbackFromProse(prose: string): DiagramContext {
  const summary = prose.replace(/\s+/g, " ").trim().slice(0, 800);
  return {
    diagramType: "other",
    summary,
    labels: [],
    observations: [],
    confidence: 0.3,
  };
}

function buildEnrichedRetrievalQuery(question: string, diagram?: DiagramContext): string {
  if (!diagram) return question;

  const parts: string[] = [question];
  if (diagram.summary) parts.push(diagram.summary);

  if (diagram.labels.length > 0) {
    const labelPairs = diagram.labels.map((label) => `${label.id}=${label.refersTo}`).join(", ");
    parts.push(`Diagram labels: ${labelPairs}`);
  }

  if (diagram.keyValues && diagram.keyValues.length > 0) {
    const kvPairs = diagram.keyValues
      .map((kv) => `${kv.name}=${kv.value}${kv.unit ? ` ${kv.unit}` : ""}`)
      .join(", ");
    parts.push(`Key values: ${kvPairs}`);
  }

  if (diagram.axes?.x || diagram.axes?.y) {
    const axisParts: string[] = [];
    if (diagram.axes.x) axisParts.push(`x=${diagram.axes.x.quantity}${diagram.axes.x.unit ? ` (${diagram.axes.x.unit})` : ""}`);
    if (diagram.axes.y) axisParts.push(`y=${diagram.axes.y.quantity}${diagram.axes.y.unit ? ` (${diagram.axes.y.unit})` : ""}`);
    parts.push(`Axes: ${axisParts.join(", ")}`);
  }

  if (diagram.observations.length > 0) {
    parts.push(`Observations: ${diagram.observations.slice(0, 4).join("; ")}`);
  }

  return parts.join("\n").slice(0, 1200);
}

function buildDiagramSystemPromptForSubject(subject?: string): string {
  const base = [
    "You are an SPM exam vision assistant. Convert the diagram, table, chart, or labelled figure into a STRUCTURED JSON object that an automated marker can consume directly.",
    "Return JSON ONLY (no prose, no code fences, no markdown).",
    "JSON schema (omit fields you cannot determine; never invent):",
    "{",
    '  "diagramType": "biology_organ" | "biology_process" | "physics_circuit" | "physics_ray" | "physics_mechanics" | "chemistry_apparatus" | "chemistry_reaction" | "graph" | "table" | "geometry" | "other",',
    '  "summary": "1-2 sentence plain summary of what the figure shows",',
    '  "labels": [{ "id": "P", "refersTo": "phloem", "confidence": 0.0-1.0 }],',
    '  "axes": { "x": { "quantity": "time", "unit": "s", "min": 0, "max": 10 }, "y": { ... } },',
    '  "dataPoints": [{ "x": 0, "y": 0 }, { "x": 1, "y": 2 }],',
    '  "arrows": [{ "from": "sun", "to": "leaf", "meaning": "light energy" }],',
    '  "keyValues": [{ "name": "R1", "value": 4, "unit": "ohm" }],',
    '  "observations": ["graph is linear from 0-3s", "slope decreases after 3s"],',
    '  "ambiguities": ["label R unclear, could be retina or rod"],',
    '  "confidence": 0.0-1.0',
    "}",
    "Rules:",
    "- Use the question's subject domain to disambiguate labels; do not guess cross-subject meanings.",
    "- For label letters in the figure, ALWAYS populate `labels[]` with the letter as `id` and the biological/physical/chemical term as `refersTo`.",
    "- For graphs: populate `axes` (with units), and `dataPoints` if discrete points are shown; otherwise leave `dataPoints` out and put trend descriptions into `observations`.",
    "- For circuits: list components in `keyValues` (e.g. R1, V, I) with units.",
    "- If you are unsure, lower the per-label or overall `confidence` and add a note to `ambiguities` — DO NOT guess.",
    "- If the visual is irrelevant to the question, return `{ \"diagramType\": \"other\", \"summary\": \"No relevant diagram context.\", \"labels\": [], \"observations\": [], \"confidence\": 0.1 }`.",
    "- In `summary`, `observations`, and `ambiguities`, use short plain language Form 4/5 students can read (no university-style phrasing).",
  ];

  const normalized = (subject || "").trim().toLowerCase();
  let subjectHint: string | null = null;
  if (normalized === "biology") {
    subjectHint =
      "Subject hint: Biology. Likely diagrams = organs, tissues, cells, processes (photosynthesis, respiration, transport). Map letters to biological terms in BM or EN as shown in SPM textbooks.";
  } else if (normalized === "physics") {
    subjectHint =
      "Subject hint: Physics. Likely diagrams = circuits (V, I, R), ray diagrams (object, image, focal length), mechanics (forces, vectors), graphs (v-t, s-t).";
  } else if (normalized === "chemistry") {
    subjectHint =
      "Subject hint: Chemistry. Likely diagrams = apparatus (delivery tube, gas jar), reactions, electrolysis (anode/cathode), graphs (rate vs time, pH).";
  } else if (
    normalized === "mathematics" ||
    normalized === "additional mathematics" ||
    normalized === "add math" ||
    normalized === "matematik" ||
    normalized === "matematik tambahan"
  ) {
    subjectHint =
      "Subject hint: Mathematics. Likely diagrams = graphs of functions, geometric figures, statistical charts. Capture intercepts, turning points, asymptotes in `keyValues` and trends in `observations`.";
  }

  if (subjectHint) base.push(subjectHint);
  return base.join("\n");
}

async function generateDiagramContextWithQwen(params: {
  question: string;
  subject?: string;
  imageUrl?: string;
  imageBase64?: string;
}): Promise<{ diagram: DiagramContext; rawText: string; model: string }> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const configuredVisionModel =
    process.env["QWEN_VISION_MODEL"]?.trim() ||
    process.env["QWEN_GRADING_VISION_MODEL"]?.trim() ||
    "qwen-vl-plus";
  const fallbackVisionModel = process.env["QWEN_VISION_FALLBACK_MODEL"]?.trim() || "qwen-vl-plus";

  const imageRef = params.imageUrl?.trim() || (params.imageBase64 ? normalizeDiagramDataUrl(params.imageBase64) : "");
  if (!imageRef) {
    throw new Error("diagram image is missing");
  }

  const modelCandidates = [configuredVisionModel];
  if (!modelCandidates.includes(fallbackVisionModel)) {
    modelCandidates.push(fallbackVisionModel);
  }

  let lastError: string | null = null;
  for (const model of modelCandidates) {
    const payload = {
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildDiagramSystemPromptForSubject(params.subject),
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageRef } },
            {
              type: "text",
              text: [
                `Subject: ${params.subject?.trim() || "General"}`,
                "Question:",
                params.question,
                "",
                "Return the structured DiagramContext JSON as specified in the system prompt. JSON ONLY.",
              ].join("\n"),
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(rawText);
    } catch {
      lastError = rawText.slice(0, 500) || `Qwen diagram context failed (${response.status})`;
      continue;
    }

    if (!response.ok) {
      const message =
        parsedResponse?.error?.message ||
        parsedResponse?.message ||
        (typeof parsedResponse?.error === "string" ? parsedResponse.error : null) ||
        rawText.slice(0, 500) ||
        `Qwen diagram context failed (${response.status})`;

      // Retry another model only for access/not-found issues.
      const modelMissing = /does not exist|not found|no access|unauthorized|forbidden/i.test(message || "");
      if (modelMissing) {
        lastError = message;
        continue;
      }
      throw new Error(message);
    }

    const content = parsedResponse?.choices?.[0]?.message?.content;
    const rawReply = messageContentToString(content).trim();
    if (!rawReply) {
      lastError = "Diagram context generation returned empty text.";
      continue;
    }

    const parsedDiagram = parseDiagramContext(rawReply);
    const diagram = parsedDiagram ?? buildDiagramFallbackFromProse(rawReply);
    return { diagram, rawText: rawReply, model };
  }

  throw new Error(lastError || "Qwen diagram context failed for all candidate vision models.");
}

/** Practice app: MCQ "Ask AI" sends only A–D and maxScore 1 — steer feedback to compare wrong vs correct options. */
function looksLikeMcqWithLetterOptions(question: string): boolean {
  const q = question.replace(/\r/g, "\n");
  return /\bA\s*[\.)]\s*\S/m.test(q) && /\bB\s*[\.)]\s*\S/m.test(q);
}

function isMcqLetterOnlyExplanationRequest(question: string, studentAnswer: string, maxScore: number): boolean {
  if (maxScore !== 1) return false;
  const letter = studentAnswer.trim().toUpperCase();
  if (!/^[A-D]$/.test(letter)) return false;
  return looksLikeMcqWithLetterOptions(question);
}

/** Generic SPM hints for legacy (v1) single-shot LLM grading only. */
function legacyGradingRubricHints(subject?: string): string[] {
  return [
    `Subject context: ${subject?.trim() || "General"}`,
    "- Prioritize syllabus accuracy at SPM Form 4/5 level.",
    "- Reward correct reasoning and paraphrases (BM/EN) when meaning is correct.",
    "- Award marks point-by-point; do not require exact textbook wording.",
    "- For visuals (diagram/graph/table), require evidence from the named source when the stem is context-bound.",
    "- Penalize only clear errors; feedback should be concise and student-friendly.",
  ];
}

async function gradeWithQwen(params: {
  question: string;
  studentAnswer: string;
  subject?: string;
  contextText: string;
  diagramContext?: DiagramContext;
  maxScore: number;
  rubricVersion: string;
  warning: string | null;
  questionAnalysis?: QuestionAnalysis | null;
}): Promise<{ parsed: QwenGradeShape; model: string }> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;

  const hasPastPaperScheme = /\[PAST PAPER MARK SCHEME\]/i.test(params.contextText || "");
  const hasTextbookContext = /\[TEXTBOOK CONTEXT\]/i.test(params.contextText || "");
  const questionType = detectQuestionType(params.question);
  const questionTypeRules = buildQuestionTypeRules(questionType);
  const answerLanguage = detectAnswerLanguage(params.studentAnswer);
  const languageDirective = buildLanguageDirective(answerLanguage);
  const answerStyle = detectAnswerStyle(params.studentAnswer);

  const featureFunctionMode =
    params.questionAnalysis?.requiresFeatureFunction ??
    requiresFeatureFunction(params.question, questionType);
  const styleMismatch =
    (featureFunctionMode && answerStyle === "stating") ||
    (questionType === "compare" && answerStyle !== "comparing" && answerStyle !== "mixed-or-unknown") ||
    (questionType === "process" && answerStyle !== "process" && answerStyle !== "explaining" && answerStyle !== "mixed-or-unknown");

  const contextSourceRule = hasPastPaperScheme && !hasTextbookContext
    ? "Only past-paper style examples are available: grade with general SPM knowledge; use examples for style/strictness only."
    : !hasPastPaperScheme && hasTextbookContext
    ? "No past-paper examples available: use textbook context with fair SPM-style partial credit."
    : !hasPastPaperScheme && !hasTextbookContext
    ? "No retrieved context: grade carefully using general SPM-level knowledge."
    : "Both textbook and past-paper examples are available.";

  const featureFunctionGradingParagraph = featureFunctionMode
    ? [
        "Feature + function rule (APPLIES — explain/discuss, or describe-with-adaptation/function):",
        "- Do NOT apply feature+function mark splitting to STATE, NAME, LIST, IDENTIFY, DEFINE, CALCULATE, DIAGRAM_LABEL, GRAPH_READING, PROCESS, COMPARE, or GENERAL short-recall items.",
        "- If the stem describes what something does but the task is only to name/identify which (e.g. 'Which type of white blood cell produces antibodies?'), the expected answer is the CORRECT NAME/TYPE only. Award full maxScore when that name is correct. Never require the student to copy stem wording as an extra mark.",
        "- SPM Explain/Describe-with-role questions are usually marked as feature + function (or structure + role) PAIRS:",
        "    * 1 mark for naming/stating the feature/structure.",
        "    * 1 mark for explaining HOW it helps / what it does (the function/mechanism).",
        "- For an N-mark Explain with K features, build markBreakdown as 2K rows: one 'feature' row + one 'function' row per feature.",
        "- If the student only NAMED a feature (no link to its function/effect), award the feature mark ONLY. Do NOT award the function mark.",
        "- A linking word/phrase is required for the function mark, e.g.: 'because', 'so that', 'in order to', 'to (reduce/increase/maintain/allow/...)', 'kerana', 'supaya', 'untuk', or a clear cause/effect clause.",
        "- Example: question 'Explain how alveoli are adapted for gas exchange' (4 marks). Student writes 'thin walls and many capillaries'.",
        "    * Award: 'thin walls' (feature) = 1m, 'many capillaries' (feature) = 1m.",
        "    * Withhold: 'thin walls → reduces diffusion distance' (function) = 0m, 'many capillaries → maintain steep diffusion gradient' (function) = 0m.",
        "    * Final score = 2/4. missingIdeas should list the two missing function explanations.",
        "- Do NOT silently merge feature + function into one row to give full marks when the student only stated features.",
      ].join("\n")
    : [
        "Feature + function rule (DOES NOT apply to this stem):",
        "- Do NOT force paired feature+function rows for pure structure description (e.g. 'Describe the structure of …') unless the stem asks for adaptation, role, effect, how, or why.",
        "- Award one mark per correct structural or requested point the question actually asks for.",
        "- If the stem describes background but the task is only to name/identify which, the expected answer is the CORRECT NAME/TYPE only. Award full maxScore when that name is correct.",
      ].join("\n");

  const systemPrompt = [
    "You are a fair, rubric-based SPM (Form 4/5) grader for Malaysian students.",
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON ONLY (no prose, no code fences) with these fields:",
    "{",
    "  \"markBreakdown\": [{ \"idea\": string, \"awarded\": boolean, \"marks\": number, \"reason\": string }],",
    "  \"score\": integer,",
    "  \"matchedIdeas\": string[],",
    "  \"missingIdeas\": string[],",
    "  \"feedback\": string,",
    "  \"modelAnswer\": string,",
    "  \"strengths\": string[],",
    "  \"improvements\": string[]",
    "}",
    `LANGUAGE RULE (highest priority): ${languageDirective}`,
    "Output language is decided ONLY by the student's answer; retrieved context language never changes it.",
  ].join("\n");

  const gradingRules = [
    "GRADING RULES (SPM examiner mindset):",

    "Procedure (do these IN ORDER):",
    "- 1) First, build markBreakdown: list each SPM mark point the question expects (idea), whether the student awarded it (awarded), the mark value (marks), and a brief reason.",
    `- 2) Compute score = sum of marks where awarded === true. score MUST equal that sum and MUST NOT exceed maxScore (${params.maxScore}).`,
    "- 3) Fill matchedIdeas from awarded === true items, and missingIdeas from awarded === false items (one idea each, short).",
    "- 4) Write feedback strictly based on matchedIdeas + missingIdeas (no extra textbook material).",
    "- 5) Write modelAnswer separately — concise, ~N mark points for an N-mark question. NEVER put 'Model answer:' inside feedback.",

    "Question vs answer-style alignment (CRITICAL — prevents over-marking):",
    `- Detected question type: ${questionType.toUpperCase()}.`,
    `- Detected student answer style: ${answerStyle.toUpperCase()}.`,
    styleMismatch
      ? "- STYLE MISMATCH FLAG = TRUE. The student's answer style does NOT match what the question type demands. Award only the marks the student actually earned at their style level. DO NOT award explanation/comparison/process marks for content the student did not actually write."
      : "- STYLE MISMATCH FLAG = FALSE.",

    featureFunctionGradingParagraph,

    "Compare questions:",
    "- Build markBreakdown as paired-difference rows ('X is __ while Y is __'). Award only when both halves are present.",

    "Process / Pathway questions:",
    "- Build markBreakdown as ordered steps. Award a step only if the student wrote that step (correct content AND correct relative order).",

    "Calibration:",
    "- Award marks ONLY for ideas explicitly stated or clearly conveyed in the student answer — never inferred.",
    "- Reject vague or generic lines that could fit many topics even if scientifically related.",
    "- Grade at SPM Form 4/5 level — NOT A-Level / matriculation / university.",
    "- Accept paraphrases only when the student's own words show the mark point with enough specificity.",
    "- Do not require advanced details SPM does not ask for (e.g., Na+/glucose symport, renal threshold, secondary active transport, ATP/ADP minutiae, enzyme kinetics formulas, biochem pathways beyond syllabus).",
    "- Deduct for missing mark points, wrong ideas, contradictions, or implied-but-unstated science.",

    "Context use:",
    "- '[TEXTBOOK CONTEXT]' is the source of scientific truth.",
    "- '[PAST PAPER MARK SCHEME]' is NOT the rubric for this exact question — it shows SPM answer style, mark splits, accepted phrasings, and strictness ceiling.",
    "- Past-paper schemes set the strictness CEILING: never be stricter than they are.",
    "- maxScore for this submission is fixed; past-paper marks do not override it.",
    "- Never quote internal labels like '[TEXTBOOK CONTEXT]' or '[PAST PAPER MARK SCHEME]' in feedback.",
    `- Current retrieval state: ${contextSourceRule}`,

    "Score consistency:",
    `- score is an integer between 0 and ${params.maxScore} and MUST equal the sum of awarded marks in markBreakdown.`,
    "- score must match feedback (no 'all correct' feedback paired with low score).",
    "- If matchedIdeas covers every required idea, score = maxScore and missingIdeas = [].",
    "- Low retrieval confidence does not lower a clearly correct answer's score.",

    "FEEDBACK STYLE (supportive SPM teacher — easy for students to read):",
    "- Follow STUDENT LANGUAGE LEVEL in your system instructions for feedback, modelAnswer, strengths, improvements, and markBreakdown reasons.",
    "- Length: 1–3 short sentences. No paragraphs, no padding.",
    "- Base feedback ONLY on matchedIdeas + missingIdeas; do not introduce new ideas not in the breakdown.",
    "- Never claim the student wrote something that does not appear in their answer text.",
    "- Full marks: briefly confirm the matched key points; improvements MUST be [].",
    "- Partial marks: one sentence on what was correct, then state what is missing.",
    "- Zero/low marks: say it's too vague or incorrect, then give the correct key idea in one short line.",
    "- Use the student's own wording first, with the SPM term in parentheses, e.g. 'thin wall (one-cell-thick epithelium)'.",
    "- Avoid stiff examiner phrases like 'scientifically accurate', 'as per the literature', 'accepted in SPM marking scheme' (unless an official scheme is provided). Prefer plain praise or plain correction.",
    "- NEVER include 'Model answer:' inside feedback — modelAnswer is a separate field.",
    "- Never print internal labels or warning text in feedback (e.g., '[Low-context-warning]', '[TEXTBOOK CONTEXT]'); confidence is handled in metadata.",
    "- 'strengths' = brief correct points (mirror matchedIdeas); 'improvements' = brief missing/wrong points (mirror missingIdeas, or [] if full marks).",

    "modelAnswer rules:",
    "- Concise, separate from feedback.",
    "- Bounded by maxScore: ~N concise mark points for an N-mark question.",
    "- No extra textbook elaboration beyond what the marks demand.",
    "- For full marks, modelAnswer can be a single short line confirming the same key points.",
  ].join("\n");

  const inputBlock = [
    `LANGUAGE: ${languageDirective}`,
    `Detected student-answer language: ${answerLanguage.toUpperCase()}`,
    `Detected question type: ${questionType.toUpperCase()}`,
    `Detected student-answer style: ${answerStyle.toUpperCase()}`,
    `Style mismatch flag: ${styleMismatch ? "TRUE (strict depth / feature-function rules apply only when enabled above)" : "FALSE"}`,
    `Subject: ${params.subject?.trim() || "General"}`,
    `Rubric version: ${params.rubricVersion}`,
    `Max score: ${params.maxScore}`,
    `Question:\n${params.question}`,
    `Student answer:\n${params.studentAnswer}`,
    `Reference context (textbook + past-paper mark schemes when available):\n${params.contextText || "[No context retrieved]"}`,
    params.diagramContext
      ? [
          "Diagram context (structured — treat as the source of truth for the figure):",
          renderDiagramContextForGrader(params.diagramContext),
          params.diagramContext.confidence < 0.5
            ? "Note: vision confidence is low. For diagram-dependent marks, be cautious and rely on the student's words where the figure is ambiguous."
            : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      : null,
    params.warning ? `Internal context note (do not mention in feedback): ${params.warning}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const fairnessBlock = [
    "FAIRNESS CHECK (perform mentally before you lock score, matchedIdeas, missingIdeas, and feedback):",
    "- Match the student answer to the EXACT command of the question (what it truly asks for). If they already satisfied that demand in simple words, give full credit for it.",
    "- Do NOT penalise for missing extra textbook detail unless the question command (e.g. Explain, Discuss, List three) clearly requires those separate points.",
    "- Retrieved context is evidence only — never invent mark rows purely because a chunk mentions a fact the question did not ask for.",
    "CONTRADICTION CHECK:",
    "- missingIdeas MUST NOT contain any point that the student already wrote, including paraphrases (e.g. grow/form/develop pollen tube; reaction rate ≈ speed of reaction; provides energy ≈ gives energy).",
    "- If unsure whether a phrase counts as the same idea, favour the student and omit it from missingIdeas.",
  ].join("\n");

  const mcqLetterExplain = isMcqLetterOnlyExplanationRequest(
    params.question,
    params.studentAnswer,
    params.maxScore,
  )
    ? [
        "SPECIAL CASE — SPM OBJECTIVE (MCQ): The student answer is ONLY one letter A–D.",
        "markBreakdown: use exactly 1 row. idea: one short line naming the correct letter and the gist of that option (from the option lines). marks: 1. awarded: true iff the student's letter equals the correct letter; otherwise awarded false. score must be 0 or 1 accordingly.",
        "FEEDBACK (override generic 1–3 sentence brevity for this case only), plain text inside the JSON string, no bullets:",
        "  If the student's letter is WRONG: write 4–6 short sentences in simple words Form 4/5 can follow. (1) State clearly that their letter is incorrect. (2) Explain WHY that chosen option fails the stem (wrong fact, irrelevant, or misread). (3) State the CORRECT letter and quote a key phrase from that option line. (4) Explain WHY the correct option answers the question.",
        "  If the student's letter is RIGHT: write 2–3 short simple sentences confirming correctness and why that option fits the stem.",
        "  If the question text includes 'Jawapan:' / 'Answer:' with a letter, treat that as the keyed answer unless it clearly contradicts the stem.",
        "modelAnswer: one line — correct letter, closing parenthesis, then a brief reason.",
        "strengths and improvements: one short phrase each; may echo the above.",
      ].join("\n")
    : null;

  const userPrompt = [
    inputBlock,
    ...legacyGradingRubricHints(params.subject),
    gradingRules,
    questionTypeRules,
    fairnessBlock,
    mcqLetterExplain,
    `FINAL CHECK: ${languageDirective} Simplify any wording that sounds too advanced for Form 4/5. Re-read every sentence and rewrite any in the wrong language.`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const payload = {
    model: config.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 500) || `Qwen grading failed (${response.status})`);
  }

  if (!response.ok) {
    const message =
      parsedResponse?.error?.message ||
      parsedResponse?.message ||
      (typeof parsedResponse?.error === "string" ? parsedResponse.error : null) ||
      rawText.slice(0, 500) ||
      `Qwen grading failed (${response.status})`;
    throw new Error(message);
  }

  const content = parsedResponse?.choices?.[0]?.message?.content;
  const rawModelReply = messageContentToString(content).trim();
  const parsed = parseGradeResponse(rawModelReply, params.maxScore, {
    feedbackMaxSentences: mcqLetterExplain ? 8 : undefined,
  });
  const enforced = enforceFeatureFunctionRule(parsed, {
    explainExpected: featureFunctionMode,
    studentAnswer: params.studentAnswer,
    maxScore: params.maxScore,
  });
  const roleRuleEnforced = enforceDiagramRoleFeedbackRule(enforced, {
    question: params.question,
    maxScore: params.maxScore,
    feedbackMaxSentences: mcqLetterExplain ? 8 : undefined,
  });
  return { parsed: roleRuleEnforced, model: config.model };
}

function briefIdeaFeedback(
  score: number,
  maxScore: number,
  matched: string[],
  missing: string[],
  language: AnswerLanguage,
): string {
  const m = matched.filter(Boolean);
  const miss = missing.filter(Boolean);
  if (language === "malay") {
    if (score >= maxScore) return `Betul (${score}/${maxScore}). Poin utama: ${m.slice(0, 4).join("; ")}.`.trim();
    if (miss.length === 0) return `Markah ${score}/${maxScore}.`;
    return `Markah ${score}/${maxScore}. Sudah ada: ${m.slice(0, 3).join("; ") || "(tiada)"}. Perlu tambah atau jelas: ${miss.slice(0, 3).join("; ")}.`.trim();
  }
  if (score >= maxScore) return `Correct (${score}/${maxScore}). Main points: ${m.slice(0, 4).join("; ")}.`.trim();
  if (miss.length === 0) return `Score ${score}/${maxScore}.`;
  return `Score ${score}/${maxScore}. You already gave: ${m.slice(0, 3).join("; ") || "(see your answer)"}. Still add or clarify: ${miss.slice(0, 3).join("; ")}.`.trim();
}

export async function gradeSubmission(input: GradeSubmissionInput): Promise<GradeSubmissionResult> {
  const question = input.question?.trim();
  const studentAnswer = input.studentAnswer?.trim();
  if (!question) throw new Error("question is required");
  if (!studentAnswer) throw new Error("studentAnswer is required");

  const questionAnalysis = input.questionAnalysis ?? analyzeQuestion(question, input.subject?.trim() ?? null);

  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const clientMaxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const rubricVersion = input.rubricVersion?.trim() || "v1";
  const submissionId = input.submissionId?.trim() || `sub-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const savedRubricSkipInfer = typeof input.rubricId === "string" && input.rubricId.trim().length > 0;
  const mcqLetterSkipInfer = isMcqLetterOnlyExplanationRequest(question, studentAnswer, clientMaxScore);
  const scoreAdjustment = savedRubricSkipInfer
    ? {
        originalMaxScore: clientMaxScore,
        adjustedMaxScore: clientMaxScore,
        maxScoreAdjustedReason: "Saved rubric supplied; maxScore inference skipped.",
      }
    : mcqLetterSkipInfer
    ? {
        originalMaxScore: clientMaxScore,
        adjustedMaxScore: clientMaxScore,
        maxScoreAdjustedReason: "MCQ letter-only explanation; maxScore inference skipped.",
      }
    : inferAdjustedMaxScore(question, clientMaxScore, questionAnalysis);
  const maxScore = scoreAdjustment.adjustedMaxScore;

  let diagramContextStructured: DiagramContext | undefined;
  let diagramContextWarning: string | undefined;
  if (input.diagramImageUrl?.trim() || input.diagramImageBase64?.trim()) {
    try {
      const vision = await generateDiagramContextWithQwen({
        question,
        subject: input.subject,
        imageUrl: input.diagramImageUrl,
        imageBase64: input.diagramImageBase64,
      });
      diagramContextStructured = vision.diagram;
      console.info("[rag][grade] diagram context generated", {
        submissionId,
        model: vision.model,
        diagramType: vision.diagram.diagramType,
        labelCount: vision.diagram.labels.length,
        confidence: vision.diagram.confidence,
        rawLength: vision.rawText.length,
      });
    } catch (error) {
      diagramContextWarning = error instanceof Error ? error.message : "Failed to generate diagram context.";
      console.warn("[rag][grade] diagram context failed", {
        submissionId,
        warning: diagramContextWarning,
      });
    }
  }

  // Back-compat: callers that still expect a string get a deterministic
  // rendering of the structured form.
  const diagramContext = diagramContextStructured
    ? renderDiagramContextForGrader(diagramContextStructured)
    : undefined;

  const retrievalQuery = buildEnrichedRetrievalQuery(question, diagramContextStructured);
  const retrieval = await retrieveChunks({
    query: retrievalQuery,
    subject: input.subject?.trim(),
    form: input.form?.trim(),
    topK: input.topK,
  });
  console.info("[rag][grade] retrieved chunks", {
    count: retrieval.chunks.length,
    submissionId,
  });

  const contextAudit = await auditRetrievedContext(question, retrieval.chunks);
  const filteredChunks = filterChunksByAudit(retrieval.chunks, contextAudit.relevantChunkIds);
  const effectiveChunks = filteredChunks.length > 0 ? filteredChunks : [];
  const context = buildGradingContextFromChunks(question, effectiveChunks);

  const rawLowConfidence = !contextAudit.isSufficientContext || filteredChunks.length === 0;
  const isCoreTopic = isCoreBiologyTopic(question, input.subject);
  // Do not flag low confidence for well-known core Biology concepts even if retrieval is weak.
  const lowConfidence = rawLowConfidence && !isCoreTopic;
  const warning = lowConfidence ? "Insufficient textbook context for reliable grading." : null;

  console.info("[rag][grade] context audit", {
    submissionId,
    originalCount: retrieval.chunks.length,
    filteredCount: filteredChunks.length,
    effectiveChunkCount: effectiveChunks.length,
    relevanceScore: contextAudit.relevanceScore,
    isSufficientContext: contextAudit.isSufficientContext,
    isCoreTopic,
    lowConfidence,
    originalMaxScore: scoreAdjustment.originalMaxScore,
    adjustedMaxScore: maxScore,
    maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
  });

  const pipelineEnv = (process.env["RAG_GRADE_PIPELINE"] || "v2").trim().toLowerCase();
  const usePipelineV2 = !["v1", "legacy", "off", "false", "0"].includes(pipelineEnv);
  if (usePipelineV2) {
    const gradedV2 = await gradeWithPipelineV2({
      ...input,
      question,
      studentAnswer,
      maxScore,
      questionAnalysis,
      mergedGradingContextText: context.mergedContextText,
      auditedRetrievedChunks: effectiveChunks,
      pipelineContextAudit: contextAudit,
      gradingLowConfidence: lowConfidence,
      gradingContextWarning: warning,
    });

    // Pipeline v2 already reconciles marks; second pass inflated partial transport answers.
    const v2Reconciled = {
      missingIdeas: gradedV2.missingIdeas,
      matchedIdeas: gradedV2.matchedIdeas,
      markBreakdown: gradedV2.markBreakdown,
      score: gradedV2.score,
      contradictionCheckPassed: gradedV2.contradictionCheckPassed,
    };

    const scoreConsistency = applyScoreConsistencyRules({
      score: v2Reconciled.score,
      maxScore,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      missingIdeas: v2Reconciled.missingIdeas,
      studentAnswer,
      questionAnalysis,
    });
    const finalScoreV2 = scoreConsistency.score;

    const retrievalConfidence = computeRetrievalConfidence({
      audit: contextAudit,
      approvedChunkCount: filteredChunks.length,
      lowConfidenceFlag: lowConfidence,
    });

    const answerLangV2 = detectAnswerLanguage(studentAnswer);
    const mcqLetterV2 = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore);
    let feedbackOut = sanitizeFeedback(gradedV2.feedback, { maxSentences: mcqLetterV2 ? 8 : undefined });

    const topicV2 = validateTopicConsistency({
      question,
      studentAnswer,
      feedback: feedbackOut,
      modelAnswer: gradedV2.modelAnswer,
      missingIdeas: v2Reconciled.missingIdeas,
      matchedIdeas: v2Reconciled.matchedIdeas,
      rubricIdeas: gradedV2.rubricIdeas,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      score: finalScoreV2,
      maxScore,
      language: answerLangV2,
    });
    feedbackOut = topicV2.feedback;
    const modelAnswerOut = topicV2.modelAnswer ?? gradedV2.modelAnswer;

    if (process.env.NODE_ENV === "development") {
      const bd: MarkBreakdownItem[] = (v2Reconciled.markBreakdown ?? gradedV2.markBreakdown ?? []) as MarkBreakdownItem[];
      console.info("[rag][grade] v2 diagnostics", {
        submissionId,
        question: question.slice(0, 200),
        commandWord: questionAnalysis.commandWord,
        questionType: questionAnalysis.questionType,
        originalMaxScore: scoreAdjustment.originalMaxScore,
        adjustedMaxScore: maxScore,
        maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
        retrievalChunkCount: retrieval.chunks.length,
        auditApprovedChunkCount: filteredChunks.length,
        effectiveChunkCount: effectiveChunks.length,
        pipelineUsedAuditedContext: gradedV2.usedAuditedContext === true,
        rubricPointCount: bd.length,
        studentIdeasDetected: gradedV2.studentIdeasDetected,
        matchedRubricIds: bd.filter((r) => r.awarded && r.rubricId).map((r) => r.rubricId),
        missingRubricIds: bd.filter((r) => !r.awarded && r.rubricId).map((r) => r.rubricId),
        contradictionCheckPassed: v2Reconciled.contradictionCheckPassed,
        topicConsistencyPassed: topicV2.topicConsistencyPassed,
        scoreAfterConsistency: finalScoreV2,
        retrievalConfidence,
      });
    }

    await ragDb.insert(ragGradingResultsTable).values({
      submissionId,
      userId: input.userId ?? null,
      subject: input.subject?.trim() || null,
      form: input.form?.trim() || null,
      rubricVersion,
      score: finalScoreV2,
      maxScore,
      feedback: feedbackOut,
    });

    return {
      submissionId,
      score: finalScoreV2,
      maxScore,
      feedback: feedbackOut,
      model: gradedV2.model,
      modelAnswer: modelAnswerOut,
      matchedIdeas: v2Reconciled.matchedIdeas,
      missingIdeas: v2Reconciled.missingIdeas,
      markBreakdown: v2Reconciled.markBreakdown ?? gradedV2.markBreakdown,
      strengths: v2Reconciled.matchedIdeas.length > 0 ? v2Reconciled.matchedIdeas : gradedV2.strengths,
      improvements: finalScoreV2 === maxScore ? [] : v2Reconciled.missingIdeas,
      originalMaxScore: scoreAdjustment.originalMaxScore,
      adjustedMaxScore: maxScore,
      maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
      studentIdeasDetected: gradedV2.studentIdeasDetected,
      rubricIdeas: gradedV2.rubricIdeas,
      acceptedConcepts: gradedV2.acceptedConcepts,
      contradictionCheckPassed: v2Reconciled.contradictionCheckPassed,
      outsideRubricAwardCount: gradedV2.outsideRubricAwardCount,
      topicConsistencyPassed: topicV2.topicConsistencyPassed,
      topicConsistencyWarning: topicV2.topicConsistencyWarning,
      questionAnalysis,
      retrievalConfidence,
      diagramContext,
      diagramContextStructured,
      diagramContextWarning,
      contextUsed: retrieval.chunks.length,
      filteredContextUsed: effectiveChunks.length,
      lowConfidence,
      warning: warning ?? undefined,
      contextAudit,
      context,
    };
  }

  const graded = await gradeWithQwen({
    question,
    studentAnswer,
    subject: input.subject,
    contextText: context.mergedContextText,
    diagramContext: diagramContextStructured,
    maxScore,
    rubricVersion,
    warning,
    questionAnalysis,
  });

  const mcqLetterExplainMode = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore);
  const answerLang = detectAnswerLanguage(studentAnswer);
  const studentIdeasList = await extractStudentIdeas(question, studentAnswer, answerLang);
  const studentIdeaStrings = studentIdeasList.map((i) => i.idea);

  const reconciled = await fixMissingIdeasAgainstStudentAnswer({
    question,
    subject: input.subject?.trim() || "General",
    studentAnswer,
    missingIdeas: graded.parsed.missingIdeas ?? [],
    matchedIdeas: graded.parsed.matchedIdeas ?? [],
    markBreakdown: graded.parsed.markBreakdown,
    rubricIdeas: undefined,
    score: graded.parsed.score,
    maxScore,
  });

  const scoreConsistencyV1 = applyScoreConsistencyRules({
    score: reconciled.score,
    maxScore,
    markBreakdown: reconciled.markBreakdown ?? graded.parsed.markBreakdown,
    missingIdeas: reconciled.missingIdeas,
    studentAnswer,
    questionAnalysis,
  });
  const finalScore = scoreConsistencyV1.score;
  const finalMatched = reconciled.matchedIdeas;
  const finalMissing = reconciled.missingIdeas;
  const finalBreakdown = reconciled.markBreakdown ?? graded.parsed.markBreakdown;
  const modelFeedback = sanitizeFeedback(graded.parsed.feedback, {
    maxSentences: mcqLetterExplainMode ? 8 : undefined,
  });
  const finalFeedback = reconciled.contradictionCheckPassed
    ? modelFeedback
    : briefIdeaFeedback(finalScore, maxScore, finalMatched, finalMissing, answerLang);

  const retrievalConfidenceV1 = computeRetrievalConfidence({
    audit: contextAudit,
    approvedChunkCount: filteredChunks.length,
    lowConfidenceFlag: lowConfidence,
  });

  const rubricIdeaStrings = (finalBreakdown ?? []).map((r) => r.idea);
  const acceptedConceptsV1 = (finalBreakdown ?? []).map((r) => ({
    rubricIdea: r.idea,
    acceptedPhrases: [] as string[],
  }));

  let feedbackV1 = finalFeedback;
  let modelAnswerV1 = graded.parsed.modelAnswer;
  const topicV1 = validateTopicConsistency({
    question,
    studentAnswer,
    feedback: feedbackV1,
    modelAnswer: modelAnswerV1,
    missingIdeas: finalMissing,
    matchedIdeas: finalMatched,
    rubricIdeas: rubricIdeaStrings,
    markBreakdown: finalBreakdown,
    score: finalScore,
    maxScore,
    language: answerLang,
  });
  feedbackV1 = topicV1.feedback;
  modelAnswerV1 = topicV1.modelAnswer ?? modelAnswerV1;

  if (process.env.NODE_ENV === "development") {
    console.info("[rag][grade] v1 diagnostics", {
      submissionId,
      question: question.slice(0, 200),
      commandWord: questionAnalysis.commandWord,
      questionType: questionAnalysis.questionType,
      originalMaxScore: scoreAdjustment.originalMaxScore,
      adjustedMaxScore: maxScore,
      maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
      retrievalChunkCount: retrieval.chunks.length,
      auditApprovedChunkCount: filteredChunks.length,
      effectiveChunkCount: effectiveChunks.length,
      contradictionCheckPassed: reconciled.contradictionCheckPassed,
      topicConsistencyPassed: topicV1.topicConsistencyPassed,
      retrievalConfidence: retrievalConfidenceV1,
    });
  }

  await ragDb.insert(ragGradingResultsTable).values({
    submissionId,
    userId: input.userId ?? null,
    subject: input.subject?.trim() || null,
    form: input.form?.trim() || null,
    rubricVersion,
    score: finalScore,
    maxScore,
    feedback: feedbackV1,
  });

  return {
    submissionId,
    score: finalScore,
    maxScore,
    feedback: feedbackV1,
    model: graded.model,
    modelAnswer: modelAnswerV1,
    matchedIdeas: finalMatched,
    missingIdeas: finalMissing,
    markBreakdown: finalBreakdown,
    strengths: finalMatched.length > 0 ? finalMatched : graded.parsed.strengths,
    improvements: finalScore === maxScore ? [] : finalMissing,
    originalMaxScore: scoreAdjustment.originalMaxScore,
    adjustedMaxScore: maxScore,
    maxScoreAdjustedReason: scoreAdjustment.maxScoreAdjustedReason,
    studentIdeasDetected: studentIdeaStrings,
    rubricIdeas: rubricIdeaStrings,
    acceptedConcepts: acceptedConceptsV1,
    contradictionCheckPassed: reconciled.contradictionCheckPassed,
    topicConsistencyPassed: topicV1.topicConsistencyPassed,
    topicConsistencyWarning: topicV1.topicConsistencyWarning,
    questionAnalysis,
    retrievalConfidence: retrievalConfidenceV1,
    diagramContext,
    diagramContextStructured,
    diagramContextWarning,
    contextUsed: retrieval.chunks.length,
    filteredContextUsed: effectiveChunks.length,
    lowConfidence,
    warning: warning ?? undefined,
    contextAudit,
    context,
  };
}
