import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookOpen, ChevronRight, Sparkles, Plus } from "lucide-react-native";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";

import { ToastMessage } from "../components/ui/ToastMessage";
import {
  backendSubjectFromPracticeCode,
  practiceSetSubjectMatchesFavourite,
  subjectTileShortLabel,
} from "../constants/practiceSubjectFilter";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import {
  addProfileSubjectFavourite,
  fetchMobileProfile,
  type MobileSubjectFavourite,
} from "../services/mobileProfile";
import {
  fetchOnboardingData,
  type OnboardingSubject,
} from "../services/mobileOnboarding";
import {
  fetchPracticeSetList,
  type PracticeSetQuestion,
  type PracticeSetSummary,
} from "../services/mobilePracticeSets";
import {
  defaultTopicForPart,
  ENGLISH_SPEAKING_PART_OPTIONS,
  isEnglishPracticeCode,
  topicCategoriesForPart,
  type EnglishSpeakingPart,
} from "../constants/englishSpeaking";
import { ragApiGet, ragApiPost } from "../services/ragApi";
import { buildEnglishSpeakingQuery, parseEnglishSpeakingAnswer } from "../utils/englishSpeakingGenerate";
import { parseAiGeneratedMcqAnswer, parseAiGeneratedOpenEnded } from "../utils/parseAiMcq";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoftSage;
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type RagGenerateResponse = {
  answer: string;
  sources?: unknown;
  openEndedQuestions?: PracticeSetQuestion[];
};

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeLibrary">;

function favouriteKey(f: MobileSubjectFavourite): string {
  return f.code.trim().toUpperCase();
}

function withEnglishTile(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  const hasEnglish = items.some((item) => {
    const k = favouriteKey(item);
    return k === "ENGLISH" || k === "ENG" || k === "EN";
  });
  if (hasEnglish) return items;
  return [...items, { code: "english", name: "English" }];
}

function withBiologyTile(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  const hasBiology = items.some((item) => favouriteKey(item) === "BIOLOGY");
  if (hasBiology) return items;
  return [...items, { code: "biology", name: "Biology" }];
}

function withChemistryTile(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  const hasChemistry = items.some((item) => favouriteKey(item) === "CHEMISTRY");
  if (hasChemistry) return items;
  return [...items, { code: "chemistry", name: "Chemistry" }];
}

function withMathTile(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  const hasMath = items.some((item) => {
    const k = favouriteKey(item);
    return k === "MATH" || k === "MATHEMATICS" || item.name.trim().toLowerCase() === "mathematics";
  });
  if (hasMath) return items;
  return [...items, { code: "math", name: "Mathematics" }];
}

function withAdditionalMathTile(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  const hasAddMath = items.some((item) => {
    const k = favouriteKey(item);
    if (k === "ADDMATH" || k === "ADDMATHS") return true;
    const n = item.name.trim().toLowerCase();
    return (
      n.includes("additional mathematics") ||
      n.includes("additional math") ||
      n.includes("add maths") ||
      n === "add math"
    );
  });
  if (hasAddMath) return items;
  return [...items, { code: "addmath", name: "Additional Math" }];
}

/** Practice screen: do not surface Science or Sejarah/History tiles or filters. */
function stripScienceAndHistory(items: MobileSubjectFavourite[]): MobileSubjectFavourite[] {
  return items.filter((f) => {
    const k = favouriteKey(f);
    const n = f.name.trim().toLowerCase();
    if (k === "SCIENCE" || n === "science") return false;
    if (k === "SEJARAH" || k === "HISTORY" || n === "sejarah" || n === "history") return false;
    return true;
  });
}

function isExcludedOnboardingSubject(s: OnboardingSubject): boolean {
  const k = s.code.trim().toUpperCase();
  const n = s.name.trim().toLowerCase();
  if (k === "SCIENCE" || n === "science") return true;
  if (k === "SEJARAH" || k === "HISTORY" || n === "sejarah" || n === "history") return true;
  return false;
}

