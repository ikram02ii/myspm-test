import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRight, BarChart2, BookOpen, Brain, Flame, Star } from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";

type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string };
};

const accent = "#7B89F4";
const accentDeep = "#5B6AE8";
const welcomeBg = "#F8F9FB";
const bodyMuted = "#666666";

export default function WelcomeScreen({
  navigation,
}: {
  navigation: { navigate: (name: keyof AuthStackParamList, params?: object) => void };
}) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 24 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + webTopPadding }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.heroWrap}>
          <View style={styles.heroCard}>
            <View style={styles.heroPlaceholder}>
              <Text style={styles.heroPlaceholderText}>to be added</Text>
            </View>
            <View style={styles.badgeTopScorer}>
              <View style={styles.badgeStarCircle}>
                <Star size={12} color="#CA8A04" fill="#EAB308" />
              </View>
              <Text style={styles.badgeTopScorerText}>Top Scorer</Text>
            </View>
            <View style={styles.badgeStreak}>
              <Flame size={16} color="#EAB308" fill="#FDE047" />
              <Text style={styles.badgeStreakText}>12 DAY STREAK</Text>
            </View>
          </View>
        </View>

        <View style={styles.brandRow}>
          <LinearGradient
            colors={[accent, accentDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoCircle}
          >
            <BookOpen size={22} color="#FFFFFF" strokeWidth={2.2} />
          </LinearGradient>
          <Text style={styles.brandName}>
            <Text style={styles.brandMy}>My</Text>
            <Text style={styles.brandSpm}>SPM</Text>
          </Text>
        </View>

        <Text style={styles.headline}>
          <Text style={styles.headlineDark}>Welcome to </Text>
          <Text style={styles.headlineAccent}>MySPM</Text>
        </Text>
        <Text style={styles.subcopy}>
          Your AI-powered companion for SPM excellence. Practice, track, and master your subjects with ease.
        </Text>

        <View style={styles.featureRow}>
          <View style={styles.featureCard}>
            <View style={[styles.featureIcon, { backgroundColor: "rgba(20, 184, 166, 0.18)" }]}>
              <Brain size={18} color="#0D9488" />
            </View>
            <Text style={styles.featureTitle}>AI Tutoring</Text>
          </View>
          <View style={styles.featureCard}>
            <View style={[styles.featureIcon, { backgroundColor: "rgba(234, 179, 8, 0.22)" }]}>
              <BarChart2 size={18} color="#CA8A04" />
            </View>
            <Text style={styles.featureTitle}>Progress Tracking</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable
          onPress={() => navigation.navigate("SignUp")}
          style={({ pressed }) => [pressed && styles.ctaPressed]}
        >
          <LinearGradient
            colors={[accent, accentDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>Get Started</Text>
            <ArrowRight size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Login")} style={styles.loginLinkWrap}>
          <Text style={styles.loginMuted}>
            Already have an account? <Text style={styles.loginAccent}>Log In</Text>
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: welcomeBg,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  heroWrap: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 28,
  },
  heroCard: {
    width: "100%",
    maxWidth: 340,
    aspectRatio: 1,
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: colors.lightGray,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      },
      android: { elevation: 4 },
    }),
  },
  heroPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E7EB",
  },
  heroPlaceholderText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: bodyMuted,
  },
  badgeTopScorer: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E5E7EB",
    paddingVertical: 8,
    paddingHorizontal: 12,
    paddingLeft: 10,
    borderRadius: 999,
  },
  badgeStarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FEF08A",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTopScorerText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: "#374151",
  },
  badgeStreak: {
    position: "absolute",
    bottom: 16,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.9)",
  },
  badgeStreakText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 0.3,
    color: "#1A1A1A",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: 22,
    fontFamily: fonts.bold,
  },
  brandMy: {
    color: "#1A1A1A",
  },
  brandSpm: {
    color: accent,
  },
  headline: {
    fontSize: 28,
    fontFamily: fonts.bold,
    lineHeight: 36,
    marginBottom: 12,
  },
  headlineDark: {
    color: "#1A1A1A",
  },
  headlineAccent: {
    color: accent,
  },
  subcopy: {
    fontSize: 15,
    lineHeight: 23,
    color: bodyMuted,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: "row",
    gap: 12,
  },
  featureCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.04)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  featureTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: "#1A1A1A",
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 16,
    backgroundColor: welcomeBg,
  },
  cta: {
    height: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  ctaText: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  loginLinkWrap: {
    alignItems: "center",
    paddingVertical: 4,
  },
  loginMuted: {
    fontSize: 14,
    color: bodyMuted,
  },
  loginAccent: {
    color: accent,
    fontFamily: fonts.bold,
  },
});
