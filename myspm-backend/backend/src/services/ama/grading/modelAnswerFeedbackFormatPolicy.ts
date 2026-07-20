/**
 * Verb-based length/depth rules for model answers and learner-facing feedback.
 * Binding when generating Model Answer or Feedback text.
 */

export type ModelAnswerVerbFamily =
  | "state_or_identify"
  | "explain_or_describe"
  | "compare_or_differentiate"
  | "default";

const EXPLAIN_DESCRIBE_RE =
  /\b(explain|describe|discuss|terangkan|huraikan|jelaskan|bincangkan|why|how|mengapa|bagaimana)\b/i;

const COMPARE_RE =
  /\b(compare|contrast|differentiate|differences?|bezakan|bandingkan|perbezaan)\b/i;

const STATE_IDENTIFY_RE =
  /\b(state|identify|list|name|nyatakan|senaraikan|namakan|kenal\s*pasti|berikan|give|mention)\b/i;

const RAW_RUBRIC_RE =
  /\bMark\s*\d+\s*:|Core\s+Idea|rubric\s+point|credit\s+criteria|—\s*<|\[Core\s+Idea\]/i;

/** Classify stem for model-answer / feedback depth. Explain wins over state on compound stems; compare is its own family. */
export function classifyModelAnswerVerbFamily(question: string): ModelAnswerVerbFamily {
  const q = (question || "").trim();
  if (!q) return "default";
  if (EXPLAIN_DESCRIBE_RE.test(q)) return "explain_or_describe";
  if (COMPARE_RE.test(q)) return "compare_or_differentiate";
  if (STATE_IDENTIFY_RE.test(q)) return "state_or_identify";
  return "default";
}

/** Shared binding: the exemplar must answer THIS stem, not a vague related topic. */
export function buildModelAnswerAnswersQuestionBlock(question: string, maxScore: number): string {
  const stemPreview = (question || "").replace(/\s+/g, " ").trim().slice(0, 280);
  return [
    "ANSWERS THE QUESTION (binding):",
    `- The model answer MUST directly answer this stem: "${stemPreview}${stemPreview.length >= 280 ? "…" : ""}"`,
    `- Cover exactly ${maxScore} mark-worthy point(s) that an examiner would credit for THIS question.`,
    "- If the stem asks for examples, differences, reasons, or conditions — those requirements MUST appear in the model answer.",
    "- When the stem has multiple demands (define/compare AND explain/state why), each demand MUST appear as its own marking point — never one merged paragraph.",
    "- Do NOT write a short unrelated fact list that ignores the command word or the subject of the stem.",
    "- Do NOT leave the answer so brief that a student cannot see how each mark is earned.",
  ].join("\n");
}

function stateOrIdentifyRules(maxScore: number): string[] {
  return [
    "STATE / IDENTIFY / LIST / NAME RULES (binding):",
    `You MUST generate exactly ${maxScore} bullet points (one per mark).`,
    "Each bullet MUST be a clear, complete fact that answers the stem — typically 8–18 words.",
    "Each bullet MUST name the required term/idea fully (include an example when the stem asks for one).",
    "You MUST NOT use cryptic 2–4 word fragments that leave the meaning unclear.",
    "You MUST NOT write long explanations or because/so essays — that is for Explain stems.",
    `Output MUST use a leading "• " on each line (one bullet per mark).`,
    maxScore <= 3
      ? `Example for ${maxScore} marks:\n• Stomata close when guard cells become flaccid\n• Less water vapour escapes from the leaf\n• Transpiration rate decreases`
      : `Example: ${maxScore} separate "• " bullets, each a complete short fact (8–18 words).`,
  ];
}

function explainOrDescribeRules(maxScore: number): string[] {
  return [
    "EXPLAIN / DESCRIBE / DISCUSS / WHY / HOW RULES (binding):",
    `You MUST generate exactly ${maxScore} distinct marking points.`,
    "Each marking point MUST be a full explanatory sentence that answers the stem.",
    "Structure each point as: [scientific fact] + [reasoning: because / so / therefore / this causes].",
    "Each marking point MUST be approximately 25–45 words — enough for a Form 4/5 student to understand the mechanism.",
    "You MUST use KSSM textbook phrasing — NOT formal A-Level terms.",
    "You MUST NOT use keyword-only bullets without reasoning.",
    "You MUST NOT collapse two independent marking points into one sentence.",
    "You MUST NOT write one-line answers that only restate the topic without explaining how/why.",
    "Put each marking point on its own line (blank line between points is OK).",
    `Example depth for ${maxScore} mark(s): ${maxScore} separate sentence(s), each with clear fact + because/so/therefore reasoning.`,
  ];
}

