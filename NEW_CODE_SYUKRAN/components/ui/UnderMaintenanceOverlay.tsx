import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";

export function UnderMaintenanceOverlay({
  visible,
  title = "UNDER MAINTENANCE",
  subtitle = "We'll be back soon.",
  style,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  style?: ViewStyle;
}) {
  if (!visible) return null;
  return (
    <View style={[styles.overlay, style]} pointerEvents="auto">
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  title: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#0F172A",
    textAlign: "center",
    letterSpacing: 1.2,
  },
  sub: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    textAlign: "center",
  },
});

