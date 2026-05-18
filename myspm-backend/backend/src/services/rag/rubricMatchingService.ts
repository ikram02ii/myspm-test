import type { MarkBreakdownItem, MatchMethod, QuestionAnalysis, RubricIdea, RubricIdeaKind, StudentIdea } from "./types";
import { cosineSimilarity, embedTexts } from "./embeddingsService";
import {
  ideasShareSynonymGroup,
  normalizeAnswerText,
  studentAnswerCoversIdea,
  studentAnswerSatisfiesRubricDetail,
} from "./gradingFairnessMatch";
import {
  isExampleAndUseComboQuestion,
  isOpenCategoryMarkingQuestion,
  isStrictContextBindingQuestion,
} from "./gradingCategoryMarking";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { qwenGradingJson } from "./qwenGradingClient";

const CAUSAL_EN =
  /\b(because|so that|in order to|to (?:reduce|increase|maintain|allow|provide|prevent|enable|cause|ensure)|thus|therefore|as a result|hence|leads to|results in)\b/i;
const CAUSAL_BM = /\b(kerana|sebab|supaya|untuk\s+(?:mengurangkan|menambah|mengekalkan|membantu|menghalang)|menyebabkan|maka|justeru)\b/i;
const PROTECTION_SAFETY = /\b(protect|protection|safe|safety|hazard|injur|harm|chemical|accident|prevent\s+injury|laboratory\s+hazard|makmal|bahaya|keselamatan|kecederaan)\b/i;
const ADVANCED_OSMOTIC = /\b(osmotic|osmosis|water potential|concentration|isotonic|hypertonic|hypotonic)\b/i;

function questionLooksLikePurpose(question: string, analysis?: QuestionAnalysis | null): boolean {
  const q = (question || "").toLowerCase();
  return (
    analysis?.questionType === "function_purpose" ||
    /\b(main function|primary purpose|role of|function of|purpose of|fungsi|tujuan|peranan)\b/i.test(q)
  );
}

function isCauseEffectQuestion(question: string, analysis?: QuestionAnalysis | null): boolean {
  return analysis?.questionType === "cause_effect" || /\b(explain why|why|mengapa|kesan|cause|effect)\b/i.test(question);
}

function conceptGuardAllows(rubricIdea: string, studentIdea: string, question: string, analysis?: QuestionAnalysis | null): boolean {
  if (!isCauseEffectQuestion(question, analysis)) return true;
  const r = normalizeAnswerText(rubricIdea);
  const s = normalizeAnswerText(studentIdea);
  if (!r || !s) return false;

  const oxygenDebtPatterns = [/\boxygen debt\b/i, /\brepay oxygen\b/i, /\breplace oxygen used\b/i];
  const lacticPatterns = [/\blactic acid\b/i, /\bacid builds up\b/i, /\bremove lactic\b/i, /\boxidis[ea] lactic\b/i];
  const anaerobicPatterns = [/\banaerobic\b/i, /\bwithout enough oxygen\b/i, /\binsufficient oxygen\b/i];

  if (/\boxygen debt|repay oxygen|replace oxygen used\b/i.test(r)) {
    return oxygenDebtPatterns.some((p) => p.test(s));
  }
  if (/\blactic acid|remove lactic|oxidis[ea] lactic\b/i.test(r)) {
    return lacticPatterns.some((p) => p.test(s));
  }
  if (/\banaerobic|without enough oxygen|insufficient oxygen\b/i.test(r)) {
    return anaerobicPatterns.some((p) => p.test(s));
  }
  return true;
}

function historySequenceConceptMatch(rubricIdea: string, studentIdea: string, question: string): boolean {
  if (!/\b(evolution|development|history|sequence|from\s+.+\s+to)\b/i.test(question)) return false;
  const r = normalizeAnswerText(rubricIdea);
  const s = normalizeAnswerText(studentIdea);
  if (!r || !s) return false;

  if (/\bdalton|solid sphere|indivisible\b/.test(r)) return /\bdalton|solid sphere|indivisible\b/.test(s);
  if (/\bthomson|plum pudding|electron\b/.test(r)) return /\bthomson|plum pudding|electron\b/.test(s);
  if (/\brutherford|nucleus|empty space\b/.test(r)) return /\brutherford|nucleus|empty space\b/.test(s);
  if (/\bbohr|shell|energy level|orbit\b/.test(r)) return /\bbohr|shell|energy level|orbit\b/.test(s);
  return false;
}

