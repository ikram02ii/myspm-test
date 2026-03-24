import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Brain,
  Check,
  Leaf,
  Play,
  Plus,
  Zap,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";

import PracticeSubjectIcon from "../components/PracticeSubjectIcon";
import {
  DEFAULT_PRACTICE_SUBJECT_IDS,
  PRACTICE_SUBJECT_CATALOG,
  TOPICS_BY_SUBJECT,
  subjectDefById,
} from "../constants/practiceSubjects";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import type { PracticeStackParamList } from "../navigation/PracticeStack";

const BRAND = "#7B89F4";
const BRAND_SOFT = "#EEF2FF";

type DifficultyId = "easy" | "medium" | "hard";

const DIFFICULTIES: {
  id: DifficultyId;
  title: string;
  subtitle: string;
  tag: string;
  tagBg: string;
  tagText: string;
  icon: "leaf" | "zap" | "brain";
  iconBg: string;
  iconColor: string;
}[] = [
  {
    id: "easy",
    title: "Easy",
    subtitle: "Focus on basic concepts and definitions.",
    tag: "WARM UP",
    tagBg: "#DCFCE7",
    tagText: "#166534",
    icon: "leaf",
    iconBg: "#DCFCE7",
    iconColor: "#22C55E",
  },
  {
    id: "medium",
    title: "Medium",
    subtitle: "Standard exam-level challenges.",
    tag: "RECOMMENDED",
    tagBg: "#FEF3C7",
    tagText: "#B45309",
    icon: "zap",
    iconBg: "#FEF9C3",
    iconColor: "#EAB308",
  },
  {
    id: "hard",
    title: "Hard",
    subtitle: "Complex KBAT questions and deep analysis.",
    tag: "MASTERY LEVEL",
    tagBg: "#FEE2E2",
    tagText: "#B91C1C",
    icon: "brain",
    iconBg: "#FEE2E2",
    iconColor: "#EF4444",
  },
];

const QUESTION_COUNTS = [10, 20, 50] as const;

