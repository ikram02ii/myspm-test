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
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookOpen, ChevronDown, ChevronRight, Sparkles, Plus } from "lucide-react-native";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";

import { ToastMessage } from "../components/ui/ToastMessage";
import {
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
  type MathLineDiagram,
  type PracticeSetQuestion,
  type PracticeSetSummary,
} from "../services/mobilePracticeSets";
import { ragApiPost } from "../services/ragApi";
import { parseAiGeneratedMcqAnswer, parseAiGeneratedOpenEnded } from "../utils/parseAiMcq";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoftSage;
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeLibrary">;

const AI_TOPIC_OPTIONS_BY_SUBJECT: Record<string, string[]> = {
  math: [
    "Chapter 1: Quadratic Functions and Equations in One Variable",
    "Chapter 2: Number Bases",
    "Chapter 3: Logical Reasoning",
    "Chapter 4: Operations on Sets",
    "Chapter 5: Network in Graph Theory",
    "Chapter 6: Linear Inequalities in Two Variables",
    "Chapter 7: Graphs of Motion",
    "Chapter 8: Measures of Dispersion for Ungrouped Data",
    "Chapter 9: Probability of Combined Events",
    "Chapter 10: Consumer Mathematics: Financial Management",
  ],
  addmath: [
    "Chapter 1: Functions",
    "Chapter 2: Quadratic Functions",
    "Chapter 3: Systems of Equations",
    "Chapter 4: Indices, Surds and Logarithms",
    "Chapter 5: Progressions",
    "Chapter 6: Linear Law",
    "Chapter 7: Coordinate Geometry",
    "Chapter 8: Vectors",
    "Chapter 9: Solution of Triangles",
    "Chapter 10: Index Numbers",
  ],
  biology: [
    "Chapter 1: Introduction to Biology and Laboratory Rules",
    "Chapter 2: Cell Biology and Organization",
    "Chapter 3: Movement of Substances Across a Plasma Membrane",
    "Chapter 4: Chemical Composition in a Cell",
    "Chapter 5: Metabolism and Enzymes",
    "Chapter 6: Cell Division",
    "Chapter 7: Cellular Respiration",
    "Chapter 8: Respiratory Systems in Humans and Animals",
    "Chapter 9: Nutrition and the Human Digestive System",
    "Chapter 10: Transport in Humans and Animals",
    "Chapter 11: Immunity in Humans",
    "Chapter 12: Coordination and Response in Humans",
    "Chapter 13: Homeostasis and the Human Urinary System",
    "Chapter 14: Support and Movement in Humans and Animals",
    "Chapter 15: Sexual Reproduction, Development, and Growth in Humans and Animals",
  ],
  physics: [
    "Chapter 1: Measurement",
    "Chapter 2: Force and Motion I",
    "Chapter 3: Gravitation",
    "Chapter 4: Heat",
    "Chapter 5: Waves",
    "Chapter 6: Light and Optics",
  ],
  chemistry: [
    "Chapter 1: Introduction to Chemistry",
    "Chapter 2: Matter and the Atomic Structure",
    "Chapter 3: The Mole Concept, Chemical Formula and Equations",
    "Chapter 4: The Periodic Table of Elements",
    "Chapter 5: Chemical Bond",
    "Chapter 6: Acid, Base and Salt",
    "Chapter 7: Rate of Reaction",
    "Chapter 8: Manufactured Substances in Industry",
  ],
  science: [
    "Chapter 1: Safety Measures in Laboratory",
    "Chapter 2: Emergency Help",
    "Chapter 3: Techniques of Measuring the Parameters of Body Health",
    "Chapter 4: Green Technology for Environmental Sustainability",
    "Chapter 5: Genetics",
    "Chapter 6: Support, Movement and Growth",
    "Chapter 7: Body Coordination",
    "Chapter 8: Elements and Substances",
    "Chapter 9: Chemicals in Industry",
    "Chapter 10: Chemicals in Medicine and Health",
    "Chapter 11: Force and Motion",
    "Chapter 12: Nuclear Energy",
  ],
  history: [
    "Bab 1: Warisan Negara Bangsa",
    "Bab 2: Kebangkitan Nasionalisme",
    "Bab 3: Konflik Dunia dan Pendudukan Jepun di Negara Kita",
    "Bab 4: Era Peralihan Kuasa British di Negara Kita",
    "Bab 5: Persekutuan Tanah Melayu 1948",
    "Bab 6: Ancaman Komunis dan Perisytiharan Darurat",
    "Bab 7: Usaha ke Arah Kemerdekaan",
    "Bab 8: Pilihan Raya",
    "Bab 9: Perlembagaan Persekutuan Tanah Melayu 1957",
    "Bab 10: Pemasyhuran Kemerdekaan",
  ],
  bm: [
    "Karangan",
    "Rumusan",
    "Pemahaman",
    "Tatabahasa",
    "Novel",
  ],
  english: [
    "Reading comprehension",
    "Essay writing",
    "Grammar",
    "Summary writing",
    "Literature",
  ],
};

