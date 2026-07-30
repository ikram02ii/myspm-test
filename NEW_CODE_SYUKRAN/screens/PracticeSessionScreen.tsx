import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Camera, Check, ChevronLeft, ImageUp, Info } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import { MathLineChart } from "../components/math/MathLineChart";
import { BiologyStructuredDiagram } from "../components/biology/BiologyStructuredDiagram";
import { AnimalCellDiagramWithLabels } from "../components/biology/AnimalCellDiagramWithLabels";
import { LabeledAnimalCellDiagram } from "../components/biology/LabeledAnimalCellDiagram";
import { MathFormattedText } from "../components/math/MathFormattedText";
import { CalculationStepsView } from "../components/math/CalculationStepsView";
import { looksLikeCalculationWorking } from "../utils/parseCalculationSteps";
import {
  inferOrganelleHighlights,
  isBiologySubject,
  shouldShowLabeledCellDiagram,
} from "../utils/biologyDiagramHighlights";
import { isMatrixOnlyOption } from "../utils/parseMatrixNotation";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  buildQuestionPayloadForGrade,
  fetchPracticeSetDetail,
  resolveAiPracticeSourceLabel,
  resolveQuestionMarks,
  type PracticeSetQuestion,
  type RagSourceAttribution,
} from "../services/mobilePracticeSets";
import { getAiPracticeAttribution, loadAiPracticeAttribution, setAiPracticeAttribution } from "../services/aiPracticeAttributionStore";
import { parseAiAttributionPayload } from "../services/aiPracticeAttributionPayload";
import {
  fetchOpenEndedQuestionStep,
  mapOpenEndedStepToPracticeQuestion,
  type OpenEndedBackgroundJob,
} from "../services/aiOpenEndedGeneration";
import { ragApiPost } from "../services/ragApi";
import { uploadScanImageWithAiTutor } from "../services/mobileScan";
import { EnglishSpeakingPart1Exam } from "../components/EnglishSpeakingPart1Exam";
import { EnglishSpeakingPart1InterviewExam } from "../components/EnglishSpeakingPart1InterviewExam";
import { EnglishSpeakingPart2Exam } from "../components/EnglishSpeakingPart2Exam";
import { SpeakingFeedbackPanel } from "../components/SpeakingFeedbackPanel";
import {
  type SpeakingGradeResponse,
} from "../services/mobileSpeaking";
import {
  formatOptionForLangView,
  formatQuestionStemForLangView,
  optionHasBilingualText,
  questionHasBilingualStem,
  type QuestionLangView,
} from "../utils/bilingualQuestionStem";
import {
  buildPart1InterviewSessionSummary,
  getPart1InterviewBlock,
  type Part1InterviewSessionResult,
} from "../utils/englishSpeakingInterview";

const BRAND = theme.brand;

function mergeRagSources(...lists: Array<RagSourceAttribution[] | undefined>): RagSourceAttribution[] {
  const seen = new Set<string>();
  const out: RagSourceAttribution[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      const label = row.label?.trim();
      const key = label || `${row.sourceType}:${row.documentId}:${row.chunkId}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeSession">;

function optionIndexFromToken(token: string, numOptions: number): number | null {
  const t = token.trim();
  if (!t || numOptions <= 0) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0 && n < numOptions && String(n) === t) {
    return n;
  }
  if (/^[A-Za-z]$/.test(t)) {
    const i = t.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < numOptions) return i;
  }
  return null;
}

/** Indices of all correct options (0-based). Supports "1", "A", "0,2", "A,C", or JSON [0,2]. */
function parseCorrectIndices(correctAnswer: string, numOptions: number): Set<number> {
  const raw = correctAnswer.trim();
  const out = new Set<number>();
  if (!raw || numOptions <= 0) return out;

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          const idx =
            typeof x === "number" && Number.isInteger(x)
              ? x >= 0 && x < numOptions
                ? x
                : null
              : optionIndexFromToken(String(x), numOptions);
          if (idx !== null) out.add(idx);
        }
        if (out.size > 0) return out;
      }
    } catch {
      // fall through
    }
  }

  const parts = raw.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return out;
  if (parts.length === 1) {
    const idx = optionIndexFromToken(parts[0], numOptions);
    if (idx !== null) out.add(idx);
    return out;
  }
  for (const p of parts) {
    const idx = optionIndexFromToken(p, numOptions);
    if (idx !== null) out.add(idx);
  }
  return out;
}

function normalizeOcrCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*\d{1,2}\s*(?:marks?|markah)\s*\)/gi, "")
    .replace(/^(?:en|bm)\s*:\s*/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bilingualStemLines(questionText: string): string[] {
  const out: string[] = [];
  for (const line of questionText.split("\n")) {
    const t = line.trim();
    if (!/^(?:en|bm)\s*:/i.test(t)) continue;
    const body = t.replace(/^(?:en|bm)\s*:\s*/i, "").trim();
    if (body.length >= 12) out.push(body);
  }
  return out;
}

function stemWordOverlap(ocrNorm: string, stemNorm: string): number {
  const oWords = new Set(ocrNorm.split(" ").filter((w) => w.length > 3));
  const sWords = stemNorm.split(" ").filter((w) => w.length > 3);
  if (sWords.length === 0) return 0;
  return sWords.filter((w) => oWords.has(w)).length / sWords.length;
}

/** True when OCR text is almost certainly the displayed question, not a student answer. */
function ocrLooksLikeQuestionStem(ocrText: string, questionText: string): boolean {
  const o = normalizeOcrCompare(ocrText);
  const q = normalizeOcrCompare(questionText);
  if (!o || o.length < 12) return false;
  if (/^(?:en|bm)\s*:/i.test(ocrText.trim()) && o.length >= 16) return true;
  if (q && o.length >= 16) {
    if (o === q) return true;
    if (q.length >= 24 && o.includes(q)) return true;
    if (stemWordOverlap(o, q) >= 0.65) return true;
  }
  for (const stem of bilingualStemLines(questionText)) {
    const s = normalizeOcrCompare(stem);
    if (s.length < 12) continue;
    if (o === s || o.includes(s) || s.includes(o)) return true;
    if (stemWordOverlap(o, s) >= 0.65) return true;
  }
  return false;
}

function isSelectionCorrect(selected: Set<number>, correct: Set<number>): boolean {
  if (selected.size !== correct.size || correct.size === 0) return false;
  for (const i of correct) {
    if (!selected.has(i)) return false;
  }
  return true;
}

/** maxScore for /rag/grade (open-ended). */
function resolveOpenEndedMaxScore(q: PracticeSetQuestion): number {
  const gradePayload = buildQuestionPayloadForGrade(
    q.questionText,
    q.questionForGrade,
    q.explanation,
  );
  return resolveQuestionMarks(q, gradePayload);
}

function stripModelAnswerLabel(raw: string | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/^Model answer(?:\s*\/\s*Jawapan model)?\s*:\s*/i, "")
    .trim();
}

function extractModelAnswerFromExplanation(explanation: string | null | undefined): string {
  const text = (explanation ?? "").trim();
  if (!text) return "";
  const labeled = text.match(/^(?:jawapan|answer|model answer)\s*[:：]\s*([\s\S]*)$/i);
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  return text;
}

type ModelMarkPoint = {
  text: string;
  marks: number;
  awarded?: boolean;
  reason?: string;
};

type OpenEndedFeedback = {
  feedback: string;
  modelPoints: ModelMarkPoint[];
  maxScore: number;
  modelAnswerRaw?: string;
  showCalculationLayout: boolean;
  /** Per-stage ✓/✗ for calculation questions. */
  calcMarkPoints?: ModelMarkPoint[];
};

const CALC_MARK_SCHEME_LABEL =
  /formula|substitution|calculation|correct data|si unit|final answer|data extraction|unit conversion/i;

function detectCalculationFeedback(
  result: { markBreakdown?: Array<{ idea?: string }> } | null | undefined,
  answerRaw: string,
  questionText: string,
): boolean {
  const breakdown = result?.markBreakdown ?? [];
  const calcRows = breakdown.filter((row) => CALC_MARK_SCHEME_LABEL.test(row.idea ?? ""));
  if (calcRows.length >= 2) return true;
  if (calcRows.length === 1 && breakdown.length === 1) return true;

  if (looksLikeCalculationWorking(answerRaw)) return true;

  const stem = questionText.trim();
  if (
    /\b(calculate|kir[ao]|hitung|solve|find the value|determine the value|berapakah|nyatakan formula|hitungkan)\b/i.test(
      stem,
    )
  ) {
    return true;
  }

  return false;
}

function splitModelAnswerPoints(raw: string, expectedCount?: number, defaultMarks = 1): ModelMarkPoint[] {
  const text = raw.trim();
  if (!text) return [];

  const stripBulletPrefix = (chunk: string) =>
    chunk.trim().replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();

  const looksLikePointStart = (line: string) => {
    const t = line.trim();
    return /^[•\-*]\s+\S/.test(t) || /^\d+[.)]\s+\S/.test(t);
  };

  const toPoints = (chunks: string[]): ModelMarkPoint[] => {
    let cleaned = chunks.map(stripBulletPrefix).filter((p) => p.length > 0);
    const target =
      typeof expectedCount === "number" && expectedCount > 0 ? Math.floor(expectedCount) : undefined;
    if (target && cleaned.length > target) {
      const head = cleaned.slice(0, target - 1);
      const tail = cleaned.slice(target - 1).join(" ").trim();
      cleaned = [...head, tail];
    }
    return cleaned.map((chunk) => ({ text: chunk, marks: defaultMarks }));
  };

  // 1) Blank-line paragraphs first (matches backend "1.\n\n2." format)
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length >= 2) return toPoints(paragraphs);

  // 2) Numbered / bulleted lines — merge soft-wrapped continuations
  const rawLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rawLines.length > 1) {
    const merged: string[] = [];
    for (const line of rawLines) {
      if (merged.length === 0 || looksLikePointStart(line)) {
        merged.push(line);
      } else {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`.trim();
      }
    }
    if (merged.length > 1) return toPoints(merged);
  }

  // 3) Inline bullets
  const inlineBulletCount = (text.match(/•/g) || []).length;
  if (inlineBulletCount >= 2) {
    const inlineParts = text
      .split(/\s*•\s*/)
      .map(stripBulletPrefix)
      .filter((part) => part.length >= 2);
    if (inlineParts.length >= 2) return toPoints(inlineParts);
  }

  // 4) Inline numbered "1. … 2. …"
  const numberedInline = text.match(/(?:^|\s)\d+[.)]\s+\S/g);
  if (numberedInline && numberedInline.length >= 2) {
    const parts = text
      .split(/(?:^|\s)(?=\d+[.)]\s+\S)/)
      .map(stripBulletPrefix)
      .filter((p) => p.length >= 2);
    if (parts.length >= 2) return toPoints(parts);
  }

  // 5) Semicolon ONLY for short state-style facts — never cut long prose mid-point
  if (text.includes(";")) {
    const parts = text.split(";").map((p) => p.trim()).filter(Boolean);
    const allShort = parts.length >= 2 && parts.every((p) => p.split(/\s+/).length <= 18);
    if (allShort) return toPoints(parts);
  }

  const sequenceMatch = text.match(
    /(?:^|\s)(?:First|Secondly|Second|Third|Fourth|Fifth|Finally|Lastly)\s*[,:]?\s*/gi,
  );
  if (sequenceMatch && sequenceMatch.length >= 2) {
    const chunks = text
      .split(/(?:^|\s)(?:First|Secondly|Second|Third|Fourth|Fifth|Finally|Lastly)\s*[,:]?\s*/i)
      .map((part) => part.trim().replace(/[.]\s*$/, ""))
      .filter(Boolean);
    if (chunks.length >= 2) return toPoints(chunks);
  }

  if (expectedCount && expectedCount >= 2) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 12);
    if (sentences.length >= expectedCount) return toPoints(sentences.slice(0, expectedCount));
  }

  return [{ text, marks: defaultMarks }];
}

