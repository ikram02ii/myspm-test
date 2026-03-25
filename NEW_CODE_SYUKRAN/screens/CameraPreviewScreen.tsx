import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import type { CameraStackParamList } from "../navigation/CameraStack";

type Props = NativeStackScreenProps<CameraStackParamList, "CameraPreview">;

export default function CameraPreviewScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { photoUri } = route.params;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.previewWrap}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardText}>
          to be updated soon for AI solution
          {'\n'}
          {'\n'}
          this area can put AI output after sending the image to the AI model etc

        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  previewWrap: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.10)",
    height: 520,
  },
  preview: { width: "100%", height: "100%" },
  card: {
    marginTop: 14,
    marginHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
  },
  cardText: {
    height: 100,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    textAlign: "center",
    textTransform: "none",
  },
});