function compareOrDifferentiateRules(maxScore: number): string[] {
  return [
    "COMPARE / DIFFERENTIATE / DIFFERENCE RULES (binding):",
    `You MUST generate exactly ${maxScore} distinct contrast points.`,
    "Each point MUST make the comparison clear for BOTH sides (or state one named difference with both entities).",
    "Each point MUST be approximately 20–40 words so the difference is understandable, not a two-word label.",
    "Include concrete detail or an example when the stem asks for examples.",
    "Put each contrast on its own line.",
    `Example for ${maxScore} marks: ${maxScore} clear difference statements naming both entities.`,
  ];
}

function defaultRules(maxScore: number): string[] {
  return [
    "DEFAULT MODEL ANSWER RULES:",
    `You MUST cover exactly ${maxScore} distinct marking points.`,
    "Each point MUST be clear enough for a Form 4/5 student to learn from (not a cryptic fragment).",
    "Use KSSM textbook phrasing a Form 4/5 student would copy from their notes.",
    "Aim for about 18–35 words per marking point unless the stem is a pure calculation.",
    "Calculations: Formula → Working (clear substitutions) → Final answer with unit.",
  ];
}

/** Wording bar: mirror Malaysian KSSM SPM textbook style, not examiner/A-Level notes. */
export function buildKssmTextbookModelAnswerWordingBlock(): string {
  return [
    "KSSM TEXTBOOK WORDING (binding for modelAnswer):",
    "- Write like a good Form 4/5 student using words from the KSSM SPM textbook for this topic — NOT an examiner mark scheme, NOT STPM/A-Level, NOT a journal.",
    "- Prefer simple school connectors: because, so, therefore, this means, as a result (BM: kerana, supaya, maka, ini bermaksud).",
    "- Use syllabus terms that appear in KSSM textbooks (e.g. active site, substrate, enzyme, transpiration) — but phrase them the way the textbook does.",
    "- You MUST simplify any formal phrase from evidence/rubric into textbook student style before writing modelAnswer.",
    "AVOID (too formal — rewrite in plain KSSM style):",
    '  • "collision frequency" → "more collisions" / "higher chance of collision"',
    '  • "catalytic capacity" / "maximum catalytic capacity" → "maximum rate" / "rate levels off"',
    '  • "substrate saturation occurs" → "substrate becomes limiting" / "all active sites are occupied"',
    '  • "optimum", "physiological mechanism", "quantitative relationship", "homeostatic dysregulation"',
    "GOOD explain example (2 marks, enzymes):",
    '  1. "More enzymes provide more active sites, so there are more collisions between enzyme and substrate and the reaction rate increases."',
    '  2. "When all active sites are occupied, the rate stops increasing even if enzyme concentration rises."',
    "BAD (too formal):",
    '  "Increased collision frequency at substrate binding sites until maximum catalytic capacity is reached."',
    "BAD (too short / does not answer):",
    '  "Enzymes speed up reactions."',
  ].join("\n");
}

const NON_KSSM_MODEL_ANSWER_RE =
  /\b(catalytic capacity|collision frequency|substrate saturation occurs|homeostatic dysregulation|physiological mechanism|quantitative relationship|optimum catalytic|enzymatic efficiency|metabolic dysregulation|substrate-binding affinity|kinetic parameters)\b/i;

/** True when wording sounds above KSSM textbook level — triggers rephrase. */
export function referenceUsesNonKssmTextbookWording(reference: string): boolean {
  return NON_KSSM_MODEL_ANSWER_RE.test(reference || "");
}

