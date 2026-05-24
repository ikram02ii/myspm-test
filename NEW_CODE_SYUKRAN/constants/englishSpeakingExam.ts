/** SPM English Speaking Part 2 exam simulation timings (seconds). */
export const SPEAKING_PART2_PREPARE_SEC = 60;
export const SPEAKING_PART2_SPEAK_SEC = 120;

/** Part 1 short Q&A — one response window per question. */
export const SPEAKING_PART1_ANSWER_SEC = 30;

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
