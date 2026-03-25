import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lock, Settings } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  POST_LOGIN_ONBOARDING_STORAGE_KEY,
} from "../constants/storageKeys";

const BRAND = theme.brand;
const BRAND_DEEP = theme.brandDeep;
const BRAND_SOFT = theme.brandSoft;
const CARD_BORDER = "rgba(15, 23, 42, 0.06)";

const MOCK_ACHIEVEMENTS = [
  { id: "1", title: "First Steps", earned: true },
  { id: "2", title: "Week Streak", earned: true },
  { id: "3", title: "Top 10", earned: false },
  { id: "4", title: "Scholar", earned: true },
  { id: "5", title: "Master", earned: false },
];

const MOCK_PROGRESS = [
  { name: "Mathematics", score: 78 },
  { name: "Bahasa Melayu", score: 92 },
  { name: "English", score: 65 },
];

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14
};

export default function ProfileScreen({
  navigation,
}: {
  navigation: {
    navigate: (name: string) => void;
    getParent?: () => { getParent?: () => { navigate: (name: string) => void } };
  };
}) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const entrance = useRef(new Animated.Value(0)).current;
  const displayName = "User";
  const displaySchool = "SMK Example";
  const displayXP = 2450;
  const displayStreak = 7;
  const displayQuestions = 156;
  const handleLogout = async () => {
    await AsyncStorage.multiRemove([
      POST_LOGIN_ONBOARDING_STORAGE_KEY,
      AUTH_TOKEN_STORAGE_KEY,
      AUTH_USER_STORAGE_KEY,
    ]);
    const rootNavigation = navigation.getParent?.()?.getParent?.();
    if (rootNavigation) {
      rootNavigation.navigate("Welcome");
      return;
    }
    navigation.navigate("Welcome");
  };

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPadding }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        style={[
          styles.animatedContent,
          {
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Your progress and account</Text>
        </View>
        <Pressable
          style={styles.settingsBtn}
          onPress={() => navigation.navigate("ProfileSettings")}
          hitSlop={8}
        >
          <Settings size={22} color={BRAND} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <LinearGradient
            colors={[BRAND_DEEP, BRAND]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            <View style={styles.avatarInner}>
              <Text style={styles.avatarText}>{displayName.charAt(0)}</Text>
            </View>
          </LinearGradient>
          <Pressable style={styles.editAvatarBtn}>
            <LinearGradient
              colors={[BRAND_DEEP, BRAND]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.editAvatarGrad}
            >
              <Text style={styles.editAvatarText}>+</Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.profileName}>{displayName}</Text>
        <Text style={styles.profileSchool}>{displaySchool}</Text>
        <View style={styles.profileBadge}>
          <Text style={styles.profileBadgeText}>Form 5</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayXP.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Total XP</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayStreak}</Text>
            <Text style={styles.statLabel}>Day streak</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayQuestions}</Text>
            <Text style={styles.statLabel}>Questions</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Achievements</Text>
        <View style={styles.achievementGrid}>
          {MOCK_ACHIEVEMENTS.map((a) => (
            <View
              key={a.id}
              style={[styles.achievementCard, !a.earned && styles.achievementLocked]}
            >
              <View
                style={[
                  styles.achievementIcon,
                  { backgroundColor: a.earned ? BRAND_SOFT : colors.surfaceAlt },
                ]}
              >
                <Lock size={22} color={a.earned ? BRAND : colors.textTertiary} strokeWidth={2} />
              </View>
              <Text style={[styles.achievementTitle, !a.earned && { color: colors.textTertiary }]}>
                {a.title}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subject performance</Text>
        <View style={styles.progressCard}>
          {MOCK_PROGRESS.map((s) => (
            <View key={s.name} style={styles.progressBlock}>
              <View style={styles.progressLabels}>
                <Text style={styles.progressLabel}>{s.name}</Text>
                <Text style={styles.progressValue}>{s.score}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${s.score}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.logoutSection}>
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}
          onPress={handleLogout}
        >
          <Text style={styles.logoutBtnText}>Logout</Text>
        </Pressable>
      </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  animatedContent: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginTop: 4,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCard: {
    marginHorizontal: 20,
    marginTop: 22,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  avatarContainer: { position: "relative" },
  avatarRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 30, fontFamily: fonts.bold, color: BRAND },
  editAvatarBtn: {
    position: "absolute",
    bottom: 0,
    right: -4,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  editAvatarGrad: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  editAvatarText: { fontSize: 16, color: colors.textInverse, fontFamily: fonts.bold, marginTop: -1 },
  profileName: { fontSize: 22, fontFamily: fonts.bold, color: colors.text, marginTop: 14 },
  profileSchool: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 4 },
  profileBadge: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
  },
  profileBadgeText: { fontSize: 12, fontFamily: fonts.semiBold, color: BRAND },
  statsRow: {
    flexDirection: "row",
    marginTop: 22,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    width: "100%",
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: fonts.bold, color: BRAND },
  statLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 4 },
  statDivider: { width: 1, backgroundColor: colors.borderLight },
  section: { marginTop: 28, paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  achievementGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  achievementCard: {
    width: "31%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  achievementLocked: { opacity: 0.55 },
  achievementIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  achievementTitle: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: colors.text,
    textAlign: "center",
  },
  progressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 18,
    ...cardShadow,
  },
  progressBlock: { gap: 8 },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  progressValue: { fontSize: 14, fontFamily: fonts.bold, color: BRAND },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: BRAND_SOFT,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: BRAND,
  },
  logoutSection: {
    marginTop: "auto",
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  logoutBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  logoutBtnPressed: {
    opacity: 0.9,
  },
  logoutBtnText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: "#B91C1C",
  },
});
