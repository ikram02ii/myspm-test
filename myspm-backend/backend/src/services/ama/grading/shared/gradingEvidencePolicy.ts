/**
 * Evidence-only marking: credit only what the student actually wrote.
 */

import {
  formatDiagramImageEvidenceBlock,
  gradingUsesVisualFigure,
  practiceQuestionIncludesDiagram,
  questionReferencesVisual,
} from "./gradingPolicy";
import type { DiagramContext, RubricIdea } from "../../types";
import {
  ideasShareSynonymGroup,
  normalizeAnswerText,
  studentAnswerCoversIdea,
  studentExpressesRubricMeaning,
} from "../matching/gradingFairness";
import { analyzeQuestion } from "../analysis/questionAnalysisService";
import {
  isComparisonDifferenceQuestion,
  studentAnswerMentionsAllComparisonSubjects,
} from "./gradingComparisonSubjects";
import { comparisonStructureBlocksAward } from "./gradingRowPolicy";

export const CRITICAL_EVIDENCE_RULE_LINES = [
  "CRITICAL EVIDENCE RULE (highest priority for every mark):",
  "- ONLY award marks for concepts explicitly present in the student's answer.",
  "- NEVER award unless the student's own words support the mark point.",
  "- NEVER infer that a student mentioned a concept if it is not written.",
  "- NEVER copy concepts from the model answer, rubric, or question stem into the student's analysis.",
  "- The question text, textbook context, and model answer are NOT evidence of what the student wrote.",
  "- Evidence does NOT require exact textbook/rubric wording; ONLY award when a reasonable paraphrase of the required concept is explicitly written in the student's answer.",
  "",
  "Before awarding EACH mark (mandatory):",
  "1) You MUST quote the student wording that supports the mark (short exact snippet is preferred).",
  "2) You MUST match that evidence to the rubric concept by meaning (not exact phrase overlap alone).",
  "3) If the required concept is not reasonably supported by the student's wording, you MUST set awarded = false.",
] as const;

export const EVIDENCE_ONLY_MARKING_LINES = [
  ...CRITICAL_EVIDENCE_RULE_LINES,
  "",
  "EVIDENCE-ONLY RULE (mandatory):",
  "- Award marks ONLY for concepts explicitly stated or clearly conveyed in the student answer text.",
  "- Base each awarded mark on the student's response as evidence of conceptual understanding and scientific correctness.",
  "- Do NOT infer missing mechanisms, purposes, outcomes, causes, effects, or relationships.",
  "- Do NOT assume what a vague or generic phrase 'probably meant' — if meaning is unclear, withhold THAT mark only.",
  "- Evaluate ONLY information actually expressed; the question stem does not count as student evidence.",
  "- For Explain/Describe/Why: accept simplified, concise, paraphrased wording when the scientific concept is still correct.",
  "- Do not reject marks solely due to weak grammar, spelling, or non-textbook phrasing.",
  "- Reject marks for scientifically incorrect claims, unrelated statements, or keyword-only overlap without real conceptual support.",
  "- When marking is uncertain for one row, withhold THAT row — other independently demonstrated rows may still earn marks.",
  "- In markBreakdown, when awarded=true the reason MUST include a short quote from the student answer (in quotation marks).",
] as const;

export const FEEDBACK_EVIDENCE_ONLY_LINES = [
  "FEEDBACK EVIDENCE RULE:",
  "- Describe only what the student actually wrote. Do NOT claim they mentioned ideas that never appear in their answer.",
  "- Do NOT paraphrase missing rubric points as if the student said them.",
  "- Never attribute model-answer or rubric wording to the student unless the same idea appears in their answer text.",
  "- If a mark point was not awarded, say it was missing or not stated clearly enough — do not imply they partially said it unless their exact wording supports that.",
  "- Chemical equations: if a formula, arrow, or state symbol appears in the student's answer, validate it — never tell them to include it again.",
] as const;

