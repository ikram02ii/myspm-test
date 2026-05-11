import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Scan } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { CameraStackParamList } from "../navigation/CameraStack";
import {
  type AiScanOcrResult,
  isAiScanBackendConfigured,
  uploadScanImage,
  uploadScanImageWithAiTutor,
} from "../services/mobileScan";

type Props = NativeStackScreenProps<CameraStackParamList, "CameraPreview">;

function formatAiOutput(r: NonNullable<CameraStackParamList["CameraPreview"]["aiResult"]>): string {
  const t = typeof r.text === "string" ? r.text.trim() : "";
  return t.length > 0 ? t : "No text extracted from the image.";
}

/** Fresh captures use local URIs; history opens remote URLs that must not be re-uploaded. */
function isLocalCaptureUri(uri: string): boolean {
  const u = uri.toLowerCase();
  return (
    u.startsWith("file:") ||
    u.startsWith("content:") ||
    u.startsWith("ph://") ||
    u.startsWith("assets-library:")
  );
}

export default function CameraPreviewScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { photoUri: paramPhotoUri, aiResult: paramAiResult } = route.params;

  const [displayUri, setDisplayUri] = useState(paramPhotoUri);
  const [aiResult, setAiResult] = useState<AiScanOcrResult | undefined>(paramAiResult);
  const [processing, setProcessing] = useState(
    () => paramAiResult == null && isLocalCaptureUri(paramPhotoUri),
  );
  const [processError, setProcessError] = useState<string | null>(null);

  const needsUploadOrScan = useMemo(() => {
    if (paramAiResult != null) return false;
    return isLocalCaptureUri(paramPhotoUri);
  }, [paramPhotoUri, paramAiResult]);

  useEffect(() => {
    setDisplayUri(paramPhotoUri);
    setAiResult(paramAiResult);
    setProcessError(null);
    setProcessing(paramAiResult == null && isLocalCaptureUri(paramPhotoUri));
  }, [paramPhotoUri, paramAiResult]);

  useEffect(() => {
    if (paramAiResult != null || !isLocalCaptureUri(paramPhotoUri)) return;

    let cancelled = false;
    setProcessing(true);
    setProcessError(null);

    void (async () => {
      try {
        if (isAiScanBackendConfigured()) {
          const r = await uploadScanImageWithAiTutor(paramPhotoUri);
          if (!cancelled) setAiResult(r);
        } else {
          const uploaded = await uploadScanImage(paramPhotoUri);
          if (!cancelled) setDisplayUri(uploaded.url);
        }
      } catch (e) {
        if (!cancelled) {
          setProcessError(e instanceof Error ? e.message : "Upload failed. Please try again.");
        }
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paramPhotoUri, paramAiResult]);

  const { cardMessage, cardTextStyle } = useMemo((): { cardMessage: string; cardTextStyle: TextStyle } => {
    if (processError) return { cardMessage: processError, cardTextStyle: styles.cardTextError };
    if (processing && isAiScanBackendConfigured()) {
      return { cardMessage: "Reading text from your photo…", cardTextStyle: styles.cardTextMuted };
    }
    if (processing) return { cardMessage: "Uploading your scan…", cardTextStyle: styles.cardTextMuted };
    if (aiResult) return { cardMessage: formatAiOutput(aiResult), cardTextStyle: styles.cardTextAi };
    return {
      cardMessage:
        "Sign in (email required for scan storage), or set EXPO_PUBLIC_AI_SCAN_BASE_URL for OCR scan.",
      cardTextStyle: styles.cardText,
    };
  }, [aiResult, processError, processing]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.previewWrap}>
        <Image source={{ uri: displayUri }} style={styles.preview} resizeMode="contain" />
      </View>

      <View style={styles.card}>
        {processing && needsUploadOrScan ? (
          <View style={styles.cardRow}>
            <ActivityIndicator color={theme.brand} />
            <Text style={[styles.cardTextMuted, styles.cardFlexText]}>{cardMessage}</Text>
          </View>
        ) : (
          <Text style={cardTextStyle}>{cardMessage}</Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.captureOuter} onPress={() => navigation.replace("CameraCapture")}>
          <LinearGradient
            colors={[...theme.gradientHero]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.captureInner}
          >
            <Scan size={22} color="#FFFFFF" />
            <Text style={styles.captureText}>Scan again</Text>
          </LinearGradient>
        </Pressable>
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
    minHeight: 100,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.textSecondary,
    textAlign: "center",
    textTransform: "none",
  },
  cardTextAi: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    textAlign: "left",
    lineHeight: 22,
  },
  cardTextMuted: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    textAlign: "left",
    lineHeight: 22,
  },
  cardTextError: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    textAlign: "center",
    lineHeight: 22,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 100,
  },
  cardFlexText: { flex: 1 },
  controls: {
    marginTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  captureOuter: {
    flex: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  captureInner: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  captureText: { fontSize: 16, fontFamily: fonts.bold, color: "#FFFFFF" },
});

