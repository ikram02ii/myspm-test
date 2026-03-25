import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SignUpForm } from "../components/forms/SignUpForm";
import { GoogleLogo } from "../components/ui/GoogleLogo";
import { ToastMessage } from "../components/ui/ToastMessage";
import { fonts } from "../constants/fonts";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  POST_LOGIN_ONBOARDING_STORAGE_KEY,
} from "../constants/storageKeys";
import {
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from "../constants/api";
import { theme } from "../constants/palette";
import { signUpWithGoogle, signUpWithPassword } from "../services/mobileAuth";
import { getGoogleIdToken, mapGoogleSignInError } from "../services/googleSignIn";

const pageBg = theme.authBackground;
const currentVersion = `v${Constants.expoConfig?.version ?? "1.0.0"}`;

export default function SignUpScreen({
  navigation,
}: {
  navigation: { navigate: (name: string) => void; goBack: () => void };
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

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

  const handleSignUp = async (fullName: string, email: string, password: string) => {
    setLoading(true);
    try {
      const result = await signUpWithPassword({
        name: fullName,
        email,
        password,
      });
      await AsyncStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
      await AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(result.user));

      setLoading(false);
      if (result.needsOnboarding) {
        await AsyncStorage.removeItem(POST_LOGIN_ONBOARDING_STORAGE_KEY);
        navigation.navigate("PostLoginOnboarding");
      } else {
        await AsyncStorage.setItem(POST_LOGIN_ONBOARDING_STORAGE_KEY, "true");
        navigation.navigate("Main");
      }
    } catch (apiError) {
      setLoading(false);
      showToast(apiError instanceof Error ? apiError.message : "Signup failed");
    }
  };

  const handleGoogleSignUp = async () => {
    if (googleLoading) return;
    if (!GOOGLE_WEB_CLIENT_ID) {
      showToast("Google Web Client ID is not configured");
      return;
    }
    if (Platform.OS === "ios" && !GOOGLE_IOS_CLIENT_ID) {
      showToast("Google iOS Client ID is not configured");
      return;
    }

    setGoogleLoading(true);
    try {
      const idToken = await getGoogleIdToken();
      const result = await signUpWithGoogle({ idToken });
      await AsyncStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
      await AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(result.user));
      setGoogleLoading(false);

      if (result.needsOnboarding) {
        await AsyncStorage.removeItem(POST_LOGIN_ONBOARDING_STORAGE_KEY);
        navigation.navigate("PostLoginOnboarding");
      } else {
        await AsyncStorage.setItem(POST_LOGIN_ONBOARDING_STORAGE_KEY, "true");
        navigation.navigate("Main");
      }
    } catch (apiError) {
      setGoogleLoading(false);
      const msg = mapGoogleSignInError(apiError);
      if (msg === "Google sign in failed") {
        showToast(apiError instanceof Error ? apiError.message : "Google signup failed");
      } else {
        showToast(msg);
      }
    }
  };

  return (
    <View style={styles.root}>
      <ToastMessage message={toastMessage} top={insets.top + 12} />
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
            <SignUpForm onSubmit={handleSignUp} loading={loading} />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.googleBtn, pressed && styles.googleBtnPressed]}
            onPress={handleGoogleSignUp}
            disabled={googleLoading}
          >
            <GoogleLogo size={22} />
            <Text style={styles.googleLabel}>
              {googleLoading ? "Connecting..." : "Google"}
            </Text>
            {googleLoading ? <ActivityIndicator size="small" color="#1A1A1A" /> : null}
          </Pressable>

          <View style={styles.loginRow}>
            <Text style={styles.loginMuted}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate("Login")}>
              <Text style={styles.loginLink}>Log In</Text>
            </Pressable>
          </View>

          <Text style={styles.versionText}>AMAST SDN BHD | {currentVersion}</Text>
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
  versionText: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 12,
    color: "#737373",
    fontFamily: fonts.medium,
  },
});
