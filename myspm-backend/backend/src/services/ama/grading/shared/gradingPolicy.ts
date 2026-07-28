/**
 * SPM grading policy: student language, diagram rules, examiner prompts, question category heuristics.
 */

import { buildStrictMarkSchemeGenerationBlock } from "./markSchemeGenerationPolicy";
import type { DiagramContext } from "../../types";
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
  "- FEEDBACK: plain SPM marking comments a Form 4/5 student understands on first read. No A-Level/STPM/university phrasing, no academic hedging ('it could be argued', 'scientifically speaking', 'as per the literature'). Feedback is NOT the model answer — never paste the full correct answer in feedback.",
  "- MODEL ANSWER: KSSM SPM textbook wording — write like a good Form 4/5 student's notes, not examiner or A-Level prose. Depth MUST follow the command word: State/Identify/List/Name → exactly N complete short bullets (~8–18 words each); Explain/Describe/Discuss/Why/How → exactly N full reasoning sentences (~25–45 words, because/so/therefore); Compare/Differentiate → exactly N clear both-sided contrasts (~20–40 words). The model answer MUST directly answer the stem. Calculations: Formula → Working → Final answer with unit.",
  "- Never use advanced jargon unless it is standard in KSSM SPM textbooks for this topic (e.g. avoid 'homeostatic dysregulation' if 'maintains body temperature' is the SPM-level idea).",
  "- In JSON, every learner-facing string (feedback, modelAnswer, strengths, improvements, markBreakdown[].reason) must follow these rules.",
  "- LANGUAGE FAIRNESS: BM/English mix, chemical formulae, common names, and trade names count when they clearly express the same SPM mark point â€” never penalize notation or language choice alone.",
  "- EXAM STANDARD (marking only): Award by marking-scheme CONCEPTS â€” not model-answer wording. State/Name: a correct keyword is enough. Explain/Describe: each correct idea counts; paraphrases OK. Reject vague/generic answers even if loosely related.",
  "- CRITICAL EVIDENCE: Credit only concepts explicitly written in the student's answer. Quote their exact phrase before each mark. Never infer unstated ideas or copy from the model answer into feedback.",
  "- FEEDBACK BOUNDARY: Never penalize in feedback for a missing idea unless that idea is an explicit individual marking point that was not awarded.",
  "- DIAGRAMS/FIGURES: Use attached or referenced figures only to understand the question and rubric. Never treat the figure as proof the student knows a label, structure, value, or process unless they wrote it.",
] as const;

export function formatSpmStudentFriendlyRulesBlock(): string {
  return [SPM_STUDENT_FRIENDLY_RULES_HEADER, ...SPM_STUDENT_FRIENDLY_RULES_LINES].join("\n");
}

/**
 * Presentation-only SPM style subset (additive — B1).
 * Character-identical lines from SPM_STUDENT_FRIENDLY_RULES_LINES; excludes scoring /
 * evidence / feedback-boundary / diagram echoes. No callers migrated yet (B1b deferred).
 */
export const SPM_PRESENTATION_STYLE_HEADER =
  "PRESENTATION STYLE (Malaysian SPM Form 4/5 — learner-facing text):";

export const SPM_PRESENTATION_STYLE_LINES = [
  SPM_STUDENT_FRIENDLY_RULES_LINES[0],
  SPM_STUDENT_FRIENDLY_RULES_LINES[1],
  SPM_STUDENT_FRIENDLY_RULES_LINES[2],
  SPM_STUDENT_FRIENDLY_RULES_LINES[3],
  SPM_STUDENT_FRIENDLY_RULES_LINES[4],
  SPM_STUDENT_FRIENDLY_RULES_LINES[5],
  SPM_STUDENT_FRIENDLY_RULES_LINES[6],
  SPM_STUDENT_FRIENDLY_RULES_LINES[9],
] as const;

export function formatSpmPresentationStyleBlock(): string {
  return [SPM_PRESENTATION_STYLE_HEADER, ...SPM_PRESENTATION_STYLE_LINES].join("\n");
}



