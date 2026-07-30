/** SPM English Speaking Part 2 exam simulation timings (seconds). */
export const SPEAKING_PART2_PREPARE_SEC = 60;
export const SPEAKING_PART2_SPEAK_SEC = 120;

/** Part 1 short Q&A — one response window per question. */
export const SPEAKING_PART1_ANSWER_SEC = 30;

/** Pause after examiner asks (TTS done), before recording starts. */
export const SPEAKING_PART1_THINK_SEC = 2;

/** Brief gap between questions in interview mode (ms). */
export const SPEAKING_PART1_BETWEEN_MS = 1000;

/** Official Part 1 interview length — always exactly 5 questions. */
export const SPEAKING_PART1_QUESTIONS_PER_SESSION = 5;

export const SPEAKING_PART1_EXAMINER_INTRO =
  "Good morning. In this part of the test, I am going to ask you a few questions. Please answer clearly.";

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Wait until the next paint + a short settle so text is on screen before TTS. */
export function waitForUiPaint(extraMs = 120): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, extraMs);
      });
    });
  });
}
