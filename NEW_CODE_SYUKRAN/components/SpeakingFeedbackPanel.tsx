import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

type Props = {
  transcript: string | null;
  markingText: string | null;
};

export function SpeakingFeedbackPanel({ transcript, markingText }: Props) {
  const trimmedTranscript = transcript?.trim() ?? "";
  const trimmedMarking = markingText?.trim() ?? "";

  if (!trimmedTranscript && !trimmedMarking) {
    return <Text style={styles.empty}>No feedback was returned for this prompt.</Text>;
  }

  return (
    <View style={styles.wrap}>
      {trimmedTranscript ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.sectionTitle}>What you said</Text>
          <Text style={styles.transcriptBody} selectable>
            {trimmedTranscript}
          </Text>
        </View>
      ) : null}
      {trimmedMarking ? (
        <View style={styles.markingBox}>
          <Text style={styles.sectionTitle}>Examiner feedback</Text>
          <Text style={styles.markingBody} selectable>
            {trimmedMarking}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginTop: 8 },
  transcriptBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.pillBorderBrand,
    padding: 12,
    gap: 6,
  },
  markingBox: {
    backgroundColor: theme.brandSoftSage,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    padding: 12,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  transcriptBody: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  markingBody: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 21,
  },
});
