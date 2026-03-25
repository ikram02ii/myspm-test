import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react-native";

import { ErrorMessage } from "../ui/ErrorMessage";
import { fonts } from "../../constants/fonts";
import { theme } from "../../constants/palette";
import { validateEmail } from "../../utils/validation";

const accent = theme.brand;
const accentDeep = theme.brandDeep;
const labelMuted = "#9CA3AF";
const inputPlaceholder = "#A3A3A3";

/** Turn on when auth API validates credentials; until then Log In works with empty fields. */
const REQUIRE_LOGIN_FIELDS = true;

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  onForgotPassword?: () => void;
  loading?: boolean;
  error?: string;
}

interface FormErrors {
  email?: string;
  password?: string;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSubmit,
  onForgotPassword,
  loading = false,
  error: externalError,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState({ email: false, password: false });

  const validateForm = (): boolean => {
    if (!REQUIRE_LOGIN_FIELDS) {
      setErrors({});
      return true;
    }

    const newErrors: FormErrors = {};

    if (!email.trim()) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!password.trim()) {
      newErrors.password = "Password is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: "email" | "password") => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (!REQUIRE_LOGIN_FIELDS) {
      return;
    }

    const newErrors = { ...errors };
    if (field === "email") {
      if (!email.trim()) {
        newErrors.email = "Email is required";
      } else if (!validateEmail(email)) {
        newErrors.email = "Please enter a valid email address";
      } else {
        delete newErrors.email;
      }
    } else if (field === "password") {
      if (!password.trim()) {
        newErrors.password = "Password is required";
      } else {
        delete newErrors.password;
      }
    }

    setErrors(newErrors);
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      if (REQUIRE_LOGIN_FIELDS) {
        setTouched({ email: true, password: true });
      }
      return;
    }
    try {
      await onSubmit(email, password);
    } catch {
      // Error shown via externalError
    }
  };

  const emailErr = touched.email ? errors.email : undefined;
  const passwordErr = touched.password ? errors.password : undefined;

  return (
    <View style={styles.wrap}>
      <ErrorMessage message={externalError} visible={!!externalError} />

      <Text style={[styles.fieldLabel, styles.labelGap]}>EMAIL ADDRESS</Text>
      <View style={[styles.pillInput, emailErr && styles.pillInputError]}>
        <Mail size={20} color={labelMuted} strokeWidth={2} />
        <TextInput
          style={styles.pillTextInput}
          placeholder="student@myspm.edu"
          placeholderTextColor={inputPlaceholder}
          value={email}
          onChangeText={setEmail}
          onBlur={() => handleBlur("email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="login-email-input"
        />
      </View>
      {emailErr ? <Text style={styles.inlineError}>{emailErr}</Text> : null}

      <View style={styles.passwordLabelRow}>
        <Text style={styles.fieldLabel}>PASSWORD</Text>
        {onForgotPassword ? (
          <Pressable onPress={onForgotPassword} hitSlop={8}>
            <Text style={styles.link}>Forgot Password?</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.pillInput, passwordErr && styles.pillInputError]}>
        <Lock size={20} color={labelMuted} strokeWidth={2} />
        <TextInput
          style={styles.pillTextInput}
          placeholder="Enter your password"
          placeholderTextColor={inputPlaceholder}
          value={password}
          onChangeText={setPassword}
          onBlur={() => handleBlur("password")}
          secureTextEntry={!showPassword}
          testID="login-password-input"
        />
        <Pressable
          onPress={() => setShowPassword((v) => !v)}
          style={styles.eyeBtn}
          testID="login-password-input-toggle"
        >
          {showPassword ? (
            <EyeOff size={20} color={labelMuted} />
          ) : (
            <Eye size={20} color={labelMuted} />
          )}
        </Pressable>
      </View>
      {passwordErr ? <Text style={styles.inlineError}>{passwordErr}</Text> : null}

      <Pressable
        onPress={handleSubmit}
        disabled={loading}
        style={({ pressed }) => [styles.ctaWrap, pressed && !loading && styles.ctaPressed]}
        testID="login-submit-button"
      >
        <LinearGradient
          colors={[accentDeep, accent]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.cta}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.ctaText}>Log In</Text>
              <ArrowRight size={20} color="#FFFFFF" />
            </>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.8,
    color: labelMuted,
  },
  labelGap: {
    marginBottom: 10,
  },
  passwordLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 10,
  },
  link: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: accent,
  },
  pillInput: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    height: 52,
    paddingHorizontal: 18,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.04)",
    ...Platform.select({
      ios: {
        shadowColor: theme.shadowBrand,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
    }),
  },
  pillInputError: {
    borderColor: "#FCA5A5",
    borderWidth: 1,
  },
  pillTextInput: {
    flex: 1,
    fontSize: 16,
    color: "#1A1A1A",
    paddingVertical: 0,
  },
  eyeBtn: {
    padding: 4,
  },
  inlineError: {
    color: "#DC2626",
    fontSize: 12,
    marginTop: 6,
    marginBottom: 4,
  },
  ctaWrap: {
    marginTop: 28,
    borderRadius: 999,
    ...Platform.select({
      ios: {
        shadowColor: accentDeep,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  ctaPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.99 }],
  },
  cta: {
    height: 54,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaText: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
});