export const FEEDBACK_MARK_SCHEME_BOUND_LINES = [
  "MARK-SCHEME-BOUND FEEDBACK (mandatory):",
  "- Evaluate the student ONLY against the BINDING MARKING POINTS list provided — nothing else.",
  "- NEVER penalize or criticize the student in feedback for missing an idea that is NOT an individual unawarded marking point.",
  "- Do NOT import extra requirements from the model answer, reference answer, textbook, or question stem beyond what each marking point explicitly requires.",
  "- Do NOT ask for additional examples, details, or sub-points unless a specific unawarded marking point demands them.",
  "- strengths[] may only reflect awarded marking points; improvements[] may only reflect unawarded marking points (brief rephrase OK).",
  "- If every marking point was awarded, feedback must be positive only and improvements MUST be [].",
] as const;

export const FEEDBACK_NOT_MODEL_ANSWER_LINES = [
  "FEEDBACK IS NOT MODEL ANSWER (mandatory — keep roles separate):",
  "- The feedback field is marking COMMENTARY only: what the student did well, what was missing, or what was wrong.",
  "- NEVER write the full correct answer, sample answer, worked solution, or marking-point solution inside feedback.",
  "- NEVER use headings or labels such as 'Model answer:', 'Jawapan:', 'Correct answer:', or 'Sample answer:' in feedback.",
  "- NEVER list bullet points of the correct marking scheme as if teaching the answer — that belongs in modelAnswer only (separate field).",
  "- When marks were lost, you MAY name the TYPE of gap (e.g. 'effect on transpiration') — do NOT write the full sentence the student should have written.",
  "- improvements[] = short gap labels only (≤12 words each), NOT model-answer sentences.",
  "- Do NOT quote unawarded marking-point text verbatim as the 'correct' wording.",
] as const;

/**
 * @deprecated Tranche A audit: no live `src/` consumers. Prefer CRITICAL_EVIDENCE_RULE_LINES
 * via formatEvidenceOnlyMarkingBlock / exam-standard composition. Kept for optional reuse.
 */
export function formatCriticalEvidenceRuleBlock(): string {
  return CRITICAL_EVIDENCE_RULE_LINES.join("\n");
}

export type EvidenceOnlyMarkingOptions = {
  question?: string;
  diagramContextStructured?: DiagramContext | null;
  diagramImageUrl?: string | null;
  diagramImageBase64?: string | null;
};

export function formatEvidenceOnlyMarkingBlock(options?: EvidenceOnlyMarkingOptions): string {
  const parts = [EVIDENCE_ONLY_MARKING_LINES.join("\n")];
  if (
    options &&
    gradingUsesVisualFigure({
      question: options.question ?? "",
      diagramContextStructured: options.diagramContextStructured,
      diagramImageUrl: options.diagramImageUrl,
      diagramImageBase64: options.diagramImageBase64,
    })
  ) {
    parts.push("", formatDiagramImageEvidenceBlock());
  }
  return parts.join("\n");
}

/**
 * @deprecated Tranche A audit: no live `src/` consumers. Canonical feedback uses
 * prompts/feedback/gapFeedbackPrompt.ts instead. Lines remain for reference.
 */
export function formatFeedbackEvidenceOnlyBlock(): string {
  return [
    ...FEEDBACK_EVIDENCE_ONLY_LINES,
    "",
    ...FEEDBACK_MARK_SCHEME_BOUND_LINES,
    "",
    ...FEEDBACK_NOT_MODEL_ANSWER_LINES,
  ].join("\n");
}

const INTERNAL_LABEL_PATTERNS = [
  /\[low-context-warning\]/gi,
  /\[textbook context\]/gi,
  /\[past paper mark scheme\]/gi,
];

/** Strip model-answer bleed and internal labels from learner-facing feedback. */
export function sanitizeLearnerFeedback(raw: string, opts?: { maxSentences?: number }): string {
  if (!raw) return "";
  const maxSentences =
    typeof opts?.maxSentences === "number" && opts.maxSentences > 0 ? opts.maxSentences : 3;
  let cleaned = raw;
  for (const pattern of INTERNAL_LABEL_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = cleaned.replace(
    /(^|\n)\s*(?:model answer|jawapan(?:\s+model)?|correct answer|sample answer|expected answer)\s*[:：][\s\S]*/gi,
    "",
  );
  cleaned = cleaned.replace(/(^|\n)\s*(?:•|\*|-)\s+.+(?:\n\s*(?:•|\*|-)\s+.+)+/g, (block) => {
    const lines = block.trim().split("\n");
    return lines.length >= 3 ? "" : block;
  });
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/\n{2,}/g, "\n").trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) return cleaned;
  return sentences.slice(0, maxSentences).join(" ").trim();
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "with", "from", "that", "this", "when", "than", "then", "will",
  "been", "being", "have", "has", "had", "not", "but", "its", "one", "two", "may", "can", "use", "also",
  "only", "very", "such", "more", "most", "less", "like", "just", "even", "other", "into", "upon", "over",
  "under", "both", "some", "any", "all", "per", "via", "yang", "dan", "atau", "untuk", "dalam", "pada",
]);

