import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { BookOpen, ChevronRight, Plus } from "lucide-react-native";

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
  type PracticeSetSummary,
} from "../services/mobilePracticeSets";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoftSage;

type Props = NativeStackScreenProps<PracticeStackParamList, "PracticeLibrary">;

function favouriteKey(f: MobileSubjectFavourite): string {
  return f.code.trim().toUpperCase();
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profileData, list] = await Promise.all([
        fetchMobileProfile(),
        fetchPracticeSetList(),
      ]);
      setFavourites(profileData.subjectFavourites);
      setSets(list);
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

  /** Selected subject for filtering: tap a tile to show only that subject; default first favourite when any exist. */
  const selectedSubjectKey = useMemo(() => {
    if (favourites.length === 0) {
      return null;
    }
    if (
      activeSubjectCode != null &&
      favourites.some((f) => favouriteKey(f) === activeSubjectCode)
    ) {
      return activeSubjectCode;
    }
    return favouriteKey(favourites[0]);
  }, [favourites, activeSubjectCode]);

  const visibleSets = useMemo(() => {
    if (favourites.length === 0) {
      return setsInFavourites;
    }
    const fav = favourites.find((f) => favouriteKey(f) === selectedSubjectKey);
    if (!fav) {
      return [];
    }
    return setsInFavourites.filter((item) => practiceSetSubjectMatchesFavourite(item.subject, fav));
  }, [setsInFavourites, favourites, selectedSubjectKey]);

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

        {!loading || favourites.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tileRow}
            style={styles.tileRowScroll}
            nestedScrollEnabled
          >
            {favourites.map((f, index) => {
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
          <Pressable
            style={({ pressed }) => [styles.aiPlaceholderButton, pressed && styles.aiPlaceholderButtonPressed]}
            onPress={() => showToast("Stay Tuned for this Features")}
          >
            <Text style={styles.aiPlaceholderButtonText}>Generate Set Question via AI</Text>
          </Pressable>
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
  aiPlaceholderButton: {
    marginTop: 8,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "rgba(15, 23, 42, 0.2)",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    alignItems: "center",
  },
  aiPlaceholderButtonPressed: { opacity: 0.88 },
  aiPlaceholderButtonText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    textAlign: "center",
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
});
