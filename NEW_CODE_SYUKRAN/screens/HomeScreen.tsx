import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BarChart2,
  Camera,
  Clock,
  FileText,
  Flame,
  PenLine,
  Sparkles,
  Star,
  Zap,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";

import TeacherPostCard from "../components/TeacherPostCard";
import { TEACHER_POSTS_MOCK } from "../constants/teacherPostsMock";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { HomeStackParamList } from "../navigation/HomeStack";

const BRAND = theme.brand;
const BRAND_DEEP = theme.brandDeep;

const MASTERY_ROWS = [
  { name: "Mathematics", pct: 82 },
  { name: "Physics", pct: 68 },
  { name: "Biology", pct: 91 },
];

type Props = NativeStackScreenProps<HomeStackParamList, "HomeIndex">;

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const goPractice = () => navigation.getParent()?.navigate("Practice");
  const goCamera = () => navigation.getParent()?.navigate("Camera");
  const displayName = "User";
  const displayStreak = 7;
  const displayXP = 2450;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPadding }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.greeting}>Hello, {displayName}</Text>
          <View style={styles.streakRow}>
            <View style={styles.streakBadge}>
              <Flame size={14} color={colors.streak} />
              <Text style={styles.streakText}>{displayStreak} day streak</Text>
            </View>
            <View style={styles.xpBadge}>
              <Star size={14} color={colors.xp} />
              <Text style={styles.xpText}>{displayXP.toLocaleString()} XP</Text>
            </View>
          </View>
        </View>
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarSmallText}>{displayName.charAt(0)}</Text>
        </View>
      </View>

      <View style={styles.block}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.blockTitle}>Today's Goal</Text>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalCardTop}>
            <View style={styles.aiBadge}>
              <Sparkles size={12} color={BRAND} />
              <Text style={styles.aiBadgeText}>AI RECOMMENDED</Text>
            </View>
            <Zap size={22} color={BRAND} strokeWidth={2} />
          </View>
          <Text style={styles.goalTitle}>Physics – Forces and Motion</Text>
          <Text style={styles.goalSubtitle}>Focus on Newton's Second Law applications</Text>
          <View style={styles.goalMetaRow}>
            <View style={styles.goalMetaItem}>
              <Clock size={16} color={colors.textSecondary} />
              <Text style={styles.goalMetaText}>45 min</Text>
            </View>
            <View style={styles.goalMetaItem}>
              <BarChart2 size={16} color={colors.textSecondary} />
              <Text style={styles.goalMetaText}>Intermediate</Text>
            </View>
          </View>
          <Pressable
            style={styles.goalCtaWrap}
            onPress={goPractice}
          >
            <LinearGradient
              colors={[BRAND_DEEP, BRAND]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.goalCta}
            >
              <Text style={styles.goalCtaText}>Start Session Now</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View style={styles.dualRow}>
          <Pressable style={styles.dualCard} onPress={goPractice}>
            <View style={[styles.dualIcon, { backgroundColor: "#FEF9C3" }]}>
              <PenLine size={20} color="#CA8A04" strokeWidth={2} />
            </View>
            <Text style={styles.dualTitle}>Daily Practice</Text>
          </Pressable>
          <Pressable style={styles.dualCard}>
            <View style={[styles.dualIcon, { backgroundColor: "#DBEAFE" }]}>
              <FileText size={20} color="#2563EB" strokeWidth={2} />
            </View>
            <Text style={styles.dualTitle}>Mock Exam</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.block}>
        <Pressable
          style={({ pressed }) => [styles.scanBanner, pressed && styles.scanBannerPressed]}
          onPress={goCamera}
        >
          <View style={styles.scanBannerText}>
            <Text style={styles.scanBannerTitle}>Instant AI Help</Text>
            <Text style={styles.scanBannerSub}>
              Scan any question to get step-by-step solutions
            </Text>
          </View>
          <View style={styles.scanBannerIconWrap}>
            <Camera size={24} color="#0F172A" strokeWidth={2} />
          </View>
        </Pressable>
        <Text style={[styles.blockTitle, styles.blockTitleSpacing]}>Mastery Progress</Text>
        <View style={styles.masteryCard}>
          {MASTERY_ROWS.map((row) => (
            <View key={row.name} style={styles.masteryRow}>
              <View style={styles.masteryLabels}>
                <Text style={styles.masteryName}>{row.name}</Text>
                <Text style={styles.masteryPct}>{row.pct}%</Text>
              </View>
              <View style={styles.masteryTrack}>
                <View style={[styles.masteryFill, { width: `${row.pct}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.block}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.blockTitle}>Teacher's Posts</Text>
          <Pressable hitSlop={8} onPress={() => navigation.navigate("TeacherPosts")}>
            <Text style={styles.viewAllMuted}>View All</Text>
          </Pressable>
        </View>
        {TEACHER_POSTS_MOCK.slice(0, 2).map((post, index) => (
          <TeacherPostCard
            key={post.id}
            post={post}
            style={index > 0 ? styles.postCardGap : undefined}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  greeting: { fontSize: 22, fontFamily: fonts.bold, color: colors.text },
  streakRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.streak + "20",
  },
  streakText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.streak },
  xpBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.xp + "20",
  },
  xpText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.xp },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmallText: { fontSize: 16, fontFamily: fonts.bold, color: colors.primary },
  block: { marginTop: 24, paddingHorizontal: 20 },
  sectionHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  blockTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  blockTitleSpacing: { marginBottom: 14 },
  linkBrand: { fontSize: 14, fontFamily: fonts.semiBold, color: BRAND },
  viewAllMuted: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  goalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    ...cardShadow,
  },
  goalCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.brandSoft,
  },
  aiBadgeText: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: BRAND,
    letterSpacing: 0.6,
  },
  goalTitle: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.text,
    letterSpacing: -0.4,
  },
  goalSubtitle: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 20,
  },
  goalMetaRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 16,
  },
  goalMetaItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  goalMetaText: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  goalCtaWrap: {
    marginTop: 20,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12
  },
  goalCta: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  goalCtaText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  dualRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  dualCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    ...cardShadow,
  },
  dualIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  dualTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  scanBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "#0F172A",
    marginBottom: 22,
  },
  scanBannerPressed: { opacity: 0.92 },
  scanBannerText: { flex: 1, paddingRight: 14 },
  scanBannerTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  scanBannerSub: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: "#94A3B8",
    marginTop: 6,
    lineHeight: 18,
  },
  scanBannerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  masteryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    gap: 18,
    ...cardShadow,
  },
  masteryRow: { gap: 8 },
  masteryLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  masteryName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  masteryPct: { fontSize: 14, fontFamily: fonts.bold, color: BRAND },
  masteryTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.brandSoft,
    overflow: "hidden",
  },
  masteryFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: BRAND,
  },
  postCardGap: { marginTop: 12 },
});