function stripModelAnswerFromFeedback(raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  return text
    .replace(
      /\n\s*(?:model answer|jawapan(?:\s+model)?|correct answer|sample answer)\s*[:：][\s\S]*/gi,
      "",
    )
    .trim();
}

function parseOpenEndedFeedback(
  result: {
    feedback?: string;
    modelAnswer?: string;
    modelAnswerPoints?: string[];
    modelAnswerPointCards?: Array<{
      text?: string;
      marks?: number;
      awarded?: boolean;
      reason?: string;
    }>;
    score?: number;
    maxScore?: number;
    markBreakdown?: Array<{
      idea?: string;
      marks?: number;
      awarded?: boolean;
      reason?: string;
    }>;
  } | null | undefined,
  fallbackExplanation?: string | null,
  questionText = "",
): OpenEndedFeedback {
  const feedback = stripModelAnswerFromFeedback((result?.feedback ?? "").trim());
  const modelAnswer = stripModelAnswerLabel(result?.modelAnswer);
  const max = Number(result?.maxScore);
  const maxScore = Number.isFinite(max) && max > 0 ? Math.round(max) : 1;
  const generatedAnswer = extractModelAnswerFromExplanation(fallbackExplanation);
  const answerRaw = modelAnswer || generatedAnswer;
  const showCalculationLayout = detectCalculationFeedback(result, answerRaw, questionText);

  const apiCards = Array.isArray(result?.modelAnswerPointCards)
    ? result!
        .modelAnswerPointCards!.map((c) => ({
          text: String(c?.text || "").trim(),
          marks: Number.isFinite(Number(c?.marks)) && Number(c?.marks) > 0 ? Number(c!.marks) : 1,
          awarded: typeof c?.awarded === "boolean" ? c.awarded : undefined,
          reason: typeof c?.reason === "string" ? c.reason : undefined,
        }))
        .filter((c) => c.text.length > 0)
    : [];

  const fromBreakdown =
    Array.isArray(result?.markBreakdown) && result!.markBreakdown!.length > 0
      ? result!.markBreakdown!.map((row) => ({
          text: String(row?.idea || "").trim(),
          marks: Number.isFinite(Number(row?.marks)) && Number(row?.marks) > 0 ? Number(row!.marks) : 1,
          awarded: row?.awarded === true,
          reason: typeof row?.reason === "string" ? row.reason : undefined,
        })).filter((c) => c.text.length > 0)
      : [];

  if (showCalculationLayout) {
    return {
      feedback: feedback || (answerRaw ? "" : "No feedback returned."),
      modelPoints: [],
      maxScore,
      modelAnswerRaw: answerRaw,
      showCalculationLayout: true,
      calcMarkPoints: apiCards.length > 0 ? apiCards : fromBreakdown,
    };
  }

  const apiPoints = Array.isArray(result?.modelAnswerPoints)
    ? result!.modelAnswerPoints!.map((p) => String(p || "").trim()).filter(Boolean)
    : [];

  // Prefer structured API cards — merge award status from breakdown when missing.
  const modelPoints =
    apiCards.length > 0
      ? apiCards.map((card, i) => ({
          ...card,
          awarded:
            typeof card.awarded === "boolean"
              ? card.awarded
              : fromBreakdown[i]?.awarded,
          reason: card.reason ?? fromBreakdown[i]?.reason,
        }))
      : apiPoints.length > 0
        ? apiPoints.map((text, i) => ({
            text,
            marks: fromBreakdown[i]?.marks ?? 1,
            awarded: fromBreakdown[i]?.awarded,
            reason: fromBreakdown[i]?.reason,
          }))
        : fromBreakdown.length > 0
          ? fromBreakdown
          : answerRaw
            ? splitModelAnswerPoints(answerRaw, maxScore)
            : [];

  return {
    feedback: feedback || (modelPoints.length === 0 ? "No feedback returned." : ""),
    modelPoints,
    maxScore,
    showCalculationLayout: false,
  };
}

function formatMarkLabel(marks: number): string {
  return marks === 1 ? "1 mark" : `${marks} marks`;
}

type QuestionMarkResult = {
  earned: number;
  max: number;
};

/** Per-question UI state so students can go back and review answers without re-solving. */
type QuestionSessionState = {
  selectedIndices: number[];
  openEndedAnswer: string;
  showFeedback: boolean;
  openEndedFeedback: OpenEndedFeedback | null;
  speakingTranscript: string | null;
  speakingMarkingText: string | null;
  speakingGrades: SpeakingGradeResponse[] | null;
  speakingGradeTitles: string[] | null;
  speakingReadyForNext: boolean;
};

function emptyQuestionSession(): QuestionSessionState {
  return {
    selectedIndices: [],
    openEndedAnswer: "",
    showFeedback: false,
    openEndedFeedback: null,
    speakingTranscript: null,
    speakingMarkingText: null,
    speakingGrades: null,
    speakingGradeTitles: null,
    speakingReadyForNext: false,
  };
}

function isSpeakingQuestionType(questionType: string | null | undefined): boolean {
  const t = (questionType ?? "").toLowerCase();
  return t === "speaking_part1" || t === "speaking_part2";
}

function questionAllowsMultiSelect(q: PracticeSetQuestion, correct: Set<number>): boolean {
  const type = (q.questionType || "").toLowerCase();
  if (type.includes("multiple_answer") || type.includes("multiple_select") || type.includes("multi_select")) {
    return true;
  }
  return correct.size > 1;
}