function normalizeAiTopicSubjectKey(input: string | null | undefined): string | null {
  const raw = input?.trim().toLowerCase();
  if (!raw) return null;
  const compact = raw.replace(/[\s_-]+/g, "");

  if (compact === "math" || compact === "mathematics") return "math";
  if (compact === "addmath" || compact === "addmaths" || compact === "additionalmath" || compact === "additionalmathematics") {
    return "addmath";
  }
  if (compact === "bio" || compact === "biology") return "biology";
  if (compact === "science") return "science";
  if (compact === "phy" || compact === "physics") return "physics";
  if (compact === "chem" || compact === "chemistry") return "chemistry";
  if (compact === "history" || compact === "sejarah") return "history";
  if (compact === "bm" || compact === "bahasamelayu" || compact === "malay") return "bm";
  if (compact === "english" || compact === "eng") return "english";

  return AI_TOPIC_OPTIONS_BY_SUBJECT[compact] ? compact : null;
}

type RagGenerateResponse = {
  answer: string;
  sources?: unknown;
  diagram?: MathLineDiagram;
  diagrams?: MathLineDiagram[];
};

function hasRenderableDiagram(diagram: MathLineDiagram | undefined): diagram is MathLineDiagram {
  return diagram?.type === "line-chart" && Array.isArray(diagram.points) && diagram.points.length >= 2;
}

function attachDiagramsToQuestions(
  questions: PracticeSetQuestion[],
  diagrams: MathLineDiagram[] | undefined,
): PracticeSetQuestion[] {
  const renderableDiagrams = (diagrams ?? []).filter(hasRenderableDiagram);
  if (renderableDiagrams.length === 0 || questions.length === 0) return questions;

  const diagramsByQuestion = new Map<number, MathLineDiagram>();
  renderableDiagrams.forEach((diagram, index) => {
    const questionIndex =
      typeof diagram.questionIndex === "number" && Number.isInteger(diagram.questionIndex)
        ? diagram.questionIndex
        : index + 1;
    diagramsByQuestion.set(questionIndex, diagram);
  });

  return questions.map((question, index) => {
    const diagram = diagramsByQuestion.get(index + 1);
    return diagram ? { ...question, diagram } : question;
  });
}