/**
 * Diagram / image / figure questions: vision context builds the rubric only;
 * marks require explicit wording in the student's written answer.
 */

// Note: bare "table"/"jadual" omitted — they false-positive on Periodic Table / Jadual Berkala.
const VISUAL_QUESTION_RE =
  /\b(diagram|figure|fig\.?\s*\d|graph|chart|image|photo|micrograph|microscopy|flowchart|flow\s*chart|apparatus|rajah|graf|gambar|labelled|labeled|label\s+[A-P]\b|structure\s+shown|based\s+on\s+the\s+(?:diagram|figure|graph|table|image)|refer\s+to\s+the\s+(?:diagram|figure|graph|table)|according\s+to\s+the\s+(?:diagram|figure|graph|table)|(?:data\s+)?table\s+(?:above|below|shows|given)|(?:from|in|using)\s+the\s+table\b|the\s+table\s+(?:above|below|shows)|(?:data\s+)?jadual\s+(?:di\s+atas|di\s+bawah|menunjukkan|diberi)|(?:dari|dalam|mengikut)\s+jadual\b|rujuk\s+rajah|berdasarkan\s+rajah|lihat\s+rajah|dalam\s+rajah|pada\s+rajah)\b/i;

/** Practice-set stems: diagram intended for this item (mobile may also send diagramImageUrl). */
const PRACTICE_DIAGRAM_FLAG_RE =
  /(?:Perlu rajah|Diagram needed|Need diagram|Rajah diperlukan)\s*:\s*(?:ya|yes|y)\b/i;

/** Strip Periodic Table wording so vision heuristics do not fire on chemistry stems. */
function stripPeriodicTableMentions(question: string): string {
  return (question || "")
    .replace(/\bperiodic\s+table(?:\s+of\s+elements)?\b/gi, " ")
    .replace(/\bjadual\s+berkala(?:\s+unsur)?\b/gi, " ");
}

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
  return VISUAL_QUESTION_RE.test(stripPeriodicTableMentions(question).trim());
}

export function practiceQuestionIncludesDiagram(question: string): boolean {
  return PRACTICE_DIAGRAM_FLAG_RE.test((question || "").trim());
}

/**
 * Whether the stem actually depends on a figure for answering (label/graph/rajah/etc.).
 * Decorative images attached to generated questions do NOT count — skip the VL call.
 */
