import React, { useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { FormInput } from "../ui/FormInput";
import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";

interface PasswordInputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  required?: boolean;
  testID?: string;
  onBlur?: () => void;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  label = "Password",
  placeholder = "Enter your password",
  value,
  onChangeText,
  error,
  required = true,
  testID,
  onBlur,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View>
      <View style={styles.inputContainer}>
        <FormInput
          label={label}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!showPassword}
          error={error}
          required={required}
          style={styles.input}
          testID={testID}
          onBlur={onBlur}
        />
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setShowPassword(!showPassword)}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <Text style={styles.toggleText}>
            {showPassword ? "Hide" : "Show"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    position: "relative",
  },
  input: {
    marginBottom: 0,
  },
  toggleButton: {
    position: "absolute",
    right: 12,
    top: "50%",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  toggleText: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: colors.primary,
  },
});
