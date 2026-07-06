import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

type Props = {
  variant: "overview" | "question";
  questionText: string;
  questionIndex?: number;
  totalQuestions?: number;
  phaseLabel?: string;
  isIntroScript?: boolean;
  /** When set, the card shows a listen prompt instead of the question text. */
  listeningMode?: "intro" | "question" | null;
};

function listenPromptText(
  listeningMode: "intro" | "question" | null | undefined,
  questionIndex: number,
): string {
  if (listeningMode === "intro") {
    return "Listen to the examiner's introduction.";
  }
  if (listeningMode === "question") {
    return `Listen to question ${questionIndex + 1}.`;
  }
  return "";
}

export function EnglishSpeakingPart1InterviewCard({
  variant,
  questionText,
  questionIndex = 0,
  totalQuestions = 1,
  phaseLabel,
  isIntroScript = false,
  listeningMode = null,
}: Props) {
  const questionBadge = `Q${questionIndex + 1}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {variant === "overview" ? "Part 1 · Short interview" : "Part 1 · Interview question"}
        </Text>
        {variant === "question" ? (
          <View style={styles.badgeBox}>
            <Text style={styles.badgeText}>{questionBadge}</Text>
          </View>
        ) : (
          <View style={styles.badgeBox}>
            <Text style={styles.badgeText}>{totalQuestions}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        {variant === "overview" ? (
          <>
            <Text style={styles.mainQuestion}>Personal questions, one at a time</Text>
            <Text style={styles.overviewText}>
              The examiner will ask {totalQuestions} short questions about you and your daily life.
              Listen carefully, then answer each question in your own words.
            </Text>
          </>
        ) : listeningMode ? (
          <>
            {phaseLabel ? (
              <Text style={styles.phaseLabel}>{phaseLabel}</Text>
            ) : null}
            <Text style={styles.listenPrompt}>{listenPromptText(listeningMode, questionIndex)}</Text>
            <Text style={styles.listenHint}>
              The question will appear when it is your turn to answer.
            </Text>
            <Text style={styles.counterText}>
              Question {questionIndex + 1} of {totalQuestions}
            </Text>
          </>
        ) : (
          <>
            {phaseLabel ? (
              <Text style={styles.phaseLabel}>{phaseLabel}</Text>
            ) : null}
            <Text
              style={[
                styles.mainQuestion,
                isIntroScript && styles.introScript,
              ]}
            >
              {questionText}
            </Text>
            <Text style={styles.counterText}>
              Question {questionIndex + 1} of {totalQuestions}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.pillBorderBrand,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.brandSoftSage,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 10,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
    letterSpacing: 0.1,
    textTransform: "uppercase",
  },
  badgeBox: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.pillBorderBrand,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: theme.brand,
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  phaseLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: theme.brand,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  mainQuestion: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: colors.text,
    lineHeight: 24,
  },
  introScript: {
    fontSize: 14,
    fontFamily: fonts.medium,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  listenPrompt: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
    lineHeight: 24,
  },
  listenHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  overviewText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  counterText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
});
