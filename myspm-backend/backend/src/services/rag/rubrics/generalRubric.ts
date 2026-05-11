export function generalRubric(subject?: string): string[] {
  return [
    `Subject-specific rubric (${subject?.trim() || "General"}):`,
    "- Prioritize subject-domain accuracy and key concepts expected at SPM level.",
    "- Reward correct reasoning, not memorized wording.",
    "- Accept equivalent terminology in Bahasa Melayu/English when meaning is correct.",
    "- For structured responses, reward completeness of required points.",
    "- For diagram/table/graph questions, reward evidence-based interpretation from the provided visual context.",
    "- Penalize only clear conceptual errors and provide corrective teaching feedback.",
  ];
}

