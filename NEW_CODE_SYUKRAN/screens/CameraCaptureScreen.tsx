import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Camera as ExpoCamera,
  CameraType,
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
} from "expo-camera";
import type { PermissionStatus } from "expo-modules-core";
import { LinearGradient } from "expo-linear-gradient";
import { Camera, RefreshCw, Scan } from "lucide-react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { CameraStackParamList } from "../navigation/CameraStack";
import { uploadScanImage } from "../services/mobileScan";

type Props = NativeStackScreenProps<CameraStackParamList, "CameraCapture">;

const BRAND = theme.brand;

export default function CameraCaptureScreen({ navigation }: Props) {
  const cameraRef = useRef<ExpoCamera | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const current = await getCameraPermissionsAsync();
        setPermissionStatus(current.status);
        if (!current.granted && current.canAskAgain) {
          const next = await requestCameraPermissionsAsync();
          setPermissionStatus(next.status);
        }
      } catch {
        setPermissionStatus(null);
      }
    };
    void init();
  }, []);

  const requestPermission = async () => {
    try {
      const next = await requestCameraPermissionsAsync();
      setPermissionStatus(next.status);
    } catch {
      setPermissionStatus(null);
    }
  };

  const takePhoto = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    setUploadError(null);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.85,
      });
      if (!photo?.uri) {
        setIsCapturing(false);
        return;
      }
      const uploaded = await uploadScanImage(photo.uri);
      navigation.replace("CameraPreview", { photoUri: uploaded.url });
    } catch (error) {
      console.error("uploadScanImage error", error);
      setUploadError("Upload failed. Please try again.");
      setIsCapturing(false);
    }
  };

  if (Platform.OS === "web") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera not available on web</Text>
        <Text style={styles.sub}>Open this on Android/iOS to scan questions.</Text>
      </View>
    );
  }

  if (permissionStatus !== "granted") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera permission required</Text>
        <Text style={styles.sub}>Enable camera access to scan questions.</Text>
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <ExpoCamera
          ref={(r) => (cameraRef.current = r)}
          style={StyleSheet.absoluteFill}
          type={CameraType.back}
          ratio="16:9"
        />

        <View style={styles.liveOverlay} pointerEvents="none">
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE SCAN</Text>
          </View>

          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />

          <View style={styles.detectingCard}>
            <View style={styles.detectingIcon}>
              <Scan size={18} color={BRAND} />
            </View>
            <View style={styles.detectingTextWrap}>
              <Text style={styles.detectingTitle}>AI Detecting...</Text>
              <Text style={styles.detectingSub}>Getting information from the image..</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.secondaryBtn} onPress={() => navigation.goBack()} disabled={isCapturing}>
          <RefreshCw size={18} color={colors.text} />
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>

        <Pressable style={styles.captureOuter} onPress={takePhoto} disabled={isCapturing}>
          <LinearGradient
            colors={[...theme.gradientHero]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.captureInner}
          >
            <Camera size={22} color="#FFFFFF" />
            <Text style={styles.captureText}>{isCapturing ? "Capturing…" : "Capture"}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  cameraWrap: {
    flex: 1,
    margin: 16,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.10)",
  },
  liveOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  liveBadge: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E11D48",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  liveText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
    letterSpacing: 0.6,
  },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "#FFFFFF",
    borderWidth: 4,
  },
  cornerTL: { top: 22, left: 22, borderRightWidth: 0, borderBottomWidth: 0, borderRadius: 10 },
  cornerTR: { top: 22, right: 22, borderLeftWidth: 0, borderBottomWidth: 0, borderRadius: 10 },
  cornerBL: { bottom: 22, left: 22, borderRightWidth: 0, borderTopWidth: 0, borderRadius: 10 },
  cornerBR: { bottom: 22, right: 22, borderLeftWidth: 0, borderTopWidth: 0, borderRadius: 10 },
  detectingCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(248, 250, 252, 0.93)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detectingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E0E7FF",
    alignItems: "center",
    justifyContent: "center",
  },
  detectingTextWrap: { flex: 1 },
  detectingTitle: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: BRAND,
  },
  detectingSub: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: "#64748B",
    marginTop: 2,
  },
  controls: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    fontSize: 13,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    textAlign: "center",
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
  secondaryBtn: {
    height: 56,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: colors.screenBackground,
  },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, textAlign: "center" },
  sub: { marginTop: 8, fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: "center" },
  permissionBtn: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BRAND,
  },
  permissionBtnText: { fontSize: 14, fontFamily: fonts.bold, color: "#FFFFFF" },
});

