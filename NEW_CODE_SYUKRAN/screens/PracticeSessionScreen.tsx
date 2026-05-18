import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { Check } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  fetchPracticeSetDetail,
  inferQuestionMaxMarks,
  type PracticeSetQuestion,
} from "../services/mobilePracticeSets";
import { ragApiPost } from "../services/ragApi";
import { uploadScanImageWithAiTutor } from "../services/mobileScan";

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

function isSelectionCorrect(selected: Set<number>, correct: Set<number>): boolean {
  if (selected.size !== correct.size || correct.size === 0) return false;
  for (const i of correct) {
    if (!selected.has(i)) return false;
  }
  return true;
}

/** maxScore for /rag/grade (open-ended): question.maxMarks from API, else "(N marks)" in stem, else 5. */
function resolveOpenEndedMaxScore(q: PracticeSetQuestion, questionForGrade: string): number {
  const fromApi = q.maxMarks;
  if (typeof fromApi === "number" && Number.isFinite(fromApi)) {
    const n = Math.floor(fromApi);
    if (n >= 1 && n <= 20) return n;
  }
  const inferred =
    inferQuestionMaxMarks(questionForGrade) ?? inferQuestionMaxMarks(q.questionText.trim());
  if (inferred !== null) return inferred;
  return 5;
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
    | { setId: number; title: string; subject?: string; formLevel?: string }
    | { title: string; questions: PracticeSetQuestion[]; subject?: string; formLevel?: string };
  const hasQuestions = "questions" in routeParams && Array.isArray(routeParams.questions);
  const initialQuestions = hasQuestions ? routeParams.questions : [];

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
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedbackText, setAiFeedbackText] = useState<string | null>(null);
  const [openEndedAnswer, setOpenEndedAnswer] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [openEndedMarkingBusy, setOpenEndedMarkingBusy] = useState(false);

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
      setScore(0);
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
      setLoading(false);
      return;
    }
    void load();
  }, [load, hasQuestions]);

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
  const isMcq =
    q &&
    ((q.options?.length ?? 0) > 0 ||
      /multiple_choice|mcq|choice/i.test(q.questionType ?? ""));

  const correctIndices = q && isMcq ? parseCorrectIndices(q.correctAnswer, q.options.length) : new Set<number>();
  const multiSelect = q && isMcq ? questionAllowsMultiSelect(q, correctIndices) : false;
  const openEndedMaxMarks =
    q && !isMcq ? resolveOpenEndedMaxScore(q, (q.questionForGrade ?? q.questionText).trim()) : null;

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
    if (ok) setScore((s) => s + 1);
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
      const result = await ragApiPost<any>("/rag/grade", {
        question: questionForGrade,
        studentAnswer,
        subject,
        form,
        topK: 8,
        maxScore: requestedMaxScore,
        rubricId: q.rubricId,
      });
      const score = Number(result?.score);
      const resultMaxScore = Number(result?.maxScore);
      const scorePrefix =
        Number.isFinite(score) && Number.isFinite(resultMaxScore)
          ? `Score: ${score}/${resultMaxScore}\n\n`
          : "";
      const feedback = result?.feedback ?? result?.modelAnswer ?? "No feedback returned.";
      setAiFeedbackText(`${scorePrefix}${feedback}`);
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
    setOpenEndedAnswer("");
    setOcrBusy(false);
    if (index + 1 >= total) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(new Set());
    setShowFeedback(false);
  };

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
      const result = await uploadScanImageWithAiTutor(photoUri);
      const text = (result?.text ?? "").trim();
      if (!text) {
        setAiFeedbackText("OCR found no readable text from the image.");
        return;
      }
      // Treat OCR output as the student's answer (paper -> image -> answer text).
      setOpenEndedAnswer(text);
      setShowFeedback(false);
      setAiFeedbackText(null);
    } catch (e) {
      setAiFeedbackText(e instanceof Error ? e.message : "OCR failed.");
    } finally {
      setOcrBusy(false);
    }
  }

  async function ocrTakePhoto() {
    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await runOcrFromUri(picked.assets[0].uri);
  }

  async function ocrPickImage() {
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
          <Text style={styles.summaryCorrect}>Correct: {score}</Text>
          <Text style={styles.summaryWrong}>Wrong: {total - score}</Text>
        </View>
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
  const feedbackTitle = isMcq ? (pickedRight ? "Correct" : "Incorrect") : "Marked by AI";

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
          <Text style={styles.diffChip}>{q.difficulty}</Text>
          <Text style={styles.questionText}>{q.questionText}</Text>

      {isMcq && multiSelect ? (
        <Text style={styles.multiHint}>Select all answers that apply.</Text>
      ) : null}

      {isMcq && q.options.length > 0 ? (
        <View style={styles.optionsGrid}>
          {q.options.map((opt, i) => {
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
                  {
                    borderColor: border,
                    backgroundColor: bg,
                    marginBottom: 12,
                  },
                ]}
                onPress={() => !showFeedback && onToggleOption(i)}
                disabled={showFeedback}
              >
                <Text style={styles.optionTileLabel} numberOfLines={4}>
                  {opt}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : isMcq && q.options.length === 0 ? (
        <Text style={styles.unsupported}>No answer choices were loaded for this question.</Text>
      ) : (
        <View style={styles.openEndedWrap}>
          {openEndedMaxMarks ? (
            <View style={styles.markValuePill}>
              <Text style={styles.markValueText}>
                {openEndedMaxMarks} mark{openEndedMaxMarks === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}
          <Text style={styles.openEndedLabel}>Your answer</Text>
          <TextInput
            value={openEndedAnswer}
            onChangeText={setOpenEndedAnswer}
            placeholder="Type your answer here..."
            placeholderTextColor="#94A3B8"
            style={styles.openEndedInput}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.ocrButtonsRow}>
            <Pressable
              style={({ pressed }) => [styles.ocrBtn, pressed && styles.ocrBtnPressed]}
              onPress={() => void ocrTakePhoto()}
              disabled={ocrBusy}
            >
              <Text style={styles.ocrBtnText}>{ocrBusy ? "Scanning..." : "Take photo"}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.ocrBtn, pressed && styles.ocrBtnPressed]}
              onPress={() => void ocrPickImage()}
              disabled={ocrBusy}
            >
              <Text style={styles.ocrBtnText}>{ocrBusy ? "Scanning..." : "Upload image"}</Text>
            </Pressable>
          </View>
        </View>
      )}
        </Animated.View>
      </View>

      {showFeedback ? (
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
          {(aiFeedbackText || q.explanation) ? (
            <Text style={styles.explanation}>{aiFeedbackText ?? q.explanation}</Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.askAiButton, pressed && styles.askAiButtonPressed]}
            onPress={() => void askAiForExplanation()}
          >
            <Text style={styles.askAiButtonText}>Ask AI for more explanation</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {!showFeedback ? (
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
      ) : (
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
      )}
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
  markValuePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.brandSoftSage,
    borderWidth: 1,
    borderColor: "rgba(22, 163, 74, 0.22)",
    marginBottom: 10,
  },
  markValueText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: BRAND,
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
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  ocrBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: BRAND,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  ocrBtnPressed: { opacity: 0.85 },
  ocrBtnText: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: BRAND,
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
  summaryRow: { gap: 12, marginBottom: 28 },
  summaryCorrect: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: "#166534",
  },
  summaryWrong: {
    fontSize: 20,
    fontFamily: fonts.bold,
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
