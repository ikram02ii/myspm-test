import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  BarChart2,
  Camera,
  Clock,
  FileText,
  Flame,
  Sparkles,
  Star,
  Zap,
} from "lucide-react-native";

import TeacherPostCard from "../components/TeacherPostCard";
import { ToastMessage } from "../components/ui/ToastMessage";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { HomeStackParamList } from "../navigation/HomeStack";
import { fetchMobileDashboard, type MobileDashboardData } from "../services/mobileDashboard";
import { fetchPracticeSetList, type PracticeSetSummary } from "../services/mobilePracticeSets";

const BRAND = theme.brand;
const BRAND_DEEP = theme.brandDeep;

const MOCK_MASTERY_ROWS = [
  { name: "Mathematics", pct: 0 },
  { name: "Physics", pct: 0},
  { name: "Biology", pct: 0 },
];

type Props = NativeStackScreenProps<HomeStackParamList, "HomeIndex">;

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const entrance = useRef(new Animated.Value(0)).current;
  const skeletonPulse = useRef(new Animated.Value(1)).current;
  const [isLoadingDashboard, setIsLoadingDashboard] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [dashboard, setDashboard] = React.useState<MobileDashboardData | null>(null);
  const [dashboardError, setDashboardError] = React.useState<string | null>(null);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [todayGoalSet, setTodayGoalSet] = React.useState<PracticeSetSummary | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const goPractice = () => navigation.getParent()?.navigate("Practice");
  const goCamera = () => navigation.getParent()?.navigate("Camera");
  const goTodayGoal = () => {
    if (!todayGoalSet) {
      goPractice();
      return;
    }
    (navigation.getParent() as any)?.navigate("Practice", {
      screen: "PracticeSetDetail",
      params: {
        setId: todayGoalSet.id,
        title: todayGoalSet.title,
        subject: todayGoalSet.subject,
        formLevel: todayGoalSet.formLevel,
        questionCount: todayGoalSet.questionCount,
      },
    });
  };

  const runEntrance = useCallback(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const loadDashboard = useCallback(
    async (onDone?: () => void) => {
      setDashboardError(null);
      try {
        const [data, sets] = await Promise.all([
          fetchMobileDashboard(),
          fetchPracticeSetList().catch(() => [] as PracticeSetSummary[]),
        ]);
        setDashboard(data);
        runEntrance();
        if (sets.length > 0) {
          setTodayGoalSet(sets[Math.floor(Math.random() * sets.length)]);
        } else {
          setTodayGoalSet(null);
        }
      } catch (error) {
        setDashboardError(error instanceof Error ? error.message : "Failed to load dashboard");
        setDashboard(null);
        setTodayGoalSet(null);
      } finally {
        setIsLoadingDashboard(false);
        onDone?.();
      }
    },
    [runEntrance]
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();
    return () => {
      pulseAnim.stop();
    };
  }, [skeletonPulse]);

  const onRefresh = () => {
    setRefreshing(true);
    setIsLoadingDashboard(true);
    void loadDashboard(() => {
      setRefreshing(false);
    });
  };

  const displayName = dashboard?.greetingName ?? "User";
  const displayStreak = dashboard?.streakDays ?? 0;
  const displayXP = dashboard?.totalXp ?? 0;
  const teacherPosts = dashboard?.teacherPosts ?? [];
  const todayGoalMinutes = todayGoalSet
    ? Math.max(1, Math.round(todayGoalSet.questionCount * 2.5))
    : 45;

  return (
    <>
    <ToastMessage message={toastMessage} top={insets.top + 12} />
    <ScrollView
      style={[styles.container, { paddingTop: webTopPadding }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.brand}
          colors={[theme.brand]}
        />
      }
    >
      {isLoadingDashboard ? (
        <Animated.View
          style={[
            styles.skeletonWrap,
            { paddingTop: insets.top + 12, opacity: skeletonPulse },
          ]}
        >
          <View style={styles.skeletonHeader}>
            <View>
              <View style={[styles.skeletonBase, styles.skeletonGreeting]} />
              <View style={styles.skeletonBadgeRow}>
                <View style={[styles.skeletonBase, styles.skeletonBadge]} />
                <View style={[styles.skeletonBase, styles.skeletonBadge]} />
              </View>
            </View>
            <View style={[styles.skeletonBase, styles.skeletonAvatar]} />
          </View>

          <View style={styles.skeletonBlock}>
            <View style={[styles.skeletonBase, styles.skeletonCardLarge]} />
            <View style={styles.skeletonDualRow}>
              <View style={[styles.skeletonBase, styles.skeletonDualCard]} />
              <View style={[styles.skeletonBase, styles.skeletonDualCard]} />
            </View>
          </View>

          <View style={styles.skeletonBlock}>
            <View style={[styles.skeletonBase, styles.skeletonCardMedium]} />
            <View style={[styles.skeletonBase, styles.skeletonCardMedium]} />
          </View>
        </Animated.View>
      ) : (
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <View style={styles.greetingRow}>
            <Image
              source={require("../assets/3d-icons/student.png")}
              style={styles.greetingIcon}
              // resizeMode="stretch"
            />
            <View style={styles.greetingTextCol}>
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
          </View>
        </View>
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarSmallText}>{displayName.charAt(0)}</Text>
        </View>
      </View>

      {dashboardError ? (
        <View style={[styles.block, { paddingHorizontal: 20 }]}>
          <Text style={styles.dashboardErrorText}>{dashboardError}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.blockTitle}>Today&apos;s Goal</Text>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalCardTop}>
            <View style={styles.aiBadge}>
              <Sparkles size={12} color={BRAND} />
              <Text style={styles.aiBadgeText}>AI RECOMMENDED</Text>
            </View>
            <Zap size={22} color={BRAND} strokeWidth={2} />
          </View>
          <Text style={styles.goalTitle}>
            {todayGoalSet ? `${todayGoalSet.subject} – ${todayGoalSet.title}` : "Physics – Forces and Motion"}
          </Text>
          <Text style={styles.goalSubtitle}>
            {todayGoalSet
              ? `Form ${todayGoalSet.formLevel} · ${todayGoalSet.questionCount} questions`
              : "Focus on Newton&apos;s Second Law applications"}
          </Text>
          <View style={styles.goalMetaRow}>
            <View style={styles.goalMetaItem}>
              <Clock size={16} color={colors.textSecondary} />
              <Text style={styles.goalMetaText}>{todayGoalMinutes} min</Text>
            </View>
            <View style={styles.goalMetaItem}>
              <BarChart2 size={16} color={colors.textSecondary} />
              <Text style={styles.goalMetaText}>
                {todayGoalSet
                  ? todayGoalSet.difficultyLevel.charAt(0).toUpperCase() + todayGoalSet.difficultyLevel.slice(1)
                  : "Intermediate"}
              </Text>
            </View>
          </View>
          <Pressable style={styles.goalCtaWrap} onPress={goTodayGoal}>
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
            <View style={styles.dualIconSpacer} />
            <View style={[styles.dualIconCorner, { backgroundColor: "#FEF9C3" }]}>
              <Image
                source={require("../assets/3d-icons/writing_hand.png")}
                style={{ width: 60, height: 60 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.dualTitle}>Daily Practice</Text>
          </Pressable>
          <Pressable
            style={styles.dualCard}
            onPress={() => showToast("Stay Tuned for this Features")}
          >
            <View style={styles.dualIconSpacer} />
            <View style={[styles.dualIconCorner, { backgroundColor: "#FEF9C3" }]}>
              <Image
                source={require("../assets/3d-icons/exam.png")}
                style={{ width: 60, height: 60 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.dualTitle}>Exam Task</Text>
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
          {MOCK_MASTERY_ROWS.map((row) => (
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
        {teacherPosts.length === 0 ? (
          <Text style={styles.emptyFeed}>
            No posts from teachers you follow yet. Follow teachers during onboarding to see updates here.
          </Text>
        ) : (
          teacherPosts.slice(0, 2).map((post, index) => (
            <TeacherPostCard
              key={post.id}
              post={post}
              style={index > 0 ? styles.postCardGap : undefined}
            />
          ))
        )}
      </View>
      </Animated.View>
      )}
    </ScrollView>
    </>
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
  animatedContent: {
    flex: 1,
  },
  skeletonWrap: {
    flex: 1,
    paddingHorizontal: 20,
  },
  skeletonHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  skeletonBase: {
    backgroundColor: "#E2E8F0",
    borderRadius: 12,
  },
  skeletonGreeting: {
    width: 170,
    height: 28,
  },
  skeletonBadgeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  skeletonBadge: {
    width: 98,
    height: 24,
    borderRadius: 20,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  skeletonBlock: {
    marginTop: 24,
  },
  skeletonCardLarge: {
    height: 260,
    borderRadius: 20,
  },
  skeletonDualRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
  },
  skeletonDualCard: {
    flex: 1,
    height: 120,
    borderRadius: 18,
  },
  skeletonCardMedium: {
    height: 140,
    borderRadius: 20,
    marginBottom: 12,
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  greeting: { fontSize: 22, fontFamily: fonts.bold, color: colors.text },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  greetingIcon: { width: 60, height: 60 },
  greetingTextCol: { flexShrink: 1 },
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
    shadowRadius: 12,
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
  dashboardErrorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    lineHeight: 20,
  },
  emptyFeed: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  dualRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  dualCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    ...cardShadow,
  },
  dualIconSpacer: {
    // height: 10,
  },
  dualIconCorner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top:2,
    left: 1,
  },
  dualTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, textAlign: "right" },
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
  postCardGap: { marginTop: 12 },
});
