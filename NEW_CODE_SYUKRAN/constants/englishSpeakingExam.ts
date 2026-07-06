/** SPM English Speaking Part 2 exam simulation timings (seconds). */
export const SPEAKING_PART2_PREPARE_SEC = 60;
export const SPEAKING_PART2_SPEAK_SEC = 120;

/** Part 1 short Q&A — one response window per question. */
export const SPEAKING_PART1_ANSWER_SEC = 30;

/** Pause after examiner asks, before recording starts. */
export const SPEAKING_PART1_THINK_SEC = 2;

/** Brief gap between questions in interview mode. */
export const SPEAKING_PART1_BETWEEN_SEC = 1;

/** Cap questions per Part 1 interview session (SPM-style). */
export const SPEAKING_PART1_QUESTIONS_PER_SESSION = 6;

export const SPEAKING_PART1_EXAMINER_INTRO =
  "Good morning. In this part of the test, I am going to ask you a few questions. Please answer clearly.";

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
