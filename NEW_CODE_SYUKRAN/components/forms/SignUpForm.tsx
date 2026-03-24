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
import { ArrowRight, Eye, EyeOff, Lock, Mail, User } from "lucide-react-native";

import { ErrorMessage } from "../ui/ErrorMessage";
import { fonts } from "../../constants/fonts";
import { theme } from "../../constants/palette";
import { validateEmail, validatePassword, validatePasswordMatch, validateRequired } from "../../utils/validation";

const accent = theme.brand;
const accentDeep = theme.brandDeep;
const labelMuted = "#9CA3AF";
const inputPlaceholder = "#A3A3A3";

const REQUIRE_SIGNUP_FIELDS = false;

interface SignUpFormProps {
  onSubmit: (fullName: string, email: string, password: string) => Promise<void>;
  loading?: boolean;
  error?: string;
}

interface FormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({
  onSubmit,
  loading = false,
  error: externalError,
}) => {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState({
    fullName: false,
    email: false,
    password: false,
    confirmPassword: false,
  });

  const validateForm = (): boolean => {
    if (!REQUIRE_SIGNUP_FIELDS) {
      setErrors({});
      return true;
    }

    const newErrors: FormErrors = {};

    if (!validateRequired(fullName)) {
      newErrors.fullName = "Name is required";
    }

    if (!email.trim()) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!password) {
      newErrors.password = "Password is required";
    } else if (!validatePassword(password)) {
      newErrors.password =
        "Password must be at least 8 characters with uppercase, lowercase, number, and special character";
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (!validatePasswordMatch(password, confirmPassword)) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: keyof FormErrors) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (!REQUIRE_SIGNUP_FIELDS) {
      return;
    }

    const newErrors = { ...errors };
    if (field === "fullName") {
      if (!validateRequired(fullName)) {
        newErrors.fullName = "Name is required";
      } else {
        delete newErrors.fullName;
      }
    } else if (field === "email") {
      if (!email.trim()) {
        newErrors.email = "Email is required";
      } else if (!validateEmail(email)) {
        newErrors.email = "Please enter a valid email address";
      } else {
        delete newErrors.email;
      }
    } else if (field === "password") {
      if (!password) {
        newErrors.password = "Password is required";
      } else if (!validatePassword(password)) {
        newErrors.password =
          "Password must be at least 8 characters with uppercase, lowercase, number, and special character";
      } else {
        delete newErrors.password;
      }
      if (confirmPassword && !validatePasswordMatch(password, confirmPassword)) {
        newErrors.confirmPassword = "Passwords do not match";
      } else if (newErrors.confirmPassword === "Passwords do not match") {
        delete newErrors.confirmPassword;
      }
    } else if (field === "confirmPassword") {
      if (!confirmPassword) {
        newErrors.confirmPassword = "Please confirm your password";
      } else if (!validatePasswordMatch(password, confirmPassword)) {
        newErrors.confirmPassword = "Passwords do not match";
      } else {
        delete newErrors.confirmPassword;
      }
    }

    setErrors(newErrors);
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      if (REQUIRE_SIGNUP_FIELDS) {
        setTouched({
          fullName: true,
          email: true,
          password: true,
          confirmPassword: true,
        });
      }
      return;
    }
    try {
      await onSubmit(fullName, email, password);
    } catch {
      // Error shown via externalError
    }
  };

  const fullNameErr = touched.fullName ? errors.fullName : undefined;
  const emailErr = touched.email ? errors.email : undefined;
  const passwordErr = touched.password ? errors.password : undefined;
  const confirmErr = touched.confirmPassword ? errors.confirmPassword : undefined;

  return (
    <View style={styles.wrap}>
      <ErrorMessage message={externalError} visible={!!externalError} />

      <Text style={[styles.fieldLabel, styles.labelGap]}>FULL NAME</Text>
      <View style={[styles.pillInput, fullNameErr && styles.pillInputError]}>
        <User size={20} color={labelMuted} strokeWidth={2} />
        <TextInput
          style={styles.pillTextInput}
          placeholder="Your name"
          placeholderTextColor={inputPlaceholder}
          value={fullName}
          onChangeText={setFullName}
          onBlur={() => handleBlur("fullName")}
          autoCapitalize="words"
          testID="signup-name-input"
        />
      </View>
      {fullNameErr ? <Text style={styles.inlineError}>{fullNameErr}</Text> : null}

      <Text style={[styles.fieldLabel, styles.labelGapBelow]}>EMAIL ADDRESS</Text>
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
          testID="signup-email-input"
        />
      </View>
      {emailErr ? <Text style={styles.inlineError}>{emailErr}</Text> : null}

      <Text style={[styles.fieldLabel, styles.labelGapBelow]}>PASSWORD</Text>
      <View style={[styles.pillInput, passwordErr && styles.pillInputError]}>
        <Lock size={20} color={labelMuted} strokeWidth={2} />
        <TextInput
          style={styles.pillTextInput}
          placeholder="Create a password"
          placeholderTextColor={inputPlaceholder}
          value={password}
          onChangeText={setPassword}
          onBlur={() => handleBlur("password")}
          secureTextEntry={!showPassword}
          testID="signup-password-input"
        />
        <Pressable
          onPress={() => setShowPassword((v) => !v)}
          style={styles.eyeBtn}
          testID="signup-password-toggle"
        >
          {showPassword ? (
            <EyeOff size={20} color={labelMuted} />
          ) : (
            <Eye size={20} color={labelMuted} />
          )}
        </Pressable>
      </View>
      {passwordErr ? <Text style={styles.inlineError}>{passwordErr}</Text> : null}

      <Text style={[styles.fieldLabel, styles.labelGapBelow]}>CONFIRM PASSWORD</Text>
      <View style={[styles.pillInput, confirmErr && styles.pillInputError]}>
        <Lock size={20} color={labelMuted} strokeWidth={2} />
        <TextInput
          style={styles.pillTextInput}
          placeholder="Confirm your password"
          placeholderTextColor={inputPlaceholder}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          onBlur={() => handleBlur("confirmPassword")}
          secureTextEntry={!showConfirmPassword}
          testID="signup-confirm-password-input"
        />
        <Pressable
          onPress={() => setShowConfirmPassword((v) => !v)}
          style={styles.eyeBtn}
          testID="signup-confirm-password-toggle"
        >
          {showConfirmPassword ? (
            <EyeOff size={20} color={labelMuted} />
          ) : (
            <Eye size={20} color={labelMuted} />
          )}
        </Pressable>
      </View>
      {confirmErr ? <Text style={styles.inlineError}>{confirmErr}</Text> : null}

      <Pressable
        onPress={handleSubmit}
        disabled={loading}
        style={({ pressed }) => [styles.ctaWrap, pressed && !loading && styles.ctaPressed]}
        testID="signup-submit-button"
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
              <Text style={styles.ctaText}>Create account</Text>
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
  labelGapBelow: {
    marginTop: 20,
    marginBottom: 10,
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
