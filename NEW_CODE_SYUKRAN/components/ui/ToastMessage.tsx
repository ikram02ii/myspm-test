import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fonts } from "../../constants/fonts";

interface ToastMessageProps {
  message?: string | null;
  top?: number;
}

export const ToastMessage: React.FC<ToastMessageProps> = ({ message, top = 16 }) => {
  if (!message) return null;

  return (
    <View style={[styles.wrap, { top }]}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: "#B91C1C",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: fonts.semiBold,
    textAlign: "center",
  },
});
