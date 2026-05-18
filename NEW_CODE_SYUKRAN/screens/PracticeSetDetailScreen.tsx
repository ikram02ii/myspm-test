import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Play } from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  fetchPracticeSetDetail,
  formatQuestionWithMarksAtEnd,
  resolveQuestionMarks,
  type PracticeSetQuestion,
} from "../services/mobilePracticeSets";

const BRAND = theme.brand;
const BRAND_DEEP = theme.brandDeep;

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeSetDetail">;

function previewLine(text: string, max = 72): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export default function PracticeSetDetailScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { setId, title: paramTitle, subject, formLevel, questionCount: paramCount } =
    route.params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(paramTitle);
  const [metaSubject, setMetaSubject] = useState(subject);
  const [metaForm, setMetaForm] = useState(formLevel);
  const [questions, setQuestions] = useState<PracticeSetQuestion[]>([]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPracticeSetDetail(setId);
      setTitle(data.set.title);
      setMetaSubject(data.set.subject);
      setMetaForm(data.set.formLevel);
      setQuestions(data.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load set");
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    navigation.setOptions({ title: title || "Practice set" });
  }, [navigation, title]);

  const count = questions.length > 0 ? questions.length : paramCount;
  const canStart = questions.length > 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pad}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading && !error ? (
          <>
            <View style={styles.metaCard}>
              <Text style={styles.headTitle}>{title}</Text>
              <Text style={styles.headMeta}>
                {metaSubject} · Form {metaForm}
              </Text>
              <Text style={styles.countLine}>
                {count} question{count === 1 ? "" : "s"} in this set
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Order</Text>
            {questions.length === 0 ? (
              <Text style={styles.emptyQs}>No questions linked to this set.</Text>
            ) : (
              questions.map((q, i) => {
                const marks = resolveQuestionMarks(q, q.questionForGrade ?? q.questionText);
                const line = formatQuestionWithMarksAtEnd(q.questionText, marks);
                return (
                  <View key={q.id} style={styles.qRow}>
                    <Text style={styles.qIndex}>{i + 1}</Text>
                    <View style={styles.qBody}>
                      <Text style={styles.qTopic}>
                        {q.difficulty} · {q.questionType.replace(/_/g, " ")} · {marks} mark{marks === 1 ? "" : "s"}
                      </Text>
                      <Text style={styles.qText}>{previewLine(line, 96)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </>
        ) : null}
      </View>

      <View style={[styles.ctaWrap, { paddingHorizontal: 20 }]}>
        <Pressable
          style={[styles.cta, !canStart && styles.ctaOff]}
          disabled={!canStart || loading}
          onPress={() =>
            navigation.navigate("PracticeSession", {
              setId,
              title: title || "Practice",
            })
          }
        >
          <LinearGradient
            colors={canStart && !loading ? [...theme.gradientCta] : ["#A1A1AA", "#9CA3AF"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.ctaGrad}
          >
            <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.ctaText}>Start practice</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  pad: { paddingHorizontal: 20, paddingTop: 12 },
  centered: { paddingVertical: 32, alignItems: "center" },
  metaCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    marginBottom: 12,
  },
  headTitle: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.text,
    lineHeight: 28,
  },
  headMeta: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginTop: 6,
  },
  countLine: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: BRAND,
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: BRAND_DEEP,
    marginTop: 22,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  emptyQs: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  qRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
  },
  qIndex: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: BRAND,
    width: 24,
    marginTop: 2,
  },
  qBody: { flex: 1, minWidth: 0 },
  qTopic: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    textTransform: "capitalize",
    marginBottom: 4,
  },
  qText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 20,
  },
  ctaWrap: { marginTop: 24 },
  cta: { borderRadius: 16, overflow: "hidden" },
  ctaOff: { opacity: 0.85 },
  ctaGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  ctaText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
});
