import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mic, Square } from "lucide-react-native";

import { colors } from "../constants/colors";
import { ORAL_PRACTICE_DURATION_SEC } from "../constants/oralPractice";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";
import { transcribeRecording, type SttLanguage } from "../services/oralApi";
import {
  cancelOralRecording,
  isOralRecordingSupported,
  startOralRecording,
  stopOralRecording,
} from "../services/oralRecording";

const BRAND = theme.brand;

type Props = NativeStackScreenProps<PracticeStackParamList, "OralPractice">;

function formatCountdown(secondsLeft: number): string {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sttLanguageLabel(language: SttLanguage): string {
  if (language === "en-MY") return "English";
  if (language === "mixed") return "English & BM";
  return "Bahasa Melayu";
}

export default function OralPracticeScreen({ navigation, route }: Props) {
  const { prompt, subject, formLevel, sttLanguage } = route.params;
  const insets = useSafeAreaInsets();

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(ORAL_PRACTICE_DURATION_SEC);
  const [timeExpired, setTimeExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const recordingRef = useRef(false);
  const transcribingRef = useRef(false);
  const timeExpiredRef = useRef(false);

  const recordingSupported = isOralRecordingSupported();
  const canRecord =
    recordingSupported && !transcribing && !timeExpired && secondsLeft > 0;

  const goToReview = useCallback(
    (transcript: string) => {
      navigation.navigate("OralReview", {
        prompt,
        transcript,
        subject,
        formLevel,
      });
    },
    [navigation, prompt, subject, formLevel],
  );

  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});

  const finishRecordingAndTranscribe = useCallback(async () => {
    if (transcribingRef.current) return;
    transcribingRef.current = true;
    setRecording(false);
    recordingRef.current = false;
    setTranscribing(true);
    setStatusMessage("Converting speech to text…");

    try {
      const file = await stopOralRecording();

      const text = await transcribeRecording({
        uri: file.uri,
        blob: file.blob,
        filename: file.filename,
        mimeType: file.mimeType,
        language: sttLanguage,
      });

      if (!text.trim()) {
        throw new Error("No speech detected. Try recording again.");
      }

      goToReview(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
      setStatusMessage(timeExpiredRef.current ? "Time is up." : "Tap microphone to record");
    } finally {
      setTranscribing(false);
      transcribingRef.current = false;
    }
  }, [goToReview, sttLanguage]);

  finishRecordingRef.current = finishRecordingAndTranscribe;

  useEffect(() => {
    if (!recordingSupported) {
      setError(
        Platform.OS === "web"
          ? "Microphone recording is not supported in this browser. Try Chrome or Edge."
          : "Recording is not available on this device.",
      );
    }
  }, [recordingSupported]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          timeExpiredRef.current = true;
          setTimeExpired(true);
          setStatusMessage("Time is up. Recording is closed.");
          if (recordingRef.current) {
            void finishRecordingRef.current();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      void cancelOralRecording();
    };
  }, []);

  const onMicPress = useCallback(async () => {
    if (!canRecord && !recording) return;

    if (recording) {
      await finishRecordingAndTranscribe();
      return;
    }

    setError(null);
    setStatusMessage(null);

    try {
      await startOralRecording();
      recordingRef.current = true;
      setRecording(true);
      setStatusMessage("Recording… tap the square when you finish speaking.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording.");
      recordingRef.current = false;
      setRecording(false);
    }
  }, [canRecord, recording, finishRecordingAndTranscribe]);

  const timerUrgent = secondsLeft > 0 && secondsLeft <= 60;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: 16,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 32,
      }}
    >
      <Text style={styles.meta}>
        {subject} · {formLevel} · Oral · {sttLanguageLabel(sttLanguage)}
      </Text>

      <View
        style={[
          styles.timerCard,
          timeExpired && styles.timerCardExpired,
          timerUrgent && !timeExpired && styles.timerCardUrgent,
        ]}
      >
        <Text style={styles.timerLabel}>
          {timeExpired ? "Time is up" : "Time remaining"}
        </Text>
        <Text
          style={[
            styles.timerValue,
            timeExpired && styles.timerValueExpired,
            timerUrgent && !timeExpired && styles.timerValueUrgent,
          ]}
        >
          {timeExpired ? "0:00" : formatCountdown(secondsLeft)}
        </Text>
        <Text style={styles.timerHint}>
          {timeExpired
            ? "You can no longer record. Review your answer on the next screen if you already finished speaking."
            : "You can record until the timer reaches 0:00."}
        </Text>
      </View>

      <View style={styles.promptCard}>
        <Text style={styles.promptLabel}>Speaking prompt</Text>
        <Text style={styles.promptText}>{prompt}</Text>
      </View>

      <Text style={styles.hint}>
        Tap the microphone and speak your answer. When you stop, you will go to the review page to
        check your transcript and submit for marking.
      </Text>

      <View style={styles.micRow}>
        <Pressable
          style={({ pressed }) => [
            styles.micButton,
            recording && styles.micButtonActive,
            pressed && canRecord && styles.micButtonPressed,
            !canRecord && !recording && styles.micButtonDisabled,
          ]}
          onPress={() => void onMicPress()}
          disabled={!canRecord && !recording}
        >
          {transcribing ? (
            <ActivityIndicator color="#FFFFFF" size="large" />
          ) : recording ? (
            <Square size={36} color="#FFFFFF" fill="#FFFFFF" />
          ) : (
            <Mic size={40} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      <Text style={styles.micStatus}>
        {statusMessage ??
          (transcribing
            ? "Converting speech to text…"
            : recording
              ? "Recording… tap square to stop"
              : timeExpired
                ? "Recording closed"
                : canRecord
                  ? "Tap microphone to record"
                  : "Microphone unavailable")}
      </Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  timerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: BRAND,
    marginBottom: 16,
    alignItems: "center",
  },
  timerCardUrgent: {
    borderColor: "#F59E0B",
    backgroundColor: "#FFFBEB",
  },
  timerCardExpired: {
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
  },
  timerLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  timerValue: {
    fontFamily: fonts.semiBold,
    fontSize: 40,
    color: BRAND,
    fontVariant: ["tabular-nums"],
  },
  timerValueUrgent: {
    color: "#D97706",
  },
  timerValueExpired: {
    color: "#DC2626",
  },
  timerHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  promptCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
  },
  promptLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: BRAND,
    marginBottom: 8,
  },
  promptText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  micRow: { alignItems: "center", marginBottom: 12 },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  micButtonActive: { backgroundColor: "#DC2626" },
  micButtonPressed: { opacity: 0.9 },
  micButtonDisabled: { opacity: 0.45 },
  micStatus: {
    textAlign: "center",
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: "#DC2626",
    lineHeight: 20,
  },
});
