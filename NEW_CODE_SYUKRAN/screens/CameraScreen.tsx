import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, ImagePlus, Lightbulb, Scan } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";

const BRAND = "#7B89F4";

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;

  const handleScanQuestion = () => {};
  const handlePickFromGallery = () => {};

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPadding }]}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>AI Scan Assistant</Text>
      <Text style={styles.subtitle}>Scan your work to get instant grading and explanations.</Text>

      <View style={styles.heroCard}>
        <View style={styles.heroPlaceholder}>
          <Camera size={48} color="#94A3B8" strokeWidth={1.5} />
          <Text style={styles.heroPlaceholderTitle}>Camera preview</Text>
          <Text style={styles.heroPlaceholderHint}>Live feed will appear here</Text>
        </View>
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
            <Text style={styles.detectingSub}>Handwriting: Physics Paper 2</Text>
          </View>
        </View>
      </View>

      <Pressable style={styles.scanButton} onPress={handleScanQuestion}>
        <LinearGradient
          colors={["#6258E3", "#7B89F4"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.scanButtonGrad}
        >
          <Camera size={25} color="#FFFFFF" />
          <Text style={styles.scanButtonText}>Scan Question</Text>
        </LinearGradient>
      </Pressable>

      <View style={styles.quickActions}>
        <Pressable style={styles.quickCard} onPress={handlePickFromGallery}>
          <View style={[styles.quickIconWrap, { backgroundColor: "#A7F3D0" }]}>
            <ImagePlus size={20} color="#059669" />
          </View>
          <Text style={styles.quickText}>Pick from Gallery</Text>
        </Pressable>
      </View>

      <View style={styles.tipCard}>
        <View style={styles.tipIconWrap}>
          <Lightbulb size={16} color={BRAND} />
        </View>
        <View style={styles.tipBody}>
          <Text style={styles.tipTitle}>Pro Tip</Text>
          <Text style={styles.tipDesc}>
            Ensure good lighting and keep the camera parallel to the page for 99% accuracy in AI
            grading.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground, paddingHorizontal: 14 },
  title: {
    marginTop: 4,
    fontSize: 32,
    fontFamily: fonts.bold,
    color: "#0F172A",
    textAlign: "center",
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: "#6B7280",
    marginTop: 5,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  heroCard: {
    borderRadius: 28,
    overflow: "hidden",
    position: "relative",
    minHeight: 430,
    backgroundColor: "#D1D5DB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  heroPlaceholder: {
    width: "100%",
    height: 430,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  heroPlaceholderTitle: {
    marginTop: 14,
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: "#64748B",
  },
  heroPlaceholderHint: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: fonts.medium,
    color: "#94A3B8",
    textAlign: "center",
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
  scanButton: {
    marginTop: 18,
    borderRadius: 999,
    overflow: "hidden",
     elevation: 3 
  },
  scanButtonGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 62,
    gap: 10,
  },
  scanButtonText: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },
  quickActions: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  quickCard: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 24,
    alignItems: "center",
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  quickIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  quickText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: "#334155",
  },
  tipCard: {
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  tipIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E0E7FF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  tipBody: { flex: 1 },
  tipTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: "#334155",
    marginBottom: 4,
  },
  tipDesc: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: "#6B7280",
    lineHeight: 20,
  },
});
