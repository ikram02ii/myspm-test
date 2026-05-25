export type SpeakingExamPhase = "prepare" | "speak";

export type SpeakingCriterionId =
  | "communicativeAbility"
  | "fluency"
  | "languageAccuracy"
  | "vocabularyRange"
  | "responseDevelopment";

export type SpeakingCriterionDefinition = {
  id: SpeakingCriterionId;
  label: string;
  shortLabel: string;
  focus: string;
};

/** SPM English Speaking — five criteria, each scored 0–2 (total 10). */
export const SPM_SPEAKING_CRITERIA: readonly SpeakingCriterionDefinition[] = [
  {
    id: "communicativeAbility",
    label: "Communicative Ability",
    shortLabel: "Communication",
    focus:
      "Can the listener understand the message? Relevance to the prompt, clear opinions, and successful communication of ideas matter more than perfect grammar.",
  },
  {
    id: "fluency",
    label: "Fluency",
    shortLabel: "Fluency",
    focus:
      "Flow and pace of speech (as inferable from the transcript): ability to keep going, logical links, and sustained delivery — not penalising normal hesitations heavily.",
  },
  {
    id: "languageAccuracy",
    label: "Language Accuracy",
    shortLabel: "Accuracy",
    focus:
      "Grammar and structure where they affect clarity. Do NOT grade on grammar alone; minor mistakes are acceptable if meaning is clear.",
  },
  {
    id: "vocabularyRange",
    label: "Vocabulary Range",
    shortLabel: "Vocabulary",
    focus:
      "Appropriate and varied words for the topic (opinions, reasons, examples, comparisons, suggestions). Reward precise topic vocabulary, not rare words for their own sake.",
  },
  {
    id: "responseDevelopment",
    label: "Response Development",
    shortLabel: "Development",
    focus:
      "Depth of ideas: explanations, reasons, examples, comparisons, justifications, and ability to elaborate — weak vs adequate vs strong discussion.",
  },
] as const;

export const SPM_SPEAKING_CRITERION_MAX = 2;
export const SPM_SPEAKING_OVERALL_MAX = SPM_SPEAKING_CRITERIA.length * SPM_SPEAKING_CRITERION_MAX;

export function phaseAssessmentNotes(phase: SpeakingExamPhase): string {
  if (phase === "prepare") {
    return [
      "Exam phase: 1-minute PREPARATION (planning aloud).",
      "Judge how well the student organises ideas for the cue card: bullet coverage, relevant vocabulary, and clear communication of their plan.",
      "A short but well-developed plan can score highly; do not expect full long-turn length.",
    ].join(" ");
  }
  return [
    "Exam phase: INDIVIDUAL LONG TURN / spoken response (Part 1 Q&A or Part 2 long turn).",
    "Judge the full spoken response against all five criteria.",
    "Reward opinions, reasons, examples, and sustained answers; penalise only when meaning breaks down.",
  ].join(" ");
}

export function buildSpmSpeakingAssessmentSystemPrompt(phase: SpeakingExamPhase): string {
  const criterionLines = SPM_SPEAKING_CRITERIA.map(
    (c) =>
      `- ${c.id}: ${c.label} (0–${SPM_SPEAKING_CRITERION_MAX}). ${c.focus}`,
  ).join("\n");

  return [
    "You are a Malaysian SPM English Speaking examiner.",
    phaseAssessmentNotes(phase),
    "",
    "ASSESSMENT PRINCIPLES (mandatory):",
    "- Evaluate communication effectiveness, NOT perfect grammatical accuracy.",
    "- Prioritise: ability to communicate meaning; relevance to the prompt; idea development;",
    "  supporting reasons and examples; ability to sustain the response.",
    "- Give credit for well-developed opinions, explanations, comparisons, suggestions, and justifications.",
    "- Distinguish weak (0), adequate (1), and strong (2) using depth and clarity, not isolated mistakes.",
    "- Language Accuracy must NOT dominate the overall impression.",
    "- Feedback: constructive, concise, SPM Form 4/5 level English.",
    "",
    "SCORING (each criterion):",
    criterionLines,
    "0 = weak / little evidence in transcript",
    "1 = adequate / partial but understandable",
    "2 = strong / clear and well developed for SPM level",
    "",
    "Return ONLY valid JSON (no markdown fences):",
    `{`,
    `  "criteria": [`,
    `    { "id": "<criterionId>", "score": <0-2>, "band": "weak"|"adequate"|"strong", "justification": "<1-2 sentences citing transcript evidence>" }`,
    `  ],`,
    `  "overallBand": "<e.g. Excellent / Good / Fair / Weak>",`,
    `  "feedback": "<2-4 sentences overall>",`,
    `  "strengths": ["<point>", "..."],`,
    `  "improvements": ["<point>", "..."],`,
    `  "modelResponse": "<higher-band sample answer for THIS prompt only; 4-8 sentences; SPM-appropriate>"`,
    `}`,
    "Include all five criterion ids exactly once.",
  ].join("\n");
}