/** SPM terms that count as real scientific content in an answer line. */
const SCIENTIFIC_CONTENT_RE =
  /\b(atp|energy|respir|oxidat|glucose|glycolysis|enzyme|protein|synthes|transport|mitochond|mitokondria|chloroplast|kloroplas|xylem|xilem|phloem|floem|nucleus|dna|rna|osmosis|diffusion|photosynthesis|fotosintesis|transpiration|transpirasi|mitosis|meiosis|allele|gene|chromosome|kromosom|hormone|hormon|anaerobic|aerobic|anaerobik|aerobik|peptide|polypeptide|ionic|covalent|hydrogen|metallic|disulfide|ester|glycosidic|amide|nucleotide|amino\s*acid|asid\s*amino|alkane|alkene|alkyne|alcohol|carboxyl|hydrolysis|condensation|redox|electrolysis|isomer|polymer|monomer)\b/i;

/** Filler words that do not make a 1–3 word answer a valid recall term on their own. */
const SHORT_ANSWER_FILLER_WORDS = new Set([
  "good",
  "bad",
  "yes",
  "no",
  "ok",
  "cell",
  "part",
  "thing",
  "stuff",
  "this",
  "that",
  "helps",
  "helped",
  "important",
  "needed",
  "useful",
  "works",
  "does",
  "mean",
  "very",
  "also",
  "just",
  "like",
]);

const WEAK_OVERLAP_TOKENS = new Set([
  "cell",
  "cells",
  "sel",
  "organ",
  "organs",
  "structure",
  "structures",
  "function",
  "energy",
  "production",
  "everything",
  "anything",
  "something",
  "part",
  "diagram",
  "figure",
  "explains",
  "means",
  "everything",
]);

/** Answer points at the diagram/image instead of stating science in words. */
export function isDiagramDeixisAnswer(text: string): boolean {
  const t = normalizeAnswerText(text);
  if (!t) return true;
  if (/\b(this|the|that)\s+(diagram|figure|graph|rajah|picture|image|photo|chart|table)\b/.test(t)) return true;
  if (/\b(diagram|figure|rajah|graph|chart|gambar)\s+(shows|show|explain|explains|means|represents|tells|said)\b/.test(t)) {
    return true;
  }
  if (/\b(as\s+shown|shown\s+in|see\s+the|refer\s+to|rujuk|lihat|pada)\s+(?:the\s+)?(?:diagram|figure|rajah|graph|image|picture|chart)\b/.test(t)) {
    return true;
  }
  if (/\b(point|points|tunjuk|menunjuk)\s+(?:at|to|ke|pada)\s+(?:the\s+)?(?:diagram|figure|rajah|part|label)\b/.test(t)) {
    return true;
  }
  if (/\b(labelled|labeled|label|letter)\s+[A-P]\b/.test(t) && !SCIENTIFIC_CONTENT_RE.test(t)) return true;
  if (
    /\b(this|the|that)\s+(part|structure|aprt|thing|section|area|organelle|organel|bahagian|struktur)\b/.test(t) &&
    !SCIENTIFIC_CONTENT_RE.test(t)
  ) {
    return true;
  }
  if (/\b(everything|anything)\b/.test(t) && /\b(cell|plant|animal|organism|body|diagram|rajah)\b/.test(t) && !SCIENTIFIC_CONTENT_RE.test(t)) {
    return true;
  }
  if (/\b(by that i mean|i mean)\s+everything\b/.test(t)) return true;
  if (/\bdo(es)?\s+everything\b/.test(t) && !SCIENTIFIC_CONTENT_RE.test(t)) return true;
  if (/\b(it|this|that)\s+(does|do|is|are)\s+(everything|all|the\s+function)\b/.test(t) && !SCIENTIFIC_CONTENT_RE.test(t)) {
    return true;
  }
  return false;
}

