/**
 * SPM grading policy: student language, diagram rules, examiner prompts, question category heuristics.
 */

import type { DiagramContext } from "../types";
import { formatEvidenceOnlyMarkingBlock, type EvidenceOnlyMarkingOptions } from "./gradingEvidencePolicy";
/**
 * Shared instructions so AI marking, rubrics, and related LLM outputs stay at
 * Malaysian SPM Form 4/5 reading level â€” short, clear, school-friendly wording.
 */
export const SPM_STUDENT_FRIENDLY_RULES_HEADER =
  "STUDENT LANGUAGE LEVEL (Malaysian SPM Form 4/5 â€” all text students will read):";

export const SPM_STUDENT_FRIENDLY_RULES_LINES = [
  "- Write for 16–17-year-old SPM students, not university lecturers.",
  "- Use short, clear sentences and everyday school vocabulary.",
  "- Avoid rare words, long nested clauses, and 'essay' or journal-style phrasing.",
  "- Science and maths: use terms found in Malaysian SPM textbooks only. If a word might confuse, add one short gloss in brackets (optional, keep brief).",
  "- Bahasa Melayu: standard classroom BM (e.g. kerana, supaya, iaitu). Avoid archaic or overly formal legal-style BM.",
  "- English: simple school English (because, so, helps, wrong, correct). Do not sound like an academic paper.",
  "- Tone: calm and helpful, like a supportive teacher. No condescension, no showing off vocabulary.",
  "- In JSON, every learner-facing string (feedback, modelAnswer, strengths, improvements, markBreakdown[].reason) must follow these rules.",
  "- LANGUAGE FAIRNESS: BM/English mix, chemical formulae, common names, and trade names count when they clearly express the same SPM mark point â€” never penalize notation or language choice alone.",
  "- EXAM STANDARD (marking only): Award by marking-scheme CONCEPTS â€” not model-answer wording. State/Name: a correct keyword is enough. Explain/Describe: each correct idea counts; paraphrases OK. Reject vague/generic answers even if loosely related.",
  "- CRITICAL EVIDENCE: Credit only concepts explicitly written in the student's answer. Quote their exact phrase before each mark. Never infer unstated ideas or copy from the model answer into feedback.",
  "- DIAGRAMS/FIGURES: Use attached or referenced figures only to understand the question and rubric. Never treat the figure as proof the student knows a label, structure, value, or process unless they wrote it.",
] as const;

export function formatSpmStudentFriendlyRulesBlock(): string {
  return [SPM_STUDENT_FRIENDLY_RULES_HEADER, ...SPM_STUDENT_FRIENDLY_RULES_LINES].join("\n");
}



/**
 * Diagram / image / figure questions: vision context builds the rubric only;
 * marks require explicit wording in the student's written answer.
 */

const VISUAL_QUESTION_RE =
  /\b(diagram|figure|fig\.?\s*\d|graph|chart|table|image|photo|micrograph|microscopy|flowchart|flow\s*chart|apparatus|rajah|graf|jadual|gambar|labelled|labeled|label\s+[A-P]\b|structure\s+shown|based\s+on\s+the\s+(?:diagram|figure|graph|table|image)|refer\s+to\s+the\s+(?:diagram|figure|graph|table)|according\s+to\s+the\s+(?:diagram|figure|graph|table)|rujuk\s+rajah|berdasarkan\s+rajah|lihat\s+rajah|dalam\s+rajah|pada\s+rajah)\b/i;

/** Practice-set stems: diagram intended for this item (mobile may also send diagramImageUrl). */
const PRACTICE_DIAGRAM_FLAG_RE =
  /(?:Perlu rajah|Diagram needed|Need diagram|Rajah diperlukan)\s*:\s*(?:ya|yes|y)\b/i;

export const VISUAL_FIGURE_REVOKE_REASON =
  "Marks require the scientific point in your written words â€” describing or pointing at the diagram/figure is not credited.";

