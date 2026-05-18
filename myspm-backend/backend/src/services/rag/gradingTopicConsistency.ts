import type { MarkBreakdownItem } from "./types";

type TopicCluster = {
  id: string;
  /** Question stem suggests this topic. */
  stemSignal: RegExp;
  /** If these appear in grader output but not in the student answer, likely wrong-topic leakage. */
  outputRedFlags: RegExp;
};

const TOPIC_CLUSTERS: TopicCluster[] = [
  {
    id: "photosynthesis_lab",
    stemSignal:
      /photosynth|hydrilla|chlorophyll|oxygen\s+bubbles?|rate\s+of\s+photosynth|light\s+intensity.*photosynth|carbon\s+dioxide.*photosynth|fotosintesis/i,
    outputRedFlags:
      /\b(glycogen|deamination|urea|liver\s+assimilation|assimilation\s+in\s+the\s+liver|hepatocytes?\s+store)\b/i,
  },
  {
    id: "liver_assimilation",
    stemSignal: /\b(liver|hepat|assimilation|glycogen|deamination|urea|amino\s+acid.*liver)\b/i,
    outputRedFlags: /\b(hydrilla|oxygen\s+bubbles?|chloroplast|chlorophyll|photosynth|fotosintesis)\b/i,
  },
  {
    id: "genetics",
    stemSignal:
      /\b(allele|genotype|phenotype|karyotype|chromosome|meiosis|mitosis|cross(?:ing)?\s*over|inheritance|blood\s+group|abo|syndrome|mutation|dna|gene|gamete)\b/i,
    outputRedFlags: /\b(hydrilla|glycogen|photosynth|liver\s+assimilation|antibody|vaccine)\b/i,
  },
  {
    id: "immunity",
    stemSignal:
      /\b(antibody|antigen|vaccine|immunity|lymphocyte|phagocyte|hiv|pathogen|immune|vaksin|imun)\b/i,
    outputRedFlags: /\b(glycogen|photosynth|hydrilla|chloroplast|deamination|urea)\b/i,
  },
  {
    id: "lab_safety_ppe",
    stemSignal:
      /\b(ppe|personal\s+protective|laboratory\s+safety|goggles|gloves|lab\s+coat|chemical\s+spills?|fume\s+cupboard|radas\s+perlindungan)\b/i,
    outputRedFlags: /\b(photosynth|hydrilla|glycogen|sperm\s+cell|chromosome|meiosis|oxygen\s+bubbles)\b/i,
  },
  {
    id: "pollen_reproduction",
    stemSignal:
      /\b(pollen|pollination|sucrose|pollen\s+grain|pollen\s+tube|germinate|embryo\s+sac|double\s+fertilisation|gametophyte)\b/i,
    outputRedFlags: /\b(glycogen|liver\s+assimilation|deamination|hydrilla|photosynth.*enzyme\s+denature)\b/i,
  },
];

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type ValidateTopicConsistencyInput = {
  question: string;
  studentAnswer: string;
  feedback: string;
  modelAnswer?: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  rubricIdeas?: string[];
  markBreakdown?: MarkBreakdownItem[];
  score: number;
  maxScore: number;
  language: "english" | "malay" | "mixed";
};

export type ValidateTopicConsistencyResult = {
  topicConsistencyPassed: boolean;
  topicConsistencyWarning?: string;
  feedback: string;
  modelAnswer?: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
};

function briefSafeFeedback(
  score: number,
  maxScore: number,
  matched: string[],
  missing: string[],
  language: "english" | "malay" | "mixed",
): string {
  const m = matched.filter(Boolean);
  const miss = missing.filter(Boolean);
  if (language === "malay") {
    if (score >= maxScore) return `Betul (${score}/${maxScore}). Poin utama: ${m.slice(0, 4).join("; ") || "jawapan anda"}.`.trim();
    return `Markah ${score}/${maxScore}. Sudah betul: ${m.slice(0, 3).join("; ") || "(tiada)"}. Perlu perbaiki: ${miss.slice(0, 3).join("; ") || "perincikan jawapan"}.`.trim();
  }
  if (score >= maxScore) return `Correct (${score}/${maxScore}). Main points: ${m.slice(0, 4).join("; ") || "your answer"}.`.trim();
  return `Score ${score}/${maxScore}. You already gave: ${m.slice(0, 3).join("; ") || "(see your answer)"}. Still improve: ${miss.slice(0, 3).join("; ") || "add a bit more detail"}.`.trim();
}

/**
 * Blocks obvious wrong-topic leakage in grader strings (e.g. liver/glycogen feedback on a Hydrilla photosynthesis question).
 */
export function validateTopicConsistency(input: ValidateTopicConsistencyInput): ValidateTopicConsistencyResult {
  const q = normalize(input.question);
  const sa = normalize(input.studentAnswer);
  const outParts = [
    input.feedback,
    input.modelAnswer ?? "",
    ...(input.missingIdeas ?? []),
    ...(input.matchedIdeas ?? []),
    ...(input.rubricIdeas ?? []),
    ...(input.markBreakdown ?? []).map((r) => `${r.idea} ${r.reason}`),
  ];
  const blob = normalize(outParts.join("\n"));

  const activeClusters = TOPIC_CLUSTERS.filter((c) => c.stemSignal.test(q));
  if (activeClusters.length === 0) {
    return {
      topicConsistencyPassed: true,
      feedback: input.feedback,
      modelAnswer: input.modelAnswer,
      missingIdeas: input.missingIdeas,
      matchedIdeas: input.matchedIdeas,
      markBreakdown: input.markBreakdown,
    };
  }

  for (const c of activeClusters) {
    if (!c.outputRedFlags.test(blob)) continue;
    if (c.outputRedFlags.test(sa)) continue;
    const safeFeedback = briefSafeFeedback(
      input.score,
      input.maxScore,
      input.matchedIdeas,
      input.missingIdeas,
      input.language,
    );
    const modelAns =
      input.matchedIdeas.filter(Boolean).length > 0
        ? input.matchedIdeas.filter(Boolean).slice(0, 6).join("; ")
        : input.modelAnswer;

    return {
      topicConsistencyPassed: false,
      topicConsistencyWarning: `Topic guard (${c.id}): grader output contained cues typical of a different topic than this stem; student-facing feedback was replaced with a safe summary tied to your scored points.`,
      feedback: safeFeedback,
      modelAnswer: modelAns,
      missingIdeas: input.missingIdeas,
      matchedIdeas: input.matchedIdeas,
      markBreakdown: input.markBreakdown,
    };
  }

  return {
    topicConsistencyPassed: true,
    feedback: input.feedback,
    modelAnswer: input.modelAnswer,
    missingIdeas: input.missingIdeas,
    matchedIdeas: input.matchedIdeas,
    markBreakdown: input.markBreakdown,
  };
}
