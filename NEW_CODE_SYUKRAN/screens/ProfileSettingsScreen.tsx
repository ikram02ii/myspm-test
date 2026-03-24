import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";

export default function ProfileSettingsScreen() {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Language</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>App language</Text>
          <Text style={styles.rowValue}>English</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Notifications</Text>
          <Text style={styles.rowValue}>On</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Theme</Text>
          <Text style={styles.rowValue}>System</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screenBackground,
  },
  section: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    marginVertical: 12,
    color: colors.darkText,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 15, color: colors.darkText },
  rowValue: { fontSize: 15, color: colors.textSecondary },
});
