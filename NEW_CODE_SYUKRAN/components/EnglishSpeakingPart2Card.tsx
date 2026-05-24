import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import { parseSpeakingPart2CueCard } from "../utils/englishSpeakingGenerate";

type Props = {
  questionText: string;
  sortOrder?: number;
};

export function EnglishSpeakingPart2Card({ questionText, sortOrder = 1 }: Props) {
  const card = useMemo(
    () => parseSpeakingPart2CueCard(questionText, sortOrder),
    [questionText, sortOrder],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Part 2 · Cue card</Text>
        <View style={styles.bookletCodeBox}>
          <Text style={styles.bookletCode}>{card.bookletCode}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.mainQuestion}>{card.mainQuestion}</Text>

        {card.bullets.length > 0 ? (
          <View style={styles.bulletList}>
            {card.bullets.map((bullet, i) => (
              <View key={`${i}-${bullet.slice(0, 24)}`} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))}
          </View>
        ) : null}
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
    marginBottom: 8,
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
  bookletCodeBox: {
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
  bookletCode: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: theme.brand,
  },
  body: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  mainQuestion: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.text,
    lineHeight: 20,
  },
  bulletList: {
    gap: 4,
    paddingLeft: 2,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  bulletDot: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: theme.brandSecondary,
    lineHeight: 18,
    width: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
