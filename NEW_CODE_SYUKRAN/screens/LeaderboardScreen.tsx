import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Flame, Trophy } from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import { FEATURE_FLAGS } from "../constants/featureFlags";
import { UnderMaintenanceOverlay } from "../components/ui/UnderMaintenanceOverlay";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoft;
const CARD_BORDER = "rgba(15, 23, 42, 0.06)";

const TABS = ["School", "National", "Subject"] as const;

const MOCK_SCHOOL_LEADERS = [
  { rank: 1, name: "Ahmad Lee", avatar: "A", xp: 12500, streak: 14 },
  { rank: 2, name: "Siti Nur", avatar: "S", xp: 11800, streak: 12 },
  { rank: 3, name: "Raj Kumar", avatar: "R", xp: 10200, streak: 9 },
  { rank: 4, name: "Mei Ling", avatar: "M", xp: 9800, streak: 7 },
  { rank: 5, name: "John Doe", avatar: "J", xp: 9200, streak: 5 },
];

const MOCK_NATIONAL_LEADERS = [
  { rank: 1, name: "Zara Ali", avatar: "Z", xp: 25600, streak: 30 },
  { rank: 2, name: "Wei Chen", avatar: "W", xp: 24100, streak: 28 },
  { rank: 3, name: "Ahmad Lee", avatar: "A", xp: 22500, streak: 25 },
];

const MOCK_SCHOOL_RANKINGS = [
  { rank: 1, name: "SMK Taman Melawati", students: 120, avgXp: 8500 },
  { rank: 2, name: "SMK Sri Aman", students: 95, avgXp: 8200 },
  { rank: 3, name: "MRSM Langkawi", students: 80, avgXp: 7900 },
];

const medalColors = [colors.gold, colors.silver, colors.bronze];

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14,
};

function TopThree({ leaders }: { leaders: typeof MOCK_SCHOOL_LEADERS }) {
  const top3 = leaders.slice(0, 3);
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const heights = [100, 130, 80];

  return (
    <View style={styles.podiumWrap}>
      <View style={styles.podiumHeader}>
        <Trophy size={18} color={BRAND} strokeWidth={2} />
        <Text style={styles.podiumHeaderText}>Top learners</Text>
      </View>
      <View style={styles.podiumContainer}>
        {order.map((person, idx) => {
          if (!person) return null;
          const rankIdx = idx === 1 ? 0 : idx === 0 ? 1 : 2;
          const medalColor = medalColors[rankIdx];
          return (
            <View key={person.rank} style={[styles.podiumItem, { marginTop: idx === 1 ? 0 : 24 }]}>
              <View style={[styles.podiumAvatar, { borderColor: medalColor }]}>
                <Text style={styles.podiumAvatarText}>{person.avatar}</Text>
              </View>
              <Text style={styles.podiumName} numberOfLines={1}>
                {person.name.split(" ")[0]}
              </Text>
              <Text style={styles.podiumXp}>{person.xp.toLocaleString()} XP</Text>
              <View
                style={[
                  styles.podiumBar,
                  { height: heights[idx], backgroundColor: medalColor + "35" },
                ]}
              >
                <Text style={[styles.podiumRank, { color: medalColor }]}>#{person.rank}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const entrance = useRef(new Animated.Value(0)).current;
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("School");
  const [refreshing, setRefreshing] = useState(false);

  const currentLeaders =
    activeTab === "School" ? MOCK_SCHOOL_LEADERS : MOCK_NATIONAL_LEADERS;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const onRefresh = () => {
    setRefreshing(true);
    console.log("API request: refresh leaderboard");
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  return (
    <View style={styles.root}>
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
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle}>Compete and climb the ranks</Text>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <Pressable
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            </Pressable>
          ))}
        </View>

        <TopThree leaders={currentLeaders} />

        <View style={styles.listSection}>
          <Text style={styles.listTitle}>Full rankings</Text>
          {currentLeaders.map((person, idx) => (
            <View key={person.rank} style={styles.rankRow}>
              <Text style={styles.rankNum}>{person.rank}</Text>
              <View
                style={[
                  styles.rankAvatar,
                  {
                    backgroundColor:
                      idx < 3 ? medalColors[idx] + "22" : BRAND_SOFT,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.rankAvatarText,
                    { color: idx < 3 ? medalColors[idx] : BRAND },
                  ]}
                >
                  {person.avatar}
                </Text>
              </View>
              <View style={styles.rankInfo}>
                <Text style={styles.rankName}>{person.name}</Text>
                <View style={styles.rankMeta}>
                  <Flame size={12} color={colors.streak} />
                  <Text style={styles.rankStreak}>{person.streak} day streak</Text>
                </View>
              </View>
              <Text style={styles.rankXp}>{person.xp.toLocaleString()}</Text>
              <Text style={styles.rankXpLabel}>XP</Text>
            </View>
          ))}
        </View>

        {activeTab === "School" && (
          <View style={styles.schoolSection}>
            <Text style={styles.listTitle}>School vs school</Text>
            {MOCK_SCHOOL_RANKINGS.map((school) => (
              <View key={school.rank} style={styles.schoolRow}>
                <Text style={styles.schoolRank}>#{school.rank}</Text>
                <View style={styles.schoolInfo}>
                  <Text style={styles.schoolName}>{school.name}</Text>
                  <Text style={styles.schoolMeta}>
                    {school.students} students · Avg {school.avgXp.toLocaleString()} XP
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
        </Animated.View>
      </ScrollView>

      <UnderMaintenanceOverlay visible={FEATURE_FLAGS.leaderboardUnderMaintenance} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.screenBackground },
  animatedContent: {
    flex: 1,
  },
  header: { paddingHorizontal: 20 },
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
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: BRAND_SOFT,
    borderRadius: 14,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 11 },
  tabActive: {
    backgroundColor: "#FFFFFF",
    ...cardShadow,
  },
  tabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  tabTextActive: { color: BRAND, fontFamily: fonts.semiBold },
  podiumWrap: {
    marginHorizontal: 20,
    marginTop: 22,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  podiumHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  podiumHeaderText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.text,
  },
  podiumContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: 4,
    gap: 12,
  },
  podiumItem: { alignItems: "center", flex: 1 },
  podiumAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
  },
  podiumAvatarText: { fontSize: 18, fontFamily: fonts.bold, color: BRAND },
  podiumName: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.text, marginTop: 6 },
  podiumXp: { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },
  podiumBar: {
    width: "100%",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 10,
  },
  podiumRank: { fontSize: 18, fontFamily: fonts.bold },
  listSection: { marginTop: 28, paddingHorizontal: 20 },
  listTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  rankNum: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textTertiary,
    width: 24,
    textAlign: "center",
  },
  rankAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  rankAvatarText: { fontSize: 16, fontFamily: fonts.semiBold },
  rankInfo: { flex: 1, marginLeft: 12 },
  rankName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  rankMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  rankStreak: { fontSize: 11, color: colors.textTertiary },
  rankXp: { fontSize: 16, fontFamily: fonts.bold, color: BRAND },
  rankXpLabel: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  schoolSection: { marginTop: 28, paddingHorizontal: 20, paddingBottom: 8 },
  schoolRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  schoolRank: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: BRAND,
    width: 36,
    textAlign: "center",
  },
  schoolInfo: { flex: 1, marginLeft: 8 },
  schoolName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  schoolMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