export function gradingNeedsVisionExtract(question: string): boolean {
  const q = (question || "").trim();
  return questionReferencesVisual(q) || practiceQuestionIncludesDiagram(q);
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
 * Stems that invite any valid syllabus answer from a topic domain,
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

/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
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

/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
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

/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
export function buildOpenTopicPoolRubricInstructions(): string {
  return [
    "OPEN-POOL QUESTION RULES",
    "",
    "First, determine whether the question expects:",
    "  (A) A FIXED set of required mark points (only a specific answer is correct), OR",
    "  (B) ANY valid member from a broader category (many correct answers exist).",
    "",
    "If the answer is (B) — open pool — apply ALL of the following:",
    "",
    "STRUCTURE:",
    "- Do NOT build a rubric with only the few examples the model or retrieval snippet mentions.",
    "- The rubric MUST represent the entire CATEGORY being assessed, not a curated short list.",
    "- Build enough rows to cover the full syllabus-valid answer pool for that category.",
    "- Total rows may EXCEED maxScore — the marking engine awards any correct N up to the cap.",
    "- Each pool row is worth exactly 1 mark.",
    "- Do NOT convert a broad category into a small fixed-answer rubric.",
    "",
    "METADATA (on EVERY pool row):",
    "- openEnded: true",
    '- gradingMode: "open_pool"',
    "- conceptType: open_set",
    "- allowSemanticEquivalence: true",
    "- validMembers: FULL list of scientifically correct SPM-level members { value, aliases: [BM/EN/shorthand] }",
    "",
    "RETRIEVAL CONTEXT:",
    "- Examples shown in retrieved textbook or past-paper content are ILLUSTRATIVE only.",
    "- Do NOT anchor the rubric to those specific examples unless the question explicitly requires them.",
    "- Do NOT assume the textbook or model answer examples are the only acceptable answers.",
    "",
    "VALIDATION (mandatory before finalising):",
    "Ask: 'Would a student lose marks for giving a correct, syllabus-valid answer that is not in this rubric?'",
    "If yes — the rubric is too narrow. Add more pool rows to cover legitimate correct answers.",
    "",
    "Use open pool when the stem asks for any N valid items from a broad category (not a single fixed answer).",
  ].join("\n");
}

/** Rubric LLM: explain-why / cause_effect causal chains. */
export function isOpenPoolGradingMode(mode: string | undefined): boolean {
  return mode === "open_pool" || mode === "open_set";
}

/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
export function buildCausalChainRubricInstructions(): string {
  return [
    "CAUSAL / EXPLANATION STEMS (explain / terangkan / explain why / cause-effect):",
    "- Apply the Marking Point Generation Policy: merge cause + consequence when they form one examiner-awardable explanation.",
    "- Set requiresCausalLink: true only on rows where the mark requires causal language (because / kerana / so that / supaya).",
    "- A single sentence stating the full linked explanation satisfies a merged row — do not require separate sentences.",
    "- Split into two rows ONLY when each row is genuinely independent (student could earn one while failing the other).",
    "- Do NOT add a vague umbrella row if a specific merged row already states the full explanation.",
    "- Marking credits demonstrated understanding, not sentence count or reference-answer layout.",
  ].join("\n");
}

/** Rubric LLM: examiner-awardable marking points (not atomic facts from model answer). */
/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
export function buildExaminerMarkingPointPolicy(): string {
  return [
    buildStrictMarkSchemeGenerationBlock(),
    "",
    "### MARKING POINT GENERATION POLICY",
    "",
    "Generate rubric rows as EXAMINER-AWARDABLE MARKING POINTS, not as individual facts extracted from the reference answer.",
    "A rubric row = a unit of understanding a human examiner would independently award marks for.",
    "Do NOT automatically convert every sentence, clause, cause, effect, prerequisite, condition, mechanism, consequence, supporting detail, or intermediate fact into a separate row.",
    "",
    "### INDEPENDENCE TEST",
    "Before creating multiple rows, ask: could a student reasonably demonstrate one row while failing to demonstrate the other(s)?",
    "If NO — they are not independent; MERGE into one marking point.",
    "If two proposed rows are naturally expressed together and represent one understanding, they MUST be merged.",
    "",
    "### EXPLANATION AND REASONING QUESTIONS",
    "For explain / why / importance / purpose / mechanism / effect / relationship / process stems:",
    "- ONE ROW PER INDEPENDENT MARKING POINT — NOT one row per fact, sentence, cause, effect, prerequisite, or supporting detail from the reference answer.",
    "- Build rows around complete explanatory understandings rather than atomic facts.",
    "- Do NOT split one explanation chain into multiple mandatory rows because the reference answer has multiple sentences.",
    "- If one statement is prerequisite, cause, mechanism, condition, consequence, or supporting detail of another — merge when they form one examiner-awardable explanation.",
    "",
    "### STUDENT EXPRESSION TEST",
    "For every pair of proposed rows: 'Could a competent student express both in one sentence while demonstrating the required understanding?'",
    "If YES → you MUST use ONE merged marking point.",
    "If NO → you MUST keep separate rows.",
    "",
    "### SUPPORTING FACT FILTER",
    "You MUST NOT award separate marks for information that merely supports another marking point.",
    "You MUST incorporate supporting facts into the main row unless the fact is independently demonstrable and independently creditable.",
    "",
    "### MARK ALLOCATION PRINCIPLE",
    "Marks MUST reflect distinct understanding, NEVER the number of facts in the reference answer.",
    "You MUST use fewer high-quality marking points over many fragmented rows.",
    "Students MUST NOT lose marks for expressing a complete idea in one concise sentence instead of listing every intermediate fact.",
    "",
    "### FINAL VALIDATION (mandatory before returning JSON)",
    "Review all rows. MERGE rows that represent one coherent explanatory understanding.",
    "KEEP SEPARATE only when each row measures distinct understanding a human examiner would independently reward.",
    "Final rubric must mirror how experienced SPM examiners allocate marks — not how the reference answer is arranged.",
  ].join("\n");
}

/** Rubric LLM: specific rules for "define / what is / takrifkan" questions. */
/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
export function buildDefinitionRubricInstructions(): string {
  return [
    "DEFINITION QUESTIONS (define / what is / takrifkan / apakah / maksud / definisi):",
    "Step 1 — extract the term being defined from the question stem (e.g. 'Define chemistry' → term = 'chemistry').",
    "Step 2 — decide how many independently markable components the definition has (one per mark).",
    "  • Component 1: the genus/category (what kind of thing it is — e.g. 'branch of science', 'scientific study').",
    "  • Component 2+: the differentiating detail that anchors it to the subject — e.g. 'properties, composition, structure and chemical reactions of matter'.",
    "",
    "MANDATORY for EVERY definition row:",
    "- The idea string MUST contain the anchor subject noun or 'of [subject term]' when stating a detail that relates to that subject.",
    "  WRONG: 'Study of properties, composition, structure and chemical reactions'",
    "  RIGHT:  'Study of properties, composition, structure and chemical reactions of matter'",
    "- acceptedConcepts MUST include:",
    "  (a) The FULL combined definition as one string — so a student writing one complete sentence earns the mark.",
    "  (b) BM and English variants of only this component.",
    "  (c) Simplified student-style phrasing (e.g. 'studies matter', 'kajian jirim').",
    "- acceptedSynonyms MUST include 6–12 colloquial phrases a Form 4/5 student might write for this component.",
    "- Do NOT require the student to write the complete textbook definition if only the component tested by this row is needed.",
    "- A student writing the full definition in one sentence MUST satisfy every definition row — put the full combined definition in acceptedConcepts on every row.",
  ].join("\n");
}

/** Detect whether the question is a definition question by command word / phrasing. */
export function isDefinitionQuestion(question: string): boolean {
  return /\b(define|definition|takrifkan|definisikan|apakah\s+(?:yang\s+)?dimaksudkan|apakah\s+(?:maksud|definisi)|maksud\s+(?:bagi|kepada|adalah)|nyatakan\s+definisi|what\s+is\s+(?:the\s+)?(?:meaning|definition)|what\s+do\s+you\s+mean\s+by)\b/i.test(
    question,
  );
}

/** Extra system/user lines for qwenBuildRubric (category vs context-bound stems). */
/** @deprecated Tranche A audit: no live consumers. Rubric-gen path unused. */
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
  "- ONLY award full marks when the student explicitly states the required term, keyword, process, structure, or concept.",
  "- NEVER require a full sentence unless the question explicitly asks for it.",
  "- ONLY award on a single correct keyword or short phrase when it clearly shows the required concept in the student's words.",
  "",
  "NAME / IDENTIFY questions:",
  "- ONLY award when the correct term is written; NEVER require extra description.",
  "",
  "EXPLAIN / DESCRIBE questions:",
  "- ONLY award marks for each correct scientific idea that is explicitly written.",
  "- ONLY award on student-friendly paraphrases when scientific intent is clear in the answer text.",
  "- NEVER deduct for grammar or spelling alone; ALWAYS revoke when the scientific meaning is missing or vague.",
  "- NEVER award examples unless the question specifically asks for them.",
  "",
  "General:",
  "- ONLY award when the required scientific concept is explicitly demonstrated in the student's answer.",
  "- NEVER require the student to rewrite the model answer; it is only a reference list of valid concepts.",
  "- ONLY award alternative scientifically correct answers at SPM level when they are explicitly written.",
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
  "ONLY award marks when ALL of the following are true for this mark point:",
  "- the student MUST have written words that demonstrate the required concept (simplified wording is allowed ONLY when meaning is explicit)",
  "- the scientific meaning MUST be correct at SPM Form 4/5 level",
  "- you MUST be able to quote a short exact phrase from the student answer as evidence",
  "",
  "NEVER award marks when ANY of the following apply:",
  "- the answer is scientifically incorrect, contradictory, irrelevant, or off-topic",
  "- the required concept is not explicitly written (implied or deduced background does NOT count)",
  "- the match depends only on keyword overlap without conceptual support in the student's text",
  "- the statement is so vague that scientific intent cannot be identified from the student's words",
  "",
  "If uncertain whether evidence is explicit enough:",
  "- you MUST set awarded=false and NEVER award on guesswork",
  "- you MUST NOT award because a reasonable examiner might accept it — only explicit student evidence counts",
  "- you MUST NOT award missing examples or supporting detail unless the command word requires them",
  "",
  "Language fairness: BM/English mix, formula notation, and common names are valid ONLY when the exam-standard point is clearly shown in the student's words.",
  "",
  "Evidence-only (mandatory): before each mark you MUST quote an exact student phrase → match to rubric → ONLY award if that phrase exists; NEVER infer; NEVER treat model answer as student evidence.",
] as const;

