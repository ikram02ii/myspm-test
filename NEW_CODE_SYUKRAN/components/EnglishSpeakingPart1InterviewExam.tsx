import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Audio } from "expo-av";
import { Check, Mic, Square, User } from "lucide-react-native";

import { EnglishSpeakingPart1InterviewCard } from "./EnglishSpeakingPart1InterviewCard";

import {
  SPEAKING_PART1_ANSWER_SEC,
  SPEAKING_PART1_BETWEEN_MS,
  SPEAKING_PART1_EXAMINER_INTRO,
  SPEAKING_PART1_THINK_SEC,
  formatCountdown,
  waitForUiPaint,
} from "../constants/englishSpeakingExam";
import { fonts } from "../constants/fonts";
import { colors } from "../constants/colors";
import { theme } from "../constants/palette";
import {
  gradeSpeakingResponse,
  transcribeSpeakingAudio,
} from "../services/mobileSpeaking";
import { speakExaminerText, stopExaminerSpeech } from "../services/speakingExaminerTts";
import type { Part1InterviewSessionResult, Part1InterviewTurn } from "../utils/englishSpeakingInterview";

type InterviewStep =
  | "intro"
  | "live"
  | "waiting_grades";

type LiveSubStep = "examiner_intro" | "examiner_asking" | "recording" | "between_questions";

type InterviewQuestion = {
  id: number;
  text: string;
};

function formatRecordedDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatAnswerRecorded(seconds: number): string {
  return formatRecordedDuration(seconds);
}

type Props = {
  questions: InterviewQuestion[];
  subject: string;
  formLevel: string;
  skipToIndex: number;
  onSessionComplete: (result: Part1InterviewSessionResult) => void;
  /** Fires when the live interview advances so the session header can stay in sync. */
  onActiveQuestionIndexChange?: (localIndex: number) => void;
};

function emptyTurn(q: InterviewQuestion): Part1InterviewTurn {
  return {
    questionId: q.id,
    questionText: q.text,
    transcript: "",
    grade: null,
  };
}

