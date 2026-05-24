import React, { useCallback, useEffect, useRef, useState } from "react";

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Audio } from "expo-av";

import { LinearGradient } from "expo-linear-gradient";

import { Clock, Mic, Square } from "lucide-react-native";



import { EnglishSpeakingPart2Card } from "./EnglishSpeakingPart2Card";

import {

  SPEAKING_PART2_PREPARE_SEC,

  SPEAKING_PART2_SPEAK_SEC,

  formatCountdown,

} from "../constants/englishSpeakingExam";

import { colors } from "../constants/colors";

import { fonts } from "../constants/fonts";

import { theme } from "../constants/palette";

import {

  gradeSpeakingResponse,

  transcribeSpeakingAudio,

  type SpeakingGradeResponse,

} from "../services/mobileSpeaking";

import { SpeakingFeedbackPanel } from "./SpeakingFeedbackPanel";



type ExamStep =

  | "intro"

  | "prepare_timer"

  | "prepare_done"

  | "speak_starting"

  | "speak_recording"

  | "speak_processing"

  | "finished";



type Props = {

  questionText: string;

  sortOrder?: number;

  subject: string;

  formLevel: string;

  onExamComplete: (payload: {

    prepareGrade: SpeakingGradeResponse | null;

    speakGrade: SpeakingGradeResponse | null;

    prepareTranscript: string;

    speakTranscript: string;

  }) => void;

};