function DifficultyIcon({
  type,
  bg,
  fg,
}: {
  type: "leaf" | "zap" | "brain";
  bg: string;
  fg: string;
}) {
  const wrap = {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: bg,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  if (type === "leaf")
    return (
      <View style={wrap}>
        <Leaf size={22} color={fg} />
      </View>
    );
  if (type === "zap")
    return (
      <View style={wrap}>
        <Zap size={22} color={fg} />
      </View>
    );
  return (
    <View style={wrap}>
      <Brain size={22} color={fg} />
    </View>
  );
}

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeIndex">;

export default function PracticeScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;

  const [addedSubjectIds, setAddedSubjectIds] = useState<string[]>([
    ...DEFAULT_PRACTICE_SUBJECT_IDS,
  ]);
  const [selectedSubject, setSelectedSubject] = useState<string>("math");
  const [selectedTopic, setSelectedTopic] = useState<string | null>("Algebra");
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyId>("medium");
  const [selectedCount, setSelectedCount] = useState<(typeof QUESTION_COUNTS)[number]>(20);

  useFocusEffect(
    useCallback(() => {
      const id = route.params?.addedSubjectId;
      if (!id) return;
      const valid = PRACTICE_SUBJECT_CATALOG.some((s) => s.id === id);
      if (!valid) {
        navigation.setParams({ addedSubjectId: undefined });
        return;
      }
      setAddedSubjectIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setSelectedSubject(id);
      const list = TOPICS_BY_SUBJECT[id];
      setSelectedTopic(list?.[0] ?? null);
      navigation.setParams({ addedSubjectId: undefined });
    }, [route.params?.addedSubjectId, navigation])
  );

  const subjectsOnScreen = useMemo(
    () =>
      addedSubjectIds
        .map((sid) => subjectDefById(sid))
        .filter((s): s is NonNullable<typeof s> => s != null),
    [addedSubjectIds]
  );

  const currentTopics = TOPICS_BY_SUBJECT[selectedSubject] ?? [];
  const availableCount = addedSubjectIds.length;
  const canAddMore = useMemo(
    () => PRACTICE_SUBJECT_CATALOG.some((s) => !addedSubjectIds.includes(s.id)),
    [addedSubjectIds]
  );

  const estimatedLabel = useMemo(() => {
    if (selectedCount <= 10) return "ESTIMATED TIME: 8-12 MINUTES";
    if (selectedCount <= 20) return "ESTIMATED TIME: 15-20 MINUTES";
    return "ESTIMATED TIME: 35-45 MINUTES";
  }, [selectedCount]);

  const canStart = !!selectedSubject && !!selectedTopic;

  const pickSubject = (id: string) => {
    setSelectedSubject(id);
    const list = TOPICS_BY_SUBJECT[id];
    setSelectedTopic(list?.[0] ?? null);
  };

  const openAddSubject = () => {
    navigation.navigate("AddPracticeSubject", { currentSubjectIds: addedSubjectIds });
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPadding }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.heroTitle}>Practice Setup</Text>
        <Text style={styles.heroSubtitle}>
          Customize your study session to master specific SPM concepts with AI-assisted insights.
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Select Subject</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{availableCount} Available</Text>
          </View>
        </View>

        <View style={styles.subjectGrid}>
          {subjectsOnScreen.map((s) => {
            const on = selectedSubject === s.id;
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [
                  styles.subjectCard,
                  on && styles.subjectCardOn,
                  pressed && styles.subjectCardPressed,
                ]}
                onPress={() => pickSubject(s.id)}
              >
                {on && (
                  <View style={styles.subjectCheck}>
                    <Check size={12} color="#FFFFFF" strokeWidth={3} />
                  </View>
                )}
                <View style={[styles.subjectIconSq, on && styles.subjectIconSqOn]}>
                  <PracticeSubjectIcon type={s.icon} color={on ? BRAND : "#94A3B8"} />
                </View>
                <Text style={[styles.subjectName, on && styles.subjectNameOn]}>{s.label}</Text>
                <Text style={[styles.subjectMeta, on && styles.subjectMetaOn]}>
                  {s.topicsActive} Topics Active
                </Text>
              </Pressable>
            );
          })}

          {canAddMore && (
            <Pressable
              style={({ pressed }) => [styles.moreCard, pressed && styles.moreCardPressed]}
              onPress={openAddSubject}
            >
              <Plus size={28} color={BRAND} strokeWidth={2} />
              <Text style={styles.moreLabel}>MORE</Text>
              <Text style={styles.moreHint}>Add another subject</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitlePlain}>Choose Topic</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicScroll}>
          {currentTopics.map((topic) => {
            const on = selectedTopic === topic;
            return (
              <Pressable
                key={topic}
                style={[styles.topicChip, on && styles.topicChipOn]}
                onPress={() => setSelectedTopic(topic)}
              >
                <Text style={[styles.topicChipText, on && styles.topicChipTextOn]}>{topic}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitlePlain}>Difficulty</Text>
        {DIFFICULTIES.map((d) => {
          const on = selectedDifficulty === d.id;
          return (
            <Pressable
              key={d.id}
              style={[styles.diffCard, on && styles.diffCardOn]}
              onPress={() => setSelectedDifficulty(d.id)}
            >
              <DifficultyIcon type={d.icon} bg={d.iconBg} fg={d.iconColor} />
              <View style={styles.diffBody}>
                <Text style={styles.diffTitle}>{d.title}</Text>
                <Text style={styles.diffSub}>{d.subtitle}</Text>
              </View>
              <View style={[styles.diffTag, { backgroundColor: d.tagBg }]}>
                <Text style={[styles.diffTagText, { color: d.tagText }]}>{d.tag}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitlePlain}>Question Count</Text>
        <View style={styles.countRow}>
          {QUESTION_COUNTS.map((c) => {
            const on = selectedCount === c;
            return (
              <Pressable
                key={c}
                style={[styles.countBtn, on && styles.countBtnOn]}
                onPress={() => setSelectedCount(c)}
              >
                {on ? (
                  <LinearGradient
                    colors={["#6B63E8", BRAND]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.countBtnGrad}
                  >
                    <Text style={styles.countBtnTextOn}>{c}</Text>
                  </LinearGradient>
                ) : (
                  <Text style={styles.countBtnText}>{c}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable style={[styles.startBtn, !canStart && styles.startBtnOff]} disabled={!canStart}>
        <LinearGradient
          colors={canStart ? ["#6B63E8", BRAND] : ["#A1A1AA", "#9CA3AF"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.startGrad}
        >
          <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
          <Text style={styles.startText}>Start Practice</Text>
        </LinearGradient>
      </Pressable>

      <Text style={styles.estimated}>{estimatedLabel}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screenBackground,
  },
  hero: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: "#0F172A",
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: "#64748B",
    lineHeight: 21,
    marginTop: 8,
  },
  section: {
    marginTop: 22,
    paddingHorizontal: 20,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#0F172A",
  },
  sectionTitlePlain: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#0F172A",
    marginBottom: 14,
  },
  countPill: {
    backgroundColor: BRAND_SOFT,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  countPillText: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  subjectGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  subjectCard: {
    width: "47.5%",
    backgroundColor: "#F1F5F9",
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: "transparent",
    position: "relative",
  },
  subjectCardPressed: {
    opacity: 0.88,
  },
  subjectCardOn: {
    backgroundColor: "#FFFFFF",
    borderColor: BRAND
  },
  subjectCheck: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  subjectIconSq: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  subjectIconSqOn: {
    backgroundColor: BRAND_SOFT,
  },
  subjectName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: "#334155",
  },
  subjectNameOn: {
    color: "#0F172A",
  },
  subjectMeta: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: "#94A3B8",
    marginTop: 4,
  },
  subjectMetaOn: {
    color: BRAND,
  },
  moreCard: {
    width: "47.5%",
    minHeight: 140,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#C4B5FD",
    backgroundColor: "#FAF5FF",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  moreCardPressed: {
    opacity: 0.88,
    backgroundColor: "#F3E8FF",
  },
  moreLabel: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: BRAND,
    letterSpacing: 0.5,
  },
  moreHint: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: "#7C3AED",
    textAlign: "center",
    marginTop: 2,
  },
  topicScroll: {
    flexDirection: "row",
    gap: 10,
    paddingRight: 20,
  },
  topicChip: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  topicChipOn: {
    backgroundColor: BRAND,
  },
  topicChipText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#475569",
  },
  topicChipTextOn: {
    color: "#FFFFFF",
    fontFamily: fonts.semiBold,
  },
  diffCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "#F1F5F9",
  },
  diffCardOn: {
    borderColor: BRAND,
    backgroundColor: "#FAFBFF",
  },
  diffBody: {
    flex: 1,
    minWidth: 0,
  },
  diffTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#0F172A",
  },
  diffSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: "#64748B",
    marginTop: 4,
    lineHeight: 17,
  },
  diffTag: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: 100,
  },
  diffTagText: {
    fontSize: 9,
    fontFamily: fonts.bold,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  countRow: {
    flexDirection: "row",
    gap: 12,
  },
  countBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  countBtnOn: {
    borderColor: "transparent",
    backgroundColor: "transparent"
  },
  countBtnGrad: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  countBtnText: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: "#64748B",
  },
  countBtnTextOn: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  startBtn: {
    marginHorizontal: 20,
    marginTop: 28,
    borderRadius: 999,
    overflow: "hidden",
  },
  startBtnOff: {
    opacity: 0.55,
  },
  startGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  startText: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  estimated: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.8,
    color: "#94A3B8",
    marginTop: 20,
    marginBottom: 8,
  },
});
