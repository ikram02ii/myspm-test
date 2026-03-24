import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";

interface ErrorMessageProps {
  message?: string;
  visible?: boolean;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  visible = true,
}) => {
  if (!message || !visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#FFE5E5",
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 4,
    marginVertical: 8,
  },
  text: {
    color: colors.error,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
});
