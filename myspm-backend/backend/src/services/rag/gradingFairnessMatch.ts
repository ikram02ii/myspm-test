/**
 * Fairness helpers: detect when a "missing" rubric idea is already expressed
 * in the student answer (paraphrase / synonym), for post-processing grader output.
 */

import type { MarkBreakdownItem, RubricIdea } from "./types";

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
  ["xylem", "xilem", "tissue xylem", "saluran xilem", "vessel xylem"],
  ["phloem", "floem", "tissue phloem", "saluran floem", "sieve tube", "tiub tapis"],
  ["transpiration", "transpirasi", "water loss", "kehilangan air"],
  ["osmosis", "osmosis", "pergerakan air", "water potential", "potensi air"],
  ["diffusion", "resapan", "penyebaran", "concentration gradient", "kecerunan kepekatan"],
  ["active transport", "pengangkutan aktif", "against concentration gradient", "menentang kecerunan"],
  ["photosynthesis", "fotosintesis", "glucose", "glukosa", "oxygen", "oksigen"],
  ["respiration", "respirasi", "anaerobic", "anaerobik", "aerobic", "aerobik"],
  ["enzyme", "enzim", "denatured", "denaturasi", "optimum temperature", "suhu optimum"],
  ["activation energy", "tenaga pengaktifan", "effective collision", "perlanggaran berkesan"],
  ["composite material", "bahan komposit", "reinforced concrete", "konkrit bertetulang"],
  ["acid", "asid", "base", "bes", "alkali", "alkali", "neutralisation", "penetrutralan"],
  ["oxidation", "pengoksidaan", "reduction", "penurunan", "redox", "tindak balas redoks"],
  ["mole", "mol", "concentration", "kepekatan", "molarity", "molariti", "mol dm"],
  ["add", "tambah", "subtract", "tolak", "multiply", "darab", "divide", "bahagi"],
  ["empire", "empayar", "colonial", "penjajahan", "independence", "kemerdekaan", "persekutuan"],
  ["cell", "sel", "tissue", "tisu", "organ", "organ", "system", "sistem", "organism", "organisma"],
  ["cell tissue organ", "cell → tissue → organ", "sel tisu organ"],
  ["sultan", "raja", "british", "inggeris", "japanese", "jepun", "malayan union", "kesatuan malaya"],
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

export function normalizeFormulaText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[→←=]/g, "");
}

export function studentAnswerContainsSpecies(studentAnswer: string, speciesKeyword: string): boolean {
  const key = (speciesKeyword || "").trim();
  if (key.length < 2) return true;
  const normKey = normalizeFormulaText(key);
  const normAns = normalizeFormulaText(studentAnswer);
  if (normAns.includes(normKey)) return true;
  return studentAnswerCoversIdea(studentAnswer, key);
}

export function allEquationSpeciesPresent(studentAnswer: string, keywords: string[] | undefined): boolean {
  const species = (keywords ?? []).map((k) => k.trim()).filter((k) => k.length >= 2);
  if (species.length === 0) return true;
  return species.every((s) => studentAnswerContainsSpecies(studentAnswer, s));
}

/** Post-split / backfill: add cluster phrases that match the row idea text. */
export function enrichRubricRowFromSynonymClusters(row: RubricIdea): RubricIdea {
  const ideaNorm = normalizeAnswerText(row.idea);
  const kw = new Set((row.keywords ?? []).map((k) => k.trim()).filter(Boolean));
  const acc = new Set((row.acceptedConcepts ?? []).map((k) => k.trim()).filter(Boolean));
  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const groupHit = group.some((g) => {
      const ng = normalizeAnswerText(g);
      return ideaNorm.includes(ng) || [...kw, ...acc].some((p) => normalizeAnswerText(p).includes(ng));
    });
    if (!groupHit) continue;
    for (const phrase of group.slice(0, 6)) {
      if (row.openEnded) kw.add(phrase);
      else acc.add(phrase);
    }
  }
  const next: RubricIdea = { ...row };
  if (kw.size > 0) next.keywords = [...new Set([...(row.keywords ?? []), ...kw])].slice(0, 12);
  if (acc.size > 0) next.acceptedConcepts = [...new Set([...(row.acceptedConcepts ?? []), ...acc])].slice(0, 8);
  return next;
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
  if (hitRatio >= 0.5) return true;

  for (const group of EQUIVALENT_PHRASE_GROUPS) {
    const ideaHit = group.some((g) => id.includes(normalizeAnswerText(g)));
    const ansHit = group.some((g) => ans.includes(normalizeAnswerText(g)));
    if (ideaHit && ansHit) return true;
  }

  if (ideasShareSynonymGroup(studentAnswer, idea)) return true;

  return false;
}

/** True when the answer (or a line) matches the rubric row via idea text, keywords, or accepted concepts. */
export function studentExpressesRubricMeaning(
  studentText: string,
  rubric: RubricIdea,
  fullAnswer?: string,
): boolean {
  const text = (studentText || "").trim();
  const answer = fullAnswer ?? studentText;
  if (!text) return false;
  if (studentAnswerCoversIdea(answer, rubric.idea) || studentAnswerCoversIdea(text, rubric.idea)) return true;
  if (ideasShareSynonymGroup(text, rubric.idea)) return true;
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    if (!phrase?.trim()) continue;
    if (studentAnswerCoversIdea(text, phrase) || studentAnswerCoversIdea(answer, phrase)) return true;
    if (ideasShareSynonymGroup(text, phrase)) return true;
  }
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
  rubricIdeas?: RubricIdea[];
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
    const rubricRow = params.rubricIdeas?.find((r) => r.idea === idea);
    const meaningPresent = rubricRow
      ? studentExpressesRubricMeaning(studentAnswer, rubricRow, studentAnswer)
      : studentAnswerCoversIdea(studentAnswer, idea) || ideasShareSynonymGroup(studentAnswer, idea);
    if (meaningPresent && studentAnswerSatisfiesRubricDetail(studentAnswer, idea)) {
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
      const rubricRow = params.rubricIdeas?.find((r) => r.id === row.rubricId || r.idea === row.idea);
      const meaningPresent = rubricRow
        ? studentExpressesRubricMeaning(studentAnswer, rubricRow, studentAnswer)
        : studentAnswerCoversIdea(studentAnswer, row.idea) || ideasShareSynonymGroup(studentAnswer, row.idea);
      if (!row.awarded && meaningPresent && studentAnswerSatisfiesRubricDetail(studentAnswer, row.idea)) {
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