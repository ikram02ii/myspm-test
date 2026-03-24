import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SignUpForm } from "../components/forms/SignUpForm";
import { GoogleLogo } from "../components/ui/GoogleLogo";
import { fonts } from "../constants/fonts";
import { POST_LOGIN_ONBOARDING_STORAGE_KEY } from "../constants/storageKeys";
import { theme } from "../constants/palette";

const pageBg = theme.authBackground;

export default function SignUpScreen({
  navigation,
}: {
  navigation: { navigate: (name: string) => void; goBack: () => void };
}) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (_fullName: string, _email: string, _password: string) => {
    setError(undefined);
    setLoading(true);
    setTimeout(async () => {
      setLoading(false);
      const done = await AsyncStorage.getItem(POST_LOGIN_ONBOARDING_STORAGE_KEY);
      if (done === "true") {
        navigation.navigate("Main");
      } else {
        navigation.navigate("PostLoginOnboarding");
      }
    }, 800);
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...theme.authGradient]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[theme.authGlowTop, "rgba(227, 83, 54, 0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.glowTopLeft}
      />
      <LinearGradient
        colors={["rgba(152, 168, 105, 0)", theme.authGlowBottom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.glowBottomRight}
      />

      <KeyboardAvoidingView
        style={[styles.flex, { paddingTop: insets.top }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backRow, pressed && styles.backPressed]}
            hitSlop={12}
          >
            <ChevronLeft size={24} color="#525252" strokeWidth={2} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.logoPillShadow}>
            <View style={styles.logoPill}>
              <Text style={styles.logoText}>
                <Text style={styles.logoMy}>My</Text>
                <Text style={styles.logoSpm}>SPM</Text>
              </Text>
            </View>
          </View>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join MySPM and start practicing smarter.</Text>

          <View style={styles.formBlock}>
            <SignUpForm onSubmit={handleSignUp} loading={loading} error={error} />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.googleBtn, pressed && styles.googleBtnPressed]}
            onPress={() => {}}
          >
            <GoogleLogo size={22} />
            <Text style={styles.googleLabel}>Google</Text>
          </Pressable>

          <View style={styles.loginRow}>
            <Text style={styles.loginMuted}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate("Login")}>
              <Text style={styles.loginLink}>Log In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: pageBg,
  },
  flex: {
    flex: 1,
  },
  glowTopLeft: {
    position: "absolute",
    top: -60,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  glowBottomRight: {
    position: "absolute",
    bottom: -100,
    right: -60,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 12,
    gap: 2,
  },
  backPressed: {
    opacity: 0.7,
  },
  backText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: "#525252",
  },
  logoPillShadow: {
    alignSelf: "center",
    marginBottom: 28,
    ...Platform.select({
      ios: {
        shadowColor: theme.shadowBrand,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  logoPill: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.pillBorderBrand,
  },
  logoText: {
    fontSize: 20,
    fontFamily: fonts.extraBold,
  },
  logoMy: {
    color: "#1A1A1A",
  },
  logoSpm: {
    color: theme.brand,
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: "#1A1A1A",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#737373",
    textAlign: "center",
    marginBottom: 32,
  },
  formBlock: {
    width: "100%",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 28,
    marginBottom: 22,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#D4D4D8",
  },
  dividerText: {
    marginHorizontal: 14,
    fontSize: 11,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.6,
    color: "#A1A1AA",
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    height: 52,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.06)",
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
  googleBtnPressed: {
    opacity: 0.92,
  },
  googleLabel: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: "#1A1A1A",
  },
  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 36,
  },
  loginMuted: {
    fontSize: 14,
    color: "#525252",
  },
  loginLink: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: theme.brand,
  },
});
