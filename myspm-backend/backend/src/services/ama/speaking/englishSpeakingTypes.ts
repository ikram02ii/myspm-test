/** SPM English oral exam parts supported for generation and practice. */
export type EnglishSpeakingPart = "part1" | "part2";

export function englishSpeakingPartFromQuery(query: string): EnglishSpeakingPart | "all" {
  const q = query.toLowerCase();
  if (/\bpart\s*2\b|cue\s*card|long\s+turn|individual\s+long/.test(q)) return "part2";
  if (/\bpart\s*1\b|short\s+q\s*&\s*a|short\s+qa|interview/.test(q)) return "part1";
  return "all";
}
