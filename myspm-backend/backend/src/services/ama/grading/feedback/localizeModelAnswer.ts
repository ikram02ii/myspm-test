import { qwenGradingJson } from "../shared/qwenGradingClient";
import { withStrictGenerationLanguage } from "../shared/gradingMandatoryLanguage";
import { formatSpmStudentFriendlyRulesBlock } from "../shared/gradingPolicy";
import {
  buildModelAnswerQualityRulesBlock,
  buildModelAnswerVerbFormatRulesBlock,
  buildKssmTextbookModelAnswerWordingBlock,
  formatMarkSchemePointsAsModelAnswer,
  modelAnswerPassesQualityCheck,
  referenceLooksLikeRawRubric,
  referenceUsesNonKssmTextbookWording,
} from "./modelAnswerFeedbackFormatPolicy";
import {
  calculationModelAnswerSectionLabels,
  hasCompleteCalculationModelAnswerSections,
  inferCalculationPolicy,
  looksLikeStructuredCalculationModelAnswer,
} from "../case/calculationAcfPolicy";
import { resolveCalculationDomain } from "../case/calculationSubjectPolicy";
import { normalizeCalculationModelAnswer } from "../extraction/normalizeCalculationModelAnswer";
import {
  buildLanguageDirective,
  detectAnswerLanguage,
  extractQuestionStemForLanguage,
  resolveModelAnswerLanguage,
  textContainsMalayProse,
  type AnswerLanguage,
} from "../shared/gradingTextUtils";
import { MUST_RETURN_JSON_MODEL_ANSWER } from "../prompts/shared/jsonRules";

function finalizeCalcModelAnswer(text: string, preserveCalc: boolean): string {
  if (!preserveCalc) return text.trim();
  return normalizeCalculationModelAnswer(text);
}

/** Cache polished model answers per question + reference — identical for all students. */
const polishedModelAnswerCache = new Map<string, string>();

function polishCacheKey(
  reference: string,
  question: string,
  maxScore: number,
  language: AnswerLanguage,
  preserveCalc: boolean,
): string {
  return `${maxScore}|${language}|${preserveCalc ? "calc" : "gen"}|${question.trim()}|${reference.trim()}`;
}

function languageMismatch(reference: string, target: AnswerLanguage): boolean {
  if (target === "english") {
    return textContainsMalayProse(reference) || detectAnswerLanguage(reference) !== "english";
  }
  if (target === "malay") {
    return !textContainsMalayProse(reference) && detectAnswerLanguage(reference) === "english";
  }
  return textContainsMalayProse(reference);
}

function needsModelAnswerPolish(params: {
  reference: string;
  language: AnswerLanguage;
  question: string;
  maxScore: number;
  preserveCalculationSections?: boolean;
}): boolean {
  if (languageMismatch(params.reference, params.language)) return true;
  // Structured calc exemplars must keep Formula/Working/Final — do not run theory polish
  // unless the worked exemplar is incomplete (missing one of the three required sections).
  if (
    params.preserveCalculationSections &&
    looksLikeStructuredCalculationModelAnswer(params.reference)
  ) {
    return !hasCompleteCalculationModelAnswerSections(params.reference);
  }
  // Calc without stage labels: force a rewrite into Formula/Working/Final sections.
  if (params.preserveCalculationSections) return true;
  if (referenceLooksLikeRawRubric(params.reference)) return true;
  if (referenceUsesNonKssmTextbookWording(params.reference)) return true;
  return !modelAnswerPassesQualityCheck(params.reference, params.maxScore, params.question);
}

function outputMatchesLanguage(text: string, target: AnswerLanguage): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (target === "english") {
    return detectAnswerLanguage(trimmed) === "english" && !textContainsMalayProse(trimmed);
  }
  if (target === "malay") {
    return textContainsMalayProse(trimmed) || detectAnswerLanguage(trimmed) === "malay";
  }
  return !textContainsMalayProse(trimmed);
}