function questionHistoryKey(subject: string, topic: string, questionType: string): string {
  return [subject, topic || "general", questionType]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function summarizeQuestionStems(questions: PracticeSetQuestion[]): string[] {
  return questions
    .map((question) => question.questionText.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function favouriteKey(f: MobileSubjectFavourite): string {
  return f.code.trim().toUpperCase();
}

type SubjectTile = MobileSubjectFavourite & {
  topicKey?: keyof typeof AI_TOPIC_OPTIONS_BY_SUBJECT;
};

const CHAPTER_SUBJECT_TILES: SubjectTile[] = [
  { code: "math", name: "Mathematics", topicKey: "math" },
  { code: "addmath", name: "Additional Math", topicKey: "addmath" },
  { code: "science", name: "Science", topicKey: "science" },
  { code: "biology", name: "Biology", topicKey: "biology" },
  { code: "physics", name: "Physics", topicKey: "physics" },
  { code: "chemistry", name: "Chemistry", topicKey: "chemistry" },
  { code: "history", name: "Sejarah", topicKey: "history" },
];

function getSubjectTileTopicKey(tile: SubjectTile | undefined): keyof typeof AI_TOPIC_OPTIONS_BY_SUBJECT | null {
  if (!tile) return null;
  if (tile.topicKey) return tile.topicKey;
  const key = normalizeAiTopicSubjectKey(tile.code) ?? normalizeAiTopicSubjectKey(tile.name);
  return key && AI_TOPIC_OPTIONS_BY_SUBJECT[key] ? key : null;
}

function withChapterSubjectTiles(items: MobileSubjectFavourite[]): SubjectTile[] {
  const chapterKeys = new Set(
    CHAPTER_SUBJECT_TILES.map((tile) => tile.topicKey).filter(Boolean),
  );

  const extraTiles = items.filter((item) => {
    const key = normalizeAiTopicSubjectKey(item.code) ?? normalizeAiTopicSubjectKey(item.name);
    return !key || !chapterKeys.has(key);
  });

  return [...CHAPTER_SUBJECT_TILES, ...extraTiles];
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
  const aiQuestionHistoryRef = useRef<Map<string, string[]>>(new Map());
  const [aiGenerating, setAiGenerating] = useState(false);
  const [metaFormLevel, setMetaFormLevel] = useState<string>("Form 4");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiMode, setAiMode] = useState<"general" | "topic">("general");
  const [aiTopic, setAiTopic] = useState("");
  const [aiTopicDropdownOpen, setAiTopicDropdownOpen] = useState(false);
  const [aiQuestionType, setAiQuestionType] = useState<"mcq" | "subjective">("mcq");
  const [aiQuestionCount, setAiQuestionCount] = useState<number>(5);

  function backendSubjectFromPracticeCode(code: string | null): string | null {
    if (!code) return null;
    const c = code.trim().toLowerCase();
    const map: Record<string, string> = {
      biology: "Biology",
      science: "Science",
      physics: "Physics",
      chemistry: "Chemistry",
      english: "English",
      bm: "BM",
      history: "Sejarah",
      sejarah: "Sejarah",
      math: "Math",
      addmath: "Additional Math",
      addmaths: "Additional Math",
      additionalmath: "Additional Math",
      additionalmathematics: "Additional Math",
    };
    return map[c] ?? null;
  }

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
    if (Platform.OS === "web") return;

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

  const subjectsToAdd = useMemo(() => {
    const have = new Set(favourites.map((f) => favouriteKey(f)));
    return onboardingSubjects.filter((s) => !have.has(favouriteKey({ code: s.code, name: s.name })));
  }, [favourites, onboardingSubjects]);

  const setsInFavourites = useMemo(() => {
    if (favourites.length === 0) {
      return sets;
    }
    return sets.filter((item) => favourites.some((f) => practiceSetSubjectMatchesFavourite(item.subject, f)));
  }, [sets, favourites]);

  const favouriteTiles = useMemo(() => withChapterSubjectTiles(favourites), [favourites]);

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

  const aiTopicOptions = useMemo(() => {
    const activeFavourite = favouriteTiles.find((f) => favouriteKey(f) === selectedSubjectKey);
    const explicitTopicKey = getSubjectTileTopicKey(activeFavourite);
    if (explicitTopicKey) {
      return AI_TOPIC_OPTIONS_BY_SUBJECT[explicitTopicKey];
    }

    const candidates = [
      selectedSubjectKey,
      activeFavourite?.code,
      activeFavourite?.name,
      backendSubjectFromPracticeCode(selectedSubjectKey),
    ];

    for (const candidate of candidates) {
      const key = normalizeAiTopicSubjectKey(candidate);
      if (key && AI_TOPIC_OPTIONS_BY_SUBJECT[key]) {
        return AI_TOPIC_OPTIONS_BY_SUBJECT[key];
      }
    }

    return [];
  }, [favouriteTiles, selectedSubjectKey]);

  useEffect(() => {
    if (aiMode !== "topic") return;

    const firstTopic = aiTopicOptions[0];
    if (!firstTopic) {
      setAiTopic("");
      return;
    }

    if (!aiTopicOptions.includes(aiTopic)) {
      setAiTopic(firstTopic);
      setAiTopicDropdownOpen(false);
    }
  }, [aiMode, aiTopic, aiTopicOptions]);

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
    setAiTopicDropdownOpen(false);
    setAiModalOpen(true);
  };

  const questionTypeLabel = aiQuestionType === "mcq" ? "MCQ (A-D)" : "subjective";

  const buildAiQuery = (subject: string): string => {
    const selectedTopic = aiMode === "topic" ? aiTopic.trim() : "";
    const topicPart =
      selectedTopic.length > 0
        ? ` focused on topic: ${selectedTopic}`
        : "";
    const historyKey = questionHistoryKey(subject, selectedTopic, aiQuestionType);
    const recentQuestions = aiQuestionHistoryRef.current.get(historyKey) ?? [];
    const avoidInstructions =
      recentQuestions.length > 0
        ? `Do not repeat or closely paraphrase these recently generated question stems: ${recentQuestions.map((q, i) => `${i + 1}. ${q}`).join(" ")} `
        : "";
    const variationSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const variationInstructions =
      `Use a different set of question angles each time. ` +
      `Cover varied subtopics or skills within the selected chapter. ` +
      `Mix recall, understanding, application, and KBAT/HOTS where suitable. ` +
      `Avoid repeating common wording or previously generated question patterns. ` +
      avoidInstructions +
      `Variation seed: ${variationSeed}.`;
    const isMathSubject = /^(math|additional math)$/i.test(subject.trim());
    const graphInstructions = isMathSubject
      ? `For every generated question, decide whether a line graph, coordinate graph, function graph, or motion graph would help. If yes, append DIAGRAM_JSON after all questions. Use a diagrams array and include one diagram object per graph-based question. Set questionIndex to the matching Soalan number, for example questionIndex 1 for Soalan 1 and questionIndex 4 for Soalan 4. Graph-related chapters may include diagrams for multiple Soalan, not only the first one. `
      : "";

    const bilingualStemRule =
      /^(sejarah|bm)$/i.test(subject.trim())
        ? ""
        : `Each question stem must be bilingual on two separate lines: first line "EN: ...", second line "BM: ..." (BM must start on a new line, not the same line as EN). `;

    if (aiQuestionType === "mcq") {
      return `Generate ${aiQuestionCount} SPM ${subject} ${questionTypeLabel} questions${topicPart}. ${variationInstructions} ${graphInstructions}${bilingualStemRule}Include A-D options, Jawapan and Penjelasan.`;
    }

    return `Generate ${aiQuestionCount} SPM ${subject} subjective questions${topicPart}. ${variationInstructions} ${graphInstructions}${bilingualStemRule}Use this exact format for every item: Soalan 1, then the question stem on the next line, then Jawapan: with a concise model answer, then Marking points: with brief marking points. Repeat as Soalan 2, Soalan 3, and so on.`;
  };

  const runAiGenerate = async () => {
    if (aiGenerating) return;
    const practiceCode = selectedSubjectKey;
    const backendSubject = backendSubjectFromPracticeCode(practiceCode);
    if (!backendSubject) {
      showComingSoonWithSound();
      return;
    }
    if (aiMode === "topic" && aiTopic.trim().length === 0) {
      showToast("Please select a topic.");
      return;
    }
    const selectedTopic = aiMode === "topic" ? aiTopic.trim() : "";
    const historyKey = questionHistoryKey(backendSubject, selectedTopic, aiQuestionType);

    setAiGenerating(true);
    try {
      const result = await ragApiPost<RagGenerateResponse>(
        "/rag/generate",
        {
          query: buildAiQuery(backendSubject),
          subject: backendSubject,
          topK: 8,
        },
      );

      if (aiQuestionType === "mcq") {
        const parsed = attachDiagramsToQuestions(
          parseAiGeneratedMcqAnswer(result.answer),
          result.diagrams ?? (result.diagram ? [result.diagram] : []),
        );
        if (parsed.length === 0) {
          showToast("AI did not return parseable MCQ questions. Try again.");
          return;
        }
        aiQuestionHistoryRef.current.set(historyKey, summarizeQuestionStems(parsed));
        setAiModalOpen(false);
        (navigation as any).navigate("PracticeSession", {
          title: "AI Practice",
          questions: parsed,
          subject: backendSubject,
          formLevel: metaFormLevel,
        });
        return;
      }

      const parsedOpen = attachDiagramsToQuestions(
        parseAiGeneratedOpenEnded(result.answer, "short"),
        result.diagrams ?? (result.diagram ? [result.diagram] : []),
      );
      if (parsedOpen.length === 0) {
        showToast("AI did not return parseable questions. Try again.");
        return;
      }
      aiQuestionHistoryRef.current.set(historyKey, summarizeQuestionStems(parsedOpen));

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
            <Text style={styles.modalTitle}>Generate AI questions</Text>
            <Text style={styles.modalHint}>Choose mode, question type, and how many questions.</Text>

            <Text style={styles.fieldLabel}>Mode</Text>
            <View style={styles.choiceRow}>
              <Pressable
                style={[styles.choiceChip, aiMode === "general" && styles.choiceChipActive]}
                onPress={() => setAiMode("general")}
              >
                <Text style={[styles.choiceChipText, aiMode === "general" && styles.choiceChipTextActive]}>
                  General
                </Text>
              </Pressable>
              <Pressable
                style={[styles.choiceChip, aiMode === "topic" && styles.choiceChipActive]}
                onPress={() => setAiMode("topic")}
              >
                <Text style={[styles.choiceChipText, aiMode === "topic" && styles.choiceChipTextActive]}>
                  Topic-specific
                </Text>
              </Pressable>
            </View>

            {aiMode === "topic" ? (
              <>
                <Text style={styles.fieldLabel}>Topic</Text>
                <Pressable
                  style={styles.topicDropdownButton}
                  onPress={() => setAiTopicDropdownOpen((open) => !open)}
                  disabled={aiGenerating}
                >
                  <Text
                    style={[
                      styles.topicDropdownText,
                      aiTopic.trim().length === 0 && styles.topicDropdownPlaceholder,
                    ]}
                  >
                    {aiTopic.trim().length > 0 ? aiTopic : "Select a topic"}
                  </Text>
                  <ChevronDown
                    size={18}
                    color={colors.textSecondary}
                    style={aiTopicDropdownOpen ? styles.topicDropdownIconOpen : undefined}
                  />
                </Pressable>

                {aiTopicDropdownOpen ? (
                  <View style={styles.topicDropdownMenu}>
                    <ScrollView nestedScrollEnabled style={styles.topicDropdownScroll}>
                      {aiTopicOptions.map((topic) => (
                        <Pressable
                          key={topic}
                          style={[
                            styles.topicDropdownItem,
                            aiTopic === topic && styles.topicDropdownItemActive,
                          ]}
                          onPress={() => {
                            setAiTopic(topic);
                            setAiTopicDropdownOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.topicDropdownItemText,
                              aiTopic === topic && styles.topicDropdownItemTextActive,
                            ]}
                          >
                            {topic}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
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

            <Pressable
              style={({ pressed }) => [styles.generateActionBtn, pressed && styles.generateActionBtnPressed]}
              onPress={() => void runAiGenerate()}
              disabled={aiGenerating}
            >
              <LinearGradient
                colors={["#F15A29", "#5B2EFF"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.generateActionBtnGrad}
              >
                <Text style={styles.generateActionBtnText}>
                  {aiGenerating ? "Generating..." : "Generate"}
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
  topicDropdownButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.16)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topicDropdownText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  topicDropdownPlaceholder: {
    color: "#94A3B8",
  },
  topicDropdownIconOpen: {
    transform: [{ rotate: "180deg" }],
  },
  topicDropdownMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  topicDropdownScroll: {
    maxHeight: 176,
  },
  topicDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
  },
  topicDropdownItemActive: {
    backgroundColor: theme.brandSoft,
  },
  topicDropdownItemText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  topicDropdownItemTextActive: {
    color: BRAND,
    fontFamily: fonts.bold,
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
