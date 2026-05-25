/**
 * Evidence-only marking: credit only what the student actually wrote.
 */

import {
  formatDiagramImageEvidenceBlock,
  gradingUsesVisualFigure,
  practiceQuestionIncludesDiagram,
  questionReferencesVisual,
} from "./gradingDiagramPolicy";
import type { DiagramContext, RubricIdea } from "./types";
import {
  ideasShareSynonymGroup,
  normalizeAnswerText,
  studentAnswerCoversIdea,
} from "./gradingFairnessMatch";

export const EVIDENCE_ONLY_MARKING_LINES = [
  "EVIDENCE-ONLY RULE (mandatory):",
  "- Award marks ONLY for concepts explicitly stated or clearly conveyed in the student answer text.",
  "- Do NOT infer missing mechanisms, purposes, outcomes, causes, effects, or relationships.",
  "- Do NOT assume what a vague or generic phrase 'probably meant' — if it could fit many topics, withhold the mark.",
  "- Evaluate ONLY information actually expressed; the question stem does not count as student evidence.",
  "- For Explain/Describe/Why: the student must state the relevant concept, mechanism, or effect in their own words.",
  "- When marking is uncertain, default to NOT awarded unless the required wording is clearly in the answer.",
] as const;

export const FEEDBACK_EVIDENCE_ONLY_LINES = [
  "FEEDBACK EVIDENCE RULE:",
  "- Describe only what the student actually wrote. Do NOT claim they mentioned ideas that never appear in their answer.",
  "- Do NOT paraphrase missing rubric points as if the student said them.",
  "- If a mark point was not awarded, say it was missing or not stated clearly enough — do not imply they partially said it unless their exact wording supports that.",
] as const;

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

export function formatFeedbackEvidenceOnlyBlock(): string {
  return FEEDBACK_EVIDENCE_ONLY_LINES.join("\n");
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "with", "from", "that", "this", "when", "than", "then", "will",
  "been", "being", "have", "has", "had", "not", "but", "its", "one", "two", "may", "can", "use", "also",
  "only", "very", "such", "more", "most", "less", "like", "just", "even", "other", "into", "upon", "over",
  "under", "both", "some", "any", "all", "per", "via", "yang", "dan", "atau", "untuk", "dalam", "pada",
]);

/** SPM terms that count as real scientific content in an answer line. */
const SCIENTIFIC_CONTENT_RE =
  /\b(atp|energy|respir|oxidat|glucose|glycolysis|enzyme|protein|synthes|transport|mitochond|mitokondria|chloroplast|kloroplas|xylem|xilem|phloem|floem|nucleus|dna|rna|osmosis|diffusion|photosynthesis|fotosintesis|transpiration|transpirasi|mitosis|meiosis|allele|gene|chromosome|kromosom|hormone|hormon|anaerobic|aerobic|anaerobik|aerobik)\b/i;

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

export function isVisualFigureQuestion(question: string, options?: EvidenceOnlyMarkingOptions): boolean {
  return gradingUsesVisualFigure({
    question,
    diagramContextStructured: options?.diagramContextStructured,
    diagramImageUrl: options?.diagramImageUrl,
    diagramImageBase64: options?.diagramImageBase64,
  });
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

/** Rubric point uses a specific term, not only weak words like "cell" or "energy". */
export function rubricSubstancePresentInAnswer(studentAnswer: string, rubric: RubricIdea): boolean {
  const ans = normalizeAnswerText(studentAnswer);
  if (!ans || isDiagramDeixisAnswer(ans)) return false;

  const sources = [
    rubric.idea,
    ...(rubric.keywords ?? []),
    ...(rubric.acceptedConcepts ?? []),
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

/** True when wording is too generic to credit a specific mark point. */
export function isGenericVagueStatement(text: string): boolean {
  const t = normalizeAnswerText(text);
  if (!t) return true;
  if (isDiagramDeixisAnswer(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return !/\b(xylem|phloem|osmosis|diffusion|mitosis|meiosis|dna|rna|enzyme|glucose|oxygen|carbon|chlorophyll|stomata|transpiration|photosynthesis|respiration|allele|gene|chromosome)\b/i.test(
      t,
    );
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
export function ideaTextGroundedInAnswer(idea: string, studentAnswer: string): boolean {
  const i = normalizeAnswerText(idea);
  const a = normalizeAnswerText(studentAnswer);
  if (!i || !a) return false;
  if (a.includes(i)) return true;
  const tokens = i.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return i.length <= 12 && a.includes(i);
  const hit = tokens.filter((t) => a.includes(t)).length;
  return hit / tokens.length >= 0.75;
}

/**
 * Code-level gate after LLM verify: mark point must be grounded in answer text.
 */
export function studentAnswerExplicitlySupportsMarkPoint(
  studentAnswer: string,
  rubric: RubricIdea,
  evidenceLine: string,
  question?: string,
): boolean {
  const line = (evidenceLine || "").trim() || studentAnswer.trim();
  if (!line || isGenericVagueStatement(line) || isGenericVagueStatement(studentAnswer)) return false;
  if (!ideaTextGroundedInAnswer(line, studentAnswer)) return false;

  if (
    question?.trim() &&
    questionRequiresExplicitWrittenScience(question) &&
    !answerNamesQuestionTarget(question, studentAnswer)
  ) {
    return false;
  }

  if (
    question?.trim() &&
    (questionReferencesVisual(question) || practiceQuestionIncludesDiagram(question)) &&
    isDiagramDeixisAnswer(studentAnswer)
  ) {
    return false;
  }

  if (!rubricSubstancePresentInAnswer(studentAnswer, rubric)) {
    return false;
  }

  if (studentAnswerCoversIdea(studentAnswer, rubric.idea)) {
    return rubricSubstancePresentInAnswer(studentAnswer, rubric);
  }
  if (ideasShareSynonymGroup(line, rubric.idea) || ideasShareSynonymGroup(studentAnswer, rubric.idea)) {
    return rubricSubstancePresentInAnswer(studentAnswer, rubric);
  }
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    if (phrase?.trim() && studentAnswerCoversIdea(studentAnswer, phrase)) {
      return rubricSubstancePresentInAnswer(studentAnswer, rubric);
    }
  }
  const id = normalizeAnswerText(rubric.idea);
  const ans = normalizeAnswerText(studentAnswer);
  const tokens = id.split(/\s+/).filter((t) => t.length > 4 && !STOPWORDS.has(t) && !WEAK_OVERLAP_TOKENS.has(t));
  if (tokens.length >= 1) {
    const hit = tokens.filter((t) => ans.includes(t)).length;
    if (hit / tokens.length >= 0.6) return rubricSubstancePresentInAnswer(studentAnswer, rubric);
  }
  return false;
}

export function filterGroundedStudentIdeas<T extends { idea: string }>(
  ideas: T[],
  studentAnswer: string,
): T[] {
  return ideas.filter(
    (row) =>
      row.idea.trim() &&
      !isDiagramDeixisAnswer(row.idea) &&
      ideaTextGroundedInAnswer(row.idea, studentAnswer),
  );
}
