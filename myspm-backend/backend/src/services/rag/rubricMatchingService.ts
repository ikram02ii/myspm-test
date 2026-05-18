import type {
  DemandType,
  MarkBreakdownItem,
  MatchMethod,
  QuestionAnalysis,
  RubricIdea,
  StudentIdea,
  VerifierMode,
} from "./types";
import { cosineSimilarity, embedTexts } from "./embeddingsService";
import {
  allEquationSpeciesPresent,
  ideasShareSynonymGroup,
  normalizeAnswerText,
  rubricIdeaRequiresRouteDetail,
  studentAnswerCoversIdea,
  studentAnswerSatisfiesRubricDetail,
  studentExpressesRubricMeaning,
} from "./gradingFairnessMatch";
import {
  isExampleAndUseComboQuestion,
  isOpenCategoryMarkingQuestion,
  isStrictContextBindingQuestion,
} from "./gradingCategoryMarking";
import { verifyBorderlineMeaningMatch } from "./qwenGradingClient";
import {
  extractStudentStageOrder,
  formatExpectedSequenceForPrompt,
  isSequenceMarkingQuestion,
  rubricRowExpectsFullOrderedSequence,
  sequenceQuestionRequiresOrder,
  sequenceStageAtCorrectPosition,
  sequenceStageMatchesStudent,
  studentFullSequenceOrderMatches,
} from "./sequenceMarkingService";

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
  if (studentExpressesRubricMeaning(studentIdea, rubric, studentAnswer)) return true;
  if (studentExpressesRubricMeaning(studentAnswer, rubric, studentAnswer)) return true;
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

function resolveMatchStrategy(
  rubric: RubricIdea,
  analysis?: QuestionAnalysis | null,
  question?: string,
): string {
  if (isSequenceMarkingQuestion(question ?? "", analysis)) return "sequenceCheck";
  const dt: DemandType | undefined = rubric.demandType ?? analysis?.demandType;
  if (rubric.openEnded === true && rubric.kind === "application") return "reasoningValidation";
  if (
    rubric.openEnded === true &&
    (rubric.kind === "example" || rubric.kind === "point" || /\bany valid\b/i.test(rubric.idea))
  ) {
    return "categoryMembership";
  }
  if (rubric.kind === "method") return "methodCheck";
  if (rubric.kind === "accuracy") return "accuracyCheck";
  if (rubric.kind === "equation" || dt === "equation") return "equationCompleteness";
  if (dt === "comparison" || rubric.kind === "comparison") return "pairedMatch";
  if (rubric.kind === "explanation" || dt === "explanation" || dt === "essay") return "conceptMatch";
  if (
    rubric.kind === "point" ||
    rubric.kind === "function" ||
    rubric.kind === "feature" ||
    rubric.kind === "knowledge" ||
    rubric.kind === "definition" ||
    rubric.kind === "step" ||
    rubric.kind === "use" ||
    rubric.kind === "calculation" ||
    dt === "recall" ||
    dt === "definition" ||
    dt === "application"
  ) {
    return "conceptMatch";
  }
  if (rubric.openEnded === true) return "categoryMembership";
  return "conceptMatch";
}

function resolveVerifierMode(strategy: string): VerifierMode {
  if (strategy === "categoryMembership") return "membership";
  if (strategy === "reasoningValidation") return "reasoning";
  if (strategy === "methodCheck") return "method";
  if (strategy === "pairedMatch") return "paired";
  if (strategy === "equationCompleteness") return "equation";
  if (strategy === "sequenceCheck") return "sequence";
  return "meaning";
}

