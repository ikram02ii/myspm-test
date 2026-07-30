import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

type Props = {
  variant: "overview" | "question";
  questionText: string;
  totalQuestions?: number;
  phaseLabel?: string;
  isIntroScript?: boolean;
  /** When set, shows a listen prompt (intro only). Question text still shown for active questions. */
  listeningMode?: "intro" | "question" | null;
};

export function EnglishSpeakingPart1InterviewCard({
  variant,
  questionText,
  totalQuestions = 5,
  phaseLabel,
  isIntroScript = false,
  listeningMode = null,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {variant === "overview" ? "Part 1 · Short interview" : "Part 1 · Interview question"}
        </Text>
      </View>

      <View style={styles.body}>
        {variant === "overview" ? (
          <>
            <Text style={styles.mainQuestion}>Personal questions, one at a time</Text>
            <Text style={styles.overviewText}>
              The examiner will ask {totalQuestions} short questions about you and your daily life.
              Read each question on screen, listen carefully, then answer in your own words.
            </Text>
          </>
        ) : listeningMode === "intro" ? (
          <>
            {phaseLabel ? <Text style={styles.phaseLabel}>{phaseLabel}</Text> : null}
            <Text style={[styles.mainQuestion, styles.introScript]}>{questionText}</Text>
            <Text style={styles.listenHint}>Listen to the examiner's introduction.</Text>
          </>
        ) : (
          <>
            {phaseLabel ? <Text style={styles.phaseLabel}>{phaseLabel}</Text> : null}
            <Text
              style={[
                styles.mainQuestion,
                isIntroScript && styles.introScript,
              ]}
            >
              {questionText}
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
  },
  headerTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
  },
  body: {
    padding: 14,
    gap: 8,
  },
  phaseLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: theme.brand,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  mainQuestion: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
    color: colors.text,
    lineHeight: 26,
  },
  introScript: {
    fontFamily: fonts.regular,
    fontStyle: "italic",
    color: colors.textSecondary,
  },
  overviewText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  listenHint: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: theme.brandDeep,
  },
});
