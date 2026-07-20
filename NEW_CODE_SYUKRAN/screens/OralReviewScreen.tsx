import React, { useState } from "react";
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

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { ORAL_PRACTICE_MAX_SCORE } from "../constants/oralPractice";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import { ragApiPost } from "../services/ragApi";

const BRAND = theme.brand;

type Props = NativeStackScreenProps<PracticeStackParamList, "OralReview">;

type GradeResult = {
  score?: number;
  maxScore?: number;
  feedback?: string;
  modelAnswer?: string;
  strengths?: string[];
  improvements?: string[];
  error?: string;
};

export default function OralReviewScreen({ route }: Props) {
  const { prompt, transcript, subject, formLevel } = route.params;
  const insets = useSafeAreaInsets();

  const [submitting, setSubmitting] = useState(false);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!transcript.trim()) {
      setError("Transcript is empty. Go back and record your answer.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await ragApiPost<GradeResult>("/rag/grade", {
        question: `Oral / speaking practice (SPM ${subject}):\n\n${prompt.trim()}\n\nThe student spoke their answer; grade the transcript as an oral response.`,
        studentAnswer: transcript.trim(),
        subject,
        form: formLevel,
        topK: 8,
        maxScore: ORAL_PRACTICE_MAX_SCORE,
      });
      setGradeResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit for marking.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: 16,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 32,
      }}
    >
      <Text style={styles.meta}>
        {subject} · {formLevel} · Your spoken answer
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Speech to text</Text>
        <Text style={styles.transcript}>{transcript}</Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {gradeResult ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackTitle}>Marking feedback</Text>
          {gradeResult.score != null && gradeResult.maxScore != null ? (
            <Text style={styles.scoreLine}>
              Score: {gradeResult.score}/{gradeResult.maxScore}
            </Text>
          ) : null}
          <Text style={styles.feedbackBody}>
            {gradeResult.feedback ?? gradeResult.modelAnswer ?? "No feedback returned."}
          </Text>
          {gradeResult.strengths && gradeResult.strengths.length > 0 ? (
            <>
              <Text style={styles.feedbackSubtitle}>Strengths</Text>
              {gradeResult.strengths.map((s) => (
                <Text key={s} style={styles.bullet}>
                  • {s}
                </Text>
              ))}
            </>
          ) : null}
          {gradeResult.improvements && gradeResult.improvements.length > 0 ? (
            <>
              <Text style={styles.feedbackSubtitle}>Improvements</Text>
              {gradeResult.improvements.map((s) => (
                <Text key={s} style={styles.bullet}>
                  • {s}
                </Text>
              ))}
            </>
          ) : null}
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.submitWrap, pressed && styles.submitPressed]}
          onPress={() => void onSubmit()}
          disabled={submitting}
        >
          <LinearGradient
            colors={["#F15A29", "#5B2EFF"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.submitGrad}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Submit for marking</Text>
            )}
          </LinearGradient>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 14,
  },
  cardLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: BRAND,
    marginBottom: 8,
  },
  cardBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  transcript: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: "#DC2626",
  },
  submitWrap: { borderRadius: 14, overflow: "hidden", marginTop: 8 },
  submitPressed: { opacity: 0.92 },
  submitGrad: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  submitText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: "#FFFFFF",
  },
  feedbackCard: {
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    marginTop: 8,
  },
  feedbackTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.text,
    marginBottom: 8,
  },
  scoreLine: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: BRAND,
    marginBottom: 10,
  },
  feedbackBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  feedbackSubtitle: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  bullet: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginLeft: 4,
  },
});