const TARGET_ENTITY_GROUPS: readonly string[][] = [
  ["mitochondria", "mitokondria", "mitochondrion"],
  ["chloroplast", "kloroplas"],
  ["nucleus", "nukleus"],
  ["ribosome", "ribosom"],
  ["xylem", "xilem"],
  ["phloem", "floem"],
  ["stomata", "stomata"],
  ["alveoli", "alveolus", "alvoli"],
  ["capillary", "kapilari", "capillaries"],
  ["neuron", "neurone", "nerve"],
  ["red blood cell", "erythrocyte", "sel darah merah"],
  ["white blood cell", "lymphocyte", "sel darah putih"],
];

/** State/explain function-of-X questions: student must name X in their answer. */
export function questionRequiresTargetEntity(question: string): boolean {
  const q = (question || "").trim();
  if (!q) return false;
  return (
    /\b(function|role|purpose|importance|fungsi|peranan|tujuan|kepentingan)\s+(of|bagi|untuk)\s+/i.test(q) ||
    /\b(state|nyatakan|terangkan|jelaskan|explain|describe|huraikan)\s+.+\b(function|fungsi|role|peranan|tujuan)\b/i.test(
      q,
    ) ||
    /\bwhat\s+is\s+the\s+(function|role|purpose)\s+of\b/i.test(q) ||
    /\b(apakah|nyatakan)\s+fungsi\b/i.test(q)
  );
}

/** Diagram / label / name / graph items: student must write the required science, not only describe the figure. */
export function questionRequiresExplicitWrittenScience(question: string): boolean {
  const q = (question || "").trim();
  if (!q) return false;
  if (questionRequiresTargetEntity(q)) return true;
  if (
    /\b(name|label|identify|state|give|write|nyatakan|namakan|labelkan|kenal\s*pasti|tulis|beri)\b/i.test(q) &&
    /\b(part|structure|organ|tissue|component|apparatus|cell|organelle|bahagian|struktur|organ|tisu|komponen|organel|sel|[A-P])\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(read|state|give|nyatakan|beri|tentukan)\b.+\b(from|off|daripada)\s+(?:the\s+)?(?:graph|chart|table|graf|jadual)\b/i.test(q)) {
    return true;
  }
  if (questionReferencesVisual(q) || practiceQuestionIncludesDiagram(q)) {
    return /\b(state|explain|describe|name|label|identify|calculate|compare|read|why|how|nyatakan|terangkan|huraikan|namakan|kenal\s*pasti|labelkan|baca|bandingkan|kira|mengapa|bagaimana)\b/i.test(
      q,
    );
  }
  return false;
}

export function answerNamesQuestionTarget(question: string, answer: string): boolean {
  const q = normalizeAnswerText(question);
  const a = normalizeAnswerText(answer);
  if (!q || !a) return false;

  for (const group of TARGET_ENTITY_GROUPS) {
    const inQuestion = group.some((term) => q.includes(normalizeAnswerText(term)));
    if (!inQuestion) continue;
    if (group.some((term) => a.includes(normalizeAnswerText(term)))) return true;
  }

  const enMatch = question.match(/\bfunction\s+of\s+(?:the\s+)?([a-z][a-z\s]{2,30}?)(?:\s+in|\s+of|\s+for|\.|,|\?|$)/i);
  if (enMatch?.[1]) {
    const term = normalizeAnswerText(enMatch[1].replace(/\s+in\s+a\s+cell$/, "").trim());
    if (term.length >= 4 && a.includes(term)) return true;
  }
  const bmMatch = question.match(/\bfungsi\s+([a-z][a-z\s]{2,24}?)(?:\s+dalam|\s+di|\.|,|\?|$)/i);
  if (bmMatch?.[1]) {
    const term = normalizeAnswerText(bmMatch[1].trim());
    if (term.length >= 4 && a.includes(term)) return true;
  }

  const labelMatch = question.match(
    /\b(?:name|label|identify|state|nyatakan|namakan|labelkan|kenal\s*pasti)\s+(?:the\s+)?(?:part|structure|organ|bahagian|struktur)?\s*(?:labelled|labeled|marked|berlabel)?\s*(?:as\s+)?([A-P])\b/i,
  );
  if (labelMatch?.[1]) {
    const letter = normalizeAnswerText(labelMatch[1]);
    if (a.includes(letter)) return true;
  }

  const whatIsMatch = question.match(/\bwhat\s+is\s+(?:the\s+)?([a-z][a-z\s]{2,28}?)(?:\s+in|\?|\.|,|$)/i);
  if (whatIsMatch?.[1]) {
    const term = normalizeAnswerText(whatIsMatch[1].trim());
    if (term.length >= 4 && a.includes(term)) return true;
  }

  return false;
}

