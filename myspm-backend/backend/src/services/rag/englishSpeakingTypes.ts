/** SPM English oral exam parts supported for generation and practice. */
export type EnglishSpeakingPart = "part1" | "part2" | "part3";

export function englishSpeakingPartFromQuery(query: string): EnglishSpeakingPart | "all" {
  const q = query.toLowerCase();
  if (/\bpart\s*3\b|group\s+discussion/.test(q)) return "part3";
  if (/\bpart\s*2\b|cue\s*card|long\s+turn/.test(q)) return "part2";
  if (/\bpart\s*1\b|short\s+q\s*&\s*a|short\s+qa/.test(q)) return "part1";
  return "all";
}