async function rewriteModelAnswer(params: {
  reference: string;
  question: string;
  maxScore: number;
  language: AnswerLanguage;
  markingPoints?: string[];
  strict?: boolean;
  preserveCalculationSections?: boolean;
}): Promise<string | null> {
  const questionStem = extractQuestionStemForLanguage(params.question, params.language);
  const looksLikeCalcModel =
    params.preserveCalculationSections ||
    looksLikeStructuredCalculationModelAnswer(params.reference) ||
    (params.reference.match(/=/g)?.length ?? 0) >= 2;
  const calcDomain = resolveCalculationDomain("");
  const calcPolicy = inferCalculationPolicy(params.question, params.maxScore);
  const calcSections = looksLikeCalcModel
    ? calculationModelAnswerSectionLabels(params.maxScore, calcDomain, calcPolicy)
    : [];
  const markingBlock =
    !looksLikeCalcModel && params.markingPoints && params.markingPoints.length > 0
      ? [
          "Required marking points (every point MUST appear in modelAnswer, rephrased as natural exam wording):",
          ...params.markingPoints.map((p) => `- ${p}`),
        ].join("\n")
      : "";

  const system = withStrictGenerationLanguage(
    [
      params.strict
        ? "You MUST translate the reference into English ONLY for an SPM Form 4/5 student."
        : "You MUST rewrite a reference model answer in KSSM SPM textbook wording for a Form 4/5 student.",
      formatSpmStudentFriendlyRulesBlock(),
      looksLikeCalcModel
        ? [
            "CALCULATION MODEL ANSWER QUALITY (binding):",
            "- Keep the worked solution structure — do NOT collapse into paragraph prose.",
            "- You MUST include ALL three sections with non-empty content: Formula: / Working: / Final answer:",
            "- NEVER return Final answer alone or Working without Formula.",
            "- Preserve numeric values, units, and formulas exactly.",
            "- Do NOT turn Formula/Working/Final sections into essay sentences.",
            "- PLAIN TEXT ONLY: no LaTeX, no markdown, no \\\\, no \\frac, no \\[1ex].",
            "- Use real newlines between Formula: / Working: / Final answer: — never write the characters backslash-n.",
            "- Do NOT repeat Formula content inside Working.",
          ].join("\n")
        : buildModelAnswerQualityRulesBlock(params.maxScore, params.question),
      looksLikeCalcModel ? "" : buildKssmTextbookModelAnswerWordingBlock(),
      buildLanguageDirective(params.language),
      looksLikeCalcModel
        ? MUST_RETURN_JSON_MODEL_ANSWER
        : [
            'You MUST return JSON only: { "pointExemplars": string[] }',
            `pointExemplars MUST have exactly ${params.maxScore} entries — one complete student-facing sentence per marking point.`,
            "Do NOT put two marking points in one string. Do NOT use ';' to join marking points.",
            "Do NOT soft-wrap one sentence across entries.",
          ].join("\n"),
      params.language === "english"
        ? "CRITICAL: modelAnswer / pointExemplars MUST be written entirely in English. Do NOT use Bahasa Melayu sentences or Malay function words (yang, dalam, adalah, kerana, makanan, etc.)."
        : "CRITICAL: modelAnswer / pointExemplars MUST be written entirely in Bahasa Melayu.",
      "The model answer is a fixed exemplar for this question — it MUST NOT vary based on any student attempt.",
      looksLikeCalcModel
        ? "Keep chemical equations, symbols, numbers, and units exactly as in the reference."
        : "The reference and marking points may use formal examiner language — you MUST rewrite them in KSSM textbook student style.\nKeep chemical equations, symbols, and formulas exactly as in the reference.\nRewrite short/cryptic points into the length/depth required by the command word so the exemplar clearly answers the stem.",
      looksLikeCalcModel
        ? [
            `Calculation model answer for ${params.maxScore} mark(s): you MUST use ALL of these section labels, each on its own line:`,
            ...calcSections.map((l) => `- ${l}`),
            "Separate sections with newlines. NEVER omit Formula: or Working:.",
            "Unit belongs in Final answer — not a separate section or mark.",
          ].join("\n")
        : buildModelAnswerVerbFormatRulesBlock(params.maxScore, params.question),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const user = [
    `Question: ${questionStem}`,
    `Max marks: ${params.maxScore}`,
    markingBlock,
    `Reference (concepts only — rephrase into proper model answer):\n${params.reference}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user, { temperature: 0 });
    if (looksLikeCalcModel) {
      const localized =
        typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
      if (!localized) return null;
      if (hasCompleteCalculationModelAnswerSections(localized)) {
        return localized;
      }
      return null;
    }

    const rows = Array.isArray(parsed?.pointExemplars)
      ? (parsed.pointExemplars as unknown[])
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter(Boolean)
      : [];
    let localized = "";
    if (rows.length === params.maxScore) {
      localized = formatMarkSchemePointsAsModelAnswer(rows, params.question);
    } else if (typeof parsed?.modelAnswer === "string" && parsed.modelAnswer.trim()) {
      localized = parsed.modelAnswer.trim();
    }
    if (!localized) return null;
    if (modelAnswerPassesQualityCheck(localized, params.maxScore, params.question)) {
      return localized;
    }
  } catch {
    /* try fallback */
  }
  return null;
}

/**
 * Polish the reference model answer for display. Output is identical for every
 * student on the same question — language comes from the stem only.
 */
export async function localizeModelAnswerForStudent(params: {
  referenceModelAnswer: string;
  question: string;
  maxScore: number;
  evidenceUnits?: string[];
  /** When true, keep Formula/Working/Final section layout (calc questions). */
  preserveCalculationSections?: boolean;
}): Promise<string> {
  const reference = params.referenceModelAnswer.trim();
  if (!reference) return reference;

  const language = resolveModelAnswerLanguage(params.question);
  const preserveCalc = Boolean(params.preserveCalculationSections);
  const markingPoints = preserveCalc ? [] : (params.evidenceUnits ?? []).filter(Boolean);
  const cacheKey = polishCacheKey(
    reference,
    params.question,
    params.maxScore,
    language,
    preserveCalc,
  );
  const cached = polishedModelAnswerCache.get(cacheKey);
  if (cached) return cached;

  if (
    !needsModelAnswerPolish({
      reference,
      language,
      question: params.question,
      maxScore: params.maxScore,
      preserveCalculationSections: preserveCalc,
    })
  ) {
    const clean = finalizeCalcModelAnswer(reference, preserveCalc);
    polishedModelAnswerCache.set(cacheKey, clean);
    return clean;
  }

  let localized = await rewriteModelAnswer({
    reference,
    question: params.question,
    maxScore: params.maxScore,
    language,
    markingPoints,
    preserveCalculationSections: preserveCalc,
  });

  if (localized && outputMatchesLanguage(localized, language)) {
    if (
      preserveCalc &&
      !hasCompleteCalculationModelAnswerSections(localized)
    ) {
      // Reject incomplete Formula/Working/Final rewrites.
      localized = null;
    } else {
      const clean = finalizeCalcModelAnswer(localized, preserveCalc);
      polishedModelAnswerCache.set(cacheKey, clean);
      return clean;
    }
  }

  if (language === "english") {
    localized = await rewriteModelAnswer({
      reference: localized ?? reference,
      question: params.question,
      maxScore: params.maxScore,
      language,
      markingPoints,
      strict: true,
      preserveCalculationSections: preserveCalc,
    });
    if (localized && outputMatchesLanguage(localized, language)) {
      if (preserveCalc && !hasCompleteCalculationModelAnswerSections(localized)) {
        localized = null;
      } else {
        const clean = finalizeCalcModelAnswer(localized, preserveCalc);
        polishedModelAnswerCache.set(cacheKey, clean);
        return clean;
      }
    }

    // Theory-only fallback — never flatten calc sections into marking-point prose.
    if (!preserveCalc && markingPoints.length > 0) {
      const fromUnits = await rewriteModelAnswer({
        reference: markingPoints.join(". "),
        question: params.question,
        maxScore: params.maxScore,
        language,
        markingPoints,
        strict: true,
      });
      if (fromUnits && outputMatchesLanguage(fromUnits, language)) {
        polishedModelAnswerCache.set(cacheKey, fromUnits);
        return fromUnits;
      }
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[grade:v3] model answer polish fell back to reference", {
      targetLanguage: language,
      referencePreview: reference.slice(0, 120),
      localizedPreview: localized?.slice(0, 120),
    });
  }

  const result =
    language === "english"
      ? localized && !textContainsMalayProse(localized)
        ? localized
        : reference
      : (localized ?? reference);

  const clean = finalizeCalcModelAnswer(result, preserveCalc);
  polishedModelAnswerCache.set(cacheKey, clean);
  return clean;
}
