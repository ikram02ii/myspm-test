import * as Speech from "expo-speech";

/** Stop any in-progress examiner speech. */
export function stopExaminerSpeech(): void {
  Speech.stop();
}

/** Speak text as the examiner; resolves when playback finishes. */
export function speakExaminerText(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  return new Promise((resolve) => {
    stopExaminerSpeech();
    Speech.speak(trimmed, {
      language: "en-GB",
      rate: 0.9,
      pitch: 1.0,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}