/** Quality bar — model answer must read as a student exemplar, not examiner notes. */
export function buildModelAnswerQualityRulesBlock(maxScore: number, question = ""): string {
  return [
    "MODEL ANSWER QUALITY (binding — this is shown to students as the exemplar):",
    "- You MUST write what a full-marks SPM student would put in the answer space — NOT rubric shorthand, NOT 'Mark N:' labels.",
    `- You MUST include all ${maxScore} marking points; omitting any point is a failure.`,
    "- You MUST directly answer the question stem; every point MUST be scientifically correct for KSSM SPM.",
    "- You MUST use KSSM textbook wording — the same simple phrasing found in Malaysian SPM student notes, not polished examiner prose.",
    "- You MUST match length/depth to the command word (State = short complete facts; Explain = full because/so reasoning; Compare = clear both-sided contrasts).",
    "- You MUST NOT repeat the same idea twice in different words.",
    "- Preserve equations, symbols, units, and numerical values exactly when present in the reference.",
    question ? buildModelAnswerAnswersQuestionBlock(question, maxScore) : "",
    buildKssmTextbookModelAnswerWordingBlock(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt block for model-answer generation / localization. */
export function buildModelAnswerVerbFormatRulesBlock(
  maxScore: number,
  question: string,
): string {
  const family = classifyModelAnswerVerbFamily(question);
  const header = "MODEL ANSWER FORMAT (command-word ruleset — binding):";
  const rules =
    family === "explain_or_describe"
      ? explainOrDescribeRules(maxScore)
      : family === "compare_or_differentiate"
        ? compareOrDifferentiateRules(maxScore)
        : family === "state_or_identify"
          ? stateOrIdentifyRules(maxScore)
          : defaultRules(maxScore);
  return [header, ...rules, buildModelAnswerAnswersQuestionBlock(question, maxScore)].join("\n");
}

function averageWordsPerPoint(text: string, pointCount: number): number {
  const words = text
    .replace(/^[•\-*]\s*/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
  return words / Math.max(1, pointCount);
}

function minCharsForFamily(family: ModelAnswerVerbFamily, maxScore: number): number {
  if (family === "state_or_identify") return Math.max(24, maxScore * 28);
  if (family === "explain_or_describe") return Math.max(60, maxScore * 100);
  if (family === "compare_or_differentiate") return Math.max(50, maxScore * 85);
  return Math.max(40, maxScore * 55);
}


/** True when reference looks like raw mark-scheme text, not a polished model answer. */
export function referenceLooksLikeRawRubric(reference: string): boolean {
  const text = (reference || "").trim();
  if (!text) return true;
  if (RAW_RUBRIC_RE.test(text)) return true;
  if (/^[-•*]\s*Mark\s+\d+/im.test(text)) return true;
  const semicolonParts = text.split(";").map((p) => p.trim()).filter(Boolean);
  if (semicolonParts.length >= 2 && semicolonParts.every((p) => p.length < 35)) return true;
  return false;
}

/** Count student-facing marking points in a model-answer string. */
export function countModelAnswerPoints(text: string): number {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  const bulletLines = trimmed.split("\n").filter((line) => /^[•\-*]\s+\S/.test(line.trim()));
  if (bulletLines.length >= 2) return bulletLines.length;
  // Inline bullets on one line: "• a • b • c" (collapse guard used to treat any • as already split).
  const inlineBulletCount = (trimmed.match(/•/g) || []).length;
  if (inlineBulletCount >= 2 && !trimmed.includes("\n")) {
    return trimmed
      .split(/\s*•\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2).length;
  }
  if (trimmed.includes(";")) {
    const parts = trimmed.split(";").map((p) => p.trim()).filter((p) => p.length >= 2);
    // Only treat as multi-point when every segment is a short fact — long prose
    // often uses ";" inside one marking point.
    if (parts.length >= 2 && parts.every((p) => p.split(/\s+/).length <= 18)) {
      return parts.length;
    }
  }
  const numbered = trimmed.split("\n").filter((line) => /^\d+[.)]\s+\S/.test(line.trim()));
  if (numbered.length >= 2) return numbered.length;
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length >= 8);
  if (paragraphs.length >= 2) return paragraphs.length;
  return trimmed.length >= 8 ? 1 : 0;
}

/**
 * Put inline • / ; separators onto separate lines so clients can split marking points.
 * Leaves already multi-line answers unchanged.
 */
export function normalizeModelAnswerPointSeparators(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  if (trimmed.split(/\n+/).filter((l) => l.trim()).length >= 2) return trimmed;

  const inlineBulletCount = (trimmed.match(/•/g) || []).length;
  if (inlineBulletCount >= 2) {
    return trimmed
      .split(/\s*•\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `• ${p.replace(/^[•\-*]\s*/, "")}`)
      .join("\n");
  }

  if (trimmed.includes(";")) {
    const parts = trimmed
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts.join("\n");
  }

  return trimmed;
}

/** Lightweight check that output is usable as a student-facing model answer. */
export function modelAnswerPassesQualityCheck(
  text: string,
  maxScore: number,
  question: string,
): boolean {
  const trimmed = (text || "").trim();
  if (trimmed.length < 8) return false;
  if (RAW_RUBRIC_RE.test(trimmed)) return false;
  if (referenceUsesNonKssmTextbookWording(trimmed)) return false;

  const family = classifyModelAnswerVerbFamily(question);
  const pointCount = countModelAnswerPoints(trimmed);
  if (trimmed.length < minCharsForFamily(family, maxScore)) return false;

  if (family === "state_or_identify") {
    if (pointCount < Math.min(maxScore, 2) && maxScore >= 2) return false;
    const avg = averageWordsPerPoint(trimmed, Math.max(pointCount, maxScore));
    // Too cryptic (e.g. 3-word labels) or essay-length for a State stem.
    if (avg < 5) return false;
    if (avg > 22 && maxScore >= 2) return false;
    return true;
  }

  if (family === "explain_or_describe") {
    if (pointCount < Math.min(maxScore, 2) && maxScore >= 2) return false;
    const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length >= 12);
    if (maxScore >= 2 && sentences.length < 2 && pointCount < 2) return false;
    const avg = averageWordsPerPoint(trimmed, Math.max(pointCount, maxScore));
    // Explain stems must carry reasoning — reject thin one-liners.
    if (avg < 18) return false;
    if (!/\b(because|so|therefore|this\s+means|as\s+a\s+result|kerana|supaya|maka|ini\s+bermaksud)\b/i.test(trimmed) && avg < 28) {
      return false;
    }
    return true;
  }

  if (family === "compare_or_differentiate") {
    if (maxScore >= 2 && pointCount < 2) return false;
    const avg = averageWordsPerPoint(trimmed, Math.max(pointCount, maxScore));
    if (avg < 12) return false;
    return true;
  }

  // Default: still need a visible multi-point structure when marks ≥ 2.
  if (maxScore >= 2 && pointCount < 2) return false;
  const avg = averageWordsPerPoint(trimmed, Math.max(pointCount, 1));
  if (avg < 8 && trimmed.length < minCharsForFamily(family, maxScore)) return false;
  return pointCount >= 1 || trimmed.length >= 16;
}

/** Prompt block for gap feedback when referencing missing / awarded marking points. */
export function buildFeedbackVerbFormatRulesBlock(
  maxScore: number,
  question: string,
): string {
  const family = classifyModelAnswerVerbFamily(question);
  const header = "FEEDBACK FORMAT (command-word ruleset — binding):";

  if (family === "state_or_identify") {
    return [
      header,
      "Feedback MUST stay 1–2 short sentences total.",
      "When naming a missing marking point, use at most 10 words per point — no elaboration.",
      "You MUST NOT ask for extra detail beyond the explicit marking scheme.",
    ].join("\n");
  }

  if (family === "explain_or_describe") {
    return [
      header,
      "Feedback MAY use up to 2–3 sentences when marks were lost.",
      "Name the TYPE of missing link (e.g. 'cause of wilting') — do NOT write the full correct explanation sentence.",
      "You MUST NOT give model-answer wording in feedback; only say what category of point was missing or unclear.",
    ].join("\n");
  }

  return [
    header,
    "Feedback MUST stay 1–2 sentences; name missing marking points briefly without inventing new criteria.",
  ].join("\n");
}

/** Static rules for question generation (Jawapan) — per-item Markah drives count. */
export function buildJawapanVerbFormatRulesForGeneration(): string {
  return [
    "JAWAPAN FORMAT BY COMMAND WORD (binding for every subjective item):",
    "- State / Identify / List / Name stems: Jawapan MUST be exactly [Markah] bullet points; each a complete short fact (~8–18 words); include examples when asked.",
    "- Explain / Describe / Discuss / Why / How stems: Jawapan MUST be exactly [Markah] marking points; each = [Fact] + [because/so/therefore reasoning] (~25–45 words).",
    "- Compare / Differentiate stems: Jawapan MUST be exactly [Markah] contrast points naming both sides clearly (~20–40 words each).",
    "- Jawapan MUST directly answer the stem command word and topic — NEVER a vague short label list that ignores the question.",
    "- Jawapan MUST use KSSM SPM textbook wording — simple school English/BM as in student notes, NOT examiner or A-Level phrasing.",
    "- Jawapan MUST read as a full-marks student exemplar — NOT rubric shorthand or 'Mark N:' labels.",
    "- Match Jawapan depth to the stem command word — NEVER use essay paragraphs; NEVER use cryptic keyword-only answers.",
  ].join("\n");
}

/** Format mark-scheme labels into a readable student model answer. */
export function formatMarkSchemePointsAsModelAnswer(
  points: string[],
  question: string,
): string {
  if (points.length === 0) return "";
  const cleaned = points.map((p) => p.replace(/^Mark\s+\d+\s*:\s*/i, "").trim()).filter(Boolean);
  const family = classifyModelAnswerVerbFamily(question);
  if (family === "explain_or_describe" || family === "compare_or_differentiate") {
    return cleaned.map((p, i) => `${i + 1}. ${p}`).join("\n\n");
  }
  if (family === "state_or_identify") {
    return cleaned.map((p) => `• ${p}`).join("\n");
  }
  // Never join with ";" — mobile card split treated ";" as a point boundary and
  // sliced mid-sentence exemplars across two "1 mark" cards.
  return cleaned.map((p, i) => `${i + 1}. ${p}`).join("\n\n");
}