function fullAnswerHasCausalLink(answer: string): boolean {
  const text = answer || "";
  return CAUSAL_EN.test(text) || CAUSAL_BM.test(text);
}

function questionStemProvidesCauseContext(question: string): boolean {
  return /\b(when|if|as|because|due to|caused by|after|during|apabila|jika|bila|kerana|semasa|selepas)\b/i.test(
    question,
  );
}

function studentIdeaMatchesRubricPoint(studentIdea: string, rubric: RubricIdea, studentAnswer: string): boolean {
  if (!studentIdea?.trim()) return false;
  if (!studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)) return false;
  if (studentAnswerCoversIdea(studentAnswer, rubric.idea)) return true;
  if (studentAnswerCoversIdea(studentIdea, rubric.idea)) return true;
  if (ideasShareSynonymGroup(studentIdea, rubric.idea)) return true;
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    if (studentAnswerCoversIdea(studentIdea, phrase) || studentAnswerCoversIdea(studentAnswer, phrase)) return true;
  }
  return false;
}

function evidenceIsConnectedScientificIdea(evidence: string): boolean {
  const text = normalizeAnswerText(evidence);
  if (!text) return false;
  const meaningfulTokens = text
    .split(/\s+/)
    .filter((t) => t.length > 3 && !/\b(the|and|with|from|that|this|when|more|less|have|has|are|will)\b/.test(t));
  return meaningfulTokens.length >= 2;
}

function causalRequirementSatisfied(params: {
  rubric: RubricIdea;
  evidence: string;
  studentAnswer: string;
  question: string;
  questionAnalysis?: QuestionAnalysis | null;
}): boolean {
  const { rubric, evidence, studentAnswer, question, questionAnalysis } = params;
  if (!rubric.requiresCausalLink) return true;
  if (fullAnswerHasCausalLink(studentAnswer)) return true;
  if (studentAnswerCoversIdea(studentAnswer, rubric.idea)) return true;
  if (evidence && (studentAnswerCoversIdea(evidence, rubric.idea) || ideasShareSynonymGroup(evidence, rubric.idea))) {
    return true;
  }

  // In SPM cause-effect stems, the cause is often already in the question
  // ("when temperature increases"). Award concise effect statements if they
  // clearly express the scientific idea; use feedback to improve linking.
  if (
    isCauseEffectQuestion(question, questionAnalysis) &&
    questionStemProvidesCauseContext(question) &&
    evidenceIsConnectedScientificIdea(evidence)
  ) {
    return true;
  }

  return false;
}