export const DIAGRAM_IMAGE_EVIDENCE_LINES = [
  "DIAGRAM / IMAGE / FIGURE QUESTIONS (mandatory when the stem or an attached figure applies):",
  "1. Use the diagram, labelled figure, graph, table, microscopy image, flowchart, apparatus drawing, or chemical/biological structure ONLY to understand the question and to shape expected rubric points.",
  "2. The diagram must NEVER be treated as evidence that the student knows a concept â€” vision labels, arrows, and summaries are not the student's answer.",
  "3. Award marks ONLY for concepts explicitly stated or clearly conveyed in the student's written answer text (typed or OCR).",
  "4. Do NOT infer structure names, functions, labels, relationships, processes, values read from a graph, or scientific terms from the figure if they are absent from the student's response.",
  "5. If the student only points at or describes the figure without naming the required term/mechanism/value in words, withhold the mark.",
  "6. For label-the-diagram tasks: credit a label only when the student wrote that name/term in their answer (BM/EN synonyms OK) â€” not because the figure shows it.",
  "7. For graph/table reading: credit a value/trend only when the student stated it in their answer â€” do not award for a correct read you see on the figure alone.",
] as const;

export function questionReferencesVisual(question: string): boolean {
  return VISUAL_QUESTION_RE.test((question || "").trim());
}

export function practiceQuestionIncludesDiagram(question: string): boolean {
  return PRACTICE_DIAGRAM_FLAG_RE.test((question || "").trim());
}

/** True when this item is diagram/graph/figure-based (stem, practice flag, or attached image). */
export function gradingUsesVisualFigure(params: {
  question: string;
  diagramContextStructured?: DiagramContext | null;
  diagramImageUrl?: string | null;
  diagramImageBase64?: string | null;
}): boolean {
  const q = (params.question || "").trim();
  return (
    Boolean(params.diagramContextStructured) ||
    Boolean(params.diagramImageUrl?.trim()) ||
    Boolean(params.diagramImageBase64?.trim()) ||
    questionReferencesVisual(q) ||
    practiceQuestionIncludesDiagram(q)
  );
}

export function formatDiagramImageEvidenceBlock(): string {
  return DIAGRAM_IMAGE_EVIDENCE_LINES.join("\n");
}

/** Shown next to structured diagram JSON â€” clarifies role for the grader/verifier. */
export function formatDiagramContextRubricOnlyPreamble(confidence?: number): string {
  const lines = [
    "ATTACHED FIGURE (rubric context only â€” NOT student evidence):",
    "- Use this block to know what the question refers to and what mark points are reasonable.",
    "- Do NOT award marks because a label, structure, or value appears here unless the student wrote it in their answer.",
    "- Do NOT copy names, functions, or relationships from this block into matchedIdeas unless the same wording appears in the student answer.",
  ];
  if (typeof confidence === "number" && confidence < 0.5) {
    lines.push("- Vision confidence is low: rely on the student's words when the figure is ambiguous; never guess credit from the image.");
  }
  return lines.join("\n");
}



/**
 * Heuristics for open-ended SPM questions that should use category-based
 * rubrics and verification (examples, uses, etc.), vs stems bound to a figure.
 */