function phaseSplit(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function WaveformBars({ active }: { active: boolean }) {
  const bar0 = useRef(new Animated.Value(0.35)).current;
  const bar1 = useRef(new Animated.Value(0.65)).current;
  const bar2 = useRef(new Animated.Value(0.45)).current;
  const bar3 = useRef(new Animated.Value(0.8)).current;
  const bars = [bar0, bar1, bar2, bar3];

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => b.setValue(0.25));
      return;
    }
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.85 + (i % 2) * 0.1,
            duration: 280 + i * 60,
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: 0.25 + (i % 3) * 0.1,
            duration: 280 + i * 50,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, bar0, bar1, bar2, bar3, bars]);

  return (
    <View style={styles.waveRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              transform: [
                {
                  scaleY: bar.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

type LiveQuestionDeckProps = {
  questionIndex: number;
  totalQuestions: number;
  cardText: string;
  liveSubStep: LiveSubStep;
  recordedPill: string | null;
  phaseLabel: string;
};

function LiveQuestionDeck({
  questionIndex,
  totalQuestions,
  cardText,
  liveSubStep,
  recordedPill,
  phaseLabel,
}: LiveQuestionDeckProps) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const cardsBehind = Math.min(2, Math.max(0, totalQuestions - questionIndex - 1));
  const isIntro = liveSubStep === "examiner_intro";
  const isSpeaking = liveSubStep === "examiner_asking";
  // Intro may hide stem; once a question is active, always show the text before/during TTS.
  const listeningMode = isIntro ? "intro" : null;
  const audioPlaying = isIntro || isSpeaking;

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [cardText, questionIndex, fadeAnim]);

  return (
    <View style={styles.deckWrap}>
      <View style={styles.deckStack}>
        {cardsBehind >= 2 ? <View style={[styles.stackCard, styles.stackCardFar]} /> : null}
        {cardsBehind >= 1 ? <View style={[styles.stackCard, styles.stackCardNear]} /> : null}

        <Animated.View style={[styles.deckFront, { opacity: fadeAnim }]}>
          <EnglishSpeakingPart1InterviewCard
            variant="question"
            questionText={cardText}
            totalQuestions={totalQuestions}
            phaseLabel={phaseLabel}
            isIntroScript={isIntro}
            listeningMode={listeningMode}
          />
        </Animated.View>
      </View>

      {recordedPill ? (
        <View style={styles.recordedStatus}>
          <View style={styles.checkBadge}>
            <Check size={14} color="#FFFFFF" strokeWidth={3} />
          </View>
          <View style={styles.recordedStatusTextCol}>
            <Text style={styles.recordedStatusTitle}>Answer recorded</Text>
            <Text style={styles.recordedStatusMeta}>
              {recordedPill} · Next question shortly
            </Text>
          </View>
        </View>
      ) : audioPlaying ? (
        <View style={styles.listenStatus}>
          <ActivityIndicator size="small" color={theme.brand} />
          <Text style={styles.listenText}>
            {isIntro ? "Examiner speaking…" : "Examiner asking — read along"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function EnglishSpeakingPart1InterviewExam({
  questions,
  subject,
  formLevel,
  skipToIndex,
  onSessionComplete,
  onActiveQuestionIndexChange,
}: Props) {
  const [step, setStep] = useState<InterviewStep>("intro");
  const [liveSubStep, setLiveSubStep] = useState<LiveSubStep>("examiner_intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SPEAKING_PART1_ANSWER_SEC);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Part1InterviewTurn[]>(() => questions.map(emptyTurn));
  const [pendingGrades, setPendingGrades] = useState(0);
  const [recordedPill, setRecordedPill] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartedRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const flowGenRef = useRef(0);
  const turnsRef = useRef(turns);
  const questionIndexRef = useRef(questionIndex);
  const processingRecordingRef = useRef(false);

  const phase1End = phaseSplit(questions.length);
  const activePhase = questionIndex < phase1End ? 1 : 2;

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    questionIndexRef.current = questionIndex;
  }, [questionIndex]);

  useEffect(() => {
    if (step !== "live" && step !== "waiting_grades") return;
    onActiveQuestionIndexChange?.(questionIndex);
  }, [step, questionIndex, onActiveQuestionIndexChange]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    if (elapsedRef.current) return;
    sessionStartedRef.current = Date.now();
    elapsedRef.current = setInterval(() => {
      if (!sessionStartedRef.current) return;
      setElapsedSec(Math.floor((Date.now() - sessionStartedRef.current) / 1000));
    }, 1000);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
  }, []);

  const runCountdown = useCallback(
    (seconds: number, onDone: () => void) => {
      clearTimer();
      setSecondsLeft(seconds);
      const started = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        const left = Math.max(0, seconds - elapsed);
        setSecondsLeft(left);
        if (left <= 0) {
          clearTimer();
          onDone();
        }
      }, 200);
    },
    [clearTimer],
  );

  const gradeTurnInBackground = useCallback(
    (idx: number, questionText: string, uri: string, durationSec: number) => {
      setPendingGrades((n) => n + 1);
      void (async () => {
        try {
          const { transcript } = await transcribeSpeakingAudio(uri);
          const grade = await gradeSpeakingResponse({
            phase: "speak",
            cueCard: questionText,
            transcript,
            subject,
            form: formLevel,
            durationSeconds: durationSec,
          });
          if (!mountedRef.current) return;
          setTurns((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], transcript, grade };
            return next;
          });
        } catch (e) {
          if (!mountedRef.current) return;
          const msg = e instanceof Error ? e.message : "Could not process recording.";
          setTurns((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], error: msg };
            return next;
          });
        } finally {
          if (mountedRef.current) {
            setPendingGrades((n) => Math.max(0, n - 1));
          }
        }
      })();
    },
    [subject, formLevel],
  );

  const stopRecording = useCallback(async (): Promise<{ uri: string | null; durationSec: number }> => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return { uri: null, durationSec: SPEAKING_PART1_ANSWER_SEC };

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
    return { uri, durationSec };
  }, []);

  const finishSession = useCallback(() => {
    const finalTurns = turnsRef.current;
    let totalScore = 0;
    let gradedCount = 0;
    for (const turn of finalTurns) {
      if (turn.grade) {
        totalScore += turn.grade.score;
        gradedCount += 1;
      }
    }
    const averageScore =
      gradedCount > 0 ? Math.round((totalScore / gradedCount) * 10) / 10 : 0;
    onSessionComplete({
      turns: finalTurns,
      totalScore: averageScore,
      totalMax: 10,
      skipToIndex,
    });
  }, [onSessionComplete, skipToIndex]);

  const runQuestionFlowRef = useRef<(idx: number, gen: number) => Promise<void>>(async () => {});
  const advanceAfterRecordingRef = useRef<(idx: number) => void>(() => {});
  const processRecordingRef = useRef<(idx: number, questionText: string) => Promise<void>>(async () => {});
  const startRecordingRef = useRef<(idx: number, questionText: string) => Promise<void>>(async () => {});

  const advanceAfterRecording = useCallback(
    (idx: number) => {
      const nextIdx = idx + 1;
      if (nextIdx >= questions.length) {
        setLiveSubStep("between_questions");
        setStep("waiting_grades");
        return;
      }
      // Stepper updates immediately; TTS for the next question starts after a short gap.
      setQuestionIndex(nextIdx);
      setLiveSubStep("between_questions");
      setTimeout(() => {
        if (!mountedRef.current) return;
        flowGenRef.current += 1;
        void runQuestionFlowRef.current(nextIdx, flowGenRef.current);
      }, SPEAKING_PART1_BETWEEN_MS);
    },
    [questions.length],
  );
  advanceAfterRecordingRef.current = advanceAfterRecording;

  const processRecording = useCallback(
    async (idx: number, questionText: string) => {
      if (processingRecordingRef.current) return;
      processingRecordingRef.current = true;
      clearTimer();
      setLiveSubStep("between_questions");

      const { uri, durationSec } = await stopRecording();
      if (!mountedRef.current) {
        processingRecordingRef.current = false;
        return;
      }

      if (!uri) {
        setError("No recording captured. Moving to the next question.");
        setTurns((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], error: "No recording captured." };
          return next;
        });
        processingRecordingRef.current = false;
        advanceAfterRecordingRef.current(idx);
        return;
      }

      setRecordedPill(formatAnswerRecorded(durationSec));
      gradeTurnInBackground(idx, questionText, uri, durationSec);
      processingRecordingRef.current = false;
      // Advance immediately (no delayed setTimeout wrapper) so "N of 5" updates now.
      advanceAfterRecordingRef.current(idx);
    },
    [clearTimer, gradeTurnInBackground, stopRecording],
  );
  processRecordingRef.current = processRecording;

  const startRecording = useCallback(
    async (idx: number, questionText: string) => {
      setError(null);
      setLiveSubStep("recording");
      setSecondsLeft(SPEAKING_PART1_ANSWER_SEC);

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission is required.");
        setStep("intro");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      try {
        const rec = new Audio.Recording();
        await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await rec.startAsync();
        recordingRef.current = rec;
      } catch {
        setError("Could not start recording.");
        advanceAfterRecordingRef.current(idx);
        return;
      }

      runCountdown(SPEAKING_PART1_ANSWER_SEC, () => {
        void processRecordingRef.current(idx, questionText);
      });
    },
    [runCountdown],
  );
  startRecordingRef.current = startRecording;

  const runQuestionFlow = useCallback(
    async (idx: number, gen: number) => {
      const q = questions[idx];
      if (!q) return;

      setRecordedPill(null);
      // Ensure index + question text are committed before any audio.
      setQuestionIndex(idx);
      setLiveSubStep("examiner_asking");
      // Wait for question card paint + fade-in (~280ms) before any TTS.
      await waitForUiPaint(320);
      if (!mountedRef.current || flowGenRef.current !== gen) return;

      await speakExaminerText(q.text);
      if (!mountedRef.current || flowGenRef.current !== gen) return;

      await waitForUiPaint(SPEAKING_PART1_THINK_SEC * 1000);
      if (!mountedRef.current || flowGenRef.current !== gen) return;

      void startRecordingRef.current(idx, q.text);
    },
    [questions],
  );
  runQuestionFlowRef.current = runQuestionFlow;

  const beginInterview = useCallback(async () => {
    flowGenRef.current += 1;
    const gen = flowGenRef.current;
    setError(null);
    setTurns(questions.map(emptyTurn));
    setQuestionIndex(0);
    setPendingGrades(0);
    setRecordedPill(null);
    setElapsedSec(0);
    startElapsedTimer();
    setStep("live");

    setLiveSubStep("examiner_intro");
    await waitForUiPaint(320);
    if (!mountedRef.current || flowGenRef.current !== gen) return;
    await speakExaminerText(SPEAKING_PART1_EXAMINER_INTRO);
    if (!mountedRef.current || flowGenRef.current !== gen) return;

    void runQuestionFlow(0, gen);
  }, [questions, runQuestionFlow, startElapsedTimer]);

  useEffect(() => {
    if (step !== "waiting_grades") return;
    if (pendingGrades > 0) return;
    stopElapsedTimer();
    finishSession();
  }, [step, pendingGrades, stopElapsedTimer, finishSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flowGenRef.current += 1;
      clearTimer();
      stopElapsedTimer();
      stopExaminerSpeech();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    };
  }, [clearTimer, stopElapsedTimer]);

  const currentQuestion = questions[questionIndex];
  const isRecording = liveSubStep === "recording";

  const cardText =
    liveSubStep === "examiner_intro"
      ? SPEAKING_PART1_EXAMINER_INTRO
      : currentQuestion?.text ?? "";

  const phaseLabel =
    activePhase === 1 ? "Phase 1 · About you" : "Phase 2 · Daily routine";

  if (step === "intro") {
    return (
      <View style={styles.wrap}>
        <EnglishSpeakingPart1InterviewCard
          variant="overview"
          questionText=""
          totalQuestions={questions.length}
        />

        <View style={styles.phaseBox}>
          <Text style={styles.phaseTitle}>Exam flow</Text>

          <View style={styles.flowList}>
            <View style={styles.flowRow}>
              <View style={[styles.flowBadge, styles.flowBadgeListen]}>
                <User size={14} color={theme.brandDeep} strokeWidth={2.5} />
              </View>
              <Text style={styles.flowText}>
                <Text style={styles.flowStepLabel}>Examiner questions</Text>
                {"\n"}Listen to each question. The next one starts after you finish answering.
              </Text>
            </View>

            <View style={styles.flowRow}>
              <View style={[styles.flowBadge, styles.flowBadgeSpeak]}>
                <Mic size={14} color={theme.brand} strokeWidth={2.5} />
              </View>
              <Text style={styles.flowText}>
                <Text style={styles.flowStepLabel}>Your answer — {SPEAKING_PART1_ANSWER_SEC}s</Text>
                {"\n"}Recording starts automatically after each question. Tap stop when you finish.
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
            onPress={() => void beginInterview()}
          >
            <Mic size={18} color={theme.brandDeep} strokeWidth={2.5} />
            <Text style={styles.secondaryBtnText}>Begin interview</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === "waiting_grades") {
    return (
      <View style={styles.wrap}>
        <View style={styles.processingBox}>
          <ActivityIndicator color={theme.brand} />
          <Text style={styles.processingText}>Marking your answers…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <LiveQuestionDeck
        questionIndex={questionIndex}
        totalQuestions={questions.length}
        cardText={cardText}
        liveSubStep={liveSubStep}
        recordedPill={recordedPill}
        phaseLabel={phaseLabel}
      />

      {isRecording ? (
        <View style={styles.recordingBox}>
          <Text style={styles.recordingLabel}>Your turn · recording</Text>
          <Text style={styles.speakTimer}>{formatCountdown(secondsLeft)}</Text>
          <WaveformBars active />
          <Text style={styles.recordingHint}>
            Speak clearly into the microphone. Stops automatically at 0:00.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.stopBtn, pressed && styles.btnPressed]}
            onPress={() => {
              if (currentQuestion) {
                void processRecording(questionIndexRef.current, currentQuestion.text);
              }
            }}
          >
            <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.stopBtnText}>Stop early</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginTop: 4 },
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
  flowBadgeListen: {
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
  btnPressed: { opacity: 0.9 },
  deckWrap: {
    width: "100%",
    gap: 12,
  },
  deckStack: {
    position: "relative",
    alignItems: "center",
    width: "100%",
  },
  stackCard: {
    position: "absolute",
    top: 0,
    width: "94%",
    height: "92%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: theme.brandSoftSage,
  },
  stackCardNear: {
    opacity: 0.55,
    transform: [{ translateY: 6 }, { scale: 0.98 }],
  },
  stackCardFar: {
    opacity: 0.3,
    transform: [{ translateY: 12 }, { scale: 0.96 }],
    backgroundColor: theme.brandSoft,
  },
  deckFront: {
    width: "100%",
  },
  recordedStatus: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "rgba(21, 128, 61, 0.22)",
  },
  recordedStatusTextCol: {
    flex: 1,
    gap: 2,
  },
  recordedStatusTitle: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: "#166534",
  },
  recordedStatusMeta: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: "#3F6212",
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  listenStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: theme.brandSoftSage,
    borderWidth: 1,
    borderColor: "rgba(152, 168, 105, 0.35)",
  },
  listenBox: {
    alignItems: "center",
    backgroundColor: theme.brandSoftSage,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(152, 168, 105, 0.35)",
    padding: 14,
  },
  listenText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: theme.brandDeep,
    textAlign: "center",
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
  stopBtnText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: "#FFFFFF",
  },
  waveRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 5,
    height: 28,
  },
  waveBar: {
    width: 4,
    height: 24,
    borderRadius: 2,
    backgroundColor: theme.brand,
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
  errorText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: theme.brand,
    backgroundColor: theme.brandSoft,
    padding: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
});
