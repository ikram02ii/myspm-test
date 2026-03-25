import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Check } from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  fetchPracticeSetDetail,
  type PracticeSetQuestion,
} from "../services/mobilePracticeSets";

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

function questionAllowsMultiSelect(q: PracticeSetQuestion, correct: Set<number>): boolean {
  const type = (q.questionType || "").toLowerCase();
  if (type.includes("multiple_answer") || type.includes("multiple_select") || type.includes("multi_select")) {
    return true;
  }
  return correct.size > 1;
}

export default function PracticeSessionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { setId, title } = route.params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeSetQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  const questionFade = useRef(new Animated.Value(1)).current;
  const questionLift = useRef(new Animated.Value(0)).current;
  const progressFillAnim = useRef(new Animated.Value(0)).current;
  const feedbackFade = useRef(new Animated.Value(0)).current;
  const feedbackLift = useRef(new Animated.Value(8)).current;
  const skipQuestionEnterAnim = useRef(true);

  const load = useCallback(async () => {
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
    void load();
  }, [load]);

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
    if (selected.size === 0 || !q || !isMcq) return;
    const ok = isSelectionCorrect(selected, correctIndices);
    if (ok) setScore((s) => s + 1);
    setShowFeedback(true);
  };

  const onNext = () => {
    setAiDrawerOpen(false);
    if (index + 1 >= total) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(new Set());
    setShowFeedback(false);
  };

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
        <Text style={styles.unsupported}>This question type is not supported in the app yet.</Text>
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
          <Text style={[styles.feedbackTitle, pickedRight ? styles.ok : styles.bad]}>
            {pickedRight ? "Correct" : "Incorrect"}
          </Text>
          {q.explanation ? (
            <Text style={styles.explanation}>{q.explanation}</Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.askAiButton, pressed && styles.askAiButtonPressed]}
            onPress={() => setAiDrawerOpen(true)}
          >
            <Text style={styles.askAiButtonText}>Ask AI for more explanation</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {!showFeedback ? (
        <Pressable
          style={[styles.primaryBtn, selected.size === 0 && styles.primaryBtnOff]}
          disabled={selected.size === 0 || !isMcq}
          onPress={onCheck}
        >
          <LinearGradient
            colors={selected.size > 0 && isMcq ? [...theme.gradientCta] : ["#A1A1AA", "#9CA3AF"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryGrad}
          >
            <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.primaryBtnText}>Check answer</Text>
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
          <Text style={styles.aiDrawerBody}>Stay Tuned for this Features</Text>
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
