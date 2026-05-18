/**
 * Fairness helpers: detect when a "missing" rubric idea is already expressed
 * in the student answer (paraphrase / synonym), for post-processing grader output.
 */

import type { MarkBreakdownItem } from "./types";

export const EQUIVALENT_PHRASE_GROUPS: readonly string[][] = [
  ["pollen tube", "grow a pollen tube", "form a pollen tube", "develop a pollen tube", "grows a pollen tube", "pollen tube growth"],
  ["provides energy", "give energy", "gives energy", "source of energy", "supply energy", "food source", "source of food", "provides nutrients", "nutrients", "gives nutrients"],
  ["lightweight", "low weight", "low density", "light weight", "not heavy"],
  ["strong", "high strength", "stronger", "tensile strength", "hard to break"],
  ["speed of reaction", "reaction rate", "rate of reaction", "how fast the reaction", "how fast the reaction happens"],
  [
    "protect from hazards",
    "protect from chemicals",
    "protect from accidents",
    "protect from injury",
    "protect from harm",
    "prevent injury",
    "keep safe",
    "protect us from chemicals",
    "protects from chemicals",
    "protect us from accidents",
    "protect from laboratory hazards",
    "laboratory safety",
    "safety",
    "ppe",
    "personal protective equipment",
  ],
  ["oxygen debt", "repay oxygen debt", "replace oxygen used", "pay back oxygen debt"],
  ["break down lactic acid", "remove lactic acid", "oxidise lactic acid", "oxidize lactic acid"],
  ["fixed shells", "energy levels", "electron shells", "fixed orbits", "electron orbits"],
  ["tail helps movement", "tail helps swim", "flagellum moves sperm", "tail for movement", "flagellum"],
  ["exchange of substances", "exchange substances", "diffusion", "diffuse", "allow exchange", "substances between blood", "between blood and tissue"],
  ["capillary", "capillaries", "blood capillary"],
  ["particles move faster", "particles have higher kinetic energy", "higher kinetic energy", "move faster", "faster movement"],
  ["collide more often", "collisions happen more often", "more frequent collisions", "collision frequency increases", "more collisions"],
  [
    "overcome activation energy",
    "enough energy to overcome activation energy",
    "energy equal to or greater than activation energy",
    "exceed activation energy",
    "sufficient energy to react",
    "more effective collisions",
  ],
  ["larger surface area", "surface area is larger", "more surface area", "powdered has larger surface area"],
  [
    "more particles exposed",
    "particles exposed to acid",
    "particles exposed to hydrochloric acid",
    "more particles are exposed to the acid",
    "exposed to the reactant",
  ],
  [
    "more frequent successful collisions",
    "more frequent collisions",
    "successful collisions",
    "collide more often",
    "more collisions between particles",
  ],
];

export function ideasShareSynonymGroup(a: string, b: string): boolean {
  const na = normalizeAnswerText(a);
  const nb = normalizeAnswerText(b);
  if (!na || !nb) return false;
  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const hitA = group.some((g) => na.includes(normalizeAnswerText(g)));
    const hitB = group.some((g) => nb.includes(normalizeAnswerText(g)));
    if (hitA && hitB) return true;
  }
  return false;
}

export function normalizeAnswerText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rubric row needs source/destination or tissue route (e.g. leaves → roots), not just "transports food". */
export function rubricIdeaRequiresRouteDetail(idea: string): boolean {
  const id = normalizeAnswerText(idea);
  if (/\bfrom\s+.+\s+to\b/.test(id)) return true;
  if (/\b(distribut|distribution|translocat)\b/.test(id) && /\b(parts|plant|growth|survival|regions)\b/.test(id)) {
    return true;
  }
  if (
    /\b(leaves|roots|stem|storage|sink|source|photosynthetic)\b/.test(id) &&
    /\b(to|from|transport|transports|carry|move|distribut)\b/.test(id)
  ) {
    return true;
  }
  if (/\bother\s+parts|growing\s+regions|storage\s+organs\b/.test(id)) return true;
  return false;
}

export function studentAnswerHasRouteDetail(answer: string): boolean {
  const ans = normalizeAnswerText(answer);
  if (/\bfrom\s+.+\s+to\b/.test(ans)) return true;
  if (/\bfrom\s+(leaves|roots|source|photosynthetic|daun|akar)\b/.test(ans)) return true;
  if (/\bto\s+(roots|other|all|storage|growing|parts|sink|akar|bahagian)\b/.test(ans)) return true;
  if (/\b(leaves|roots|stem|daun|akar|batang)\b/.test(ans) && /\b(to|from|ke|dari)\b/.test(ans)) return true;
  if (/\b(all|other)\s+parts\b/.test(ans)) return true;
  return false;
}