function normalizeStem(question: string): string {
  return (question || "")
    .toLowerCase()
    .replace(/\r/g, "\n")
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .replace(/^(en|bm)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stem ties the answer to a given diagram, text, experiment, or named target â†’ closed set from that source. */
export function isStrictContextBindingQuestion(question: string): boolean {
  const q = normalizeStem(question);
  return (
    /\bbased\s+on\s+(?:the\s+)?(?:diagram|figure|graph|text|passage|table|information|experiment|data|results?|photo|image)\b/.test(
      q,
    ) ||
    /\b(?:refer(?:\s+to)?|using)\s+(?:the\s+)?(?:diagram|figure|graph|text|passage|table|experiment)\b/.test(q) ||
    /\b(?:from|in)\s+the\s+(?:diagram|figure|graph|text|passage|table|experiment)\s+(?:above|below|shown)\b/.test(q) ||
    /\bberdasarkan\s+(?:rajah|graf|teks|jadual|maklumat|eksperimen|data)\b/.test(q) ||
    /\bdaripada\s+(?:rajah|graf|teks|jadual|eksperimen)\b/.test(q) ||
    /\b(?:di|dari)\s+(?:rajah|graf)\s+(?:di\s+)?(?:atas|bawah)\b/.test(q) ||
    /\baccording\s+to\s+the\s+(?:diagram|figure|graph|passage|table|experiment)\b/.test(q)
  );
}

/** Asks for category-style open answers (examples, uses, pros/cons, etc.). */
export function isOpenCategoryMarkingQuestion(question: string): boolean {
  const q = normalizeStem(question);
  return (
    /\b(examples?|for\s+example|such\s+as|one\s+example|give\s+an\s+example|uses?\b|usage\b|function\s+of|functions\s+of|properties?\b|property\b|advantages?|disadvantages?|suggestions?|applications?|benefits?|limitations?)\b/i.test(
      q,
    ) ||
    /\b(contoh|contohnya|sebagai\s+contoh|satu\s+contoh|berikan\s+contoh|kegunaan|fungsi|sifat|ciri|kelebihan|kelemahan|kekurangan|cadangan|aplikasi|faedah|keburukan)\b/i.test(
      q,
    )
  );
}

/** Question asks for an example and a matching use/function (verify separately). */
export function isExampleAndUseComboQuestion(question: string): boolean {
  const q = normalizeStem(question);
  const hasEx = /\b(example|examples|contoh)\b/i.test(q);
  const hasUse = /\b(use|uses|usage|function|functions|purpose|application|kegunaan|fungsi|tujuan|aplikasi)\b/i.test(q);
  if (!hasEx || !hasUse) return false;
  return /\b(and|dan|beserta|serta|with|together\s+with)\b/i.test(q);
}

const OPEN_TOPIC_RECALL_CMD =
  /\b(state|list|give|mention|name|identify|nyatakan|senaraikan|namakan|berikan|kenal\s*pasti)\b/i;

/** Stem names one fixed target (not "any valid from topic"). */
export function stemSpecifiesParticularAnswersOnly(question: string): boolean {
  const q = normalizeStem(question);
  if (isStrictContextBindingQuestion(question)) return true;
  if (/\bwhich\s+of\s+the\s+following\b/i.test(q)) return true;
  if (/\b(?:the\s+)?following\s*:\s*/i.test(q)) return true;
  if (/\b(?:below|above|di\s+bawah|di\s+atas)\s*:\s*/i.test(q)) return true;
  if (/\blabel(?:led|ed)?\s+[A-P]\b/i.test(q)) return true;
  if (/\b(?:function|role|purpose|structure|part|organ|tissue|process)\s+of\s+(?:the\s+)?[a-z0-9]/i.test(q)) {
    return true;
  }
  if (/\b(?:name|namakan|identify|kenal\s*pasti)\s+(?:the\s+)?(?:part|structure|organ|cell|tissue|label)\b/i.test(q)) {
    return true;
  }
  if (/\bwhat\s+is\s+the\s+(?:name|function|role|purpose)\s+of\b/i.test(q)) return true;
  if (/\b(?:state|nyatakan)\s+(?:whether|if|that)\b/i.test(q)) return true;
  return false;
}

/**
 * "State two safety rules", "list three uses", etc. — any valid SPM answer from the topic,
 * not a closed list copied from a model answer.
 */
export function questionInvitesOpenTopicRecall(question: string): boolean {
  const q = normalizeStem(question);
  if (!OPEN_TOPIC_RECALL_CMD.test(q)) return false;
  if (stemSpecifiesParticularAnswersOnly(question)) return false;
  return true;
}

export function isExplainWhyCauseEffectQuestion(
  question: string,
  questionType?: string,
  demandType?: string,
): boolean {
  const q = normalizeStem(question);
  const hasExplainCmd =
    /\b(explain\s+why|explain\s+how|terangkan\s+mengapa|terangkan\s+kenapa|jelaskan\s+mengapa|mengapa|why\s+does|why\s+do|give\s+reasons?)\b/i.test(
      q,
    ) || /\b(explain|terangkan|jelaskan|huraikan|discuss|bincangkan|why|mengapa|kenapa)\b/i.test(q);
  if (!hasExplainCmd) return false;
  return questionType === "cause_effect" || demandType === "explanation";
}

/** Rubric LLM: how to populate acceptedConcepts per row. */
export function buildAcceptedConceptsRubricInstructions(): string {
  return [
    "ACCEPTED CONCEPTS (mandatory for every row):",
    "For each rubric row, populate acceptedConcepts by reasoning from the CORE CONCEPT that row tests — not from model-answer wording.",
    "Ask: what underlying idea must the student demonstrate for this mark?",
    "Include any term or phrase that expresses that same idea:",
    "- shortened or informal forms of the key term",
    "- BM, English, and Chinese equivalents",
    "- general category terms where the specific term is implied by context",
    "- any phrasing a trained SPM examiner would reasonably accept",
    "Never restrict acceptedConcepts to paraphrases of one model answer phrase.",
    "A term belongs in acceptedConcepts if it expresses the correct concept — not because it resembles the model answer.",
  ].join("\n");
}

/** Rubric LLM: cached colloquial and short-form targets for Stage 4 semantic matching. */
export function buildAcceptedSynonymsRubricInstructions(): string {
  return [
    "ACCEPTED SYNONYMS (mandatory for every row — separate from acceptedConcepts):",
    "Populate acceptedSynonyms with 6–14 short phrases a Malaysian SPM student might actually write for this mark point.",
    "Include:",
    "- colloquial or informal labels (not only textbook wording)",
    "- phrases with action verbs (e.g. stops, blocks, carries, protects, causes)",
    "- BM / English / mixed classroom shorthand",
    "- abbreviated or list-style fragments students use in compound answers",
    "Derive from the CORE CONCEPT the row tests — never copy only from a single model answer line.",
    "acceptedSynonyms is for semantic matching; acceptedConcepts remains the broader paraphrase list.",
    "Also accept semanticTargets as an alias field name in JSON if you prefer — same meaning as acceptedSynonyms.",
  ].join("\n");
}

/** Rubric LLM: open topic pool ("state any N from domain"). */
export function buildOpenTopicPoolRubricInstructions(): string {
  return [
    "OPEN TOPIC POOL (when the stem invites any valid answer from a topic domain):",
    "Applies when the command word is state / nyatakan / give / berikan / list / senaraikan / name / namakan",
    "AND the stem does NOT require one particular named answer.",
    "On EVERY row for such questions:",
    "- openEnded: true",
    '- gradingMode: "open_pool"',
    "- conceptType: open_set",
    "- allowSemanticEquivalence: true",
    "- Populate validMembers with the FULL set of scientifically correct SPM-level answers for this topic — not only items from a model answer.",
    "- Each pool row = one valid answer (1 mark). One validMembers entry: { value: canonical term, aliases: [BM/EN/shorthand] }.",
    "- The model answer is ONE valid combination; students earn marks for ANY correct items from the domain.",
    "- Build enough rows to cover the syllabus pool (total marks may exceed maxScore; marking caps at maxScore).",
  ].join("\n");
}

/** Rubric LLM: explain-why / cause_effect causal chains. */
export function isOpenPoolGradingMode(mode: string | undefined): boolean {
  return mode === "open_pool" || mode === "open_set";
}

export function buildCausalChainRubricInstructions(): string {
  return [
    "CAUSAL CHAIN (explain / terangkan / explain why + cause-effect demand):",
    "- Use rows for cause and consequence when they are genuinely independent examinable points.",
    "- Set requiresCausalLink: true only where the mark requires linking cause AND effect in the student's words.",
    "- A single sentence that states both cause and consequence satisfies the chain — do not require separate sentences.",
    "- Split into two rows only when cause and consequence are distinct concepts that can be demonstrated separately.",
    "- Do NOT add a vague umbrella row (general safety/protection) if a specific mechanism row already states hazard + injury.",
    "- Marking credits concept, not sentence structure.",
  ].join("\n");
}

/** Extra system/user lines for qwenBuildRubric (category vs context-bound stems). */
export function buildCategoryRubricPromptInstructions(question: string): string[] {
  const strict = isStrictContextBindingQuestion(question);
  const open = isOpenCategoryMarkingQuestion(question);
  const lines: string[] = [];
  if (strict) {
    lines.push(
      "CONTEXT-BOUND STEM: the question refers to a specific diagram, text, passage, table, or experiment. Use that source to shape expected rubric points only. Marks still require the student to state each point in their written answer â€” the diagram/figure is never evidence of what the student knows.",
    );
  }
  if (open) {
    const intro = strict
      ? "The stem is context-bound, so answers must fit that source â€” still do not require one arbitrary example phrase copied only from retrieval snippets."
      : "OPEN-CATEGORY STEM: the question invites examples, uses, functions, properties, advantages, disadvantages, suggestions, or applications without naming one fixed item.";
    lines.push(
      [
        intro,
        "RUBRIC RULES:",
        '- Prefer GENERAL criteria rows (e.g. "scientifically valid example of the requested category", "correct matching use/function/property for the student\'s example", "valid advantage/disadvantage relevant to the question").',
        "- Do NOT create separate rubric rows that each demand one specific example taken only from retrieved context (treat retrieval as illustration, not a closed answer list).",
        "- Only treat the answer set as CLOSED if the stem is context-bound (diagram/text/experiment above) OR the question names a specific item students must use.",
        '- If the stem asks for BOTH an example AND a use/function (or equivalent), split marks into at least two ideas: (1) valid example in the category, (2) scientifically correct use/function that matches the student\'s chosen example â€” use linkedToId on the use row pointing at the example row id when helpful.',
      ].join("\n"),
    );
  }
  return lines;
}

function tokenCount(s: string): number {
  return s
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
}

/**
 * Two marking demands joined by "and" / "dan" (e.g. preamble + "state â€¦ and explain â€¦").
 * Uses the last "and"/"dan" so stems like "Table 1 â€¦ State the hypothesis and explain" still match.
 */
export function hasTwoDistinctDemandsJoinedByAnd(question: string): boolean {
  const t = normalizeStem(question);
  if (/^\s*(?:compare|bandingkan|differentiate|distinguish|bezakan)\b/i.test(t)) return false;
  const matches = [...t.matchAll(/\s+(?:and|dan)\s+/gi)];
  if (matches.length === 0) return false;
  const m = matches[matches.length - 1];
  if (m.index === undefined) return false;
  const left = t.slice(0, m.index).trim();
  const right = t.slice(m.index + m[0].length).trim();
  if (tokenCount(left) < 3 || tokenCount(right) < 3) return false;
  const imperative =
    /\b(state|give|list|name|identify|explain|describe|define|calculate|discuss|outline|suggest|predict|how|why|what|which|nyatakan|senaraikan|namakan|kenal\s*pasti|terangkan|huraikan|jelaskan|takrifkan|hitung|kira|bincangkan|cadangkan|bagaimana|mengapa|apa)\b/i;
  if (imperative.test(left) && imperative.test(right)) return true;
  return imperative.test(right) && imperative.test(t);
}



/**
 * SPM marking standard: marks follow the syllabus / marking scheme, not loose scientific relatedness.
 */

/** Concept-based marking (command-word aware) â€” used across grading and borderline verify. */
export const SPM_CONCEPT_BASED_MARKING_LINES = [
  "You are an SPM examiner. Mark from MARKING SCHEME CONCEPTS â€” not by matching the wording of a model answer.",
  "",
  "Before assigning marks:",
  "1) Identify the command word (State, Name, Explain, Describe, Compare, Calculate, etc.).",
  "2) Decide what information that command word actually requires.",
  "3) Check whether the student supplied those concepts in their written answer.",
  "4) Award marks accordingly.",
  "",
  "STATE questions:",
  "- Award full marks when the student correctly states the required term, keyword, process, structure, or concept.",
  "- Do NOT require a full sentence or explanation unless the question explicitly asks for it.",
  "- A single correct keyword or short phrase is sufficient when it shows the required concept.",
  "",
  "NAME / IDENTIFY questions:",
  "- Accept the correct term only; do not require extra description.",
  "",
  "EXPLAIN / DESCRIBE questions:",
  "- Award marks for each correct scientific idea independently.",
  "- Accept student-friendly paraphrases; do not require textbook wording.",
  "- Do not deduct for grammar, spelling, or sentence structure if the meaning is clear.",
  "- Do not require examples unless the question specifically asks for them.",
  "",
  "General:",
  "- If the answer contains the required scientific concept, award the mark â€” even if phrased differently from the model answer.",
  "- Never require the student to rewrite the model answer; it is only a reference list of valid concepts.",
  "- Alternative scientifically correct answers at SPM level must receive the same marks.",
  "- Output reasoning should reflect: marks awarded, concepts matched, missing concepts, brief feedback.",
] as const;

export function formatConceptBasedMarkingBlock(): string {
  return SPM_CONCEPT_BASED_MARKING_LINES.join("\n");
}

export const SPM_EXAM_STANDARD_MARKING_LINES = [
  "You are marking as an official SPM examiner (Form 4/5), not as a university tutor.",
  "",
  "Grade by demonstrated SCIENTIFIC UNDERSTANDING and correctness, not wording similarity.",
  "Treat rubric/model answers as concept guidance, not exact phrase requirements.",
  "",
  "AWARD marks when the student demonstrates the required concept for this mark point:",
  "- scientifically correct meaning (even with simplified wording, weak grammar, or incomplete terminology)",
  "- semantically equivalent paraphrases that preserve the intended concept",
  "- sufficient idea-level evidence for what the command word demands",
  "- concise answers are acceptable when they clearly convey the concept",
  "",
  "DO NOT award marks when:",
  "- the answer is scientifically incorrect, contradictory, irrelevant, or off-topic for the mark point",
  "- the response fails to demonstrate the required concept",
  "- any match depends only on embedding/keyword overlap without actual conceptual meaning",
  "- the statement is so vague that scientific intent cannot be reasonably interpreted",
  "",
  "If uncertain, evaluate in this order:",
  "1) Does the student demonstrate the required concept?",
  "2) Is the scientific meaning correct?",
  "3) Would a reasonable human SPM examiner likely accept this answer?",
  "When reasonably correct, prefer awarding marks rather than rejecting due to wording differences.",
  "Do not over-penalize missing examples/supporting detail when the core concept is already correct.",
  "",
  "Language fairness still applies: BM/English mix, formula notation, and common names are fine when the exam-standard point is clearly shown.",
  "",
  "Evidence-only: before each mark, quote an exact student phrase â†’ match to rubric â†’ award only if that phrase exists; never infer; never treat model answer as student evidence.",
] as const;

export const SPM_PARTIAL_CREDIT_LINES = [
  "PARTIAL CREDIT RULE (mandatory):",
  "",
  "If a student answers SOME but NOT ALL parts of a question correctly:",
  "- Award marks for every part they answered correctly.",
  "- Do NOT reduce already-awarded marks because other parts were wrong or missing.",
  "- Treat each rubric mark point independently â€” one incorrect point must NEVER cancel a correct point.",
  "",
  "Partial answers deserve partial marks:",
  "- 1 correct concept out of 2 required â†’ award 1 mark, not 0.",
  "- 2 correct concepts out of 3 required â†’ award 2 marks, not 0.",
  "- Do NOT round down to 0 because the answer is incomplete.",
  "- Do NOT require the student to be fully correct to earn ANY marks.",
  "",
  "Concise partial answers still earn marks:",
  "- If the student states one correct point concisely, that point earns its mark.",
  "- Missing elaboration on a correct point does NOT cancel the mark for that point.",
  "",
  "Wrong answers do not cancel correct answers:",
  "- If the student writes one correct and one incorrect point, award the correct one.",
  "- Do NOT zero out all marks because one part was wrong.",
] as const;

export function formatPartialCreditBlock(): string {
  return SPM_PARTIAL_CREDIT_LINES.join("\n");
}

export const SPM_SUFFICIENCY_MARKING_LINES = [
  "SUFFICIENCY-FIRST MARKING (apply before finalizing every mark decision):",
  "",
  "Step 1 â€” Answer Sufficiency Check:",
  "Before deducting marks, ask: Has the student already sufficiently demonstrated the core required concept?",
  "- Is the main scientific understanding clearly shown?",
  "- Is the scientific meaning reasonably correct?",
  "- Are any missing parts merely supporting elaborations, not core requirements?",
  "- Would a fair SPM examiner likely accept this as sufficient for the marks allocated?",
  "If yes to the above: award the mark â€” do not deduct for omitted supporting detail.",
  "",
  "Step 2 â€” Core vs Supporting Distinction:",
  "Distinguish between CORE required concepts and SUPPORTING elaborations.",
  "Supporting details (examples, expansions, additional mechanisms) must NOT become hidden compulsory mark points",
  "unless the command word, question wording, or mark allocation explicitly requires them.",
  "",
  "Step 3 â€” Low-mark explanation questions:",
  "For 1–2 mark explain/describe questions, a concise but scientifically correct answer may already be sufficient.",
  "Do NOT require exhaustive textbook-level detail for low-mark questions.",
  "A concise explanation that captures the required concept deserves full marks.",
  "",
  "Step 3b â€” Distinct evidence per mark (IMPORTANT):",
  "Each mark point must be supported by a DIFFERENT part of the student's answer.",
  "- 2 marks = 2 distinct demonstrable concepts from the student's answer.",
  "- 3 marks = 3 distinct concepts.",
  "- ONE short vague phrase cannot earn multiple marks, even if it loosely relates to multiple rubric rows.",
  "- If the student only wrote one concept, they can only earn 1 mark maximum.",
  "- Do NOT award N marks just because a single phrase could be interpreted as covering N ideas.",
  "",
  "Step 4 â€” Final validation before deducting:",
  "Ask: Am I deducting only for a truly MISSING REQUIRED concept, or for missing elaboration?",
  "- Missing required concept â†’ deduct.",
  "- Missing elaboration / supporting detail â†’ do NOT deduct.",
  "- Concise but correct wording â†’ award.",
  "- Different phrasing from rubric but same scientific meaning â†’ award.",
  "",
  "The grading must behave like a fair human SPM examiner evaluating understanding,",
  "NOT like a checklist matcher counting rubric fragments.",
] as const;

export function formatSufficiencyMarkingBlock(): string {
  return SPM_SUFFICIENCY_MARKING_LINES.join("\n");
}

export function formatSpmExamStandardMarkingBlock(options?: EvidenceOnlyMarkingOptions): string {
  return [
    formatConceptBasedMarkingBlock(),
    "",
    ...SPM_EXAM_STANDARD_MARKING_LINES,
    "",
    formatPartialCreditBlock(),
    "",
    formatSufficiencyMarkingBlock(),
    "",
    formatEvidenceOnlyMarkingBlock(options),
  ].join("\n");
}

/** @deprecated Use formatSpmExamStandardMarkingBlock â€” kept for imports that still reference examiner priority naming. */
export function formatExaminerMarkingPriorityBlock(): string {
  return formatSpmExamStandardMarkingBlock();
}

