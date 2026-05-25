import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Camera, Check, ImageUp } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import { MathLineChart } from "../components/math/MathLineChart";
import { AnimalCellDiagramWithLabels } from "../components/biology/AnimalCellDiagramWithLabels";
import { LabeledAnimalCellDiagram } from "../components/biology/LabeledAnimalCellDiagram";
import { MathFormattedText } from "../components/math/MathFormattedText";
import {
  inferOrganelleHighlights,
  isBiologySubject,
  shouldShowLabeledCellDiagram,
} from "../utils/biologyDiagramHighlights";
import { isMatrixOnlyOption } from "../utils/parseMatrixNotation";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  fetchPracticeSetDetail,
  formatQuestionWithMarksAtEnd,
  resolveQuestionMarks,
  type PracticeSetQuestion,
} from "../services/mobilePracticeSets";
import { ragApiPost } from "../services/ragApi";
import { uploadScanImageWithAiTutor } from "../services/mobileScan";
import { EnglishSpeakingPart1Exam } from "../components/EnglishSpeakingPart1Exam";
import { EnglishSpeakingPart2Exam } from "../components/EnglishSpeakingPart2Exam";
import { SpeakingFeedbackPanel } from "../components/SpeakingFeedbackPanel";
import {
  formatSpeakingGradeSummary,
  type SpeakingGradeResponse,
} from "../services/mobileSpeaking";

const BRAND = theme.brand;

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

