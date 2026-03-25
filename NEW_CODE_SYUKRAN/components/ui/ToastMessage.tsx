import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { fonts } from "../../constants/fonts";

interface ToastMessageProps {
  message?: string | null;
  top?: number;
}

const SLIDE_FROM = -52;

export const ToastMessage: React.FC<ToastMessageProps> = ({ message, top = 16 }) => {
  const [displayText, setDisplayText] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(SLIDE_FROM)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const prevMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (message) {
      setDisplayText(message);
      translateY.stopAnimation();
      opacity.stopAnimation();
      translateY.setValue(SLIDE_FROM);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 16,
          stiffness: 260,
          mass: 0.85,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (prevMessageRef.current !== null) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SLIDE_FROM,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setDisplayText(null);
        }
      });
    }
    prevMessageRef.current = message ?? null;
  }, [message]);

  if (!displayText) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top },
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={styles.text}>{displayText}</Text>
    </Animated.View>
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
