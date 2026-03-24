import React from "react";
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  Text,
} from "react-native";
import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";

interface FormInputProps extends TextInputProps {
  label?: string;
  error?: string;
  required?: boolean;
}

export const FormInput = React.forwardRef<TextInput, FormInputProps>(
  ({ label, error, required, style, ...props }, ref) => {
    return (
      <View style={styles.container}>
        {label && (
          <Text style={styles.label}>
            {label}
            {required && <Text style={styles.required}> *</Text>}
          </Text>
        )}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            error && styles.inputError,
            style,
          ]}
          placeholderTextColor={colors.gray}
          {...props}
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
);

FormInput.displayName = "FormInput";

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    marginBottom: 8,
    color: colors.darkText,
  },
  required: {
    color: colors.error,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.darkText,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginTop: 4,
  },
});
