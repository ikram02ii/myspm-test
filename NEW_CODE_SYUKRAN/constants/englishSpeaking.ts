export type EnglishSpeakingPart = "part1" | "part2" | "part3";

export const ENGLISH_SPEAKING_PART_OPTIONS: Array<{ id: EnglishSpeakingPart; label: string }> = [
  { id: "part1", label: "Part 1: Short Q&A" },
  { id: "part2", label: "Part 2: Individual Long Turn" },
  { id: "part3", label: "Part 3: Group Discussion" },
];

export const ENGLISH_PART1_TOPIC_CATEGORIES = [
  "Daily Life",
  "School",
  "Hobbies",
  "Family & Friends",
  "Food & Lifestyle",
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
  "Random",
] as const;

export const ENGLISH_PART3_TOPIC_CATEGORIES = [
  "Social Issues",
  "Technology",
  "Education",
  "Health",
  "Environment",
  "Youth & Society",
  "School Life",
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
  if (part === "part3") return ENGLISH_PART3_TOPIC_CATEGORIES;
  return ENGLISH_PART2_TOPIC_CATEGORIES;
}

export function defaultTopicForPart(part: EnglishSpeakingPart): string {
  return topicCategoriesForPart(part)[0];
}
