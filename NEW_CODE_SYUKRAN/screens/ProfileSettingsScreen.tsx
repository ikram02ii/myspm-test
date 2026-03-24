import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronRight,
  Globe,
  HelpCircle,
  Palette,
  Shield,
  User,
} from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoft;
const CARD_BORDER = "rgba(15, 23, 42, 0.06)";

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14,
};

const SETTINGS_ITEMS = [
  { icon: Globe, label: "Language", value: "English" },
  { icon: Shield, label: "Notifications", value: "On" },
  { icon: Palette, label: "Theme", value: "System" },
  { icon: User, label: "Account", value: "" },
  { icon: HelpCircle, label: "Help & Support", value: "" },
] as const;

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        {SETTINGS_ITEMS.map((item) => (
          <Pressable key={item.label} style={styles.settingsRow} onPress={() => {}}>
            <View style={styles.settingsIconWrap}>
              <item.icon size={18} color={BRAND} strokeWidth={2} />
            </View>
            <Text style={styles.settingsLabel}>{item.label}</Text>
            <Text style={styles.settingsValue}>{item.value}</Text>
            <ChevronRight size={18} color={colors.textTertiary} />
          </Pressable>
        ))}
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
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  settingsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsLabel: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.text,
    flex: 1,
  },
  settingsValue: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
});