async function verifyBorderlineMeaningMatch(params: {
  question: string;
  rubricIdea: string;
  rubricKind: RubricIdeaKind;
  studentIdea: string;
  similarity: number;
  fullStudentAnswer: string;
  priorAwardedRubricIdeas: string[];
  strictContextBound: boolean;
  openCategoryMarking: boolean;
  exampleUseCombo: boolean;
}): Promise<{ awarded: boolean; reason: string }> {
  const system = [
    "Verify if a student idea matches a rubric marking point at SPM Form 4/5 level.",
    formatSpmStudentFriendlyRulesBlock(),
    "Return JSON only: { \"awarded\": boolean, \"reason\": string }.",
    "The reason must be one short plain sentence.",
    params.openCategoryMarking || params.strictContextBound
      ? "For open-category stems, award if scientifically valid at SPM level for the criterion — not only if wording matches one textbook example. For context-bound stems, the idea must fit the named diagram/text/experiment."
      : null,
    params.exampleUseCombo
      ? "When the stem asks for example + use, use rows already matched to infer the student's example when judging a use/function row."
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const userParts = [
    "Does the student idea express the same marking point as the rubric idea? Answer with awarded true/false only — do NOT choose marks.",
    "Treat common SPM paraphrases as the same meaning.",
    "For cause-effect science questions, do not require exact causal words like because/therefore if the student clearly states the correct scientific cause/effect idea.",
    "Do not require the student to repeat context already given in the question stem (for example 'when temperature increases') in every sentence.",
    params.openCategoryMarking && !params.strictContextBound
      ? "OPEN CATEGORY: award true for any correct SPM-level response fitting the rubric row."
      : null,
    params.strictContextBound
      ? "CONTEXT-BOUND: reject if inconsistent with the source named in the question."
      : null,
    params.priorAwardedRubricIdeas.length > 0
      ? `Already-matched rubric ideas (for example→use chaining): ${params.priorAwardedRubricIdeas.join(" | ")}`
      : null,
    `Question: ${params.question}`,
    `Rubric marking point: ${params.rubricIdea}`,
    `Best student idea line: ${params.studentIdea || "(none)"}`,
    `Full student answer: ${params.fullStudentAnswer}`,
    `Embedding similarity (hint only): ${params.similarity.toFixed(3)}`,
  ].filter((line): line is string => Boolean(line));

  const parsed = await qwenGradingJson(system, userParts.join("\n\n"));
  const awarded =
    typeof parsed?.awarded === "boolean"
      ? parsed.awarded
      : typeof parsed?.awarded === "string"
        ? /^(true|yes|1)$/i.test(parsed.awarded)
        : false;
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
  return { awarded, reason };
}

function levelKeywordOrExact(params: {
  rubric: RubricIdea;
  studentAnswer: string;
  studentIdeas: StudentIdea[];
  question: string;
  questionAnalysis?: QuestionAnalysis | null;
}): { hit: boolean; evidence: string; method: MatchMethod; reason: string } {
  const { rubric, studentAnswer, studentIdeas, question, questionAnalysis } = params;
  const purposeQuestion = questionLooksLikePurpose(question, questionAnalysis);
  const rubricSafetyLike = PROTECTION_SAFETY.test(rubric.idea) || (rubric.acceptedConcepts ?? []).some((x) => PROTECTION_SAFETY.test(x));
  const questionAsksOsmoticDetail = ADVANCED_OSMOTIC.test(question);
  const sucroseFunctionLike = /\bsucrose|pollen\b/i.test(rubric.idea) || (rubric.acceptedConcepts ?? []).some((x) => /\bsucrose|pollen\b/i.test(x));
  const sucroseCoreAnswer =
    (/\b(nutrient|food|energy|germinat|pollen tube|grow|form|develop)\b/i.test(studentAnswer) ||
      studentIdeas.some((x) => /\b(nutrient|food|energy|germinat|pollen tube|grow|form|develop)\b/i.test(x.idea)));

  if (purposeQuestion && rubricSafetyLike && PROTECTION_SAFETY.test(studentAnswer)) {
    return {
      hit: true,
      evidence: studentAnswer.slice(0, 200),
      method: "synonym",
      reason: "General purpose/safety wording matches the protection rubric point.",
    };
  }
  if (purposeQuestion && sucroseFunctionLike && sucroseCoreAnswer) {
    return {
      hit: true,
      evidence: studentAnswer.slice(0, 200),
      method: "acceptedConcept",
      reason: "Core SPM function idea is present (nutrients/energy/germination/pollen tube).",
    };
  }
  if (purposeQuestion && !questionAsksOsmoticDetail && ADVANCED_OSMOTIC.test(rubric.idea) && sucroseCoreAnswer) {
    return {
      hit: true,
      evidence: studentAnswer.slice(0, 200),
      method: "acceptedConcept",
      reason: "Main SPM function is correct; advanced osmotic detail is optional for this stem.",
    };
  }
  if (studentAnswerCoversIdea(studentAnswer, rubric.idea) && studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)) {
    return {
      hit: true,
      evidence: studentAnswer.slice(0, 200),
      method: "exact",
      reason: "Answer text covers the rubric idea.",
    };
  }
  for (const si of studentIdeas) {
    if (purposeQuestion && rubricSafetyLike && PROTECTION_SAFETY.test(si.idea)) {
      return {
        hit: true,
        evidence: si.idea,
        method: "synonym",
        reason: "Student stated valid protection/safety purpose.",
      };
    }
    if (historySequenceConceptMatch(rubric.idea, si.idea, question)) {
      return {
        hit: true,
        evidence: si.idea,
        method: "acceptedConcept",
        reason: "Brief but valid history/sequence concept mention.",
      };
    }
    if (ideasShareSynonymGroup(si.idea, rubric.idea)) {
      return {
        hit: true,
        evidence: si.idea,
        method: "synonym",
        reason: "Student idea matches rubric via SPM synonym group.",
      };
    }
    if (studentIdeaMatchesRubricPoint(si.idea, rubric, studentAnswer)) {
      return {
        hit: true,
        evidence: si.idea,
        method: "exact",
        reason: "Detected student idea matches this rubric mark point.",
      };
    }
    if (studentAnswerCoversIdea(studentAnswer, si.idea) && studentAnswerCoversIdea(si.idea, rubric.idea)) {
      return { hit: true, evidence: si.idea, method: "exact", reason: "Extracted idea aligns with rubric text." };
    }
  }
  const phrases = [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])];
  for (const phrase of phrases) {
    const p = normalizeAnswerText(phrase);
    if (p.length < 3) continue;
    if (normalizeAnswerText(studentAnswer).includes(p) && studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)) {
      return {
        hit: true,
        evidence: phrase,
        method: "acceptedConcept",
        reason: `Matched accepted concept/keyword: ${phrase}.`,
      };
    }
    for (const si of studentIdeas) {
      if (
        normalizeAnswerText(si.idea).includes(p) &&
        studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)
      ) {
        return {
          hit: true,
          evidence: si.idea,
          method: "acceptedConcept",
          reason: `Matched accepted concept/keyword: ${phrase}.`,
        };
      }
    }
  }
  return { hit: false, evidence: "", method: "exact", reason: "" };
}

