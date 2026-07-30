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

function looksLikePart2LongTurn(cueCard: string): boolean {
  const t = (cueCard || "").toLowerCase();
  return (
    /you\s+should\s+talk\s+about/.test(t) ||
    /preparation\s+time/.test(t) ||
    /speaking\s+time/.test(t) ||
    /1\.5\s*[-–]\s*2\s*minutes?/.test(t) ||
    (/topic\s*:/.test(t) && (t.match(/^\s*[-•*]/gm) || []).length >= 3)
  );
}

export function phaseAssessmentNotes(phase: SpeakingExamPhase, cueCard?: string): string {
  if (phase === "prepare") {
    return [
      "Exam phase: 1-minute PREPARATION (planning aloud).",
      "Judge how well the student organises ideas for the cue card: bullet coverage, relevant vocabulary, and clear communication of their plan.",
      "A short but well-developed plan can score highly; do not expect full long-turn length.",
    ].join(" ");
  }
  if (cueCard && looksLikePart2LongTurn(cueCard)) {
    return [
      "Exam phase: PART 2 INDIVIDUAL LONG TURN (about 1.5–2 minutes of speech).",
      "Judge sustained response: introduction, multiple points with reasons/examples, opinions, transitions, and a clear ending.",
      "Reward depth and coherence; penalise only when meaning breaks down.",
    ].join(" ");
  }
  return [
    "Exam phase: PART 1 short spoken response (about 20–40 seconds).",
    "Judge relevance, clarity, and brief development (opinion/reason/example).",
    "Reward clear communication; do not demand long-turn length.",
  ].join(" ");
}

function modelResponseInstruction(phase: SpeakingExamPhase, cueCard?: string): string {
  if (phase === "prepare") {
    return `"modelResponse": "<higher-band preparation plan for THIS cue card; 4–6 short spoken sentences outlining what the student will say>"`;
  }
  if (cueCard && looksLikePart2LongTurn(cueCard)) {
    return [
      `"modelResponse": "<FULL spoken model answer for THIS Part 2 task that naturally lasts about 1.5–2 minutes when read aloud.",
      "Must include: clear introduction; multiple supporting points; personal opinions; reasons; concrete examples; smooth transitions; strong conclusion.",
      "Write as continuous natural spoken English (paragraphs OK). NO bullet points. NO robotic filler. Sound like a high-scoring SPM student.",
      "Aim for roughly 220–320 words.>"`,
    ].join(" ");
  }
  return `"modelResponse": "<higher-band sample spoken answer for THIS Part 1 question; 4–7 short natural sentences (~20–40 seconds)>"`;
}

export function buildSpmSpeakingAssessmentSystemPrompt(
  phase: SpeakingExamPhase,
  cueCard?: string,
): string {
  const criterionLines = SPM_SPEAKING_CRITERIA.map(
    (c) =>
      `- ${c.id}: ${c.label} (0–${SPM_SPEAKING_CRITERION_MAX}). ${c.focus}`,
  ).join("\n");

  return [
    "You are a Malaysian SPM English Speaking examiner.",
    phaseAssessmentNotes(phase, cueCard),
    "",
    "ASSESSMENT PRINCIPLES (mandatory):",
    "- Evaluate communication effectiveness, NOT perfect grammatical accuracy.",
    "- Prioritise: ability to communicate meaning; relevance to the prompt; idea development;",
    "  supporting reasons and examples; ability to sustain the response.",
    "- Give credit for well-developed opinions, explanations, comparisons, suggestions, and justifications.",
    "- Distinguish weak (0), adequate (1), and strong (2) using depth and clarity, not isolated mistakes.",
    "- Language Accuracy must NOT dominate the overall impression.",
    "- Feedback: constructive, concise, SPM Form 4/5 level English. Keep overall feedback to 2 short sentences max.",
    "- Justifications: one short sentence each. Strengths/improvements: max 3 short bullets each.",
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
    `    { "id": "<criterionId>", "score": <0-2>, "band": "weak"|"adequate"|"strong", "justification": "<one short sentence>" }`,
    `  ],`,
    `  "overallBand": "<e.g. Excellent / Good / Fair / Weak>",`,
    `  "feedback": "<2 short sentences overall>",`,
    `  "strengths": ["<short point>", "..."],`,
    `  "improvements": ["<short point>", "..."],`,
    `  ${modelResponseInstruction(phase, cueCard)}`,
    `}`,
    "Include all five criterion ids exactly once.",
  ].join("\n");
}