export function EnglishSpeakingPart2Exam({

  questionText,

  sortOrder = 1,

  subject,

  formLevel,

  onExamComplete,

}: Props) {

  const [step, setStep] = useState<ExamStep>("intro");

  const [secondsLeft, setSecondsLeft] = useState(0);

  const [elapsedSec, setElapsedSec] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const [speakGrade, setSpeakGrade] = useState<SpeakingGradeResponse | null>(null);

  const [speakTranscript, setSpeakTranscript] = useState("");

  const [pendingTranscript, setPendingTranscript] = useState("");



  const recordingRef = useRef<Audio.Recording | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecRef = useRef(0);
  const beginLongTurnRef = useRef<() => void>(() => {});

  const clearTimer = useCallback(() => {

    if (timerRef.current) {

      clearInterval(timerRef.current);

      timerRef.current = null;

    }

  }, []);



  const stopRecording = useCallback(async (): Promise<{ uri: string | null; durationSec: number }> => {

    const rec = recordingRef.current;

    recordingRef.current = null;

    if (!rec) return { uri: null, durationSec: elapsedSecRef.current };



    try {

      await rec.stopAndUnloadAsync();

    } catch {

      // already stopped

    }

    const status = await rec.getStatusAsync().catch(() => null);

    const durationMillis =

      status && "durationMillis" in status && typeof status.durationMillis === "number"

        ? status.durationMillis

        : elapsedSecRef.current * 1000;

    const uri = rec.getURI();

    return { uri, durationSec: Math.max(1, Math.round(durationMillis / 1000)) };

  }, []);



  const startPrepareTimer = useCallback(() => {

    setError(null);

    const limit = SPEAKING_PART2_PREPARE_SEC;

    elapsedSecRef.current = 0;
    setElapsedSec(0);

    setSecondsLeft(limit);

    setStep("prepare_timer");



    clearTimer();

    const started = Date.now();

    timerRef.current = setInterval(() => {

      const elapsed = Math.floor((Date.now() - started) / 1000);

      const left = Math.max(0, limit - elapsed);

      elapsedSecRef.current = elapsed;
      setElapsedSec(elapsed);

      setSecondsLeft(left);

      if (left <= 0) {

        beginLongTurnRef.current();

      }

    }, 250);

  }, [clearTimer]);



  const processSpeakRecording = useCallback(

    async (uri: string | null, durationSec: number) => {

      if (!uri) {

        setError("No recording captured. Please try again.");

        setStep("prepare_done");

        return;

      }



      setStep("speak_processing");

      setError(null);

      setPendingTranscript("");



      try {

        const { transcript } = await transcribeSpeakingAudio(uri);

        setPendingTranscript(transcript);

        setSpeakTranscript(transcript);



        const grade = await gradeSpeakingResponse({

          phase: "speak",

          cueCard: questionText,

          transcript,

          subject,

          form: formLevel,

          durationSeconds: durationSec,

        });



        setSpeakGrade(grade);

        setStep("finished");

        onExamComplete({

          prepareGrade: null,

          speakGrade: grade,

          prepareTranscript: "",

          speakTranscript: transcript,

        });

      } catch (e) {

        setError(e instanceof Error ? e.message : "Could not process your recording.");

        setStep("prepare_done");

      }

    },

    [questionText, subject, formLevel, onExamComplete],

  );



  const finishSpeakRecording = useCallback(async () => {

    clearTimer();

    const { uri, durationSec } = await stopRecording();

    await processSpeakRecording(uri, durationSec);

  }, [clearTimer, stopRecording, processSpeakRecording]);



  const startSpeakRecording = useCallback(async () => {

    setError(null);

    setPendingTranscript("");

    clearTimer();

    setStep("speak_starting");

    const perm = await Audio.requestPermissionsAsync();

    if (!perm.granted) {

      setError("Microphone permission is required for the long-turn recording.");

      setStep("prepare_done");

      return;

    }



    await Audio.setAudioModeAsync({

      allowsRecordingIOS: true,

      playsInSilentModeIOS: true,

    });



    const recording = new Audio.Recording();

    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

    await recording.startAsync();

    recordingRef.current = recording;



    const limit = SPEAKING_PART2_SPEAK_SEC;

    elapsedSecRef.current = 0;
    setElapsedSec(0);

    setSecondsLeft(limit);

    setStep("speak_recording");



    clearTimer();

    const started = Date.now();

    timerRef.current = setInterval(() => {

      const elapsed = Math.floor((Date.now() - started) / 1000);

      const left = Math.max(0, limit - elapsed);

      elapsedSecRef.current = elapsed;
      setElapsedSec(elapsed);

      setSecondsLeft(left);

      if (left <= 0) {

        void finishSpeakRecording();

      }

    }, 250);

  }, [clearTimer, finishSpeakRecording]);

  beginLongTurnRef.current = () => {
    clearTimer();
    void startSpeakRecording();
  };

  // Mount-only cleanup: depending on stopRecording/elapsedSec re-runs cleanup every tick and kills the timer.
  useEffect(() => {
    return () => {
      clearTimer();
      void stopRecording();
    };
  }, []);



  const isPrepareTimer = step === "prepare_timer";

  const isSpeakStarting = step === "speak_starting";

  const isSpeakRecording = step === "speak_recording";

  const isProcessing = step === "speak_processing";



  return (

    <View style={styles.wrap}>

      <EnglishSpeakingPart2Card questionText={questionText} sortOrder={sortOrder} />



      {step === "intro" ? (

        <View style={styles.phaseBox}>

          <Text style={styles.phaseTitle}>Exam flow</Text>

          <View style={styles.flowList}>

            <View style={styles.flowRow}>

              <View style={[styles.flowBadge, styles.flowBadgePrepare]}>

                <Clock size={14} color={theme.brandDeep} strokeWidth={2.5} />

              </View>

              <Text style={styles.flowText}>

                <Text style={styles.flowStepLabel}>Preparation — {SPEAKING_PART2_PREPARE_SEC}s</Text>

                {"\n"}Read the cue card and plan your answer. No recording.

              </Text>

            </View>

            <View style={styles.flowRow}>

              <View style={[styles.flowBadge, styles.flowBadgeSpeak]}>

                <Mic size={14} color={theme.brand} strokeWidth={2.5} />

              </View>

              <Text style={styles.flowText}>

                <Text style={styles.flowStepLabel}>Long turn — {SPEAKING_PART2_SPEAK_SEC}s</Text>

                {"\n"}Starts automatically when preparation ends ({SPEAKING_PART2_SPEAK_SEC}s recording).

              </Text>

            </View>

          </View>

          <Pressable

            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}

            onPress={startPrepareTimer}

          >

            <Clock size={18} color={theme.brandDeep} strokeWidth={2.5} />

            <Text style={styles.secondaryBtnText}>Start preparation timer</Text>

          </Pressable>

        </View>

      ) : null}



      {isPrepareTimer ? (

        <View style={styles.prepareTimerBox}>

          <Text style={styles.prepareTimerLabel}>Preparation time</Text>

          <Text style={styles.prepareTimerValue}>{formatCountdown(secondsLeft)}</Text>

          <Text style={styles.prepareTimerHint}>

            Read the cue card and prepare your answer. Recording begins automatically at 0:00.

          </Text>

          <Pressable

            style={({ pressed }) => [styles.skipPrepBtn, pressed && styles.btnPressed]}

            onPress={() => beginLongTurnRef.current()}

          >

            <Text style={styles.skipPrepBtnText}>Start long turn now</Text>

          </Pressable>

        </View>

      ) : null}

      {isSpeakStarting ? (
        <View style={styles.recordingBox}>
          <ActivityIndicator color={theme.brand} size="large" />
          <Text style={styles.recordingLabel}>Starting long turn</Text>
          <Text style={styles.recordingHint}>Allow microphone access if prompted.</Text>
        </View>
      ) : null}

      {step === "prepare_done" ? (

        <View style={styles.readyBox}>

          <Text style={styles.readyTitle}>Microphone needed</Text>

          <Text style={styles.readyHint}>

            Allow microphone access, then start your {SPEAKING_PART2_SPEAK_SEC}s long turn.

          </Text>

          <Pressable

            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}

            onPress={() => void startSpeakRecording()}

          >

            <LinearGradient colors={[...theme.gradientCta]} style={styles.primaryGrad}>

              <Mic size={18} color="#FFFFFF" strokeWidth={2.5} />

              <Text style={styles.primaryBtnText}>Start long turn ({SPEAKING_PART2_SPEAK_SEC}s)</Text>

            </LinearGradient>

          </Pressable>

        </View>

      ) : null}



      {isSpeakRecording ? (

        <View style={styles.recordingBox}>

          <Text style={styles.recordingLabel}>Speaking time · recording</Text>

          <Text style={styles.speakTimer}>{formatCountdown(secondsLeft)}</Text>

          <Text style={styles.recordingHint}>

            Speak clearly into the microphone. Stops automatically at 0:00.

          </Text>

          <Pressable

            style={({ pressed }) => [styles.stopBtn, pressed && styles.btnPressed]}

            onPress={() => void finishSpeakRecording()}

          >

            <Square size={16} color="#FFFFFF" fill="#FFFFFF" />

            <Text style={styles.stopBtnText}>Stop early</Text>

          </Pressable>

        </View>

      ) : null}



      {isProcessing ? (

        <View style={styles.processingBox}>

          {pendingTranscript.trim() ? (

            <SpeakingFeedbackPanel

              transcript={pendingTranscript}

              markingText="Marking your long turn…"

            />

          ) : (

            <>

              <ActivityIndicator color={theme.brand} />

              <Text style={styles.processingText}>Transcribing your speech…</Text>

            </>

          )}

        </View>

      ) : null}



      {step === "finished" && speakGrade ? (
        <View style={styles.doneBanner}>
          <Text style={styles.doneBannerText}>
            Long turn complete — see your score and feedback below.
          </Text>
        </View>
      ) : null}



      {error ? <Text style={styles.errorText}>{error}</Text> : null}

    </View>

  );

}