/** True when specific rubric substance appears in the given text span. */
export function rubricSubstancePresentInText(text: string, rubric: RubricIdea): boolean {
  const ans = normalizeAnswerText(text);
  if (!ans || isDiagramDeixisAnswer(ans)) return false;

  const sources = [
    rubric.idea,
    ...(rubric.keywords ?? []),
    ...(rubric.acceptedConcepts ?? []),
    ...(rubric.acceptedSynonyms ?? []),
  ].filter(Boolean);

  for (const src of sources) {
    const tokens = normalizeAnswerText(src)
      .split(/\s+/)
      .filter((t) => t.length > 4 && !WEAK_OVERLAP_TOKENS.has(t) && !STOPWORDS.has(t));
    if (tokens.length > 0 && tokens.some((t) => ans.includes(t))) return true;
  }

  if (SCIENTIFIC_CONTENT_RE.test(ans) && sources.some((s) => SCIENTIFIC_CONTENT_RE.test(s))) {
    return true;
  }

  return false;
}

/** Rubric point uses a specific term, not only weak words like "cell" or "energy". */
export function rubricSubstancePresentInAnswer(studentAnswer: string, rubric: RubricIdea): boolean {
  return rubricSubstancePresentInText(studentAnswer, rubric);
}

/**
 * Name/State-style answers: "peptide bond", "ionic bond", "mitochondria" — specific terms, not vague.
 */