export const SPM_PARTIAL_CREDIT_LINES = [
  "PARTIAL CREDIT RULE (mandatory):",
  "",
  "If a student answers SOME but NOT ALL parts of a question correctly:",
  "- ONLY award marks for each part they explicitly answered correctly.",
  "- NEVER reduce already-awarded marks because other parts were wrong or missing.",
  "- You MUST treat each rubric mark point independently — one incorrect point must NEVER cancel a correct point.",
  "",
  "Partial answers:",
  "- ONLY award 1 mark when 1 required concept is explicitly written (never round down to 0 for that concept).",
  "- ONLY award 2 marks when 2 distinct required concepts are explicitly written.",
  "- NEVER award full marks when required concepts are missing.",
  "- NEVER require the student to be fully correct to earn marks for concepts they did write.",
  "",
  "Concise partial answers:",
  "- ONLY award when the student explicitly states a correct point — missing elaboration must NOT revoke that point.",
  "",
  "Wrong answers do not cancel correct answers:",
  "- ONLY award the explicitly correct point when one point is wrong and another is right.",
  "- NEVER zero out all marks because one part was wrong.",
] as const;

export function formatPartialCreditBlock(): string {
  return SPM_PARTIAL_CREDIT_LINES.join("\n");
}

export const SPM_SUFFICIENCY_MARKING_LINES = [
  "SUFFICIENCY RULES (apply before finalizing every mark decision — do not override mandatory ONLY/NEVER rules above):",
  "",
  "Step 1 — Core concept check:",
  "ONLY award when the student has explicitly written the core required concept for that mark point.",
  "- NEVER revoke a mark solely because supporting elaboration is missing if the core concept is clearly written.",
  "- ALWAYS revoke when the core required concept is missing, vague, or only implied.",
  "",
  "Step 2 — Core vs supporting:",
  "ONLY treat supporting details (examples, extra mechanism steps) as compulsory when the command word, question, or mark allocation explicitly requires them.",
  "- NEVER award a mark for supporting detail that was not required and not written.",
  "",
  "Step 3 — Low-mark explain/describe:",
  "For 1–2 mark questions, ONLY award when the required concept is explicitly written — concise wording is allowed ONLY when meaning is clear in the student's words.",
  "- NEVER require textbook-length answers when the student already wrote the required concept explicitly.",
  "",
  "Step 3b — Distinct evidence per mark (mandatory):",
  "Each mark MUST be supported by a DIFFERENT explicit part of the student's answer.",
  "- 2 marks = 2 distinct written concepts; 3 marks = 3 distinct written concepts.",
  "- NEVER award multiple marks from one vague phrase.",
  "- If the student only wrote one concept, you MUST cap at 1 mark for that dimension.",
  "",
  "Step 4 — Before revoking:",
  "ONLY revoke for a truly missing REQUIRED concept — NEVER revoke because optional elaboration is absent.",
  "- ALWAYS revoke when the required concept is wrong, missing, or not explicit in the student's words.",
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