/** True when OCR text is almost certainly the displayed question, not a student answer. */
function ocrLooksLikeQuestionStem(ocrText: string, questionText: string): boolean {
  const o = normalizeOcrCompare(ocrText);
  const q = normalizeOcrCompare(questionText);
  if (!o || !q || o.length < 16) return false;
  if (o === q) return true;
  if (q.length >= 24 && o.includes(q)) return true;
  const bmLine = questionText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^bm\s*:/i.test(l))
    ?.replace(/^bm\s*:\s*/i, "")
    .trim();
  if (bmLine) {
    const b = normalizeOcrCompare(bmLine);
    if (b.length >= 16 && (o === b || o.includes(b) || b.includes(o))) return true;
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
function resolveOpenEndedMaxScore(q: PracticeSetQuestion, questionForGrade: string): number {
  return resolveQuestionMarks(q, questionForGrade);
}

function stripModelAnswerLabel(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  return text.replace(/^Model answer(?:\s*\/\s*Jawapan model)?\s*:\s*/i, "").trim();
}

function openEndedFeedbackOnly(
  result: { feedback?: string } | null | undefined,
): string {
  const feedback = (result?.feedback ?? "").trim();
  return feedback || "No feedback returned.";
}

type QuestionMarkResult = {
  earned: number;
  max: number;
};

function isSpeakingQuestionType(questionType: string | null | undefined): boolean {
  const t = (questionType ?? "").toLowerCase();
  return t === "speaking_part1" || t === "speaking_part2" || t === "speaking_part3";
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
      };
  const hasQuestions = "questions" in routeParams && Array.isArray(routeParams.questions);
  const initialQuestions = hasQuestions ? routeParams.questions : [];
  const practiceMode = routeParams.practiceMode;

  const setId = "setId" in routeParams ? routeParams.setId : undefined;
  const { title } = routeParams;
  const routeSubject = routeParams.subject;
  const routeFormLevel = routeParams.formLevel;

  const [loading, setLoading] = useState(!hasQuestions);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeSetQuestion[]>(initialQuestions);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [questionResults, setQuestionResults] = useState<Record<number, QuestionMarkResult>>({});
  const [finished, setFinished] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedbackText, setAiFeedbackText] = useState<string | null>(null);
  const [gradeModelAnswer, setGradeModelAnswer] = useState<string | null>(null);
  const [modelAnswerExpanded, setModelAnswerExpanded] = useState(false);
  const [openEndedAnswer, setOpenEndedAnswer] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [openEndedMarkingBusy, setOpenEndedMarkingBusy] = useState(false);
  const [speakingReadyForNext, setSpeakingReadyForNext] = useState(false);
  const [speakingTranscript, setSpeakingTranscript] = useState<string | null>(null);
  const [speakingMarkingText, setSpeakingMarkingText] = useState<string | null>(null);

  const questionFade = useRef(new Animated.Value(1)).current;
  const questionLift = useRef(new Animated.Value(0)).current;
  const progressFillAnim = useRef(new Animated.Value(0)).current;
  const feedbackFade = useRef(new Animated.Value(0)).current;
  const feedbackLift = useRef(new Animated.Value(8)).current;
  const skipQuestionEnterAnim = useRef(true);

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
    navigation.setOptions({ title: title || "Practice" });
  }, [navigation, title]);

  useEffect(() => {
    const len = questions.length;
    if (len === 0) return;
    const target = (index + 1) / len;
    progressFillAnim.stopAnimation();
    Animated.spring(progressFillAnim, {
      toValue: target,
      useNativeDriver: false,
      friction: 14,
      tension: 100,
    }).start();
  }, [index, questions.length, progressFillAnim]);

  useEffect(() => {
    setSpeakingReadyForNext(false);
    setSpeakingTranscript(null);
    setSpeakingMarkingText(null);
    setOpenEndedAnswer("");
    setShowFeedback(false);
    setAiFeedbackText(null);
    setGradeModelAnswer(null);
    setModelAnswerExpanded(false);
    setOcrError(null);
  }, [index, questions[index]?.id]);

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
  const speakingSubject = routeSubject ?? "English";
  const speakingForm = routeFormLevel ?? "Form 4";
  const isSpeakingQuestion =
    practiceMode === "speaking" || (q ? isSpeakingQuestionType(q.questionType) : false);
  const isSpeakingPart2 =
    isSpeakingQuestion && (q?.questionType ?? "").toLowerCase() === "speaking_part2";
  const isMcq =
    q &&
    !isSpeakingQuestion &&
    ((q.options?.length ?? 0) > 0 ||
      /multiple_choice|mcq|choice/i.test(q.questionType ?? ""));

  const correctIndices = q && isMcq ? parseCorrectIndices(q.correctAnswer, q.options.length) : new Set<number>();
  const multiSelect = q && isMcq ? questionAllowsMultiSelect(q, correctIndices) : false;
  const questionForGradeStem = q ? (q.questionForGrade ?? q.questionText).trim() : "";
  const questionMarks = q ? resolveQuestionMarks(q, questionForGradeStem) : 1;
  const displayQuestionText = q
    ? formatQuestionWithMarksAtEnd(q.questionText, questionMarks)
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
      setAiBusy(false);
      setAiFeedbackText(null);
      setShowFeedback(true);
      return;
    }
    if (selected.size === 0) return;
    setAiBusy(false);
    setAiFeedbackText(null);
    const ok = isSelectionCorrect(selected, correctIndices);
    const maxMarks = resolveQuestionMarks(q, q.questionForGrade ?? q.questionText);
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
      setAiFeedbackText("Please write an answer (or use OCR) before submitting.");
      setShowFeedback(true);
      return;
    }

    const subject = routeSubject ?? "Biology";
    const form = routeFormLevel ?? "Form 4";
    const questionForGrade = (q.questionForGrade ?? q.questionText).trim();
    const requestedMaxScore = resolveOpenEndedMaxScore(q, questionForGrade);

    try {
      setOpenEndedMarkingBusy(true);
      setAiFeedbackText(null);
      setGradeModelAnswer(null);
      setModelAnswerExpanded(false);
      const result = await ragApiPost<any>("/rag/grade", {
        question: questionForGrade,
        studentAnswer,
        subject,
        form,
        topK: 8,
        maxScore: requestedMaxScore,
        rubricId: q.rubricId ?? undefined,
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
      const earnedClamped = Math.min(earned, maxMarks);
      const modelAnswer = stripModelAnswerLabel(result?.modelAnswer);
      const showModelAnswer = earnedClamped < maxMarks && modelAnswer.length > 0;
      setGradeModelAnswer(showModelAnswer ? modelAnswer : null);
      setModelAnswerExpanded(showModelAnswer);
      setAiFeedbackText(openEndedFeedbackOnly(result));
      setShowFeedback(true);
    } catch (e) {
      setAiFeedbackText(e instanceof Error ? e.message : "Failed to grade your answer.");
      setShowFeedback(true);
    } finally {
      setOpenEndedMarkingBusy(false);
    }
  }

  const onNext = () => {
    setAiDrawerOpen(false);
    setAiBusy(false);
    setAiFeedbackText(null);
    setGradeModelAnswer(null);
    setModelAnswerExpanded(false);
    setOpenEndedAnswer("");
    setOcrBusy(false);
    setSpeakingReadyForNext(false);
    setSpeakingTranscript(null);
    setSpeakingMarkingText(null);
    if (index + 1 >= total) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(new Set());
    setShowFeedback(false);
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
      setSpeakingMarkingText(formatSpeakingGradeSummary(result));
      setAiFeedbackText(null);
      setShowFeedback(true);
    },
    [recordSpeakingResult],
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

      const markingParts: string[] = [];
      if (payload.prepareGrade) {
        markingParts.push(formatSpeakingGradeSummary(payload.prepareGrade));
      }
      if (speak) {
        markingParts.push(formatSpeakingGradeSummary(speak));
      }
      setSpeakingMarkingText(markingParts.length > 0 ? markingParts.join("\n\n\n") : null);
      setAiFeedbackText(null);
      setShowFeedback(true);
    },
    [recordSpeakingResult],
  );

  async function askAiForExplanation() {
    if (!q || !isMcq) return;
    if (selected.size === 0) return;

    const selectedLetter = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => String.fromCharCode(65 + i))
      .slice(0, 1)
      .join("");

    const questionForGrade = q.questionForGrade
      ? q.questionForGrade
      : [
          q.questionText.trim(),
          ...q.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`),
        ].join("\n");

    const subject = routeSubject ?? "Biology";
    const form = routeFormLevel ?? "Form 4";

    try {
      setAiBusy(true);
      setAiFeedbackText(null);
      setAiDrawerOpen(true);

      const result = await ragApiPost<any>("/rag/grade", {
        question: questionForGrade,
        studentAnswer: selectedLetter,
        subject,
        form,
        topK: 8,
        maxScore: 1,
      });

      setAiFeedbackText(result?.feedback ?? result?.modelAnswer ?? "No feedback returned.");
    } catch (e) {
      setAiFeedbackText(e instanceof Error ? e.message : "Failed to get AI feedback.");
    } finally {
      setAiBusy(false);
    }
  }

  async function runOcrFromUri(photoUri: string) {
    try {
      setOcrBusy(true);
      setOcrError(null);
      const result = await uploadScanImageWithAiTutor(photoUri, {
        mode: "extract",
        subject: routeSubject ?? "Biology",
      });
      const text = (result?.text ?? "").trim();
      if (!text) {
        setOcrError("No text found in the image. Try a clearer photo of your written answer.");
        return;
      }
      const stem = (q?.questionText ?? "").trim();
      if (stem && ocrLooksLikeQuestionStem(text, stem)) {
        setOcrError(
          "That looks like the question, not your answer. Photo only your handwriting or typed working.",
        );
        return;
      }
      setOpenEndedAnswer(text);
      setShowFeedback(false);
      setAiFeedbackText(null);
      setOcrError(null);
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
      (sum, item) => sum + resolveQuestionMarks(item, item.questionForGrade ?? item.questionText),
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
          const maxMarks = resolveQuestionMarks(item, item.questionForGrade ?? item.questionText);
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
                  {formatQuestionWithMarksAtEnd(item.questionText, maxMarks)}
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
          <Text style={styles.progressText}>
            Question {index + 1} of {total}
          </Text>
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
          <Text style={styles.diffChip}>
            {isSpeakingQuestion ? "English speaking" : q.difficulty}
          </Text>
          {isSpeakingQuestion && !isSpeakingPart2 ? (
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
          {!isSpeakingQuestion && isBiologySubject(routeSubject) && shouldShowLabeledCellDiagram(q.questionText) ? (
            <View style={styles.diagramWrap}>
              {q.diagramImageUrl ? (
                <AnimalCellDiagramWithLabels
                  imageUrl={q.diagramImageUrl}
                  highlights={inferOrganelleHighlights(q.questionText)}
                />
              ) : (
                <LabeledAnimalCellDiagram highlights={inferOrganelleHighlights(q.questionText)} />
              )}
            </View>
          ) : !isSpeakingQuestion && q.diagramImageUrl ? (
            <View style={styles.diagramWrap}>
              <Image
                source={{ uri: q.diagramImageUrl }}
                style={styles.scienceDiagramImage}
                resizeMode="contain"
                accessibilityLabel="Educational diagram for this question"
              />
            </View>
          ) : null}

          {isSpeakingQuestion ? (
        isSpeakingPart2 ? (
          <EnglishSpeakingPart2Exam
            key={q.id}
            questionText={q.questionText}
            sortOrder={q.sortOrder}
            subject={speakingSubject}
            formLevel={speakingForm}
            onExamComplete={onSpeakingPart2Complete}
          />
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
            const matrixOption = isMatrixOnlyOption(opt);
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
                  {opt}
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
            style={styles.openEndedInput}
            multiline
            textAlignVertical="top"
          />

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
        </View>
      ) : null}
        </Animated.View>
      </View>

      {showFeedback || (isSpeakingQuestion && speakingReadyForNext) ? (
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
            />
          ) : (aiFeedbackText || q.explanation) ? (
            <Text style={styles.explanation}>{aiFeedbackText ?? q.explanation}</Text>
          ) : null}
          {!isSpeakingQuestion && gradeModelAnswer ? (
            <Pressable
              style={({ pressed }) => [
                styles.modelAnswerCard,
                pressed && styles.askAiButtonPressed,
              ]}
              onPress={() => setModelAnswerExpanded((open) => !open)}
            >
              <Text style={styles.askAiButtonText}>
                {modelAnswerExpanded ? "Model answer" : "View model answer"}
              </Text>
              {modelAnswerExpanded ? (
                <Text style={styles.modelAnswerBody}>{gradeModelAnswer}</Text>
              ) : null}
            </Pressable>
          ) : !isSpeakingQuestion && isMcq ? (
            <Pressable
              style={({ pressed }) => [styles.askAiButton, pressed && styles.askAiButtonPressed]}
              onPress={() => void askAiForExplanation()}
            >
              <Text style={styles.askAiButtonText}>Ask AI why</Text>
            </Pressable>
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
        <Pressable style={styles.primaryBtn} onPress={onNext}>
          <LinearGradient
            colors={[...theme.gradientCta]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryGrad}
          >
            <Text style={styles.primaryBtnText}>
              {index + 1 >= total ? "See results" : "Next question"}
            </Text>
          </LinearGradient>
        </Pressable>
      ) : null}
    </ScrollView>

    <Modal
      transparent
      visible={aiDrawerOpen}
      animationType="slide"
      onRequestClose={() => setAiDrawerOpen(false)}
    >
      <Pressable style={styles.aiDrawerBackdrop} onPress={() => setAiDrawerOpen(false)}>
        <Pressable
          style={[styles.aiDrawerSheet, { paddingBottom: insets.bottom + 20 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.aiDrawerTitle}>AI explanation</Text>
          <Text style={styles.aiDrawerBody}>
            {aiBusy ? "Grading with AI..." : aiFeedbackText ?? "Press again to get AI feedback."}
          </Text>
          <Pressable style={styles.aiDrawerClose} onPress={() => setAiDrawerOpen(false)}>
            <Text style={styles.aiDrawerCloseText}>Close</Text>
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
  progressText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    marginBottom: 8,
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
  diffChip: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontFamily: fonts.bold,
    color: BRAND,
    textTransform: "capitalize",
    marginBottom: 10,
  },
  questionText: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    lineHeight: 26,
    marginBottom: 16,
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
  askAiButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.14)",
    backgroundColor: "#FFFFFF",
  },
  modelAnswerCard: {
    alignSelf: "stretch",
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.14)",
    backgroundColor: "#FFFFFF",
  },
  modelAnswerBody: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  askAiButtonPressed: { opacity: 0.85 },
  askAiButtonText: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  aiDrawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  aiDrawerSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  aiDrawerTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 10,
  },
  aiDrawerBody: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 22,
    height: 300,
  },
  aiDrawerClose: {
    marginTop: 24,
    alignSelf: "center",
    paddingVertical: 12,
  },
  aiDrawerCloseText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: BRAND,
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
