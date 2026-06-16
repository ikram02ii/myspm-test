import { qwenGradingJson } from "../qwenGradingClient";
import { formatSpmStudentFriendlyRulesBlock } from "../gradingPolicy";
import {
  buildLanguageDirective,
  detectAnswerLanguage,
  extractQuestionStemForLanguage,
  textContainsMalayProse,
  type AnswerLanguage,
} from "../gradingTextUtils";

function resolveStudentFacingLanguage(studentAnswer: string, question: string): AnswerLanguage {
  const hasWords = /[a-zA-Z]{3,}/.test(studentAnswer);
  if (!hasWords) {
    const fromEnStem = extractQuestionStemForLanguage(question, "english");
    if (fromEnStem !== question.trim()) return "english";
    const fromBmStem = extractQuestionStemForLanguage(question, "malay");
    if (fromBmStem !== question.trim()) return "malay";
    return detectAnswerLanguage(question);
  }
  return detectAnswerLanguage(studentAnswer);
}

function needsLocalization(reference: string, target: AnswerLanguage): boolean {
  if (target === "english") {
    return textContainsMalayProse(reference) || detectAnswerLanguage(reference) !== "english";
  }
  if (target === "malay") {
    return !textContainsMalayProse(reference) && detectAnswerLanguage(reference) === "english";
  }
  return textContainsMalayProse(reference);
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
  studentAnswer: string;
  maxScore: number;
  language: AnswerLanguage;
  strict?: boolean;
}): Promise<string | null> {
  const questionStem = extractQuestionStemForLanguage(params.question, params.language);
  const system = [
    params.strict
      ? "Translate the reference model answer into English ONLY for an SPM student."
      : "Rephrase a reference model answer for an SPM student.",
    formatSpmStudentFriendlyRulesBlock(),
    buildLanguageDirective(params.language),
    'Return JSON only: { "modelAnswer": string }',
    params.language === "english"
      ? "CRITICAL: modelAnswer MUST be written entirely in English. Do NOT use Bahasa Melayu sentences or Malay function words (yang, dalam, adalah, kerana, makanan, etc.)."
      : "CRITICAL: modelAnswer MUST be written entirely in Bahasa Melayu.",
    "Use the reference for scientific concepts and mark coverage only.",
    "Keep chemical equations, symbols, and formulas exactly as in the reference.",
    "Write concise exam-style wording at SPM Form 4/5 level.",
  ].join("\n");

  const user = [
    `Question: ${questionStem}`,
    `Max marks: ${params.maxScore}`,
    `Student answer (match this language):\n${params.studentAnswer}`,
    `Reference model answer:\n${params.reference}`,
  ].join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user, { temperature: params.strict ? 0 : 0.1 });
    const localized =
      typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
    if (localized.length > 0) return localized;
  } catch {
    /* try fallback */
  }
  return null;
}

export async function localizeModelAnswerForStudent(params: {
  referenceModelAnswer: string;
  question: string;
  studentAnswer: string;
  maxScore: number;
  evidenceUnits?: string[];
}): Promise<string> {
  const reference = params.referenceModelAnswer.trim();
  if (!reference) return reference;

  const language = resolveStudentFacingLanguage(params.studentAnswer, params.question);
  if (!needsLocalization(reference, language)) return reference;

  let localized = await rewriteModelAnswer({
    reference,
    question: params.question,
    studentAnswer: params.studentAnswer,
    maxScore: params.maxScore,
    language,
  });

  if (localized && outputMatchesLanguage(localized, language)) {
    return localized;
  }

  if (language === "english") {
    localized = await rewriteModelAnswer({
      reference: localized ?? reference,
      question: params.question,
      studentAnswer: params.studentAnswer,
      maxScore: params.maxScore,
      language,
      strict: true,
    });
    if (localized && outputMatchesLanguage(localized, language)) {
      return localized;
    }

    const unitSource = (params.evidenceUnits ?? []).filter(Boolean).join(". ");
    if (unitSource.trim()) {
      const fromUnits = await rewriteModelAnswer({
        reference: unitSource,
        question: params.question,
        studentAnswer: params.studentAnswer,
        maxScore: params.maxScore,
        language,
        strict: true,
      });
      if (fromUnits && outputMatchesLanguage(fromUnits, language)) {
        return fromUnits;
      }
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[grade:v3] model answer localization fell back to reference", {
      targetLanguage: language,
      referencePreview: reference.slice(0, 120),
      localizedPreview: localized?.slice(0, 120),
    });
  }

  if (language === "english") {
    if (localized && !textContainsMalayProse(localized)) return localized;
    return "";
  }

  return localized ?? reference;
}
