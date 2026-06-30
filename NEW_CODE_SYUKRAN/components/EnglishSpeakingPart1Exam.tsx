import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { Mic, Square } from "lucide-react-native";

import { SPEAKING_PART1_ANSWER_SEC, formatCountdown } from "../constants/englishSpeakingExam";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import {
  formatSpeakingGradeSummary,
  gradeSpeakingResponse,
  transcribeSpeakingAudio,
  type SpeakingGradeResponse,
} from "../services/mobileSpeaking";
import { SpeakingFeedbackPanel } from "./SpeakingFeedbackPanel";

type Props = {
  questionText: string;
  subject: string;
  formLevel: string;
  onGraded: (result: SpeakingGradeResponse, transcript: string) => void;
};

export function EnglishSpeakingPart1Exam({ questionText, subject, formLevel, onGraded }: Props) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(SPEAKING_PART1_ANSWER_SEC);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<SpeakingGradeResponse | null>(null);
  const [transcript, setTranscript] = useState("");

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    clearTimer();
    setRecording(false);
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return;

    let uri: string | null = null;
    let durationSec = SPEAKING_PART1_ANSWER_SEC;
    try {
      await rec.stopAndUnloadAsync();
      const status = await rec.getStatusAsync().catch(() => null);
      if (status && "durationMillis" in status && typeof status.durationMillis === "number") {
        durationSec = Math.max(1, Math.round(status.durationMillis / 1000));
      }
      uri = rec.getURI();
    } catch {
      uri = null;
    }

    if (!uri) {
      setError("No recording captured.");
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const { transcript: text } = await transcribeSpeakingAudio(uri);
      setTranscript(text);
      const result = await gradeSpeakingResponse({
        phase: "speak",
        cueCard: questionText,
        transcript: text,
        subject,
        form: formLevel,
        durationSeconds: durationSec,
      });
      setTranscript(text);
      setGrade(result);
      onGraded(result, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process recording.");
    } finally {
      setProcessing(false);
    }
  }, [clearTimer, questionText, subject, formLevel, onGraded]);

  const startRecording = useCallback(async () => {
    setError(null);
    setGrade(null);
    setTranscript("");
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setError("Microphone permission is required.");
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    recordingRef.current = rec;
    setRecording(true);
    setSecondsLeft(SPEAKING_PART1_ANSWER_SEC);

    clearTimer();
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const left = Math.max(0, SPEAKING_PART1_ANSWER_SEC - elapsed);
      setSecondsLeft(left);
      if (left <= 0) void stopAndProcess();
    }, 250);
  }, [clearTimer, stopAndProcess]);

  useEffect(() => () => {
    clearTimer();
    void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
  }, [clearTimer]);

  return (
    <View style={styles.wrap}>
      {!grade && !processing ? (
        <>
          <Text style={styles.hint}>
            Tap the mic and answer in {SPEAKING_PART1_ANSWER_SEC} seconds (auto-stops at 0:00).
          </Text>
          {recording ? (
            <View style={styles.recordingBox}>
              <Text style={styles.timer}>{formatCountdown(secondsLeft)}</Text>
              <Pressable style={styles.stopBtn} onPress={() => void stopAndProcess()}>
                <Square size={14} color="#FFF" fill="#FFF" />
                <Text style={styles.stopText}>Stop</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.micBtn} onPress={() => void startRecording()}>
              <LinearGradient colors={[...theme.gradientCta]} style={styles.micGrad}>
                <Mic size={20} color="#FFFFFF" />
                <Text style={styles.micText}>Tap to answer</Text>
              </LinearGradient>
            </Pressable>
          )}
        </>
      ) : null}

      {processing ? (
        <View style={styles.processing}>
          {transcript.trim() ? (
            <SpeakingFeedbackPanel
              transcript={transcript}
              markingText="Marking your response…"
            />
          ) : (
            <>
              <ActivityIndicator color={theme.brand} />
              <Text style={styles.processingText}>Transcribing your speech…</Text>
            </>
          )}
        </View>
      ) : null}

      {grade ? (
        <SpeakingFeedbackPanel
          transcript={transcript}
          markingText={formatSpeakingGradeSummary(grade)}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 8 },
  hint: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  micBtn: { borderRadius: 14, overflow: "hidden" },
  micGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  micText: { fontSize: 15, fontFamily: fonts.bold, color: "#FFFFFF" },
  recordingBox: { alignItems: "center", gap: 8 },
  timer: { fontSize: 32, fontFamily: fonts.bold, color: theme.brand },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.brandDeep,
  },
  stopText: { fontSize: 13, fontFamily: fonts.semiBold, color: "#FFFFFF" },
  processing: { alignItems: "stretch", gap: 8, padding: 12 },
  processingText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: "center" },
  error: { fontSize: 12, fontFamily: fonts.medium, color: "#B91C1C" },
});
