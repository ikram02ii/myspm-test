export type EnglishSpeakingPart = "part1" | "part2";

export const ENGLISH_SPEAKING_PART_OPTIONS: Array<{ id: EnglishSpeakingPart; label: string }> = [
  { id: "part1", label: "Part 1" },
  { id: "part2", label: "Part 2" },
];

export const ENGLISH_PART1_TOPIC_CATEGORIES = [
  "School Life",
  "Hobbies & Interests",
  "Family & Friends",
  "Technology & Social Media",
  "Health & Lifestyle",
  "Sports",
  "Reading & Media",
  "Travelling",
  "Future Ambitions",
  "Daily Routines",
  "Environment",
  "Random",
] as const;

export const ENGLISH_PART2_TOPIC_CATEGORIES = [
  "People",
  "Places",
  "Activities",
  "Experiences",
  "Objects / Gadgets",
  "Health & Lifestyle",
  "Environment",
  "School Life",
  "Technology",
  "Future Ambitions",
  "Random",
] as const;

export type EnglishPart1Topic = (typeof ENGLISH_PART1_TOPIC_CATEGORIES)[number];
export type EnglishPart2Topic = (typeof ENGLISH_PART2_TOPIC_CATEGORIES)[number];

export function isEnglishPracticeCode(code: string | null): boolean {
  if (!code) return false;
  const k = code.trim().toUpperCase();
  return k === "ENGLISH" || k === "ENG" || k === "EN";
}

export function topicCategoriesForPart(part: EnglishSpeakingPart): readonly string[] {
  if (part === "part1") return ENGLISH_PART1_TOPIC_CATEGORIES;
  return ENGLISH_PART2_TOPIC_CATEGORIES;
}

export function defaultTopicForPart(part: EnglishSpeakingPart): string {
  return topicCategoriesForPart(part)[0];
}