const styles = StyleSheet.create({

  wrap: { gap: 12 },

  phaseBox: {

    backgroundColor: colors.background,

    borderRadius: 14,

    borderWidth: 1,

    borderColor: colors.border,

    padding: 14,

    gap: 12,

  },

  phaseTitle: {

    fontSize: 14,

    fontFamily: fonts.bold,

    color: theme.brandDeep,

  },

  flowList: { gap: 10 },

  flowRow: {

    flexDirection: "row",

    alignItems: "flex-start",

    gap: 10,

  },

  flowBadge: {

    width: 28,

    height: 28,

    borderRadius: 8,

    alignItems: "center",

    justifyContent: "center",

  },

  flowBadgePrepare: {

    backgroundColor: theme.brandSoftSage,

  },

  flowBadgeSpeak: {

    backgroundColor: theme.brandSoft,

  },

  flowText: {

    flex: 1,

    fontSize: 12,

    fontFamily: fonts.regular,

    color: colors.textSecondary,

    lineHeight: 18,

  },

  flowStepLabel: {

    fontFamily: fonts.semiBold,

    color: colors.text,

  },

  prepareTimerBox: {

    alignItems: "center",

    backgroundColor: theme.brandSoftSage,

    borderRadius: 14,

    borderWidth: 1,

    borderColor: "rgba(152, 168, 105, 0.35)",

    padding: 18,

    gap: 8,

  },

  prepareTimerLabel: {

    fontSize: 11,

    fontFamily: fonts.semiBold,

    color: theme.brandDeep,

    textTransform: "uppercase",

    letterSpacing: 0.4,

  },

  prepareTimerValue: {

    fontSize: 40,

    fontFamily: fonts.bold,

    color: theme.brandDeep,

    fontVariant: ["tabular-nums"],

  },

  prepareTimerHint: {

    fontSize: 12,

    fontFamily: fonts.regular,

    color: colors.textSecondary,

    textAlign: "center",

    lineHeight: 18,

    paddingHorizontal: 8,

  },

  skipPrepBtn: {

    marginTop: 6,

    paddingVertical: 8,

    paddingHorizontal: 14,

  },

  skipPrepBtnText: {

    fontSize: 13,

    fontFamily: fonts.semiBold,

    color: theme.brandDeep,

  },

  readyBox: {

    backgroundColor: theme.surfaceHighlight,

    borderRadius: 14,

    borderWidth: 1,

    borderColor: theme.pillBorderBrand,

    padding: 14,

    gap: 10,

  },

  readyTitle: {

    fontSize: 14,

    fontFamily: fonts.bold,

    color: theme.brandDeep,

  },

  readyHint: {

    fontSize: 12,

    fontFamily: fonts.regular,

    color: colors.textSecondary,

    lineHeight: 18,

  },

  recordingBox: {

    alignItems: "center",

    backgroundColor: colors.background,

    borderRadius: 14,

    borderWidth: 2,

    borderColor: theme.brand,

    padding: 18,

    gap: 8,

  },

  recordingLabel: {

    fontSize: 11,

    fontFamily: fonts.semiBold,

    color: theme.brand,

    textTransform: "uppercase",

    letterSpacing: 0.4,

  },

  speakTimer: {

    fontSize: 40,

    fontFamily: fonts.bold,

    color: theme.brand,

    fontVariant: ["tabular-nums"],

  },

  recordingHint: {

    fontSize: 12,

    fontFamily: fonts.regular,

    color: colors.textSecondary,

    textAlign: "center",

  },

  stopBtn: {

    flexDirection: "row",

    alignItems: "center",

    gap: 6,

    marginTop: 6,

    paddingVertical: 9,

    paddingHorizontal: 16,

    borderRadius: 999,

    backgroundColor: theme.brand,

  },

  stopBtnPressed: { opacity: 0.88 },

  stopBtnText: {

    fontSize: 13,

    fontFamily: fonts.semiBold,

    color: "#FFFFFF",

  },

  processingBox: {

    alignItems: "stretch",

    gap: 10,

    padding: 16,

  },

  processingText: {

    fontSize: 13,

    fontFamily: fonts.medium,

    color: colors.textSecondary,

    textAlign: "center",

  },

  doneBanner: {
    backgroundColor: theme.brandSoftSage,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(152, 168, 105, 0.35)",
    padding: 12,
  },
  doneBannerText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: theme.brandDeep,
    textAlign: "center",
    lineHeight: 19,
  },

  errorText: {

    fontSize: 12,

    fontFamily: fonts.medium,

    color: theme.brand,

    backgroundColor: theme.brandSoft,

    padding: 10,

    borderRadius: 10,

    overflow: "hidden",

  },

  secondaryBtn: {

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "center",

    gap: 8,

    paddingVertical: 14,

    paddingHorizontal: 16,

    borderRadius: 14,

    backgroundColor: theme.brandSoftSage,

    borderWidth: 1,

    borderColor: "rgba(152, 168, 105, 0.4)",

  },

  secondaryBtnText: {

    fontSize: 15,

    fontFamily: fonts.bold,

    color: theme.brandDeep,

  },

  primaryBtn: { borderRadius: 14, overflow: "hidden" },

  btnPressed: { opacity: 0.9 },

  primaryGrad: {

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "center",

    gap: 8,

    paddingVertical: 14,

    paddingHorizontal: 16,

  },

  primaryBtnText: {

    fontSize: 15,

    fontFamily: fonts.bold,

    color: "#FFFFFF",

  },

});