export default function PracticeSessionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const routeParams = route.params as
    | { setId: number; title: string; subject?: string; formLevel?: string; practiceMode?: "speaking" }
    | {
        title: string;
        questions: PracticeSetQuestion[];
        subject?: string;
        formLevel?: string;
        practiceMode?: "speaking";
        openEndedBackground?: OpenEndedBackgroundJob;
        ragSourceLabel?: string;
        ragSources?: RagSourceAttribution[];
        /** Explicit flag — more reliable than title string on web. */
        isAiPractice?: boolean;
        /** Compact JSON source payload (reliable on web navigation). */
        aiSourcePayload?: string;
      };
  const hasQuestions = "questions" in routeParams && Array.isArray(routeParams.questions);
  const initialQuestions = hasQuestions ? routeParams.questions : [];
  const questionSourcePayload = useMemo(() => {
    const fromRoute =
      hasQuestions && typeof routeParams.aiSourcePayload === "string"
        ? routeParams.aiSourcePayload
        : "";
    const fromQuestion = initialQuestions.find((item) => item.sourcePayload?.trim())?.sourcePayload?.trim() ?? "";
    return fromRoute || fromQuestion;
  }, [hasQuestions, routeParams, initialQuestions]);
  const routePayload = useMemo(
    () =>
      questionSourcePayload
        ? parseAiAttributionPayload(questionSourcePayload)
        : hasQuestions && typeof routeParams.aiSourcePayload === "string"
          ? parseAiAttributionPayload(routeParams.aiSourcePayload)
          : null,
    [hasQuestions, questionSourcePayload, routeParams],
  );
  const routeRagSourceLabel =
    hasQuestions && typeof routeParams.ragSourceLabel === "string"
      ? routeParams.ragSourceLabel.trim()
      : "";
  const storedAttribution = getAiPracticeAttribution();
  const sessionRagSourceLabel =
    routeRagSourceLabel ||
    routePayload?.sourceLabel?.trim() ||
    storedAttribution?.sourceLabel?.trim() ||
    "";
  const sessionRagSources =
    routePayload?.sources?.length
      ? routePayload.sources
      : storedAttribution?.sources ?? [];
  const sessionAttributionRef = useRef({
    sourceLabel: sessionRagSourceLabel?.trim() ?? "",
    sources: sessionRagSources ?? [],
  });
  const openEndedBackground =
    hasQuestions && "openEndedBackground" in routeParams ? routeParams.openEndedBackground : undefined;
  const practiceMode = routeParams.practiceMode;

  const setId = "setId" in routeParams ? routeParams.setId : undefined;
  const { title } = routeParams;
  const routeSubject = routeParams.subject;
  const routeFormLevel = routeParams.formLevel;

  const [loading, setLoading] = useState(!hasQuestions);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeSetQuestion[]>(() => {
    const payloadFromQuestion = parseAiAttributionPayload(
      initialQuestions.find((item) => item.sourcePayload?.trim())?.sourcePayload,
    );
    const label =
      sessionAttributionRef.current.sourceLabel ||
      payloadFromQuestion?.sourceLabel ||
      initialQuestions.find((item) => item.sourceLabel?.trim())?.sourceLabel?.trim() ||
      "";
    const sources =
      sessionAttributionRef.current.sources.length > 0
        ? sessionAttributionRef.current.sources
        : payloadFromQuestion?.sources ?? [];
    if (!label && sources.length === 0) return initialQuestions;
    return initialQuestions.map((question) => ({
      ...question,
      sourceLabel: question.sourceLabel?.trim() || label || undefined,
      sources:
        question.sources?.length && question.sources[0]?.label?.trim()
          ? question.sources
          : sources.length > 0
            ? sources
            : question.sources,
    }));
  });
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [questionResults, setQuestionResults] = useState<Record<number, QuestionMarkResult>>({});
  const [finished, setFinished] = useState(false);
  const [openEndedFeedback, setOpenEndedFeedback] = useState<OpenEndedFeedback | null>(null);
  const [openEndedAnswer, setOpenEndedAnswer] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [openEndedMarkingBusy, setOpenEndedMarkingBusy] = useState(false);
  const [speakingReadyForNext, setSpeakingReadyForNext] = useState(false);
  const [part1InterviewSessionScore, setPart1InterviewSessionScore] = useState<QuestionMarkResult | null>(null);
  const [speakingTranscript, setSpeakingTranscript] = useState<string | null>(null);
  const [speakingMarkingText, setSpeakingMarkingText] = useState<string | null>(null);
  const [speakingGrades, setSpeakingGrades] = useState<SpeakingGradeResponse[] | null>(null);
  const [speakingGradeTitles, setSpeakingGradeTitles] = useState<string[] | null>(null);
  const [openEndedBgBusy, setOpenEndedBgBusy] = useState(Boolean(openEndedBackground));
  const [questionLangView, setQuestionLangView] = useState<QuestionLangView>("en");
  const [aiSourceLabel, setAiSourceLabel] = useState(
    () => routePayload?.sourceLabel?.trim() || sessionRagSourceLabel || "",
  );
  const [aiSources, setAiSources] = useState<RagSourceAttribution[]>(
    () => routePayload?.sources ?? sessionRagSources,
  );
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const isAiPractice =
    title === "AI Practice" ||
    (hasQuestions && "isAiPractice" in routeParams && routeParams.isAiPractice === true);

  const refreshAiAttribution = useCallback(() => {
    if (!isAiPractice) {
      setAiSourceLabel("");
      setAiSources([]);
      return;
    }
    const fromQuestionLabel = questions.find((item) => item.sourceLabel?.trim())?.sourceLabel?.trim() ?? "";
    const fromQuestionPayload = parseAiAttributionPayload(
      questions.find((item) => item.sourcePayload?.trim())?.sourcePayload,
    );
    const fromRoute =
      routeRagSourceLabel ||
      routePayload?.sourceLabel?.trim() ||
      fromQuestionPayload?.sourceLabel?.trim() ||
      sessionRagSourceLabel;
    const fromMemory = getAiPracticeAttribution();
    const fromRef = sessionAttributionRef.current;
    const label =
      fromQuestionLabel ||
      fromRoute ||
      fromMemory?.sourceLabel?.trim() ||
      fromRef.sourceLabel?.trim() ||
      "";
    const sources = mergeRagSources(
      questions.find((item) => item.sources?.length)?.sources,
      routePayload?.sources,
      fromQuestionPayload?.sources,
      fromRef.sources,
      fromMemory?.sources,
      sessionRagSources,
    );
    setAiSourceLabel(label);
    setAiSources(sources);
  }, [isAiPractice, questions, routeRagSourceLabel, routePayload, sessionRagSourceLabel, sessionRagSources]);

  useFocusEffect(
    useCallback(() => {
      if (!isAiPractice) return;
      refreshAiAttribution();
      void loadAiPracticeAttribution().then((stored) => {
        if (!stored?.sourceLabel?.trim() && (stored?.sources?.length ?? 0) === 0) return;
        sessionAttributionRef.current = {
          sourceLabel: stored.sourceLabel?.trim() ?? "",
          sources: stored.sources ?? [],
        };
        setAiSourceLabel((prev) => prev || stored.sourceLabel?.trim() || "");
        setAiSources((prev) => mergeRagSources(prev, stored.sources));
      });
    }, [isAiPractice, refreshAiAttribution]),
  );

  useEffect(() => {
    if (!routePayload) return;
    sessionAttributionRef.current = {
      sourceLabel: routePayload.sourceLabel,
      sources: routePayload.sources,
    };
    setAiSourceLabel(routePayload.sourceLabel);
    setAiSources(routePayload.sources);
    setAiPracticeAttribution(routePayload);
  }, [routePayload]);

  useEffect(() => {
    refreshAiAttribution();
  }, [refreshAiAttribution]);

  const questionFade = useRef(new Animated.Value(1)).current;
  const questionLift = useRef(new Animated.Value(0)).current;
  const progressFillAnim = useRef(new Animated.Value(0)).current;
  const feedbackFade = useRef(new Animated.Value(0)).current;
  const feedbackLift = useRef(new Animated.Value(8)).current;
  const skipQuestionEnterAnim = useRef(true);
  const sessionByQuestionIdRef = useRef<Record<number, QuestionSessionState>>({});
  const part1SkipToIndexRef = useRef<number | null>(null);
  const load = useCallback(async () => {
    if (!setId) return;
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPracticeSetDetail(setId);
      skipQuestionEnterAnim.current = true;
      setQuestions(data.questions);
      setIndex(0);
      setSelected(new Set());
      setShowFeedback(false);
      setQuestionResults({});
      sessionByQuestionIdRef.current = {};
      setFinished(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load questions");
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    if (hasQuestions) {
      // questions were passed via navigation params; skip fetching from API
      skipQuestionEnterAnim.current = true;
      questionFade.setValue(1);
      questionLift.setValue(0);
      setLoading(false);
      return;
    }
    void load();
  }, [load, hasQuestions, questionFade, questionLift]);

  useEffect(() => {
    if (!hasQuestions) return;
    const stored = getAiPracticeAttribution();
    const sourceLabel =
      sessionAttributionRef.current.sourceLabel ||
      stored?.sourceLabel?.trim() ||
      "";
    const sources =
      sessionAttributionRef.current.sources.length > 0
        ? sessionAttributionRef.current.sources
        : (stored?.sources ?? []);
    if (!sourceLabel && sources.length === 0) return;

    sessionAttributionRef.current = { sourceLabel, sources };

    setQuestions((prev) => {
      const needsPatch = prev.some(
        (question) =>
          !question.sourceLabel?.trim() &&
          !(question.sources?.length && question.sources[0]?.label?.trim()),
      );
      if (!needsPatch) return prev;
      return prev.map((question) => ({
        ...question,
        sourceLabel: question.sourceLabel?.trim() || sourceLabel || undefined,
        sources:
          question.sources?.length && question.sources[0]?.label?.trim()
            ? question.sources
            : sources.length > 0
              ? sources
              : question.sources,
      }));
    });
  }, [hasQuestions]);

  useEffect(() => {
    navigation.setOptions({ title: title || "Practice" });
  }, [navigation, title]);

  useEffect(() => {
    const job = openEndedBackground;
    if (!job || job.nextQuestionIndex > job.totalQuestions) {
      setOpenEndedBgBusy(false);
      return;
    }

    let cancelled = false;
    setOpenEndedBgBusy(true);

    (async () => {
      let contextId = job.generationContextId;
      let priorStems = [...job.priorStems];

      for (let idx = job.nextQuestionIndex; idx <= job.totalQuestions; idx += 1) {
        if (cancelled) return;
        try {
          const step = await fetchOpenEndedQuestionStep({
            request: {
              query: job.query,
              subject: job.subject,
              form: job.form,
              topK: job.topK,
              chapterHint: job.chapterHint,
              chapterFilter: job.chapterFilter,
            },
            questionIndex: idx,
            totalQuestions: job.totalQuestions,
            priorStems,
            generationContextId: contextId,
          });
          contextId = step.generationContextId;
          if (cancelled || !step.question?.questionText?.trim()) continue;

          const mapped = mapOpenEndedStepToPracticeQuestion(step.question, idx, {
            sources: step.sources,
            sourceLabel: step.sourceLabel,
          });
          if (mapped.sourceLabel || mapped.sources?.length) {
            setAiPracticeAttribution({
              sourceLabel: mapped.sourceLabel ?? step.sourceLabel ?? "",
              sources: mapped.sources ?? [],
            });
          }
          priorStems.push(mapped.questionText);
          setQuestions((prev) => {
            if (prev.some((q) => q.sortOrder === mapped.sortOrder)) return prev;
            return [...prev, mapped].sort((a, b) => a.sortOrder - b.sortOrder);
          });
        } catch {
          break;
        }
      }

      if (!cancelled) {
        setOpenEndedBgBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openEndedBackground]);

  const plannedQuestionTotal = openEndedBackground?.totalQuestions ?? questions.length;

  useEffect(() => {
    const len = Math.max(questions.length, plannedQuestionTotal);
    if (len === 0) return;
    const target = (index + 1) / len;
    progressFillAnim.stopAnimation();
    Animated.spring(progressFillAnim, {
      toValue: target,
      useNativeDriver: false,
      friction: 14,
      tension: 100,
    }).start();
  }, [index, questions.length, plannedQuestionTotal, progressFillAnim]);

  const snapshotCurrentSession = useCallback((): QuestionSessionState => {
    return {
      selectedIndices: Array.from(selected),
      openEndedAnswer,
      showFeedback,
      openEndedFeedback,
      speakingTranscript,
      speakingMarkingText,
      speakingGrades,
      speakingGradeTitles,
      speakingReadyForNext,
    };
  }, [
    selected,
    openEndedAnswer,
    showFeedback,
    openEndedFeedback,
    speakingTranscript,
    speakingMarkingText,
    speakingGrades,
    speakingGradeTitles,
    speakingReadyForNext,
  ]);

  const applyQuestionSession = useCallback((state: QuestionSessionState) => {
    setSelected(new Set(state.selectedIndices));
    setOpenEndedAnswer(state.openEndedAnswer);
    setShowFeedback(state.showFeedback);
    setOpenEndedFeedback(state.openEndedFeedback);
    setSpeakingTranscript(state.speakingTranscript);
    setSpeakingMarkingText(state.speakingMarkingText);
    setSpeakingGrades(state.speakingGrades ?? null);
    setSpeakingGradeTitles(state.speakingGradeTitles ?? null);
    setSpeakingReadyForNext(state.speakingReadyForNext);
    setOcrError(null);
    setOcrBusy(false);
  }, []);

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0) return;
      if (nextIndex >= questions.length) {
        setFinished(true);
        return;
      }
      const currentQ = questions[index];
      if (currentQ) {
        sessionByQuestionIdRef.current = {
          ...sessionByQuestionIdRef.current,
          [currentQ.id]: snapshotCurrentSession(),
        };
      }
      const targetQ = questions[nextIndex];
      const saved = targetQ ? sessionByQuestionIdRef.current[targetQ.id] : undefined;
      setPart1InterviewSessionScore(null);
      setIndex(nextIndex);
      applyQuestionSession(saved ?? emptyQuestionSession());
    },
    [applyQuestionSession, index, questions, snapshotCurrentSession],
  );

  useEffect(() => {
    const current = questions[index];
    if (!current) return;
    if (skipQuestionEnterAnim.current) {
      skipQuestionEnterAnim.current = false;
      questionFade.setValue(1);
      questionLift.setValue(0);
      return;
    }
    questionFade.setValue(0);
    questionLift.setValue(14);
    Animated.parallel([
      Animated.timing(questionFade, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.spring(questionLift, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 220,
        mass: 0.6,
      }),
    ]).start();
  }, [index, questions[index]?.id, questionFade, questionLift]);

  useEffect(() => {
    if (!showFeedback) {
      feedbackFade.setValue(0);
      feedbackLift.setValue(10);
      return;
    }
    feedbackFade.setValue(0);
    feedbackLift.setValue(12);
    Animated.parallel([
      Animated.timing(feedbackFade, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.spring(feedbackLift, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 260,
      }),
    ]).start();
  }, [showFeedback, feedbackFade, feedbackLift]);

  const q = questions[index];
  const total = questions.length;

  const part1InterviewBlock = React.useMemo(
    () => getPart1InterviewBlock(questions, index),
    [questions, index],
  );
  const isPart1InterviewStart =
    part1InterviewBlock != null && part1InterviewBlock.startIndex === index;
  const isInsidePart1InterviewBlock =
    part1InterviewBlock != null &&
    index >= part1InterviewBlock.startIndex &&
    index <= part1InterviewBlock.endIndex;
  const isPart1InterviewFollower =
    isInsidePart1InterviewBlock && !isPart1InterviewStart;

  const speakingSubject = routeSubject ?? "English";
  const speakingForm = routeFormLevel ?? "Form 4";
  const isSpeakingQuestion =
    practiceMode === "speaking" || (q ? isSpeakingQuestionType(q.questionType) : false);
  const displaySourceLabel =
    q && !isSpeakingQuestion
      ? aiSourceLabel ||
        resolveAiPracticeSourceLabel(q, {
          routeSourceLabel: sessionRagSourceLabel || routeRagSourceLabel,
          storeSourceLabel: getAiPracticeAttribution()?.sourceLabel,
        })
      : "";
  const displaySources = mergeRagSources(q?.sources, aiSources, sessionAttributionRef.current.sources);
  const showSourceButton = isAiPractice && !isSpeakingQuestion;

  const openSourceModal = useCallback(() => {
    void loadAiPracticeAttribution().then((stored) => {
      if (stored) {
        sessionAttributionRef.current = {
          sourceLabel: stored.sourceLabel?.trim() ?? sessionAttributionRef.current.sourceLabel,
          sources: mergeRagSources(sessionAttributionRef.current.sources, stored.sources),
        };
        setAiSourceLabel((prev) => prev || stored.sourceLabel?.trim() || "");
        setAiSources((prev) => mergeRagSources(prev, stored.sources));
      }
    });
    setSourceModalOpen(true);
  }, []);
  const isSpeakingPart2 =
    isSpeakingQuestion && (q?.questionType ?? "").toLowerCase() === "speaking_part2";
  const isReviewMode = showFeedback || (isSpeakingQuestion && speakingReadyForNext);
  const speakingCompleted = isSpeakingQuestion && (showFeedback || speakingReadyForNext);
  const isSpeakingPart1Interview =
    isSpeakingQuestion && isInsidePart1InterviewBlock && !speakingCompleted;
  const isMcq =
    q &&
    !isSpeakingQuestion &&
    ((q.options?.length ?? 0) > 0 ||
      /multiple_choice|mcq|choice/i.test(q.questionType ?? ""));

  const correctIndices = q && isMcq ? parseCorrectIndices(q.correctAnswer, q.options.length) : new Set<number>();
  const multiSelect = q && isMcq ? questionAllowsMultiSelect(q, correctIndices) : false;
  const gradeQuestionPayload = q
    ? buildQuestionPayloadForGrade(q.questionText, q.questionForGrade, q.explanation)
    : "";
  const questionMarks =
    q && isSpeakingQuestion
      ? 10
      : q
        ? resolveQuestionMarks(q, gradeQuestionPayload)
        : 1;
  const showSpeakingFeedbackPanel =
    showFeedback || (isSpeakingQuestion && speakingReadyForNext);
  const showLangToggle = Boolean(
    q &&
      !isSpeakingQuestion &&
      (questionHasBilingualStem(q.questionText) ||
        (q.options?.some((opt) => optionHasBilingualText(opt)) ?? false)),
  );
  const displayQuestionText = q
    ? formatQuestionStemForLangView(q.questionText, questionLangView)
    : "";
  const onToggleOption = (i: number) => {
    if (!q || !isMcq) return;
    if (multiSelect) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    } else {
      setSelected(new Set([i]));
    }
  };

  const onCheck = () => {
    if (!q) return;
    if (!isMcq) {
      setOpenEndedFeedback(null);
      setShowFeedback(true);
      return;
    }
    if (selected.size === 0) return;
    setOpenEndedFeedback(null);
    const ok = isSelectionCorrect(selected, correctIndices);
    const maxMarks = resolveQuestionMarks(
      q,
      buildQuestionPayloadForGrade(q.questionText, q.questionForGrade, q.explanation),
    );
    const earned = ok ? maxMarks : 0;
    setQuestionResults((prev) => ({
      ...prev,
      [q.id]: { earned, max: maxMarks },
    }));
    setShowFeedback(true);
  };

  async function submitOpenEndedForMarking() {
    if (!q || isMcq) return;
    const studentAnswer = openEndedAnswer.trim();
    if (!studentAnswer) {
      setOpenEndedFeedback({
        feedback: "Please write an answer (or use OCR) before submitting.",
        modelPoints: [],
        maxScore: 1,
        showCalculationLayout: false,
      });
      setShowFeedback(true);
      return;
    }

    const subject = routeSubject ?? "Biology";
    const form = routeFormLevel ?? "Form 4";
    const questionForGrade = buildQuestionPayloadForGrade(
      q.questionText,
      q.questionForGrade,
      q.explanation,
    );
    const requestedMaxScore = resolveOpenEndedMaxScore(q);

    try {
      setOpenEndedMarkingBusy(true);
      setOpenEndedFeedback(null);
      const result = await ragApiPost<any>("/rag/grade", {
        question: questionForGrade,
        studentAnswer,
        subject,
        form,
        topK: 8,
        maxScore: requestedMaxScore,
        rubricId: q.rubricId ?? undefined,
        questionType: q.questionType ?? undefined,
        diagramImageUrl: q.diagramImageUrl?.trim() || undefined,
      });
      const earnedRaw = Number(result?.score);
      const maxRaw = Number(result?.maxScore);
      const earned = Number.isFinite(earnedRaw) ? Math.max(0, Math.round(earnedRaw)) : 0;
      const maxMarks = Number.isFinite(maxRaw)
        ? Math.max(1, Math.round(maxRaw))
        : requestedMaxScore;
      setQuestionResults((prev) => ({
        ...prev,
        [q.id]: { earned: Math.min(earned, maxMarks), max: maxMarks },
      }));
      setOpenEndedFeedback(
        parseOpenEndedFeedback(result, q.explanation, questionForGrade),
      );
      setShowFeedback(true);
    } catch (e) {
      setOpenEndedFeedback({
        feedback: e instanceof Error ? e.message : "Failed to grade your answer.",
        modelPoints: [],
        maxScore: requestedMaxScore,
        showCalculationLayout: false,
      });
      setShowFeedback(true);
    } finally {
      setOpenEndedMarkingBusy(false);
    }
  }

  const onPrevious = () => {
    if (index <= 0) return;
    navigateToIndex(index - 1);
  };

  const onNext = () => {
    const currentQ = questions[index];
    if (currentQ) {
      sessionByQuestionIdRef.current = {
        ...sessionByQuestionIdRef.current,
        [currentQ.id]: snapshotCurrentSession(),
      };
    }
    if (index + 1 >= total) {
      const morePlanned = index + 1 < plannedQuestionTotal;
      if (morePlanned || openEndedBgBusy) {
        return;
      }
      setFinished(true);
      return;
    }
    if (part1SkipToIndexRef.current != null) {
      const nextIdx = part1SkipToIndexRef.current;
      part1SkipToIndexRef.current = null;
      navigateToIndex(nextIdx);
      return;
    }
    navigateToIndex(index + 1);
  };

  const recordSpeakingResult = useCallback(
    (scoreRaw: number | undefined, maxRaw: number | undefined) => {
      if (!q) return;
      const max = Number.isFinite(maxRaw) ? Math.max(1, Math.round(maxRaw!)) : 10;
      const earned = Number.isFinite(scoreRaw)
        ? Math.max(0, Math.min(max, Math.round(scoreRaw!)))
        : 0;
      setQuestionResults((prev) => ({
        ...prev,
        [q.id]: { earned, max },
      }));
      setSpeakingReadyForNext(true);
    },
    [q],
  );

  const onSpeakingPart1Graded = useCallback(
    (result: SpeakingGradeResponse, transcript: string) => {
      recordSpeakingResult(result.score, result.maxScore);
      setSpeakingTranscript(transcript.trim() || null);
      setSpeakingGrades([result]);
      setSpeakingGradeTitles(null);
      setSpeakingMarkingText(null);
      setOpenEndedFeedback(null);
      setShowFeedback(true);
    },
    [recordSpeakingResult],
  );

  const onSpeakingPart1InterviewComplete = useCallback(
    (payload: Part1InterviewSessionResult) => {
      setQuestionResults((prev) => {
        const next = { ...prev };
        for (const turn of payload.turns) {
          const max = turn.grade?.maxScore ?? 10;
          const earned = turn.grade?.score ?? 0;
          next[turn.questionId] = { earned, max };
        }
        return next;
      });
      const summary = buildPart1InterviewSessionSummary(payload.turns);
      setSpeakingTranscript(summary.transcript || null);
      setSpeakingGrades(summary.grades.length > 0 ? summary.grades : null);
      setSpeakingGradeTitles(summary.gradeTitles.length > 0 ? summary.gradeTitles : null);
      setSpeakingMarkingText(summary.grades.length > 0 ? null : summary.markingText || null);
      setPart1InterviewSessionScore({
        earned: summary.averageScore,
        max: payload.totalMax,
      });
      part1SkipToIndexRef.current = payload.skipToIndex;
      setOpenEndedFeedback(null);
      setShowFeedback(true);
      setSpeakingReadyForNext(false);
    },
    [],
  );

  const onSpeakingPart1InterviewQuestionChange = useCallback(
    (localIndex: number) => {
      const block = getPart1InterviewBlock(questions, index);
      if (!block) return;
      const nextIndex = block.startIndex + localIndex;
      if (nextIndex < block.startIndex || nextIndex > block.endIndex) return;
      if (nextIndex === index) return;
      // Keep the interview mounted; only sync the session header progress.
      skipQuestionEnterAnim.current = true;
      setIndex(nextIndex);
    },
    [questions, index],
  );

  const onSpeakingPart2Complete = useCallback(
    (payload: {
      prepareGrade: SpeakingGradeResponse | null;
      speakGrade: SpeakingGradeResponse | null;
      prepareTranscript: string;
      speakTranscript: string;
    }) => {
      const speak = payload.speakGrade;
      recordSpeakingResult(speak?.score, speak?.maxScore ?? 10);

      const transcriptParts: string[] = [];
      if (payload.prepareTranscript.trim()) {
        transcriptParts.push(payload.prepareTranscript.trim());
      }
      if (payload.speakTranscript.trim()) {
        transcriptParts.push(payload.speakTranscript.trim());
      }
      setSpeakingTranscript(transcriptParts.length > 0 ? transcriptParts.join("\n\n") : null);

      const grades: SpeakingGradeResponse[] = [];
      const titles: string[] = [];
      if (payload.prepareGrade) {
        grades.push(payload.prepareGrade);
        titles.push("Preparation");
      }
      if (speak) {
        grades.push(speak);
        titles.push("Long turn");
      }
      setSpeakingGrades(grades.length > 0 ? grades : null);
      setSpeakingGradeTitles(titles.length > 0 ? titles : null);
      setSpeakingMarkingText(null);
      setOpenEndedFeedback(null);
      setShowFeedback(true);
    },
    [recordSpeakingResult],
  );

  async function runOcrFromUri(photoUri: string) {
    try {
      setOcrBusy(true);
      setOcrError(null);
      const stem = (q?.questionForGrade ?? q?.questionText ?? "").trim();
      const result = await uploadScanImageWithAiTutor(photoUri, {
        mode: "full",
        subject: routeSubject ?? "Biology",
        question: stem || undefined,
      });
      const text = (result?.text ?? "").trim();
      if (!text) {
        setOcrError(
          result.validationWarning ||
            "No text found in the image. Try a clearer photo of your written answer.",
        );
        return;
      }
      if (stem && ocrLooksLikeQuestionStem(text, stem)) {
        setOcrError(
          "That looks like the question (e.g. BM/EN stem), not your answer. Photo only your handwriting or typed working.",
        );
        return;
      }
      setOpenEndedAnswer(text);
      setShowFeedback(false);
      setOpenEndedFeedback(null);
      // Keep text so the student can edit; still surface topic/quality warnings.
      setOcrError(result.validationWarning ?? null);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "OCR failed. Check your connection and try again.";
      setOcrError(
        /system error has occurred/i.test(raw)
          ? "Scan service is busy. Wait a moment and try again, or type your answer."
          : raw,
      );
    } finally {
      setOcrBusy(false);
    }
  }

  async function ocrTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setOcrError("Camera permission is required to take a photo of your answer.");
      return;
    }
    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await runOcrFromUri(picked.assets[0].uri);
  }

  async function ocrPickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setOcrError("Photo library permission is required to upload an image.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await runOcrFromUri(picked.assets[0].uri);
  }

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (error || total === 0) {
    return (
      <View style={[styles.pad, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.errorText}>{error ?? "No questions in this set."}</Text>
      </View>
    );
  }

  if (finished) {
    const totalEarned = questions.reduce((sum, item) => {
      const r = questionResults[item.id];
      return sum + (r?.earned ?? 0);
    }, 0);
    const totalMax = questions.reduce(
      (sum, item) =>
        sum +
        resolveQuestionMarks(
          item,
          buildQuestionPayloadForGrade(item.questionText, item.questionForGrade, item.explanation),
        ),
      0,
    );

    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text style={styles.doneTitle}>Set complete</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryTotal}>
            Total: {totalEarned}/{totalMax} marks
          </Text>
        </View>
        <Text style={styles.reviewSectionTitle}>Your marks per question</Text>
        {questions.map((item, i) => {
          const maxMarks = resolveQuestionMarks(
            item,
            buildQuestionPayloadForGrade(item.questionText, item.questionForGrade, item.explanation),
          );
          const result = questionResults[item.id];
          const earned = result?.earned;
          const max = result?.max ?? maxMarks;
          const scoreLabel =
            earned === undefined ? `—/${maxMarks}` : `${earned}/${max}`;
          const fullMarks = earned !== undefined && earned >= max;
          const partialMarks = earned !== undefined && earned > 0 && earned < max;
          return (
            <View key={`${item.id}-${i}`} style={styles.reviewRow}>
              <Text style={styles.reviewIndex}>{i + 1}</Text>
              <View style={styles.reviewBody}>
                <Text style={styles.reviewQuestion}>
                  {formatQuestionStemForLangView(item.questionText, questionLangView)}
                </Text>
              </View>
              <Text
                style={[
                  styles.reviewScore,
                  fullMarks && styles.reviewScoreFull,
                  partialMarks && styles.reviewScorePartial,
                  earned === 0 && styles.reviewScoreZero,
                ]}
              >
                {scoreLabel}
              </Text>
            </View>
          );
        })}
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.secondaryBtnText}>Back to sets</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => void load()}>
          <Text style={styles.secondaryBtnText}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const pickedRight = isSelectionCorrect(selected, correctIndices);
  const currentMarkResult = q ? questionResults[q.id] : undefined;
  const feedbackTitle = isMcq
    ? pickedRight
      ? `Correct · ${currentMarkResult ? `${currentMarkResult.earned}/${currentMarkResult.max}` : "1/1"}`
      : `Incorrect · ${currentMarkResult ? `${currentMarkResult.earned}/${currentMarkResult.max}` : "0/1"}`
    : isSpeakingQuestion && part1InterviewSessionScore
      ? `Speaking · ${part1InterviewSessionScore.earned}/${part1InterviewSessionScore.max}`
    : isSpeakingQuestion && currentMarkResult
      ? `Speaking · ${currentMarkResult.earned}/${currentMarkResult.max}`
      : currentMarkResult
      ? `Marked · ${currentMarkResult.earned}/${currentMarkResult.max} marks`
      : "Marked by AI";

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 28,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.questionCard}>
        <Text style={styles.setTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.progressRow}>
          <View style={styles.progressHeaderRow}>
            <Text style={styles.progressText}>
              Question {index + 1} of {total}
            </Text>
            {index > 0 && !isSpeakingPart1Interview ? (
              <Pressable
                style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
                onPress={onPrevious}
                accessibilityLabel="Previous question"
              >
                <ChevronLeft size={18} color={BRAND} strokeWidth={2.5} />
                <Text style={styles.backLinkText}>Previous</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressFillAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </View>

        <Animated.View
          style={{
            opacity: questionFade,
            transform: [{ translateY: questionLift }],
          }}
        >
          <View style={styles.questionMetaRow}>
            <Text style={styles.diffChip} numberOfLines={1}>
              {isSpeakingQuestion ? "English speaking" : q.difficulty}
            </Text>
            <View style={styles.questionMetaTrailing}>
              {showSourceButton ? (
                <Pressable
                  style={({ pressed }) => [styles.sourceInfoBtn, pressed && styles.sourceInfoBtnPressed]}
                  onPress={openSourceModal}
                  accessibilityRole="button"
                  accessibilityLabel="View question source"
                >
                  <Info size={15} color={BRAND} strokeWidth={2.4} />
                  <Text style={styles.sourceInfoBtnText}>Source</Text>
                </Pressable>
              ) : null}
              <View style={styles.marksBadge} accessibilityLabel={`${questionMarks} marks`}>
                <Text style={styles.marksBadgeNum}>{questionMarks}</Text>
                <Text style={styles.marksBadgeLabel}>marks</Text>
              </View>
            </View>
          </View>
          {showLangToggle ? (
            <View style={styles.langToggleRow}>
              {(["en", "bm"] as const).map((mode) => {
                const active = questionLangView === mode;
                const label = mode === "en" ? "EN" : "BM";
                return (
                  <Pressable
                    key={mode}
                    style={({ pressed }) => [
                      styles.langToggleBtn,
                      active && styles.langToggleBtnActive,
                      pressed && styles.langToggleBtnPressed,
                    ]}
                    onPress={() => setQuestionLangView(mode)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show question in ${label}`}
                  >
                    <Text style={[styles.langToggleText, active && styles.langToggleTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {isSpeakingQuestion && !isSpeakingPart2 && !isSpeakingPart1Interview ? (
            <Text style={styles.questionText}>{displayQuestionText}</Text>
          ) : !isSpeakingQuestion ? (
            <MathFormattedText textStyle={styles.questionText}>{displayQuestionText}</MathFormattedText>
          ) : null}

          {!isSpeakingQuestion && q.diagram?.type === "line-chart" ? (
            <View style={styles.diagramWrap}>
              <MathLineChart
                title={q.diagram.title ?? "Math Diagram"}
                subtitle={q.diagram.subtitle ?? "Generated for this question"}
                equationLabel={q.diagram.equationLabel ?? "Graph"}
                xAxisLabel={q.diagram.xAxisLabel ?? "x"}
                yAxisLabel={q.diagram.yAxisLabel ?? "y"}
                points={q.diagram.points}
              />
            </View>
          ) : null}
          {!isSpeakingQuestion && q.diagramImageUrl ? (
            <View style={styles.diagramWrap}>
              <Image
                source={{ uri: q.diagramImageUrl }}
                style={styles.scienceDiagramImage}
                resizeMode="contain"
                accessibilityLabel="Educational diagram for this question"
              />
            </View>
          ) : null}

          {isSpeakingQuestion && !speakingCompleted ? (
        isSpeakingPart2 ? (
          <EnglishSpeakingPart2Exam
            key={q.id}
            questionText={q.questionText}
            sortOrder={q.sortOrder}
            subject={speakingSubject}
            formLevel={speakingForm}
            onExamComplete={onSpeakingPart2Complete}
          />
        ) : isSpeakingPart1Interview && part1InterviewBlock ? (
          <EnglishSpeakingPart1InterviewExam
            key={`part1-interview-${part1InterviewBlock.startIndex}`}
            questions={part1InterviewBlock.questions.map((item) => ({
              id: item.id,
              text: item.questionText,
            }))}
            subject={speakingSubject}
            formLevel={speakingForm}
            skipToIndex={part1InterviewBlock.endIndex + 1}
            onSessionComplete={onSpeakingPart1InterviewComplete}
            onActiveQuestionIndexChange={onSpeakingPart1InterviewQuestionChange}
          />
        ) : isPart1InterviewFollower ? (
          <Text style={styles.speakingFollowerHint}>
            This question is part of the Part 1 interview on question {part1InterviewBlock!.startIndex + 1}.
            Tap Next to continue.
          </Text>
        ) : (
          <EnglishSpeakingPart1Exam
            key={q.id}
            questionText={q.questionText}
            subject={speakingSubject}
            formLevel={speakingForm}
            onGraded={onSpeakingPart1Graded}
          />
        )
          ) : null}

          {!isSpeakingQuestion && isMcq && multiSelect ? (
        <Text style={styles.multiHint}>Select all answers that apply.</Text>
      ) : null}

      {!isSpeakingQuestion && isMcq && q.options.length > 0 ? (
        <View style={styles.optionsGrid}>
          {q.options.map((opt, i) => {
            const displayOpt = formatOptionForLangView(opt, questionLangView);
            const matrixOption = isMatrixOnlyOption(displayOpt);
            const on = selected.has(i);
            const isCorrectOption = correctIndices.has(i);
            let border = "rgba(15, 23, 42, 0.12)";
            let bg = "#FFFFFF";
            if (showFeedback) {
              if (isCorrectOption) {
                border = "#22C55E";
                bg = "#ECFDF5";
              } else if (on && !isCorrectOption) {
                border = "#EF4444";
                bg = "#FEF2F2";
              }
            } else if (on) {
              border = BRAND;
              bg = theme.brandSoftSage;
            }
            return (
              <Pressable
                key={i}
                style={[
                  styles.optionTile,
                  matrixOption && styles.optionTileMatrix,
                  {
                    borderColor: border,
                    backgroundColor: bg,
                    marginBottom: 12,
                  },
                ]}
                onPress={() => !showFeedback && onToggleOption(i)}
                disabled={showFeedback}
              >
                <MathFormattedText textStyle={styles.optionTileLabel} matrixCompact>
                  {displayOpt}
                </MathFormattedText>
              </Pressable>
            );
          })}
        </View>
      ) : !isSpeakingQuestion && isMcq && q.options.length === 0 ? (
        <Text style={styles.unsupported}>No answer choices were loaded for this question.</Text>
      ) : !isSpeakingQuestion ? (
        <View style={styles.openEndedWrap}>
          <Text style={styles.openEndedLabel}>Your answer</Text>
          <TextInput
            value={openEndedAnswer}
            onChangeText={setOpenEndedAnswer}
            placeholder="Type your answer, or scan it with the options below"
            placeholderTextColor="#94A3B8"
            style={[styles.openEndedInput, isReviewMode && styles.openEndedInputReadOnly]}
            multiline
            textAlignVertical="top"
            editable={!isReviewMode}
          />

          {!isReviewMode ? (
          <>
          <View style={styles.ocrButtonsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.ocrCard,
                styles.ocrCardCamera,
                pressed && !ocrBusy && styles.ocrCardPressed,
                ocrBusy && styles.ocrCardDisabled,
              ]}
              onPress={() => void ocrTakePhoto()}
              disabled={ocrBusy}
            >
              <LinearGradient
                colors={[BRAND, theme.brandDeep]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ocrIconBadge}
              >
                {ocrBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Camera size={18} color="#FFFFFF" strokeWidth={2.2} />
                )}
              </LinearGradient>
              <Text style={styles.ocrCardTitle}>{ocrBusy ? "Scanning…" : "Take photo"}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.ocrCard,
                styles.ocrCardUpload,
                pressed && !ocrBusy && styles.ocrCardPressed,
                ocrBusy && styles.ocrCardDisabled,
              ]}
              onPress={() => void ocrPickImage()}
              disabled={ocrBusy}
            >
              <View style={[styles.ocrIconBadge, styles.ocrIconBadgeUpload]}>
                {ocrBusy ? (
                  <ActivityIndicator size="small" color={BRAND} />
                ) : (
                  <ImageUp size={18} color={BRAND} strokeWidth={2.2} />
                )}
              </View>
              <Text style={styles.ocrCardTitle}>{ocrBusy ? "Scanning…" : "Upload image"}</Text>
            </Pressable>
          </View>
          {ocrBusy ? (
            <View style={styles.ocrStatusRow}>
              <ActivityIndicator size="small" color={BRAND} />
              <Text style={styles.ocrStatusText}>Reading text from your image…</Text>
            </View>
          ) : null}
          {ocrError ? <Text style={styles.ocrErrorText}>{ocrError}</Text> : null}
          </>
          ) : null}
        </View>
      ) : null}
        </Animated.View>
      </View>

      {showSpeakingFeedbackPanel ? (
        <Animated.View
          style={[
            styles.feedback,
            {
              opacity: feedbackFade,
              transform: [{ translateY: feedbackLift }],
            },
          ]}
        >
          <Text style={[styles.feedbackTitle, isMcq ? (pickedRight ? styles.ok : styles.bad) : styles.ok]}>
            {feedbackTitle}
          </Text>
          {isSpeakingQuestion ? (
            <SpeakingFeedbackPanel
              transcript={speakingTranscript}
              markingText={speakingMarkingText}
              grades={speakingGrades}
              gradeTitles={speakingGradeTitles}
              transcriptResetKey={q?.id ?? index}
            />
          ) : openEndedFeedback ? (
            openEndedFeedback.showCalculationLayout ? (
              <>
                {openEndedFeedback.feedback ? (
                  <Text style={styles.explanation}>{openEndedFeedback.feedback}</Text>
                ) : null}
                {openEndedFeedback.calcMarkPoints && openEndedFeedback.calcMarkPoints.length > 0 ? (
                  <View style={styles.modelPointsSection}>
                    <Text style={styles.modelPointsTitle}>
                      Marking stages · {openEndedFeedback.maxScore} mark
                      {openEndedFeedback.maxScore === 1 ? "" : "s"}
                    </Text>
                    {openEndedFeedback.calcMarkPoints.map((point, i) => (
                      <View key={i} style={styles.modelPointRow}>
                        <View
                          style={[
                            styles.modelPointBadge,
                            typeof point.awarded === "boolean"
                              ? point.awarded
                                ? styles.modelPointBadgeOk
                                : styles.modelPointBadgeBad
                              : null,
                          ]}
                        >
                          <Text style={styles.modelPointBadgeText}>
                            {typeof point.awarded === "boolean" ? (point.awarded ? "✓" : "✗") : String(i + 1)}
                          </Text>
                        </View>
                        <View style={styles.modelPointBody}>
                          <Text style={styles.modelPointMark}>
                            {formatMarkLabel(point.marks)}
                            {typeof point.awarded === "boolean"
                              ? point.awarded
                                ? " · awarded"
                                : " · missing"
                              : ""}
                          </Text>
                          <Text style={styles.modelPointText}>{point.text}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
                {openEndedFeedback.modelAnswerRaw ? (
                  <View style={styles.calcModelSection}>
                    <Text style={styles.calcModelTitle}>Model answer</Text>
                    <View style={styles.calcModelCard}>
                      <CalculationStepsView text={openEndedFeedback.modelAnswerRaw} />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {openEndedFeedback.modelPoints.length > 0 ? (
                  <View style={styles.modelPointsSection}>
                    <Text style={styles.modelPointsTitle}>
                      Model answer · {openEndedFeedback.maxScore} mark
                      {openEndedFeedback.maxScore === 1 ? "" : "s"}
                    </Text>
                    {openEndedFeedback.modelPoints.map((point, i) => (
                      <View key={i} style={styles.modelPointRow}>
                        <View
                          style={[
                            styles.modelPointBadge,
                            typeof point.awarded === "boolean"
                              ? point.awarded
                                ? styles.modelPointBadgeOk
                                : styles.modelPointBadgeBad
                              : null,
                          ]}
                        >
                          <Text style={styles.modelPointBadgeText}>
                            {typeof point.awarded === "boolean" ? (point.awarded ? "✓" : "✗") : String(i + 1)}
                          </Text>
                        </View>
                        <View style={styles.modelPointBody}>
                          <Text style={styles.modelPointMark}>
                            {formatMarkLabel(point.marks)}
                            {typeof point.awarded === "boolean"
                              ? point.awarded
                                ? " · awarded"
                                : " · missing"
                              : ""}
                          </Text>
                          <Text style={styles.modelPointText}>{point.text}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )
          ) : q.explanation ? (
            <Text style={styles.explanation}>{q.explanation}</Text>
          ) : null}
        </Animated.View>
      ) : null}

      {!showFeedback && !speakingReadyForNext && !isSpeakingQuestion ? (
        <Pressable
          style={[styles.primaryBtn, selected.size === 0 && styles.primaryBtnOff]}
          disabled={isMcq ? selected.size === 0 : openEndedAnswer.trim().length === 0 || openEndedMarkingBusy}
          onPress={isMcq ? onCheck : () => void submitOpenEndedForMarking()}
        >
          <LinearGradient
            colors={
              isMcq
                ? (selected.size > 0 ? [...theme.gradientCta] : ["#A1A1AA", "#9CA3AF"])
                : (openEndedAnswer.trim().length > 0 && !openEndedMarkingBusy
                    ? [...theme.gradientCta]
                    : ["#A1A1AA", "#9CA3AF"])
            }
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryGrad}
          >
            {isMcq ? <Check size={18} color="#FFFFFF" strokeWidth={2.5} /> : null}
            <Text style={styles.primaryBtnText}>
              {isMcq ? "Check answer" : openEndedMarkingBusy ? "Marking..." : "Submit for marking"}
            </Text>
          </LinearGradient>
        </Pressable>
      ) : speakingReadyForNext || showFeedback ? (
        index > 0 ? (
          <View style={styles.navFooter}>
            <Pressable
              style={({ pressed }) => [styles.secondaryNavBtn, pressed && styles.secondaryNavBtnPressed]}
              onPress={onPrevious}
            >
              <ChevronLeft size={18} color={BRAND} strokeWidth={2.5} />
              <Text style={styles.secondaryNavBtnText}>Previous</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, styles.primaryBtnFlex]} onPress={onNext}>
              <LinearGradient
                colors={[...theme.gradientCta]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.primaryGrad}
              >
                <Text style={styles.primaryBtnText}>
                  {index + 1 >= plannedQuestionTotal && !openEndedBgBusy ? "See results" : "Next question"}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={onNext}>
            <LinearGradient
              colors={[...theme.gradientCta]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryGrad}
            >
              <Text style={styles.primaryBtnText}>
                {index + 1 >= plannedQuestionTotal && !openEndedBgBusy ? "See results" : "Next question"}
              </Text>
            </LinearGradient>
          </Pressable>
        )
      ) : null}
    </ScrollView>

    <Modal
      transparent
      visible={sourceModalOpen}
      animationType="slide"
      onRequestClose={() => setSourceModalOpen(false)}
    >
      <Pressable style={styles.sourceModalBackdrop} onPress={() => setSourceModalOpen(false)}>
        <Pressable style={[styles.sourceModalCard, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <View style={styles.sourceModalHandle} />
          <Text style={styles.sourceModalTitle}>Sumber / Source</Text>
          <Text style={styles.sourceModalSubtitle}>
            Textbook or past-paper material used to generate this AI practice question.
          </Text>
          {displaySourceLabel ? (
            <Text style={styles.sourceModalSummary} selectable>
              {displaySourceLabel}
            </Text>
          ) : null}
          <ScrollView
            style={styles.sourceModalScroll}
            contentContainerStyle={styles.sourceModalScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {displaySources.length > 0 ? (
              displaySources.map((source, sourceIndex) => (
                <View key={`${source.label}-${sourceIndex}`} style={styles.sourceModalItem}>
                  <Text style={styles.sourceModalItemType}>
                    {source.sourceType === "past_paper" ? "Past year paper" : "Textbook"}
                  </Text>
                  <Text style={styles.sourceModalItemLabel} selectable>
                    {source.label}
                  </Text>
                  {source.excerpt?.trim() ? (
                    <Text style={styles.sourceModalExcerpt} selectable>
                      {source.excerpt.trim()}
                    </Text>
                  ) : null}
                </View>
              ))
            ) : displaySourceLabel ? null : (
              <Text style={styles.sourceModalEmpty}>
                No textbook or past-paper source was recorded for this session. Reload the app, generate a
                new AI practice set, then tap Source again.
              </Text>
            )}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.sourceModalCloseBtn, pressed && styles.sourceInfoBtnPressed]}
            onPress={() => setSourceModalOpen(false)}
          >
            <Text style={styles.sourceModalCloseBtnText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  pad: { paddingHorizontal: 20, flex: 1 },
  centered: { flex: 1, alignItems: "center", backgroundColor: colors.screenBackground },
  questionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    marginBottom: 14,
  },
  questionCardInterview: {
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    shadowOpacity: 0,
    elevation: 0,
    marginBottom: 0,
  },
  setTitle: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
  },
  progressRow: { marginBottom: 16 },
  progressHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    flex: 1,
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backLinkPressed: { opacity: 0.7 },
  backLinkText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
  },
  questionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  diffChip: {
    flex: 1,
    flexShrink: 1,
    fontSize: 11,
    fontFamily: fonts.bold,
    color: BRAND,
    textTransform: "capitalize",
    marginRight: 8,
  },
  questionMetaTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  sourceInfoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#DDE8DF",
    borderWidth: 1.5,
    borderColor: BRAND,
  },
  sourceInfoBtnPressed: {
    opacity: 0.85,
  },
  sourceInfoBtnText: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  marksBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: theme.brandSoftSage,
    borderWidth: 1,
    borderColor: "rgba(152, 168, 105, 0.35)",
  },
  marksBadgeNum: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: theme.brandDeep,
    lineHeight: 20,
  },
  marksBadgeLabel: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: BRAND,
    lineHeight: 16,
  },
  langToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  langToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    backgroundColor: "#F8FAFC",
  },
  langToggleBtnActive: {
    borderColor: BRAND,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
  },
  langToggleBtnPressed: {
    opacity: 0.85,
  },
  langToggleText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
  },
  langToggleTextActive: {
    color: colors.text,
    fontFamily: fonts.bold,
  },
  questionText: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    lineHeight: 26,
    marginBottom: 16,
  },
  sourceModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sourceModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "78%",
  },
  sourceModalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(15, 23, 42, 0.15)",
    marginBottom: 14,
  },
  sourceModalTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 6,
  },
  sourceModalSubtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  sourceModalSummary: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: "#274A2A",
    lineHeight: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#DDE8DF",
  },
  sourceModalScroll: {
    maxHeight: 320,
  },
  sourceModalScrollContent: {
    paddingBottom: 8,
    gap: 10,
  },
  sourceModalItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F8FAF8",
    borderWidth: 1,
    borderColor: "rgba(39, 74, 42, 0.12)",
  },
  sourceModalItemType: {
    fontSize: 10,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  sourceModalItemLabel: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    lineHeight: 20,
    marginBottom: 6,
  },
  sourceModalExcerpt: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  sourceModalEmpty: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sourceModalCloseBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: BRAND,
    alignItems: "center",
  },
  sourceModalCloseBtnText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: "#FFFFFF",
  },
  diagramWrap: {
    marginBottom: 16,
  },
  scienceDiagramImage: {
    width: "100%",
    height: 280,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "flex-start",
    justifyContent: "space-between",
  },
  optionTile: {
    flexBasis: "48%",
    minHeight: 92,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  optionTileMatrix: {
    minHeight: 108,
    paddingVertical: 10,
  },
  optionTileLabel: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  unsupported: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  speakingFollowerHint: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  openEndedWrap: {
    marginBottom: 8,
  },
  openEndedLabel: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  openEndedInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.14)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    backgroundColor: "#FFFFFF",
  },
  openEndedInputReadOnly: {
    backgroundColor: "#F8FAFC",
    color: colors.textSecondary,
  },
  navFooter: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  secondaryNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 108,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    backgroundColor: "#FFFFFF",
  },
  secondaryNavBtnPressed: { opacity: 0.85 },
  secondaryNavBtnText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  primaryBtnFlex: { flex: 1 },
  ocrButtonsRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  ocrCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    backgroundColor: "#FFFFFF",
  },
  ocrCardCamera: {
    backgroundColor: theme.brandSoft,
    borderColor: "rgba(227, 83, 54, 0.16)",
  },
  ocrCardUpload: {
    backgroundColor: theme.brandSoftSage,
    borderColor: "rgba(152, 168, 105, 0.22)",
  },
  ocrCardPressed: {
    opacity: 0.9,
  },
  ocrCardDisabled: {
    opacity: 0.7,
  },
  ocrIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  ocrIconBadgeUpload: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: theme.brandSecondary,
  },
  ocrCardTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
  },
  ocrStatusRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ocrStatusText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  ocrErrorText: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: fonts.medium,
    color: "#DC2626",
    lineHeight: 18,
  },
  feedback: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
  },
  feedbackTitle: { fontSize: 16, fontFamily: fonts.bold },
  ok: { color: "#166534" },
  bad: { color: "#B91C1C" },
  explanation: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
    marginTop: 8,
  },
  modelPointsSection: {
    marginTop: 14,
    gap: 8,
  },
  modelPointsTitle: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  modelPointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  modelPointBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.brandSoftSage,
    borderWidth: 1,
    borderColor: "rgba(152, 168, 105, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  modelPointBadgeOk: {
    backgroundColor: "rgba(22, 163, 74, 0.15)",
    borderColor: "rgba(22, 163, 74, 0.45)",
  },
  modelPointBadgeBad: {
    backgroundColor: "rgba(220, 38, 38, 0.12)",
    borderColor: "rgba(220, 38, 38, 0.4)",
  },
  modelPointBadgeText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: theme.brandDeep,
  },
  modelPointBody: {
    flex: 1,
    gap: 2,
  },
  modelPointMark: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: BRAND,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modelPointText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    lineHeight: 21,
  },
  calcModelSection: {
    marginTop: 14,
    gap: 8,
  },
  calcModelTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: BRAND,
  },
  calcModelCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    padding: 14,
  },
  primaryBtn: { marginTop: 22, borderRadius: 16, overflow: "hidden" },
  primaryBtnOff: { opacity: 0.95 },
  primaryGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  primaryBtnText: { fontSize: 16, fontFamily: fonts.bold, color: "#FFFFFF" },
  doneTitle: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 20,
  },
  summaryRow: { marginBottom: 20 },
  summaryTotal: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: BRAND,
  },
  reviewSectionTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: BRAND,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
  },
  reviewIndex: {
    width: 22,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: BRAND,
    marginTop: 2,
  },
  reviewBody: {
    flex: 1,
    minWidth: 0,
  },
  reviewQuestion: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 20,
  },
  reviewScore: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
    marginTop: 2,
    minWidth: 44,
    textAlign: "right",
  },
  reviewScoreFull: {
    color: "#166534",
  },
  reviewScorePartial: {
    color: "#B45309",
  },
  reviewScoreZero: {
    color: "#B91C1C",
  },
  multiHint: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 12,
    marginTop: -4,
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.1)",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
});