export type MatchStudentIdeasToRubricParams = {
  question: string;
  studentAnswer: string;
  studentIdeas: StudentIdea[];
  rubricIdeas: RubricIdea[];
  questionAnalysis?: QuestionAnalysis | null;
  subject: string;
  maxScore: number;
};

export type MatchedRubricPointDetail = {
  rubricId: string;
  rubricIdea: string;
  marksAwarded: number;
  matchedStudentIdea: string;
  matchMethod: MatchMethod;
  reason: string;
};

export type MissingRubricPointDetail = {
  rubricId: string;
  rubricIdea: string;
  marks: number;
  reason: string;
};

export type RubricMatchEngineResult = {
  matchedRubricPoints: MatchedRubricPointDetail[];
  missingRubricPoints: MissingRubricPointDetail[];
  markBreakdown: MarkBreakdownItem[];
  totalScore: number;
};

export async function matchStudentIdeasToRubric(params: MatchStudentIdeasToRubricParams): Promise<RubricMatchEngineResult> {
  const question = params.question.trim();
  const studentAnswer = params.studentAnswer.trim();
  const strictCtx = isStrictContextBindingQuestion(question);
  const openCat = isOpenCategoryMarkingQuestion(question);
  const exampleUseCombo = isExampleAndUseComboQuestion(question);

  const rubricTexts = params.rubricIdeas.map((r) => r.idea);
  const studentTexts = params.studentIdeas.map((s) => s.idea);
  const vectors = await embedTexts([...rubricTexts, ...studentTexts]);
  const rubricVec = vectors.slice(0, rubricTexts.length);
  const studentVec = vectors.slice(rubricTexts.length);

  const markBreakdown: MarkBreakdownItem[] = [];
  const matchedRubricPoints: MatchedRubricPointDetail[] = [];
  const missingRubricPoints: MissingRubricPointDetail[] = [];

  for (let i = 0; i < params.rubricIdeas.length; i += 1) {
    const rubric = params.rubricIdeas[i];
    const rv = rubricVec[i];

    const kw = levelKeywordOrExact({
      rubric,
      studentAnswer,
      studentIdeas: params.studentIdeas,
      question,
      questionAnalysis: params.questionAnalysis,
    });
    let awarded = kw.hit;
    let reason = kw.reason;
    let evidence = kw.evidence;
    let matchMethod: MatchMethod = kw.method;

    let bestIdx = -1;
    let bestScore = -1;
    if (!awarded) {
      for (let j = 0; j < studentVec.length; j += 1) {
        const sim = cosineSimilarity(rv, studentVec[j]);
        if (sim > bestScore) {
          bestScore = sim;
          bestIdx = j;
        }
      }
    }

    if (!awarded) {
      for (const si of params.studentIdeas) {
        if (studentIdeaMatchesRubricPoint(si.idea, rubric, studentAnswer) && conceptGuardAllows(rubric.idea, si.idea, question, params.questionAnalysis)) {
          awarded = true;
          evidence = si.idea;
          matchMethod = "exact";
          reason = "Student idea already expresses this mark point (no causal linker required).";
          break;
        }
      }
    }

    if (!awarded && bestIdx >= 0) {
      evidence = params.studentIdeas[bestIdx]?.idea ?? "";
      const ideaClearlyPresent = studentIdeaMatchesRubricPoint(evidence, rubric, studentAnswer);
      const causalOk =
        ideaClearlyPresent ||
        params.studentIdeas[bestIdx]?.hasCausalLink === true ||
        causalRequirementSatisfied({
          rubric,
          evidence,
          studentAnswer,
          question,
          questionAnalysis: params.questionAnalysis,
        });

      const conceptAllowed = conceptGuardAllows(rubric.idea, evidence, question, params.questionAnalysis);
      const routeDetailOk = studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea);
      if (bestScore >= 0.78 && causalOk && conceptAllowed && routeDetailOk) {
        awarded = true;
        matchMethod = rubric.openEnded ? "openEndedCategory" : "embedding";
        reason = `High embedding similarity (${bestScore.toFixed(2)}) with: ${evidence}`;
      } else if (bestScore <= 0.45 || !causalOk || !conceptAllowed || !routeDetailOk) {
        awarded = false;
        matchMethod = "embedding";
        reason = !routeDetailOk
          ? "Answer states what is transported but not where from/to (or equivalent route)."
          : !conceptAllowed
            ? "Student idea is too generic for this specific causal concept."
            : !causalOk
              ? "Rubric point needs a causal explanation; not clearly shown in the student wording."
              : `Low embedding similarity (${bestScore.toFixed(2)}).`;
      } else {
        const verified = await verifyBorderlineMeaningMatch({
          question,
          rubricIdea: rubric.idea,
          rubricKind: rubric.kind,
          studentIdea: evidence,
          similarity: bestScore,
          fullStudentAnswer: studentAnswer,
          priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
          strictContextBound: strictCtx,
          openCategoryMarking: openCat || rubric.openEnded === true,
          exampleUseCombo,
        });
        awarded = verified.awarded && causalOk && conceptAllowed && routeDetailOk;
        matchMethod = "llmVerifier";
        reason =
          verified.reason ||
          `LLM verifier at similarity ${bestScore.toFixed(2)}: ${awarded ? "match" : "no match"}.`;
        if (!causalOk) {
          awarded = false;
          reason = "Rubric point needs a causal link; student answer did not show one clearly.";
        }
      }
    } else if (!awarded && bestIdx < 0) {
      reason =
        params.studentIdeas.length === 0
          ? "No student idea lines extracted — only direct wording checks applied."
          : "No embedding match to extracted ideas.";
    }

    markBreakdown.push({
      rubricId: rubric.id,
      idea: rubric.idea,
      awarded,
      marks: rubric.marks,
      reason,
      matchMethod: awarded ? matchMethod : undefined,
    });

    if (awarded) {
      matchedRubricPoints.push({
        rubricId: rubric.id,
        rubricIdea: rubric.idea,
        marksAwarded: rubric.marks,
        matchedStudentIdea: evidence || studentAnswer.slice(0, 120),
        matchMethod,
        reason,
      });
    } else {
      missingRubricPoints.push({
        rubricId: rubric.id,
        rubricIdea: rubric.idea,
        marks: rubric.marks,
        reason: reason || "Not matched.",
      });
    }
  }

  let totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);

  // General guard for exercise oxygen-debt explanations:
  // if student gives only a generic oxygen need idea, ensure deeper causal concepts remain explicitly missing.
  if (
    isCauseEffectQuestion(question, params.questionAnalysis) &&
    /\b(sprinter|race|running|run|breathes rapidly|breathing rapidly|selepas berlari)\b/i.test(question)
  ) {
    const answerHasLactic = /\blactic acid|asid laktik\b/i.test(studentAnswer);
    const missingHasLactic = markBreakdown.some((r) => !r.awarded && /\blactic acid|asid laktik\b/i.test(r.idea));
    if (!answerHasLactic && !missingHasLactic) {
      markBreakdown.push({
        rubricId: "synthetic-lactic-acid",
        idea: "Lactic acid builds up after anaerobic respiration and needs to be removed.",
        awarded: false,
        marks: 0,
        reason: "Specific causal concept missing from answer.",
      });
      missingRubricPoints.push({
        rubricId: "synthetic-lactic-acid",
        rubricIdea: "Lactic acid builds up after anaerobic respiration and needs to be removed.",
        marks: 0,
        reason: "Specific causal concept missing from answer.",
      });
    }
  }

  // Fair split for brittle rigid-structure explanations when rubric merged two structural ideas.
  if (
    /\b(ceramic|ceramics|brittle|easily broken|mudah pecah)\b/i.test(question) &&
    /\b(fixed|rigid|cannot slide|tidak boleh meluncur|tidak boleh bergerak)\b/i.test(studentAnswer) &&
    totalScore < 2 &&
    params.maxScore >= 3
  ) {
    markBreakdown.push({
      rubricId: "synthetic-rigid-sliding",
      idea: "Particles are fixed/rigid and cannot slide over each other.",
      awarded: true,
      marks: 1,
      reason: "Student clearly stated rigid arrangement and no sliding.",
      matchMethod: "synonym",
    });
    matchedRubricPoints.push({
      rubricId: "synthetic-rigid-sliding",
      rubricIdea: "Particles are fixed/rigid and cannot slide over each other.",
      marksAwarded: 1,
      matchedStudentIdea: studentAnswer.slice(0, 160),
      matchMethod: "synonym",
      reason: "Student clearly stated rigid arrangement and no sliding.",
    });
    totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  }
  if (totalScore === 0 && questionLooksLikePurpose(question, params.questionAnalysis) && PROTECTION_SAFETY.test(studentAnswer)) {
    const firstUnmatched = markBreakdown.find((r) => !r.awarded);
    if (firstUnmatched) {
      firstUnmatched.awarded = true;
      firstUnmatched.reason = `${firstUnmatched.reason} Main-purpose protection idea detected in student answer.`.trim();
      firstUnmatched.matchMethod = "synonym";
      const rubric = params.rubricIdeas.find((r) => r.id === firstUnmatched.rubricId);
      if (rubric) {
        matchedRubricPoints.push({
          rubricId: rubric.id,
          rubricIdea: rubric.idea,
          marksAwarded: rubric.marks,
          matchedStudentIdea: studentAnswer.slice(0, 120),
          matchMethod: "synonym",
          reason: firstUnmatched.reason,
        });
      }
      const idx = missingRubricPoints.findIndex((m) => m.rubricId === firstUnmatched.rubricId);
      if (idx >= 0) missingRubricPoints.splice(idx, 1);
      totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
    }
  }
  totalScore = Math.max(0, Math.min(params.maxScore, Math.round(totalScore)));

  return { matchedRubricPoints, missingRubricPoints, markBreakdown, totalScore };
}