export default function PracticeSetsLibraryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const [sets, setSets] = useState<PracticeSetSummary[]>([]);
  const [favourites, setFavourites] = useState<MobileSubjectFavourite[]>([]);
  const [activeSubjectCode, setActiveSubjectCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [onboardingSubjects, setOnboardingSubjects] = useState<OnboardingSubject[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const borderGlow = useRef(new Animated.Value(0)).current;
  const borderPulse = useRef(new Animated.Value(0)).current;
  const borderShine = useRef(new Animated.Value(0)).current;
  const [aiGenerating, setAiGenerating] = useState(false);
  const [metaFormLevel, setMetaFormLevel] = useState<string>("Form 4");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiMode, setAiMode] = useState<"general" | "topic">("general");
  const [aiTopic, setAiTopic] = useState("");
  /** Exact `rag_textbook_chunks.chapter` string from DB when user picks topic-specific mode. */
  const [aiSelectedChapter, setAiSelectedChapter] = useState("");
  const [ragChapters, setRagChapters] = useState<string[]>([]);
  const [ragChaptersLoading, setRagChaptersLoading] = useState(false);
  const [aiQuestionType, setAiQuestionType] = useState<"mcq" | "subjective">("mcq");
  const [aiQuestionCount, setAiQuestionCount] = useState<number>(5);
  const [englishSpeakingPart, setEnglishSpeakingPart] = useState<EnglishSpeakingPart>("part1");
  const [englishTopicCategory, setEnglishTopicCategory] = useState(() => defaultTopicForPart("part1"));
  const [englishQuestionCount, setEnglishQuestionCount] = useState<number>(5);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  const showComingSoonWithSound = () => {
    const msg = "Stay tuned for this feature";
    showToast(msg);
    void Notifications.scheduleNotificationAsync({
      content: {
        title: "MySPM",
        body: msg,
        sound: "default",
      },
      trigger: null,
    });
  };

  useEffect(() => {
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(borderGlow, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(borderGlow, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(borderPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(borderPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    const shineLoop = Animated.loop(
      Animated.timing(borderShine, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );

    glowLoop.start();
    pulseLoop.start();
    shineLoop.start();

    return () => {
      glowLoop.stop();
      pulseLoop.stop();
      shineLoop.stop();
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [borderGlow, borderPulse, borderShine]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profileData, list] = await Promise.all([
        fetchMobileProfile(),
        fetchPracticeSetList(),
      ]);
      setFavourites(profileData.subjectFavourites);
      setSets(list);
      setMetaFormLevel(
        typeof profileData.formLevel === "number" && Number.isFinite(profileData.formLevel)
          ? `Form ${profileData.formLevel}`
          : "Form 4",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setSets([]);
      setFavourites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    setLoading(true);
    void load().finally(() => setRefreshing(false));
  };

  const openAddModal = useCallback(async () => {
    setAddOpen(true);
    try {
      const { subjects } = await fetchOnboardingData();
      setOnboardingSubjects(subjects);
    } catch {
      setOnboardingSubjects([]);
    }
  }, []);

  const favouritesVisible = useMemo(() => stripScienceAndHistory(favourites), [favourites]);

  const subjectsToAdd = useMemo(() => {
    const have = new Set(favourites.map((f) => favouriteKey(f)));
    return onboardingSubjects.filter(
      (s) => !isExcludedOnboardingSubject(s) && !have.has(favouriteKey({ code: s.code, name: s.name })),
    );
  }, [favourites, onboardingSubjects]);

  const setsInFavourites = useMemo(() => {
    if (favouritesVisible.length === 0) {
      return sets;
    }
    return sets.filter((item) =>
      favouritesVisible.some((f) => practiceSetSubjectMatchesFavourite(item.subject, f)),
    );
  }, [sets, favouritesVisible]);

  const favouriteTiles = useMemo(
    () =>
      withAdditionalMathTile(
        withMathTile(withChemistryTile(withBiologyTile(withEnglishTile(favouritesVisible)))),
      ),
    [favouritesVisible],
  );

  /** Selected subject for filtering: tap a tile to show only that subject; default first favourite when any exist. */
  const selectedSubjectKey = useMemo(() => {
    if (favouriteTiles.length === 0) {
      return null;
    }
    if (
      activeSubjectCode != null &&
      favouriteTiles.some((f) => favouriteKey(f) === activeSubjectCode)
    ) {
      return activeSubjectCode;
    }
    return favouriteKey(favouriteTiles[0]);
  }, [favouriteTiles, activeSubjectCode]);

  const isEnglishGenerator = useMemo(
    () => isEnglishPracticeCode(selectedSubjectKey),
    [selectedSubjectKey],
  );

  const englishTopicOptions = useMemo(
    () => topicCategoriesForPart(englishSpeakingPart),
    [englishSpeakingPart],
  );

  const visibleSets = useMemo(() => {
    if (favouriteTiles.length === 0) {
      return setsInFavourites;
    }
    const fav = favouriteTiles.find((f) => favouriteKey(f) === selectedSubjectKey);
    if (!fav) {
      return [];
    }
    return setsInFavourites.filter((item) => practiceSetSubjectMatchesFavourite(item.subject, fav));
  }, [setsInFavourites, favouriteTiles, selectedSubjectKey]);

  const onTilePress = (f: MobileSubjectFavourite) => {
    setActiveSubjectCode(favouriteKey(f));
  };

  const onPickNewSubject = async (code: string) => {
    setAddBusy(true);
    try {
      await addProfileSubjectFavourite(code);
      const profileData = await fetchMobileProfile();
      setFavourites(profileData.subjectFavourites);
      setAddOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add subject");
    } finally {
      setAddBusy(false);
    }
  };

  const openAiGenerateModal = () => {
    setAiModalOpen(true);
  };

  const backendSubjectForModal = useMemo(
    () => backendSubjectFromPracticeCode(selectedSubjectKey),
    [selectedSubjectKey],
  );

  useEffect(() => {
    if (!aiModalOpen || isEnglishGenerator) return;
    const subject = backendSubjectForModal;
    if (!subject) {
      setRagChapters([]);
      return;
    }
    let cancelled = false;
    setRagChaptersLoading(true);
    void ragApiGet<{ chapters?: string[] }>("/rag/textbook-chapters", {
      subject,
      form: metaFormLevel,
    })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.chapters) ? res.chapters : [];
        setRagChapters(list);
        setAiSelectedChapter((prev) => (prev && list.includes(prev) ? prev : list[0] ?? ""));
      })
      .catch(() => {
        if (!cancelled) setRagChapters([]);
      })
      .finally(() => {
        if (!cancelled) setRagChaptersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aiModalOpen, backendSubjectForModal, metaFormLevel, isEnglishGenerator]);

  useEffect(() => {
    setEnglishTopicCategory(defaultTopicForPart(englishSpeakingPart));
  }, [englishSpeakingPart]);

  const questionTypeLabel = aiQuestionType === "mcq" ? "MCQ (A-D)" : "subjective";

  const buildAiQuery = (subject: string, chapterDbLabel: string): string => {
    const topicPart =
      aiMode === "topic" && chapterDbLabel.length > 0
        ? ` aligned to this syllabus chapter heading (stay within its scope): ${chapterDbLabel}`
        : "";

    if (aiQuestionType === "mcq") {
      return `Generate ${aiQuestionCount} SPM ${subject} ${questionTypeLabel} questions${topicPart}. Include A-D options, Jawapan and Penjelasan.`;
    }

    return `Generate ${aiQuestionCount} short SPM ${subject} subjective questions${topicPart}. Each question must be worth 1 to 3 marks only, and the mark allocation must appear in every question stem, e.g. "(2 marks)" or "(3 marks)". Keep each stem concise so students can answer in a few sentences. For each question, include a concise model answer and marking points.`;
  };

  const runAiGenerate = async () => {
    if (aiGenerating) return;
    const practiceCode = selectedSubjectKey;
    const backendSubject = backendSubjectFromPracticeCode(practiceCode);
    if (!backendSubject) {
      showComingSoonWithSound();
      return;
    }
    const chapterDb =
      aiMode === "topic" ? (aiSelectedChapter.trim() || aiTopic.trim()) : "";
    if (aiMode === "topic" && chapterDb.length === 0) {
      showToast(
        ragChapters.length > 0
          ? "Please select a chapter from the list."
          : "No textbook chapters loaded — type a chapter phrase, or check subject/form and RAG ingest.",
      );
      return;
    }

    setAiGenerating(true);
    try {
      const topicTrim = chapterDb;
      const result = await ragApiPost<RagGenerateResponse>(
        "/rag/generate",
        {
          query: buildAiQuery(backendSubject, topicTrim),
          subject: backendSubject,
          form: metaFormLevel,
          topK: 8,
          createOpenEndedRubrics: aiQuestionType === "subjective",
          ...(aiMode === "topic" && topicTrim.length > 0
            ? {
                chapterHint: topicTrim,
                ...( /^(chapter|bab|unit)\s*\d+/i.test(topicTrim) ? { chapterFilter: topicTrim } : {} ),
              }
            : {}),
        },
      );

      if (aiQuestionType === "mcq") {
        const parsed = parseAiGeneratedMcqAnswer(result.answer);
        if (parsed.length === 0) {
          showToast("AI did not return parseable MCQ questions. Try again.");
          return;
        }
        setAiModalOpen(false);
        (navigation as any).navigate("PracticeSession", {
          title: "AI Practice",
          questions: parsed,
          subject: backendSubject,
          formLevel: metaFormLevel,
        });
        return;
      }

      const structuredOpen: PracticeSetQuestion[] = Array.isArray(result.openEndedQuestions)
        ? result.openEndedQuestions.map((item, idx) => ({
            id: typeof item?.id === "number" ? item.id : idx + 1,
            sortOrder: typeof item?.sortOrder === "number" ? item.sortOrder : idx + 1,
            questionText: typeof item?.questionText === "string" ? item.questionText : "",
            questionType: typeof item?.questionType === "string" ? item.questionType : "short_answer",
            difficulty: typeof item?.difficulty === "string" ? item.difficulty : "mixed",
            options: [],
            correctAnswer: "",
            explanation: typeof item?.explanation === "string" ? item.explanation : null,
            maxMarks: typeof item?.maxMarks === "number" ? item.maxMarks : undefined,
            questionForGrade: typeof item?.questionForGrade === "string" ? item.questionForGrade : undefined,
            rubricId: typeof item?.rubricId === "string" ? item.rubricId : undefined,
            modelAnswer: typeof item?.modelAnswer === "string" ? item.modelAnswer : undefined,
            rubricIdeas: Array.isArray(item?.rubricIdeas) ? item.rubricIdeas : undefined,
          })).filter((item) => item.questionText.trim().length > 0)
        : [];
      const parsedOpen = structuredOpen.length > 0
        ? structuredOpen
        : parseAiGeneratedOpenEnded(result.answer, "short");
      if (parsedOpen.length === 0) {
        showToast("AI did not return parseable questions. Try again.");
        return;
      }

      setAiModalOpen(false);
      (navigation as any).navigate("PracticeSession", {
        title: "AI Practice",
        questions: parsedOpen,
        subject: backendSubject,
        formLevel: metaFormLevel,
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to generate questions.");
    } finally {
      setAiGenerating(false);
    }
  };

  const runEnglishSpeakingGenerate = async () => {
    if (aiGenerating) return;
    const backendSubject = backendSubjectFromPracticeCode(selectedSubjectKey);
    if (!backendSubject || !isEnglishGenerator) {
      showComingSoonWithSound();
      return;
    }

    setAiGenerating(true);
    try {
      const topic = englishTopicCategory.trim() || defaultTopicForPart(englishSpeakingPart);
      const count =
        englishSpeakingPart === "part1"
          ? englishQuestionCount
          : englishSpeakingPart === "part3"
            ? Math.min(6, Math.max(2, englishQuestionCount))
            : 1;
      const query = buildEnglishSpeakingQuery({
        form: metaFormLevel,
        part: englishSpeakingPart,
        topicCategory: topic,
        questionCount: count,
      });
      const result = await ragApiPost<RagGenerateResponse>("/rag/generate", {
        query,
        subject: backendSubject,
        form: metaFormLevel,
        skipRetrieval: true,
        englishSpeaking: true,
      });
      const parsed = parseEnglishSpeakingAnswer(result.answer, englishSpeakingPart);
      if (parsed.length === 0) {
        showToast("AI did not return parseable speaking prompts. Try again.");
        return;
      }
      setAiModalOpen(false);
      navigation.navigate("PracticeSession", {
        title:
          englishSpeakingPart === "part1"
            ? "English Speaking Part 1"
            : englishSpeakingPart === "part3"
              ? "English Speaking Part 3"
              : "English Speaking Part 2",
        questions: parsed,
        subject: backendSubject,
        formLevel: metaFormLevel,
        practiceMode: "speaking",
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to generate speaking practice.");
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { paddingTop: webTopPadding }]}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 20,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BRAND}
            colors={[BRAND]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.heroTitle}>Practice sets</Text>
          <Text style={styles.heroSubtitle}>
            Choose a set and work through questions in order.
          </Text>
        </View>

        {!loading || favouriteTiles.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tileRow}
            style={styles.tileRowScroll}
            nestedScrollEnabled
          >
            {favouriteTiles.map((f, index) => {
              const key = favouriteKey(f);
              const active = selectedSubjectKey === key;
              return (
                <Pressable
                  key={`${key}-${index}`}
                  style={[styles.subjectTile, active && styles.subjectTileActive]}
                  onPress={() => onTilePress(f)}
                >
                  <Text style={[styles.subjectTileText, active && styles.subjectTileTextActive]}>
                    {subjectTileShortLabel(f.code)}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [styles.addTile, pressed && styles.addTilePressed]}
              onPress={() => void openAddModal()}
            >
              <Plus size={22} color={BRAND} strokeWidth={2.2} />
            </Pressable>
          </ScrollView>
        ) : null}

        {loading && sets.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading && !error && visibleSets.length === 0 ? (
          <Text style={styles.empty}>
            {favourites.length === 0
              ? "Tap + to add a subject and see practice sets for it."
              : "No practice sets for this subject yet. \nYou may generate set Question via AI or try another subject above."}
          </Text>
        ) : null}

        {visibleSets.map((item) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() =>
              navigation.navigate("PracticeSetDetail", {
                setId: item.id,
                title: item.title,
                subject: item.subject,
                formLevel: item.formLevel,
                questionCount: item.questionCount,
              })
            }
          >
            <View style={styles.cardIconWrap}>
              <BookOpen size={22} color={BRAND} strokeWidth={2} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardMeta}>
                {item.subject} · Form {item.formLevel}
              </Text>
              <Text style={styles.cardCount}>
                {item.questionCount} question{item.questionCount === 1 ? "" : "s"}
              </Text>
            </View>
            <ChevronRight size={22} color="#94A3B8" />
          </Pressable>
        ))}

        {!loading ? (
          <AnimatedLinearGradient
            colors={[
              "#FF2D55",
              "#FF9500",
              "#FFD60A",
              "#34C759",
              "#00C7BE",
              "#0A84FF",
              "#5E5CE6",
              "#FF2D55",
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[
              styles.aiBorder,
              {
                opacity: borderGlow.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
                transform: [
                  {
                    scale: borderPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }),
                  },
                ],
              },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.aiShine,
                {
                  transform: [
                    {
                      translateX: borderShine.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-220, 220],
                      }),
                    },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.aiShineGrad}
              />
            </Animated.View>

            <Pressable
              style={({ pressed }) => [styles.aiButton, pressed && styles.aiButtonPressed]}
              onPress={openAiGenerateModal}
            >
              <LinearGradient
                colors={["#F15A29", "#5B2EFF"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.aiButtonGrad}
              >
                <View style={styles.aiButtonInner}>
                  <Sparkles size={18} color="#FFFFFF" />
                  <Text style={styles.aiButtonText}>
                    Generate questions via AI
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>
          </AnimatedLinearGradient>
        ) : null}
      </ScrollView>

      <ToastMessage message={toastMessage} top={insets.top + 12} />

      <Modal transparent visible={addOpen} animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !addBusy && setAddOpen(false)}>
          <Pressable style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Add subject</Text>
            <Text style={styles.modalHint}>Shown sets are limited to your subject picks. Add more here.</Text>
            {addBusy ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color={BRAND} />
            ) : subjectsToAdd.length === 0 ? (
              <Text style={styles.modalEmpty}>All available subjects are already added.</Text>
            ) : (
              <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
                {subjectsToAdd.map((s) => (
                  <Pressable
                    key={s.code}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    onPress={() => void onPickNewSubject(s.code)}
                  >
                    <Text style={styles.modalRowText}>{s.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.modalClose} onPress={() => !addBusy && setAddOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={aiModalOpen} animationType="fade" onRequestClose={() => setAiModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !aiGenerating && setAiModalOpen(false)}>
          <Pressable
            style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>
              {isEnglishGenerator ? "English speaking practice" : "Generate AI questions"}
            </Text>
            <Text style={styles.modalHint}>
              {isEnglishGenerator
                ? "Generate SPM-style oral prompts, then practise with timed recording and AI marking."
                : "Pick Form (must match ingested textbooks), then topic-specific uses chapter titles from the database."}
            </Text>

            <Text style={styles.fieldLabel}>Form (matches textbook in RAG)</Text>
            <View style={styles.choiceRow}>
              {(["Form 4", "Form 5"] as const).map((lvl) => (
                <Pressable
                  key={lvl}
                  style={[styles.choiceChip, metaFormLevel === lvl && styles.choiceChipActive]}
                  onPress={() => {
                    setMetaFormLevel(lvl);
                    setAiSelectedChapter("");
                  }}
                >
                  <Text
                    style={[styles.choiceChipText, metaFormLevel === lvl && styles.choiceChipTextActive]}
                  >
                    {lvl}
                  </Text>
                </Pressable>
              ))}
            </View>

            {isEnglishGenerator ? (
              <>
                <Text style={styles.fieldLabel}>Skill</Text>
                <View style={styles.choiceRow}>
                  <View style={[styles.choiceChip, styles.choiceChipActive]}>
                    <Text style={[styles.choiceChipText, styles.choiceChipTextActive]}>Speaking</Text>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Speaking part</Text>
                <View style={styles.choiceRow}>
                  {ENGLISH_SPEAKING_PART_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.id}
                      style={[
                        styles.choiceChip,
                        englishSpeakingPart === opt.id && styles.choiceChipActive,
                      ]}
                      onPress={() => setEnglishSpeakingPart(opt.id)}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          englishSpeakingPart === opt.id && styles.choiceChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Topic category</Text>
                <View style={styles.choiceRow}>
                  {englishTopicOptions.map((topic) => (
                    <Pressable
                      key={topic}
                      style={[
                        styles.choiceChip,
                        englishTopicCategory === topic && styles.choiceChipActive,
                      ]}
                      onPress={() => setEnglishTopicCategory(topic)}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          englishTopicCategory === topic && styles.choiceChipTextActive,
                        ]}
                      >
                        {topic}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {englishSpeakingPart === "part1" ? (
                  <>
                    <Text style={styles.fieldLabel}>Number of questions</Text>
                    <View style={styles.choiceRow}>
                      {[5, 8, 10].map((count) => (
                        <Pressable
                          key={count}
                          style={[
                            styles.choiceChip,
                            englishQuestionCount === count && styles.choiceChipActive,
                          ]}
                          onPress={() => setEnglishQuestionCount(count)}
                        >
                          <Text
                            style={[
                              styles.choiceChipText,
                              englishQuestionCount === count && styles.choiceChipTextActive,
                            ]}
                          >
                            {count}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <>
            <Text style={styles.fieldLabel}>Mode</Text>
            <View style={styles.choiceRow}>
              <Pressable
                style={[styles.choiceChip, aiMode === "general" && styles.choiceChipActive]}
                onPress={() => {
                  setAiMode("general");
                  setAiSelectedChapter("");
                }}
              >
                <Text style={[styles.choiceChipText, aiMode === "general" && styles.choiceChipTextActive]}>
                  General
                </Text>
              </Pressable>
              <Pressable
                style={[styles.choiceChip, aiMode === "topic" && styles.choiceChipActive]}
                onPress={() => {
                  setAiMode("topic");
                  setAiSelectedChapter("");
                }}
              >
                <Text style={[styles.choiceChipText, aiMode === "topic" && styles.choiceChipTextActive]}>
                  Topic-specific
                </Text>
              </Pressable>
            </View>

            {aiMode === "topic" ? (
              <>
                <Text style={styles.fieldLabel}>Syllabus topic (from your textbook DB)</Text>
                {ragChaptersLoading ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} color={BRAND} />
                ) : ragChapters.length > 0 ? (
                  <ScrollView
                    style={styles.topicChapterScroll}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {ragChapters.map((ch) => {
                      const active = aiSelectedChapter === ch;
                      return (
                        <Pressable
                          key={ch}
                          style={[styles.topicChapterRow, active && styles.topicChapterRowActive]}
                          onPress={() => {
                            setAiSelectedChapter(ch);
                            setAiTopic("");
                          }}
                        >
                          <Text
                            style={[styles.topicChapterRowText, active && styles.topicChapterRowTextActive]}
                            numberOfLines={3}
                          >
                            {ch}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Text style={styles.modalHint}>
                    No chapter headings found for this subject and form. Ingest a textbook or pick another
                    form. You can still type a phrase below as a soft retrieval hint.
                  </Text>
                )}
                <Text style={styles.fieldLabel}>
                  {ragChapters.length > 0 ? "Or type a custom chapter hint" : "Chapter hint (typed)"}
                </Text>
                <TextInput
                  value={aiTopic}
                  onChangeText={(t) => {
                    setAiTopic(t);
                    if (t.trim().length > 0) setAiSelectedChapter("");
                  }}
                  placeholder="Only if list is empty or you need a different phrase"
                  placeholderTextColor="#94A3B8"
                  style={styles.topicInput}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Question type</Text>
            <View style={styles.choiceRow}>
              {(["mcq", "subjective"] as const).map((type) => (
                <Pressable
                  key={type}
                  style={[styles.choiceChip, aiQuestionType === type && styles.choiceChipActive]}
                  onPress={() => setAiQuestionType(type)}
                >
                  <Text
                    style={[styles.choiceChipText, aiQuestionType === type && styles.choiceChipTextActive]}
                  >
                    {type === "mcq" ? "MCQ" : "Subjective"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Number of questions</Text>
            <View style={styles.choiceRow}>
              {[5, 10, 15, 20].map((count) => (
                <Pressable
                  key={count}
                  style={[styles.choiceChip, aiQuestionCount === count && styles.choiceChipActive]}
                  onPress={() => setAiQuestionCount(count)}
                >
                  <Text
                    style={[
                      styles.choiceChipText,
                      aiQuestionCount === count && styles.choiceChipTextActive,
                    ]}
                  >
                    {count}
                  </Text>
                </Pressable>
              ))}
            </View>

              </>
            )}

            <Pressable
              style={({ pressed }) => [styles.generateActionBtn, pressed && styles.generateActionBtnPressed]}
              onPress={() =>
                void (isEnglishGenerator ? runEnglishSpeakingGenerate() : runAiGenerate())
              }
              disabled={aiGenerating}
            >
              <LinearGradient
                colors={["#F15A29", "#5B2EFF"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.generateActionBtnGrad}
              >
                <Text style={styles.generateActionBtnText}>
                  {aiGenerating
                    ? "Generating..."
                    : isEnglishGenerator
                      ? "Start speaking practice"
                      : "Generate"}
                </Text>
              </LinearGradient>
            </Pressable>

            <Pressable style={styles.modalClose} onPress={() => !aiGenerating && setAiModalOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  hero: { marginBottom: 8 },
  heroTitle: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: 8,
  },
  tileRowScroll: { marginBottom: 16, marginHorizontal: -4, flexGrow: 0 },
  tileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  subjectTile: {
    minWidth: 52,
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  subjectTileActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  subjectTileText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  subjectTileTextActive: {
    color: "#FFFFFF",
  },
  addTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: BRAND,
    backgroundColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  addTilePressed: { opacity: 0.85 },
  centered: { paddingVertical: 48, alignItems: "center" },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    marginBottom: 12,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    gap: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },
  cardPressed: { opacity: 0.92 },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    lineHeight: 22,
  },
  cardMeta: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginTop: 4,
  },
  cardCount: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: BRAND,
    marginTop: 6,
  },
  aiButton: {
    borderRadius: 14,
    overflow: "hidden",
  },
  aiButtonPressed: { opacity: 0.92 },
  aiButtonGrad: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  aiButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  aiButtonText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: "#FFFFFF",
    textAlign: "center",
  },
  aiBorder: {
    marginTop: 8,
    borderRadius: 16,
    padding: 2,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 5,
  },
  aiShine: {
    position: "absolute",
    top: -6,
    bottom: -6,
    width: 90,
    left: 0,
    opacity: 0.9,
    transform: [{ skewX: "-20deg" }],
  },
  aiShineGrad: {
    flex: 1,
    borderRadius: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: "72%",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 19,
  },
  modalList: { maxHeight: 320 },
  modalRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(15, 23, 42, 0.08)",
  },
  modalRowPressed: { opacity: 0.75 },
  modalRowText: {
    fontSize: 16,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  modalEmpty: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginVertical: 20,
  },
  modalClose: {
    marginTop: 12,
    alignSelf: "center",
    paddingVertical: 12,
  },
  modalCloseText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  genBtn: {
    marginTop: 12,
    borderRadius: 14,
    overflow: "hidden",
  },
  genBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  genBtnText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    marginTop: 10,
    marginBottom: 8,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.18)",
    backgroundColor: "#FFFFFF",
  },
  choiceChipActive: {
    borderColor: BRAND,
    backgroundColor: BRAND,
  },
  choiceChipText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.text,
  },
  choiceChipTextActive: {
    color: "#FFFFFF",
  },
  topicChapterScroll: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    borderRadius: 12,
    marginBottom: 4,
  },
  topicChapterRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(15, 23, 42, 0.08)",
  },
  topicChapterRowActive: {
    backgroundColor: BRAND_SOFT,
  },
  topicChapterRowText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 20,
  },
  topicChapterRowTextActive: {
    fontFamily: fonts.semiBold,
    color: colors.text,
  },
  topicInput: {
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.16)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    backgroundColor: "#FFFFFF",
  },
  generateActionBtn: {
    marginTop: 14,
    borderRadius: 12,
    overflow: "hidden",
  },
  generateActionBtnPressed: { opacity: 0.92 },
  generateActionBtnGrad: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  generateActionBtnText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
});