function shortAnswerGuardBlocks(
  rubric: RubricIdea,
  studentLine: string,
  question?: string,
  analysis?: QuestionAnalysis | null,
): boolean {
  if (isSequenceMarkingQuestion(question ?? "", analysis)) return false;
  const tokens = normalizeAnswerText(studentLine).split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) return false;
  if (rubric.kind === "example" || rubric.kind === "equation") return false;
  const dt = rubric.demandType;
  if (dt === "recall" || dt === "example" || dt === "equation" || dt === "diagram_label") return false;
  if (rubric.kind === "point" || rubric.kind === "function" || rubric.kind === "feature") return false;
  return rubric.kind === "explanation" && dt === "definition";
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
    if (isSequenceMarkingQuestion(question, questionAnalysis)) {
      return {
        hit: false,
        evidence: si.idea,
        method: "acceptedConcept",
        reason: "Sequence questions require correct order; use ordered position check.",
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

  const mechanismEvidenceUsed = new Set<string>();

  const applyAwardGuards = (
    rubric: RubricIdea,
    awarded: boolean,
    evidence: string,
    reason: string,
  ): { awarded: boolean; reason: string } => {
    if (!awarded) return { awarded, reason };
    if (rubricIdeaRequiresRouteDetail(rubric.idea) && !studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)) {
      return {
        awarded: false,
        reason: "Answer states what is transported but not where from/to (or equivalent route).",
      };
    }
    const mechanismRow =
      rubric.kind === "explanation" ||
      rubric.demandType === "explanation" ||
      params.questionAnalysis?.questionType === "cause_effect";
    if (mechanismRow && evidence.trim()) {
      const normEvidence = normalizeAnswerText(evidence);
      const matchedIdea = params.studentIdeas.find((si) => normalizeAnswerText(si.idea) === normEvidence);
      if (matchedIdea) {
        if (mechanismEvidenceUsed.has(normEvidence)) {
          return {
            awarded: false,
            reason: "One student point cannot satisfy multiple separate mechanism marks.",
          };
        }
        mechanismEvidenceUsed.add(normEvidence);
      }
    }
    return { awarded, reason };
  };

  const pushRow = (
    rubric: RubricIdea,
    strategy: string,
    awarded: boolean,
    reason: string,
    evidence: string,
    matchMethod?: MatchMethod,
  ) => {
    const guarded = applyAwardGuards(rubric, awarded, evidence, reason);
    awarded = guarded.awarded;
    reason = guarded.reason;
    markBreakdown.push({
      rubricId: rubric.id,
      idea: rubric.idea,
      awarded,
      marks: rubric.marks,
      reason,
      matchMethod: awarded ? matchMethod : undefined,
      matchStrategy: strategy,
    });
    if (awarded) {
      matchedRubricPoints.push({
        rubricId: rubric.id,
        rubricIdea: rubric.idea,
        marksAwarded: rubric.marks,
        matchedStudentIdea: evidence || studentAnswer.slice(0, 120),
        matchMethod: matchMethod ?? "llmVerifier",
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
  };

  for (let i = 0; i < params.rubricIdeas.length; i += 1) {
    const rubric = params.rubricIdeas[i];
    const rv = rubricVec[i];
    const strategy = resolveMatchStrategy(rubric, params.questionAnalysis, question);
    const studentLine =
      params.studentIdeas
        .map((s) => s.idea)
        .filter(Boolean)
        .join(" | ") ||
      studentAnswer.trim() ||
      "(none)";

    if (rubric.kind === "accuracy" && rubric.dependsOnRowId) {
      const methodAwarded = markBreakdown.some((r) => r.rubricId === rubric.dependsOnRowId && r.awarded);
      if (!methodAwarded) {
        pushRow(
          rubric,
          strategy,
          false,
          "Accuracy mark requires the method step to be awarded first.",
          studentLine,
        );
        continue;
      }
    }

    if (shortAnswerGuardBlocks(rubric, studentLine, question, params.questionAnalysis)) {
      pushRow(
        rubric,
        strategy,
        false,
        "Answer too brief to evaluate this mark point.",
        studentLine,
      );
      continue;
    }

    if (strategy === "sequenceCheck") {
      const rubricIndex = i;
      const requiresOrder = sequenceQuestionRequiresOrder(question, params.questionAnalysis);
      let hit = false;
      let evidence = "";
      let matchMethod: MatchMethod = "acceptedConcept";
      let reason = "";
      const studentOrder = extractStudentStageOrder(studentAnswer);
      const expectedOrder = formatExpectedSequenceForPrompt(params.rubricIdeas);

      if (rubricRowExpectsFullOrderedSequence(rubric.idea)) {
        if (studentFullSequenceOrderMatches(params.rubricIdeas, studentAnswer)) {
          hit = true;
          reason = `Full sequence correct in order (${expectedOrder}).`;
          evidence = studentAnswer.slice(0, 200);
        } else {
          const verified = await verifyBorderlineMeaningMatch({
            mode: "sequence",
            question,
            rubricIdea: rubric.idea,
            rubricKind: rubric.kind,
            rubricKeywords: rubric.keywords,
            studentIdea: studentLine,
            similarity: 0,
            fullStudentAnswer: studentAnswer,
            priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
            strictContextBound: strictCtx,
            openCategoryMarking: false,
            exampleUseCombo,
            sequenceExpectedOrder: expectedOrder,
            sequenceStudentOrder: studentOrder.join(" → "),
            sequencePositionIndex: rubricIndex,
          });
          hit = verified.awarded;
          reason =
            verified.reason ||
            (hit ? "Correct sequence in order." : "Sequence wrong, incomplete, or out of order.");
          evidence = studentAnswer.slice(0, 200);
          matchMethod = "llmVerifier";
        }
      } else if (requiresOrder) {
        const ordered = sequenceStageAtCorrectPosition(
          rubric,
          rubricIndex,
          params.rubricIdeas,
          studentAnswer,
          params.studentIdeas,
        );
        hit = ordered.hit;
        evidence = ordered.evidence;
        reason = ordered.reason;
        if (!hit && !reason.includes("wrong position")) {
          const verified = await verifyBorderlineMeaningMatch({
            mode: "sequence",
            question,
            rubricIdea: rubric.idea,
            rubricKind: rubric.kind,
            rubricKeywords: rubric.keywords,
            studentIdea: evidence || studentLine,
            similarity: 0,
            fullStudentAnswer: studentAnswer,
            priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
            strictContextBound: strictCtx,
            openCategoryMarking: false,
            exampleUseCombo,
            sequenceExpectedOrder: expectedOrder,
            sequenceStudentOrder: studentOrder.join(" → ") || "(none detected)",
            sequencePositionIndex: rubricIndex,
          });
          hit = verified.awarded;
          reason = verified.reason || reason;
          matchMethod = "llmVerifier";
        }
      } else {
        hit = sequenceStageMatchesStudent(rubric, studentAnswer, params.studentIdeas);
        evidence = params.studentIdeas[0]?.idea ?? studentAnswer.slice(0, 200);
        reason = hit ? "Stage present in answer." : "Stage not found.";
      }

      pushRow(rubric, strategy, hit, reason, evidence, hit ? matchMethod : undefined);
      continue;
    }

    if (strategy === "categoryMembership") {
      const namedIdea = params.studentIdeas.find(
        (si) =>
          sequenceStageMatchesStudent(rubric, studentAnswer, [si]) ||
          studentIdeaMatchesRubricPoint(si.idea, rubric, studentAnswer) ||
          ideasShareSynonymGroup(si.idea, rubric.idea),
      );
      if (namedIdea) {
        pushRow(
          rubric,
          strategy,
          true,
          "Student gave a valid description for this category at SPM level.",
          namedIdea.idea,
          "acceptedConcept",
        );
        continue;
      }
      const lineForVerify =
        params.studentIdeas.find((si) => studentAnswerCoversIdea(si.idea, rubric.idea))?.idea ?? studentLine;
      const verified = await verifyBorderlineMeaningMatch({
        mode: "membership",
        question,
        rubricIdea: rubric.idea,
        rubricKind: rubric.kind,
        rubricKeywords: rubric.keywords,
        studentIdea: lineForVerify,
        similarity: 0,
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
        strictContextBound: strictCtx,
        openCategoryMarking: openCat || true,
        exampleUseCombo,
      });
      const evidence = params.studentIdeas[0]?.idea ?? studentAnswer.slice(0, 200);
      pushRow(
        rubric,
        strategy,
        verified.awarded,
        verified.reason ||
          (verified.awarded ? "Valid member of the category at SPM level." : "Not a valid member of the category."),
        evidence,
        "llmVerifier",
      );
      continue;
    }

    if (strategy === "reasoningValidation") {
      let bestScore = -1;
      for (let j = 0; j < studentVec.length; j += 1) {
        const sim = cosineSimilarity(rv, studentVec[j]);
        if (sim > bestScore) bestScore = sim;
      }
      const verified = await verifyBorderlineMeaningMatch({
        mode: "reasoning",
        question,
        rubricIdea: rubric.idea,
        rubricKind: rubric.kind,
        rubricKeywords: rubric.keywords,
        studentIdea: studentLine,
        similarity: Math.max(0, bestScore),
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
        strictContextBound: strictCtx,
        openCategoryMarking: openCat || true,
        exampleUseCombo,
      });
      pushRow(
        rubric,
        strategy,
        verified.awarded,
        verified.reason || (verified.awarded ? "Valid scientific reasoning." : "Reasoning not scientifically valid."),
        params.studentIdeas[0]?.idea ?? studentAnswer.slice(0, 200),
        "llmVerifier",
      );
      continue;
    }

    if (strategy === "equationCompleteness") {
      if (!allEquationSpeciesPresent(studentAnswer, rubric.keywords)) {
        pushRow(
          rubric,
          strategy,
          false,
          "Equation is incomplete — not all required species are present.",
          studentAnswer.slice(0, 200),
        );
        continue;
      }
      const verified = await verifyBorderlineMeaningMatch({
        mode: "equation",
        question,
        rubricIdea: rubric.idea,
        rubricKind: rubric.kind,
        rubricKeywords: rubric.keywords,
        studentIdea: studentLine,
        similarity: 0,
        fullStudentAnswer: studentAnswer,
        priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
        strictContextBound: strictCtx,
        openCategoryMarking: false,
        exampleUseCombo,
      });
      pushRow(
        rubric,
        strategy,
        verified.awarded,
        verified.reason ||
          (verified.awarded ? "Equation complete and balanced." : "Equation incomplete or not balanced."),
        studentAnswer.slice(0, 200),
        "llmVerifier",
      );
      continue;
    }

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
      const embedAutoAward = 0.68;
      const embedAutoReject = 0.32;
      const useSemanticVerifier =
        strategy !== "equationCompleteness" &&
        strategy !== "accuracyCheck" &&
        (ideaClearlyPresent || bestScore > embedAutoReject);

      if (bestScore >= embedAutoAward && causalOk && conceptAllowed && routeDetailOk) {
        awarded = true;
        matchMethod = rubric.openEnded ? "openEndedCategory" : "embedding";
        reason = `Scientific meaning aligns (similarity ${bestScore.toFixed(2)}): ${evidence}`;
      } else if (
        !useSemanticVerifier &&
        (bestScore <= embedAutoReject || !causalOk || !conceptAllowed || !routeDetailOk)
      ) {
        awarded = false;
        matchMethod = "embedding";
        reason = !routeDetailOk
          ? "Answer states what is transported but not where from/to (or equivalent route)."
          : !conceptAllowed
            ? "Student idea is too generic for this specific causal concept."
            : !causalOk
              ? "Rubric point needs a causal explanation; not clearly shown in the student wording."
              : `Scientific meaning not shown (similarity ${bestScore.toFixed(2)}).`;
      } else if (useSemanticVerifier) {
        const verified = await verifyBorderlineMeaningMatch({
          mode: resolveVerifierMode(strategy),
          question,
          rubricIdea: rubric.idea,
          rubricKind: rubric.kind,
          rubricKeywords: rubric.keywords,
          studentIdea: evidence || studentAnswer.slice(0, 400),
          similarity: Math.max(0, bestScore),
          fullStudentAnswer: studentAnswer,
          priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
          strictContextBound: strictCtx,
          openCategoryMarking: openCat || rubric.openEnded === true || strategy === "conceptMatch",
          exampleUseCombo,
        });
        awarded = verified.awarded && causalOk && conceptAllowed && routeDetailOk;
        matchMethod = "llmVerifier";
        reason =
          verified.reason ||
          `Semantic check (similarity ${bestScore.toFixed(2)}): ${awarded ? "same scientific meaning" : "meaning not shown"}.`;
        if (!causalOk) {
          awarded = false;
          reason = "Rubric point needs a causal link; student answer did not show one clearly.";
        }
      }
    } else if (!awarded && bestIdx < 0) {
      reason =
        params.studentIdeas.length === 0
          ? "No student idea lines extracted — semantic check on full answer next."
          : "No embedding match to extracted ideas.";
    }

    if (
      !awarded &&
      strategy !== "equationCompleteness" &&
      strategy !== "accuracyCheck" &&
      studentAnswer.trim().length > 0
    ) {
      const rescueLine =
        evidence ||
        params.studentIdeas.map((s) => s.idea).find((line) => studentExpressesRubricMeaning(line, rubric, studentAnswer)) ||
        studentAnswer.slice(0, 400);
      const routeDetailOk = studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea);
      const causalOk =
        !rubric.requiresCausalLink ||
        fullAnswerHasCausalLink(studentAnswer) ||
        studentExpressesRubricMeaning(rescueLine, rubric, studentAnswer);
      if (routeDetailOk && causalOk && conceptGuardAllows(rubric.idea, rescueLine, question, params.questionAnalysis)) {
        const rescued = await verifyBorderlineMeaningMatch({
          mode: resolveVerifierMode(strategy),
          question,
          rubricIdea: rubric.idea,
          rubricKind: rubric.kind,
          rubricKeywords: rubric.keywords,
          studentIdea: rescueLine,
          similarity: 0,
          fullStudentAnswer: studentAnswer,
          priorAwardedRubricIdeas: markBreakdown.filter((r) => r.awarded).map((r) => r.idea),
          strictContextBound: strictCtx,
          openCategoryMarking: !strictCtx,
          exampleUseCombo,
        });
        if (rescued.awarded) {
          awarded = true;
          evidence = rescueLine;
          matchMethod = "llmVerifier";
          reason = rescued.reason || "Scientific meaning matches this mark point (semantic rescue).";
        }
      }
    }

    pushRow(rubric, strategy, awarded, reason, evidence, awarded ? matchMethod : undefined);
  }

  let totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);

  // Oxygen-debt style stems: keep at most one mechanism mark when the answer only states generic oxygen need.
  if (
    isCauseEffectQuestion(question, params.questionAnalysis) &&
    /\b(sprinter|race|running|run|breathes rapidly|breathing rapidly|selepas berlari)\b/i.test(question)
  ) {
    const answerHasLactic = /\blactic acid|asid laktik|oxygen debt|hutang oksigen\b/i.test(studentAnswer);
    const missingHasLactic = markBreakdown.some((r) => !r.awarded && /\blactic acid|asid laktik\b/i.test(r.idea));
    if (!answerHasLactic && !missingHasLactic) {
      markBreakdown.push({
        rubricId: "synthetic-lactic-acid",
        idea: "Lactic acid builds up and oxygen debt must be repaid after anaerobic respiration.",
        awarded: false,
        marks: 0,
        reason: "Specific causal concept missing from answer.",
        matchStrategy: "postProcess",
      });
      missingRubricPoints.push({
        rubricId: "synthetic-lactic-acid",
        rubricIdea: "Lactic acid builds up after anaerobic respiration and needs to be removed.",
        marks: 0,
        reason: "Specific causal concept missing from answer.",
      });
    }
    if (!answerHasLactic && totalScore > 1) {
      let kept = 0;
      for (const row of markBreakdown) {
        if (!row.awarded || row.marks <= 0) continue;
        if (kept >= 1) {
          row.awarded = false;
          row.reason = "Partial answer — only one mechanism point credited for this brief response.";
          const idx = matchedRubricPoints.findIndex((m) => m.rubricId === row.rubricId);
          if (idx >= 0) matchedRubricPoints.splice(idx, 1);
          missingRubricPoints.push({
            rubricId: row.rubricId ?? "unknown",
            rubricIdea: row.idea,
            marks: row.marks,
            reason: row.reason,
          });
        } else {
          kept += 1;
        }
      }
      totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
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