export function isShortSpecificRecallAnswer(text: string): boolean {
  const t = normalizeAnswerText(text);
  if (!t || isDiagramDeixisAnswer(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (SCIENTIFIC_CONTENT_RE.test(t)) return true;
  const substantive = words.filter((w) => w.length >= 4 && !SHORT_ANSWER_FILLER_WORDS.has(w));
  if (words.length === 1) return substantive.length === 1;
  if (substantive.length >= 1 && words.some((w) => w.length >= 5)) return true;
  if (words.length >= 2 && substantive.length >= Math.ceil(words.length / 2)) return true;
  return false;
}

function isRecallStyleQuestion(question: string): boolean {
  const cw = analyzeQuestion(question).commandWord;
  return cw === "state" || cw === "name" || cw === "list" || cw === "identify";
}

/** True when wording is too generic to credit a specific mark point. */
export function isGenericVagueStatement(text: string): boolean {
  const t = normalizeAnswerText(text);
  if (!t) return true;
  if (isDiagramDeixisAnswer(t)) return true;
  if (isShortSpecificRecallAnswer(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return !SCIENTIFIC_CONTENT_RE.test(t);
  }
  if (words.length <= 6) {
    const mostlyGeneric =
      words.filter((w) =>
        /^(helps?|helped|important|good|bad|better|needed|useful|benefit|affect|grow|survive|work|function|energy|water|food|plant|animal|cell|thing|stuff|something|because|so|to)$/i.test(
          w,
        ),
      ).length >= Math.max(2, words.length - 1);
    if (mostlyGeneric) return true;
  }
  const vaguePhrases = [
    /\b(helps? the|good for|important for|needed for|useful for|beneficial to)\b/,
    /\b(affects? the|increase|decrease)(s)?\s+(growth|rate|level|amount)\b/,
    /\b(so that it|because it|in order to)\s+(can|will|could)\s+(work|function|grow|survive)\b/,
    /\b(related to|connected to|linked to|part of)\b/,
    /\b(something|things|stuff|everything)\b/,
  ];
  if (vaguePhrases.some((p) => p.test(t)) && !SCIENTIFIC_CONTENT_RE.test(t)) return true;
  return words.length <= 10 && vaguePhrases.some((p) => p.test(t));
}

/** Idea string must appear in the raw answer (not LLM-expanded). */
export function ideaTextGroundedInAnswer(
  idea: string,
  studentAnswer: string,
  minTokenRatio = 0.75,
): boolean {
  const i = normalizeAnswerText(idea);
  const a = normalizeAnswerText(studentAnswer);
  if (!i || !a) return false;
  if (a.includes(i)) return true;
  const tokens = i.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return i.length <= 12 && a.includes(i);
  const hit = tokens.filter((t) => a.includes(t)).length;
  return hit / tokens.length >= minTokenRatio;
}

/**
 * Code-level gate after LLM verify: mark point must be grounded in answer text.
 * Concept recognition runs first; structural checks apply per-row on the evidence clause only.
 */
export function studentAnswerExplicitlySupportsMarkPoint(
  studentAnswer: string,
  rubric: RubricIdea,
  evidenceLine: string,
  question?: string,
): boolean {
  const line = (evidenceLine || "").trim() || studentAnswer.trim();
  if (!line) return false;

  const q = question?.trim() ?? "";

  // Comparison structure: scoped to evidence clause, not whole answer.
  if (
    q &&
    isComparisonDifferenceQuestion(q) &&
    rubric.comparisonSubjects &&
    rubric.comparisonSubjects.length >= 2 &&
    comparisonStructureBlocksAward(rubric, line, studentAnswer)
  ) {
    return false;
  }

  // Short recall answers: full answer is the evidence.
  if (q && isRecallStyleQuestion(q) && isShortSpecificRecallAnswer(studentAnswer)) {
    if (isDiagramDeixisAnswer(studentAnswer)) return false;
    if (studentAnswerCoversIdea(studentAnswer, rubric.idea)) return true;
    for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? []), ...(rubric.acceptedSynonyms ?? [])]) {
      if (phrase?.trim() && studentAnswerCoversIdea(studentAnswer, phrase)) return true;
    }
    if (ideasShareSynonymGroup(studentAnswer, rubric.idea)) return true;
  }

  if (isDiagramDeixisAnswer(line)) return false;
  if (isGenericVagueStatement(line)) return false;
  if (!ideaTextGroundedInAnswer(line, studentAnswer, 0.55)) return false;

  if (
    q &&
    questionRequiresExplicitWrittenScience(q) &&
    !answerNamesQuestionTarget(q, studentAnswer)
  ) {
    return false;
  }

  if (
    question?.trim() &&
    (questionReferencesVisual(question) || practiceQuestionIncludesDiagram(question)) &&
    isDiagramDeixisAnswer(line)
  ) {
    return false;
  }

  // Concept-first: semantic match on evidence clause before token overlap fallbacks.
  if (studentExpressesRubricMeaning(line, rubric, studentAnswer)) {
    return rubricSubstancePresentInText(line, rubric) || rubricSubstancePresentInAnswer(studentAnswer, rubric);
  }

  if (ideasShareSynonymGroup(line, rubric.idea)) {
    return rubricSubstancePresentInText(line, rubric) || rubricSubstancePresentInAnswer(studentAnswer, rubric);
  }

  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? []), ...(rubric.acceptedSynonyms ?? [])]) {
    if (phrase?.trim() && (studentAnswerCoversIdea(line, phrase) || studentAnswerCoversIdea(studentAnswer, phrase))) {
      return rubricSubstancePresentInText(line, rubric) || rubricSubstancePresentInAnswer(studentAnswer, rubric);
    }
  }

  const id = normalizeAnswerText(rubric.idea);
  const lineNorm = normalizeAnswerText(line);
  const tokens = id.split(/\s+/).filter((t) => t.length > 4 && !STOPWORDS.has(t) && !WEAK_OVERLAP_TOKENS.has(t));
  if (tokens.length >= 1) {
    const hit = tokens.filter((t) => lineNorm.includes(t)).length;
    if (hit / tokens.length >= 0.55) {
      return rubricSubstancePresentInText(line, rubric) || rubricSubstancePresentInAnswer(studentAnswer, rubric);
    }
  }

  return false;
}