/** SPM transport marks: route/direction rows need from→to (or equivalent), not only "transports X". */
export function studentAnswerSatisfiesRubricDetail(studentAnswer: string, rubricIdea: string): boolean {
  if (!rubricIdeaRequiresRouteDetail(rubricIdea)) return true;
  return studentAnswerHasRouteDetail(studentAnswer);
}

/**
 * Heuristic: does the student answer already cover the idea text
 * (substring, shared significant tokens, or equivalent phrase group)?
 */
export function studentAnswerCoversIdea(studentAnswer: string, idea: string): boolean {
  const ans = normalizeAnswerText(studentAnswer);
  const id = normalizeAnswerText(idea);
  if (!ans || !id) return false;
  if (ans.includes(id)) return true;
  if (id.includes(ans)) {
    if (!studentAnswerSatisfiesRubricDetail(studentAnswer, idea)) return false;
    const ansWords = ans.split(/\s+/).filter(Boolean).length;
    const idWords = id.split(/\s+/).filter(Boolean).length;
    if (idWords >= ansWords + 5) return false;
    return true;
  }

  const tokens = id
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length > 3 &&
        !/\b(the|and|for|are|was|with|from|that|this|into|each|their|they|them|when|than|then|will|been|being|have|has|had|not|but|its|one|two|may|can|use|uses|used|using|also|only|very|such|more|most|less|like|just|even|other|onto|upon|over|under|both|some|any|all|per|via)\b/i.test(
          t,
        ),
    );

  if (tokens.length === 0) return false;
  const hitRatio = tokens.filter((t) => ans.includes(t)).length / tokens.length;
  if (hitRatio >= 0.66) return true;

  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const ideaHit = group.some((g) => id.includes(normalizeAnswerText(g)));
    const ansHit = group.some((g) => ans.includes(normalizeAnswerText(g)));
    if (ideaHit && ansHit) return true;
  }

  if (ideasShareSynonymGroup(studentAnswer, idea)) return true;

  return false;
}

export type ContradictionFixResult = {
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
  score: number;
  contradictionCheckPassed: boolean;
};

/**
 * Remove missing ideas that are already present in the student answer; optionally
 * flip matching markBreakdown rows to awarded and re-sum score.
 */
export function fixMissingIdeasAgainstStudentAnswer(params: {
  studentAnswer: string;
  missingIdeas: string[];
  matchedIdeas: string[];
  markBreakdown?: MarkBreakdownItem[];
  score: number;
  maxScore: number;
}): ContradictionFixResult {
  const { studentAnswer, maxScore } = params;
  let missing = [...params.missingIdeas];
  let matched = [...params.matchedIdeas];
  const breakdown = params.markBreakdown?.map((r) => ({ ...r }));
  let score = params.score;
  const falselyMissing: string[] = [];

  for (const idea of params.missingIdeas) {
    if (studentAnswerCoversIdea(studentAnswer, idea) && studentAnswerSatisfiesRubricDetail(studentAnswer, idea)) {
      falselyMissing.push(idea);
    }
  }

  if (falselyMissing.length === 0) {
    return {
      missingIdeas: missing,
      matchedIdeas: matched,
      markBreakdown: breakdown,
      score,
      contradictionCheckPassed: true,
    };
  }

  missing = missing.filter((m) => !falselyMissing.includes(m));
  for (const idea of falselyMissing) {
    if (!matched.includes(idea)) matched.push(idea);
  }

  if (breakdown && breakdown.length > 0) {
    for (const row of breakdown) {
      if (
        !row.awarded &&
        studentAnswerCoversIdea(studentAnswer, row.idea) &&
        studentAnswerSatisfiesRubricDetail(studentAnswer, row.idea)
      ) {
        row.awarded = true;
        row.reason = `${row.reason || ""} (Reconciled: idea appears in student answer.)`.trim();
      }
    }
    const summed = breakdown.reduce((sum, item) => sum + (item.awarded ? item.marks : 0), 0);
    score = Math.max(0, Math.min(maxScore, Math.round(summed)));
  } else {
    score = Math.max(0, Math.min(maxScore, score + falselyMissing.length));
  }

  return {
    missingIdeas: missing,
    matchedIdeas: matched,
    markBreakdown: breakdown,
    score,
    /** True when output no longer lists ideas as missing that the answer already covers (including after repair). */
    contradictionCheckPassed: true,
  };
}