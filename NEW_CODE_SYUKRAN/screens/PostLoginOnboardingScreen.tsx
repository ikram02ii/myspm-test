import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  GraduationCap,
  Lightbulb,
  Search,
  Sparkles,
  User,
} from "lucide-react-native";

import { fonts } from "../constants/fonts";
import { POST_LOGIN_ONBOARDING_STORAGE_KEY } from "../constants/storageKeys";
import { theme } from "../constants/palette";
import {
  completeMobileOnboarding,
  fetchOnboardingData,
  type OnboardingSchool,
  type OnboardingSubject,
  type OnboardingTeacher,
} from "../services/mobileOnboarding";

const brand = theme.brand;
const brandDeep = theme.brandDeep;
const textMain = "#1A1A1A";
const textMuted = "#737373";
const tipBg = "#FFFBEB";
const tipBorder = "#FDE68A";
const infoBg = theme.brandSoftSage;

/** Core subject fixed in UI; display name comes from LOV when present. */
const CORE_SUBJECT_CODE = "BM";

const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "NA";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
};

type RootNav = {
  replace: (name: "Main") => void;
  goBack: () => void;
};

export default function PostLoginOnboardingScreen({ navigation }: { navigation: RootNav }) {
  
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const [formLevel, setFormLevel] = useState<4 | 5 | null>(null);
  const [subjects, setSubjects] = useState<OnboardingSubject[]>([]);
  const [schools, setSchools] = useState<OnboardingSchool[]>([]);
  const [teachers, setTeachers] = useState<OnboardingTeacher[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [followedTeachers, setFollowedTeachers] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pct = useMemo(() => [25, 50, 75, 100][step], [step]);
  const stepLabel = useMemo(() => `STEP 0${step + 1} OF 4`, [step]);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setLoadingData(true);
      setLoadingError(null);
      try {
        const data = await fetchOnboardingData();
        if (!active) return;
        setSubjects(data.subjects);
        setSchools(data.schools);
        setTeachers(data.teachers);
        setSelectedSubjects([CORE_SUBJECT_CODE]);
      } catch (error) {
        if (!active) return;
        setLoadingError(error instanceof Error ? error.message : "Failed to load onboarding options");
      } finally {
        if (active) setLoadingData(false);
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, []);

  const filteredSchools = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((s) => {
      const hay = `${s.name} ${s.city ?? ""} ${s.state ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [schoolQuery, schools]);

  const bmSubject = useMemo(
    () => subjects.find((s) => s.code === CORE_SUBJECT_CODE),
    [subjects]
  );
  const selectableSubjects = useMemo(
    () => subjects.filter((s) => s.code !== CORE_SUBJECT_CODE),
    [subjects]
  );

  const canNext = () => {
    if (step === 0) return formLevel !== null;
    if (loadingData) return false;
    if (step === 1) return selectedSubjects.length > 0;
    if (step === 2) return selectedSchoolId !== null;
    if (step === 3) return followedTeachers.length >= 1;
    return true;
  };

  const handleBack = () => {
    if (step === 0) navigation.goBack();
    else setStep((s) => s - 1);
  };

  const handlePrimary = async () => {
    if (step < 3) {
      if (!canNext()) return;
      setStep((s) => s + 1);
      return;
    }
    if (submitting) return;
    if (!canNext()) return;
    if (formLevel === null || selectedSchoolId === null) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await completeMobileOnboarding({
        formLevel,
        schoolId: selectedSchoolId,
        subjectCodes: selectedSubjects,
        teacherIds: followedTeachers,
      });
      await AsyncStorage.setItem(POST_LOGIN_ONBOARDING_STORAGE_KEY, "true");
      navigation.replace("Main");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to save preferences");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSubject = (id: string) => {
    if (id === CORE_SUBJECT_CODE) return;
    setSelectedSubjects((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleFollow = (id: number) => {
    setFollowedTeachers((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const renderProgress = () => (
    <View style={styles.progressBlock}>
      <View style={styles.progressLabels}>
        <Text style={styles.progressStepText}>{stepLabel}</Text>
        <Text style={styles.progressPct}>{pct}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );

  const renderStep0 = () => (
    <View style={styles.stepInner}>
      <Text style={styles.stepTitle}>Which Form are you in?</Text>
      <Text style={styles.stepSubtitle}>
        We&apos;ll tailor your SPM curriculum based on your current level.
      </Text>

      <View style={styles.formRow}>
        <Pressable
          style={[styles.formCard, formLevel === 4 && styles.formCardSelected]}
          onPress={() => setFormLevel(4)}
        >
          {formLevel === 4 && (
            <View style={styles.checkBadge}>
              <Check size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          )}
          <GraduationCap size={36} color={formLevel === 4 ? brand : textMuted} />
          <Text style={[styles.formCardTitle, formLevel === 4 && styles.formCardTitleOn]}>
            Form 4
          </Text>
          <Text style={styles.formCardHint}>The Foundation Year</Text>
        </Pressable>

        <Pressable
          style={[styles.formCard, formLevel === 5 && styles.formCardSelected]}
          onPress={() => setFormLevel(5)}
        >
          {formLevel === 5 && (
            <View style={styles.checkBadge}>
              <Check size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          )}
          <Sparkles size={36} color={formLevel === 5 ? brand : textMuted} />
          <Text style={[styles.formCardTitle, formLevel === 5 && styles.formCardTitleOn]}>
            Form 5
          </Text>
          <Text style={styles.formCardHint}>The SPM Sprint</Text>
        </Pressable>
      </View>

      <View style={styles.tipBox}>
        <Lightbulb size={20} color="#CA8A04" />
        <Text style={styles.tipText}>
          <Text style={styles.tipBold}>Smart Tip: </Text>
          Starting in Form 4 builds a stronger base—many top scorers begin revision early.
        </Text>
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepInner}>
      <Text style={styles.stepTitle}>
        Select your <Text style={styles.stepTitleAccent}>subjects</Text>
      </Text>
      <Text style={styles.stepSubtitle}>
        Customize your learning path for the upcoming SPM examinations.
      </Text>

      <View style={[styles.coreCard, styles.coreCardSelected]}>
        <View style={styles.checkBadge}>
          <Check size={14} color="#FFFFFF" strokeWidth={3} />
        </View>
        <BookOpen size={22} color={brand} />
        <View style={styles.coreCardText}>
          <Text style={styles.coreTitle}>{bmSubject?.name ?? "Bahasa Melayu"}</Text>
          <Text style={styles.coreBadge}>Core Requirement</Text>
        </View>
      </View>

      <View style={styles.subjectGrid}>
        {selectableSubjects.map((subject) => {
          const on = selectedSubjects.includes(subject.code);
          return (
            <Pressable
              key={subject.code}
              style={[styles.subjectCell, on && styles.subjectCellSelected]}
              onPress={() => toggleSubject(subject.code)}
            >
              {on && (
                <View style={[styles.checkBadge, styles.checkBadgeSmall]}>
                  <Check size={11} color="#FFFFFF" strokeWidth={3} />
                </View>
              )}
              <BookOpen size={20} color={on ? brand : textMuted} />
              <Text style={[styles.subjectLabel, on && styles.subjectLabelOn]}>{subject.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tipBox}>
        <Lightbulb size={20} color="#CA8A04" />
        <Text style={styles.tipText}>
          You can add elective subjects like Add Maths or Physics later in settings.
        </Text>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepInner}>
      <Text style={styles.stepTitle}>
        Find your <Text style={styles.stepTitleAccent}>school.</Text>
      </Text>
      <Text style={styles.stepSubtitle}>
        Connect with your peers and see how your school ranks in the odyssey.
      </Text>

      <View style={styles.searchBar}>
        <Search size={20} color={textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for school name..."
          placeholderTextColor="#A3A3A3"
          value={schoolQuery}
          onChangeText={setSchoolQuery}
        />
      </View>

      <View style={styles.schoolList}>
        {filteredSchools.map((school) => {
          const sel = selectedSchoolId === school.id;
          const locationLine = [school.city, school.state]
            .map((x) => (x ?? "").trim())
            .filter((x) => x.length > 0)
            .join(", ");
          console.log(school)
          return (
            <Pressable
              key={school.id}
              style={[styles.schoolRow, sel && styles.schoolRowSelected]}
              onPress={() => setSelectedSchoolId(school.id)}
            >
              <View style={styles.schoolLogo}>
                <Text style={styles.schoolLogoText}>{getInitials(school.name)}</Text>
              </View>
              <View style={styles.schoolInfo}>
                <Text style={styles.schoolName}>{school.name}</Text>
                {locationLine.length > 0 ? (
                  <Text style={styles.schoolCityState}>{locationLine}</Text>
                ) : null}
              </View>
              <ChevronRight size={20} color={sel ? brand : textMuted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepInner}>
      <Text style={styles.stepTitle}>Follow top teachers</Text>
      <Text style={styles.stepSubtitle}>
        Get practice sets and tips directly in your feed. Follow at least one teacher to continue.
      </Text>

      {teachers.map((t) => {
        const following = followedTeachers.includes(t.id);
        const followerCount = t.followerCount ?? 0;
        return (
          <View key={t.id} style={styles.teacherCard}>
            <View style={styles.teacherAvatar}>
              <User size={22} color={brand} />
            </View>
            <View style={styles.teacherBody}>
              <Text style={styles.teacherName}>{t.name}</Text>
              <Text style={styles.teacherFollowerCount}>
                {followerCount} {followerCount === 1 ? "follower" : "followers"}
              </Text>
            </View>
            <Pressable
              style={[styles.followBtn, following && styles.followBtnOn]}
              onPress={() => toggleFollow(t.id)}
            >
              {following ? (
                <>
                  <Check size={16} color="#FFFFFF" strokeWidth={3} />
                  <Text style={styles.followBtnTextOn}>Following</Text>
                </>
              ) : (
                <Text style={styles.followBtnText}>Follow</Text>
              )}
            </Pressable>
          </View>
        );
      })}

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Did you know?</Text>
        <Text style={styles.infoBody}>
          Students who follow at least one teacher complete 40% more practice sets on average.
        </Text>
      </View>
    </View>
  );

  const renderLoadingState = () => (
    <View style={styles.loadingBlock}>
      <ActivityIndicator size="large" color={brand} />
      <Text style={styles.loadingText}>Loading onboarding data...</Text>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.loadingBlock}>
      <Text style={styles.errorText}>{loadingError ?? "Failed to load onboarding data."}</Text>
    </View>
  );

  const renderStep = () => {
    if (loadingData) return renderLoadingState();
    if (loadingError) return renderErrorState();
    switch (step) {
      case 0:
        return renderStep0();
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      default:
        return renderStep3();
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.headerBack} hitSlop={12}>
          <ArrowLeft size={22} color={textMain} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Onboarding First Time Login
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderProgress()}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStep()}
      </ScrollView>

      <View
        style={[
          styles.footer,
          (step === 1 || step === 2) && styles.footerAlignEnd,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        {step === 3 && submitError ? (
          <Text style={styles.footerError}>{submitError}</Text>
        ) : null}
        {step === 0 ? (
          <View style={styles.footerRow0}>
            <Pressable onPress={handleBack} style={styles.iconBackBtn}>
              <ArrowLeft size={20} color={textMain} />
            </Pressable>
            <Pressable
              onPress={handlePrimary}
              disabled={!canNext()}
              style={({ pressed }) => [
                styles.circleNext,
                !canNext() && styles.circleNextDisabled,
                pressed && canNext() && styles.circleNextPressed,
              ]}
            >
              <LinearGradient
                colors={[brandDeep, brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.circleNextGrad}
              >
                <ArrowRight size={22} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
          </View>
        ) : step === 3 ? (
          <Pressable
            onPress={handlePrimary}
            disabled={submitting || !canNext()}
            style={({ pressed }) => [
              pressed && !submitting && canNext() && styles.fullBtnPressed,
            ]}
          >
            <LinearGradient
              colors={
                submitting || !canNext() ? ["#C4C4C4", "#B0B0B0"] : [brandDeep, brand]
              }
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.fullBtn}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.fullBtnText}>Complete Setup</Text>
                  <ArrowRight size={20} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            onPress={handlePrimary}
            disabled={!canNext()}
            style={({ pressed }) => [pressed && canNext() && styles.fullBtnPressed]}
          >
            <LinearGradient
              colors={canNext() ? [brandDeep, brand] : ["#C4C4C4", "#B0B0B0"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.nextPill, !canNext() && styles.nextPillDisabled]}
            >
              <Text style={styles.nextPillText}>
                {step === 1 ? "Next Step" : "Next"}
              </Text>
              <ArrowRight size={20} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: textMain,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  progressBlock: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressStepText: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.5,
    color: textMuted,
  },
  progressPct: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: brand,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: brand,
    borderRadius: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  stepInner: {
    paddingTop: 8,
  },
  loadingBlock: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: textMuted,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    textAlign: "center",
  },
  stepTitle: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: textMain,
    lineHeight: 32,
    marginBottom: 8,
  },
  stepTitleAccent: {
    color: brand,
    fontFamily: fonts.bold,
  },
  stepSubtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: textMuted,
    lineHeight: 22,
    marginBottom: 24,
  },
  formRow: {
    flexDirection: "row",
    gap: 12,
  },
  formCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    backgroundColor: "#FAFAFA",
    paddingVertical: 28,
    paddingHorizontal: 12,
    alignItems: "center",
    position: "relative",
  },
  formCardSelected: {
    borderColor: brand,
    backgroundColor: "#F5F7FF",
  },
  checkBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: brand,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadgeSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    top: 8,
    right: 8,
  },
  formCardTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: textMain,
    marginTop: 12,
  },
  formCardTitleOn: {
    color: brand,
  },
  formCardHint: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: textMuted,
    marginTop: 4,
    textAlign: "center",
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: tipBg,
    borderWidth: 1,
    borderColor: tipBorder,
    borderRadius: 14,
    padding: 14,
    marginTop: 24,
  },
  tipBold: {
    fontFamily: fonts.semiBold,
    color: textMain,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: "#57534E",
    lineHeight: 20,
  },
  coreCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    padding: 16,
    marginBottom: 14,
    position: "relative",
  },
  coreCardSelected: {
    borderColor: brand,
    backgroundColor: "#F5F7FF",
  },
  coreCardText: {
    flex: 1,
  },
  coreTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: textMain,
  },
  coreBadge: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: textMuted,
    marginTop: 4,
  },
  subjectGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  subjectCell: {
    width: "48%",
    flexGrow: 1,
    minWidth: "47%",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    paddingVertical: 20,
    paddingHorizontal: 12,
    alignItems: "center",
    position: "relative",
    backgroundColor: "#FAFAFA",
  },
  subjectCellSelected: {
    borderColor: brand,
    backgroundColor: "#F5F7FF",
  },
  subjectLabel: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: textMain,
    marginTop: 10,
  },
  subjectLabelOn: {
    color: brand,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F4F4F5",
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 50,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E4E4E7",
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: textMain,
    paddingVertical: 0,
  },
  schoolList: {
    gap: 10,
  },
  schoolRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  schoolRowSelected: {
    borderColor: brand,
    backgroundColor: "#F5F7FF",
  },
  schoolLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolLogoText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: brand,
  },
  schoolInfo: {
    flex: 1,
  },
  schoolName: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: textMain,
  },
  schoolCityState: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: textMuted,
    marginTop: 4,
  },
  teacherCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  teacherAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  teacherBody: {
    flex: 1,
    minWidth: 0,
  },
  teacherName: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: textMain,
  },
  teacherFollowerCount: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: textMuted,
    marginTop: 4,
  },
  followBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: brand,
    backgroundColor: "#FFFFFF",
  },
  followBtnOn: {
    backgroundColor: brand,
    borderColor: brand,
  },
  followBtnText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: brand,
  },
  followBtnTextOn: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: "#FFFFFF",
  },
  infoBox: {
    backgroundColor: infoBg,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  infoTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: brandDeep,
    marginBottom: 6,
  },
  infoBody: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: "#4338CA",
    lineHeight: 20,
  },
  footerAlignEnd: {
    alignItems: "flex-end",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      }
    }),
  },
  footerError: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  footerRow0: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBackBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#F4F4F5",
    alignItems: "center",
    justifyContent: "center",
  },
  circleNext: {
    borderRadius: 999,
    overflow: "hidden"
  },
  circleNextDisabled: {
    opacity: 0.4,
  },
  circleNextPressed: {
    opacity: 0.92,
  },
  circleNextGrad: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  nextPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  nextPillDisabled: {
    opacity: 0.7,
  },
  nextPillText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  fullBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    borderRadius: 999,
  },
  fullBtnText: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  fullBtnPressed: {
    opacity: 0.92,
  },
});
