import type {
  DemandType,
  DiagramContext,
  MarkBreakdownItem,
  MatchMethod,
  QuestionAnalysis,
  RubricIdea,
  StudentIdea,
  VerifierMode,
} from "../types";
import { cosineSimilarity, embedTexts } from "../retrieval/embeddingsService";
import {
  allEquationSpeciesPresent,
  ideasShareSynonymGroup,
  normalizeAnswerText,
  normalizedTextIncludesPhrase,
  rubricIdeaRequiresRouteDetail,
  studentAnswerCoversIdea,
  studentAnswerSatisfiesRubricDetail,
  studentExpressesRubricMeaning,
} from "../grading/gradingFairness";
import {
  isExampleAndUseComboQuestion,
  isOpenCategoryMarkingQuestion,
  isOpenPoolGradingMode,
  isStrictContextBindingQuestion,
} from "../grading/gradingPolicy";
import {
  isDiagramDeixisAnswer,
  isGenericVagueStatement,
  rubricSubstancePresentInAnswer,
  studentAnswerExplicitlySupportsMarkPoint,
  type EvidenceOnlyMarkingOptions,
} from "../grading/gradingEvidencePolicy";
import { qwenGradingJson, verifyBorderlineMeaningMatch } from "../grading/qwenGradingClient";
import {
  questionExpectsExplainedMechanism,
  studentWroteCausalMechanism,
} from "../grading/gradingFairness";
import {
  extractStudentStageOrder,
  formatExpectedSequenceForPrompt,
  isSequenceMarkingQuestion,
  rubricRowExpectsFullOrderedSequence,
  sequenceQuestionRequiresOrder,
  sequenceStageAtCorrectPosition,
  sequenceStageMatchesStudent,
  studentFullSequenceOrderMatches,
} from "../grading/sequenceMarkingService";

const CAUSAL_EN =
  /\b(because|so that|in order to|to (?:reduce|increase|maintain|allow|provide|prevent|enable|cause|ensure)|thus|therefore|as a result|hence|leads to|results in)\b/i;
const CAUSAL_BM = /\b(kerana|sebab|supaya|untuk\s+(?:mengurangkan|menambah|mengekalkan|membantu|menghalang)|menyebabkan|maka|justeru)\b/i;
const PROTECTION_SAFETY = /\b(protect|protection|safe|safety|hazard|injur|harm|chemical|accident|prevent\s+injury|laboratory\s+hazard|makmal|bahaya|keselamatan|kecederaan)\b/i;

function questionLooksLikePurpose(question: string, analysis?: QuestionAnalysis | null): boolean {
  if (questionExpectsExplainedMechanism(question, analysis)) return true;
  const q = (question || "").toLowerCase();
  return (
    analysis?.questionType === "function_purpose" ||
    /\b(main function|primary purpose|role of|function of|purpose of|fungsi|tujuan|peranan)\b/i.test(q)
  );
}

function isCauseEffectQuestion(question: string, analysis?: QuestionAnalysis | null): boolean {
  return analysis?.questionType === "cause_effect" || /\b(explain why|why|mengapa|kesan|cause|effect)\b/i.test(question);
}


function fullAnswerHasCausalLink(answer: string): boolean {
  const text = answer || "";
  return CAUSAL_EN.test(text) || CAUSAL_BM.test(text);
}

/**
 * Fast deterministic match against validMembers pool (open_set rubric rows).
 * Returns matched member value string if found, null otherwise.
 */
function matchValidMember(studentAnswer: string, rubric: RubricIdea): string | null {
  if (!rubric.validMembers || rubric.validMembers.length === 0) return null;
  const ans = normalizeAnswerText(studentAnswer);
  for (const member of rubric.validMembers) {
    const allTerms = [member.value, ...member.aliases].filter(Boolean);
    for (const term of allTerms) {
      const t = normalizeAnswerText(term);
      if (t.length >= 3 && ans.includes(t)) return member.value;
    }
    // Synonym group check for each member value
    if (ideasShareSynonymGroup(ans, normalizeAnswerText(member.value))) return member.value;
  }
  return null;
}

/** Strong deterministic match only — borderline cases go to the LLM exam-standard verifier. */
function studentIdeaMatchesRubricPoint(studentIdea: string, rubric: RubricIdea, studentAnswer: string): boolean {
  if (!studentIdea?.trim()) return false;
  if (isDiagramDeixisAnswer(studentIdea) || isDiagramDeixisAnswer(studentAnswer)) return false;
  // validMembers fast-path for open_set rows
  if (isOpenPoolGradingMode(rubric.gradingMode) && rubric.validMembers?.length) {
    return matchValidMember(studentAnswer, rubric) !== null;
  }
  if (!rubricSubstancePresentInAnswer(studentAnswer, rubric)) return false;
  if (!studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea)) return false;
  const ans = normalizeAnswerText(studentAnswer);
  const id = normalizeAnswerText(rubric.idea);
  if (id.length >= 8 && ans.includes(id)) return true;
  if (ideasShareSynonymGroup(studentIdea, rubric.idea) || ideasShareSynonymGroup(studentAnswer, rubric.idea)) {
    return true;
  }
  for (const phrase of [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])]) {
    const p = normalizeAnswerText(phrase);
    if (p.length >= 6 && ans.includes(p)) return true;
  }
  return false;
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
  if (!fullAnswerHasCausalLink(studentAnswer) && evidence && !fullAnswerHasCausalLink(evidence)) {
    return false;
  }
  if (studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, evidence || studentAnswer, question)) {
    return true;
  }
  return false;
}

function allowMarkAward(params: {
  llmAwarded: boolean;
  studentAnswer: string;
  rubric: RubricIdea;
  evidence: string;
  causalOk: boolean;
  routeDetailOk: boolean;
  question?: string;
}): boolean {
  if (!params.llmAwarded) return false;
  if (!params.causalOk || !params.routeDetailOk) return false;
  return studentAnswerExplicitlySupportsMarkPoint(
    params.studentAnswer,
    params.rubric,
    params.evidence,
    params.question,
  );
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
  if (
    purposeQuestion &&
    rubricSafetyLike &&
    PROTECTION_SAFETY.test(studentAnswer) &&
    studentWroteCausalMechanism(studentAnswer)
  ) {
    return {
      hit: true,
      evidence: studentAnswer.slice(0, 200),
      method: "synonym",
      reason: "Specific hazard/mechanism stated; safety/purpose mark point satisfied by that explanation.",
    };
  }
  if (
    !isDiagramDeixisAnswer(studentAnswer) &&
    studentAnswerCoversIdea(studentAnswer, rubric.idea) &&
    studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea) &&
    studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, studentAnswer.slice(0, 200), question)
  ) {
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
      if (
        !isDiagramDeixisAnswer(studentAnswer) &&
        studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, si.idea, question)
      ) {
        return {
          hit: true,
          evidence: si.idea,
          method: "synonym",
          reason: "Student idea matches rubric via SPM synonym group.",
        };
      }
    }
    if (studentIdeaMatchesRubricPoint(si.idea, rubric, studentAnswer)) {
      // For open_set rows, name the matched member in the reason for evidence traceability
      const matchedMember = isOpenPoolGradingMode(rubric.gradingMode)
        ? matchValidMember(studentAnswer, rubric)
        : null;
      return {
        hit: true,
        evidence: si.idea,
        method: "exact",
        reason: matchedMember
          ? `Matched valid answer from pool: "${matchedMember}". Student wrote: "${si.idea}".`
          : "Detected student idea matches this rubric mark point.",
      };
    }
    if (
      !isDiagramDeixisAnswer(studentAnswer) &&
      studentAnswerCoversIdea(studentAnswer, si.idea) &&
      studentAnswerCoversIdea(si.idea, rubric.idea) &&
      studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, si.idea, question)
    ) {
      return { hit: true, evidence: si.idea, method: "exact", reason: "Extracted idea aligns with rubric text." };
    }
  }
  const phrases = [...(rubric.keywords ?? []), ...(rubric.acceptedConcepts ?? [])];
  for (const phrase of phrases) {
    const p = normalizeAnswerText(phrase);
    if (p.length < 3) continue;
    if (
      !isDiagramDeixisAnswer(studentAnswer) &&
      normalizedTextIncludesPhrase(studentAnswer, phrase) &&
      studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea) &&
      studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, phrase, question)
    ) {
      return {
        hit: true,
        evidence: phrase,
        method: "acceptedConcept",
        reason: `Matched accepted concept/keyword: ${phrase}.`,
      };
    }
    for (const si of studentIdeas) {
      if (
        !isDiagramDeixisAnswer(studentAnswer) &&
        normalizedTextIncludesPhrase(si.idea, phrase) &&
        studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea) &&
        studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, si.idea, question)
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
  diagramContextStructured?: DiagramContext | null;
  diagramImageUrl?: string | null;
  diagramImageBase64?: string | null;
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
  const markingPolicyOptions: EvidenceOnlyMarkingOptions = {
    question,
    diagramContextStructured: params.diagramContextStructured ?? null,
    diagramImageUrl: params.diagramImageUrl,
    diagramImageBase64: params.diagramImageBase64,
  };

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
    if (isDiagramDeixisAnswer(studentAnswer) || isDiagramDeixisAnswer(evidence)) {
      return {
        awarded: false,
        reason:
          "Diagram or vague wording is not credited — state the required scientific point in your own words.",
      };
    }
    if (
      !studentAnswerExplicitlySupportsMarkPoint(
        studentAnswer,
        rubric,
        evidence || studentAnswer,
        question,
      )
    ) {
      return {
        awarded: false,
        reason:
          "No matching phrase in your answer for this mark point — only written evidence counts.",
      };
    }
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
    if (awarded) {
      const quote = (evidence || studentAnswer).trim().slice(0, 100);
      if (quote && !reason.includes('"') && !reason.includes("'")) {
        reason = `You wrote "${quote}" — this matches the marking point.`;
      }
    }
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
            markingPolicyOptions,
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
            markingPolicyOptions,
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
        markingPolicyOptions,
      });
      const catEvidence =
        lineForVerify ||
        params.studentIdeas[0]?.idea ||
        studentAnswer.slice(0, 200);
      const catAwarded = allowMarkAward({
        llmAwarded: verified.awarded,
        studentAnswer,
        rubric,
        evidence: catEvidence,
        causalOk: true,
        conceptAllowed: true,
        routeDetailOk: studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea),
        question,
      });
      pushRow(
        rubric,
        strategy,
        catAwarded,
        catAwarded
          ? verified.reason || "Category member stated clearly in the answer."
          : verified.reason ||
            "Answer does not name a specific valid category member in the student's own words.",
        catEvidence,
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
        markingPolicyOptions,
      });
      const reasonEvidence = params.studentIdeas[0]?.idea ?? studentAnswer.slice(0, 200);
      const reasonAwarded = allowMarkAward({
        llmAwarded: verified.awarded,
        studentAnswer,
        rubric,
        evidence: reasonEvidence,
        causalOk: true,
        conceptAllowed: true,
        routeDetailOk: true,
        question,
      });
      pushRow(
        rubric,
        strategy,
        reasonAwarded,
        reasonAwarded
          ? verified.reason || "Reasoning stated clearly in the answer."
          : verified.reason || "Reasoning not stated clearly enough in the answer.",
        reasonEvidence,
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
        markingPolicyOptions,
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
        if (
          studentIdeaMatchesRubricPoint(si.idea, rubric, studentAnswer) &&
          studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, si.idea, question)
        ) {
          awarded = true;
          evidence = si.idea;
          matchMethod = "exact";
          reason = "Mark point explicitly stated in the answer.";
          break;
        }
      }
    }

    if (!awarded && bestIdx >= 0) {
      evidence = params.studentIdeas[bestIdx]?.idea ?? "";
      const ideaClearlyPresent = studentIdeaMatchesRubricPoint(evidence, rubric, studentAnswer);
      const causalOk = causalRequirementSatisfied({
        rubric,
        evidence,
        studentAnswer,
        question,
        questionAnalysis: params.questionAnalysis,
      });

      const routeDetailOk = studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea);
      const embedAutoReject = 0.32;
      const useSemanticVerifier =
        strategy !== "equationCompleteness" &&
        strategy !== "accuracyCheck" &&
        (ideaClearlyPresent || bestScore > embedAutoReject);

      if (
        !useSemanticVerifier &&
        (bestScore <= embedAutoReject || !causalOk || !routeDetailOk)
      ) {
        awarded = false;
        matchMethod = "embedding";
        reason = !routeDetailOk
          ? "Answer states what is transported but not where from/to (or equivalent route)."
          : !causalOk
            ? "Rubric point needs a causal explanation; not clearly shown in the student wording."
            : `Does not meet SPM mark-scheme standard for this point (similarity ${bestScore.toFixed(2)}).`;
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
          markingPolicyOptions,
        });
        const evidenceLine = evidence || studentAnswer.slice(0, 400);
        awarded = allowMarkAward({
          llmAwarded: verified.awarded,
          studentAnswer,
          rubric,
          evidence: evidenceLine,
          causalOk,
          routeDetailOk,
          question,
        });
        matchMethod = "llmVerifier";
        reason =
          verified.reason ||
          (awarded
            ? `Mark point stated in the answer (similarity ${bestScore.toFixed(2)}).`
            : `Required point not stated clearly in the answer (similarity ${bestScore.toFixed(2)}).`);
        if (!causalOk) {
          awarded = false;
          reason = "Explanation mark needs a causal link written in the answer.";
        } else if (awarded === false && isGenericVagueStatement(evidenceLine)) {
          reason = "Answer is too vague — the required scientific point is not stated clearly.";
        }
      }
    } else if (!awarded && bestIdx < 0) {
      reason =
        params.studentIdeas.length === 0
          ? "No student idea lines extracted — semantic check on full answer next."
          : "No embedding match to extracted ideas.";
    }

    if (!awarded && studentIdeaMatchesRubricPoint(evidence, rubric, studentAnswer)) {
      const causalOk =
        !rubric.requiresCausalLink ||
        fullAnswerHasCausalLink(studentAnswer) ||
        studentAnswerCoversIdea(studentAnswer, rubric.idea);
      if (
        causalOk &&
        studentAnswerSatisfiesRubricDetail(studentAnswer, rubric.idea) &&
        studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, evidence, question)
      ) {
        awarded = true;
        matchMethod = "exact";
        reason = "Mark point explicitly stated in the answer.";
      }
    }

    pushRow(rubric, strategy, awarded, reason, evidence, awarded ? matchMethod : undefined);
  }

  const totalScore = Math.max(
    0,
    Math.min(
      params.maxScore,
      Math.round(markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0)),
    ),
  );

  return { matchedRubricPoints, missingRubricPoints, markBreakdown, totalScore };
}

// ── Evidence-based examiner matcher (default Stage 4) ─────────────────────────

export type CriterionMatchRow = {
  criterion_id: string;
  criterion_description: string;
  core_concept: string;
  marks_available: number;
  matched: boolean;
  marks_awarded: number;
  matching_idea_id: string | null;
  matching_idea_text: string | null;
  match_type: "exact" | "synonym" | "partial" | "no_match" | string;
  match_reasoning: string;
  confidence: number;
};

export type EvidenceBasedMarkingResult = {
  matches: CriterionMatchRow[];
  total_marks_awarded: number;
  total_marks_available: number;
  low_confidence_flags: string[];
};

const EXAMINER_MATCH_SYSTEM = `You are an SPM examiner performing evidence-based marking.

Your task is to determine whether each student idea satisfies each rubric criterion.
Reason about meaning and concept — not surface wording.

SEMANTIC MATCHING (mandatory):
- Each criterion includes core_concept, accepted_concepts, and accepted_synonyms (cached at rubric build).
- Student ideas are short, atomized phrases — often colloquial or list fragments.
- Award a mark when the student idea shows SEMANTIC CONTAINMENT: the same scientific intent
  as the criterion, even if wording differs from the textbook idea string.
- Check accepted_synonyms and accepted_concepts first for colloquial / action-verb / BM forms.
- Do NOT require exact keyword overlap with criterion_description or core_concept alone.
- One student idea may match at most one criterion unless it clearly expresses two independent concepts.

Marking philosophy:
- A student answer is correct if it conveys the same core_concept as the criterion,
  regardless of the specific words used.
- Your standard: would a trained SPM examiner accept this phrasing?
  SPM examiners accept any reasonable phrasing that demonstrates understanding.
- BM, English, and Chinese are equally valid. Never penalise for language choice.
- Penalise only for wrong or missing concepts, never for informal or imprecise phrasing.
- When uncertain between accepting and rejecting, accept and flag low confidence
  for human review.

Return ONLY valid JSON, no explanation, no markdown fences.

Output schema:
{
  "matches": [
    {
      "criterion_id": string,
      "criterion_description": string,
      "core_concept": string,
      "marks_available": number,
      "matched": boolean,
      "marks_awarded": number,
      "matching_idea_id": string,
      "matching_idea_text": string,
      "match_type": string,
      "match_reasoning": string,
      "confidence": number
    }
  ],
  "total_marks_awarded": number,
  "total_marks_available": number,
  "low_confidence_flags": [string]
}

Rules for match_reasoning:
- State what concept the student demonstrated
- State what concept the criterion requires
- State whether they match and why — at concept level, not word level
- Never write "student wrote X, rubric says Y"

Rules for confidence:
- >= 0.85 · concept match is unambiguous
- 0.75–0.84 · phrasing non-standard but concept appears correct
- < 0.75 · uncertain — always add criterion_id to low_confidence_flags
            and queue for human examiner review

Rules for marks_awarded:
- If matched is false, marks_awarded must be 0.
- If matched is true, marks_awarded must be between 1 and marks_available (inclusive).
- total_marks_awarded must equal the sum of marks_awarded across matches.
- Do not award marks for concepts not present in the student ideas list.`;

function rubricCriteriaForPrompt(rubricIdeas: RubricIdea[]): unknown[] {
  return rubricIdeas.map((r) => ({
    criterion_id: r.id,
    criterion_description: r.idea,
    core_concept: r.idea,
    marks_available: r.marks,
    kind: r.kind,
    keywords: r.keywords ?? [],
    accepted_concepts: r.acceptedConcepts ?? [],
    accepted_synonyms: r.acceptedSynonyms ?? [],
    open_ended: r.openEnded === true,
    requires_causal_link: r.requiresCausalLink === true,
  }));
}

function studentIdeasForPrompt(studentIdeas: StudentIdea[]): { idea_id: string; idea_text: string; has_causal_link: boolean }[] {
  return studentIdeas.map((row, index) => ({
    idea_id: `idea_${index + 1}`,
    idea_text: row.idea,
    has_causal_link: row.hasCausalLink,
  }));
}

function parseCriterionMatchRow(raw: unknown, rubric: RubricIdea): CriterionMatchRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const criterionId = typeof o.criterion_id === "string" ? o.criterion_id : rubric.id;
  const marksAvailable = typeof o.marks_available === "number" ? o.marks_available : rubric.marks;
  const matched =
    typeof o.matched === "boolean"
      ? o.matched
      : typeof o.matched === "string"
        ? /^(true|yes|1)$/i.test(o.matched)
        : false;
  let marksAwarded = typeof o.marks_awarded === "number" ? Math.round(o.marks_awarded) : 0;
  if (matched && marksAwarded <= 0) marksAwarded = 1;
  if (!matched) marksAwarded = 0;
  marksAwarded = Math.max(0, Math.min(marksAvailable, marksAwarded));

  const confidenceRaw = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;

  return {
    criterion_id: criterionId,
    criterion_description:
      typeof o.criterion_description === "string" ? o.criterion_description : rubric.idea,
    core_concept: typeof o.core_concept === "string" ? o.core_concept : rubric.idea,
    marks_available: marksAvailable,
    matched,
    marks_awarded: marksAwarded,
    matching_idea_id: typeof o.matching_idea_id === "string" ? o.matching_idea_id : null,
    matching_idea_text: typeof o.matching_idea_text === "string" ? o.matching_idea_text : null,
    match_type: typeof o.match_type === "string" ? o.match_type : matched ? "synonym" : "no_match",
    match_reasoning: typeof o.match_reasoning === "string" ? o.match_reasoning.trim() : "",
    confidence,
  };
}

export async function runEvidenceBasedCriterionMatching(params: {
  question: string;
  subject: string;
  rubricIdeas: RubricIdea[];
  studentIdeas: StudentIdea[];
  fullStudentAnswer: string;
}): Promise<EvidenceBasedMarkingResult> {
  const rubricPayload = rubricCriteriaForPrompt(params.rubricIdeas);
  const ideasPayload = studentIdeasForPrompt(params.studentIdeas);

  const user = [
    `Rubric: ${JSON.stringify(rubricPayload)}`,
    `Student ideas: ${JSON.stringify(ideasPayload)}`,
    `Subject: ${params.subject}`,
    `Question: ${params.question}`,
    `Full student answer (for context only — award only from ideas list): ${params.fullStudentAnswer}`,
    "Student ideas are atomized short phrases — match each against accepted_synonyms and accepted_concepts using semantic containment and intent, not exact wording.",
    params.studentIdeas.length === 0
      ? "No ideas were extracted — treat all criteria as no_match unless the question accepts an empty recall answer."
      : null,
    isSequenceMarkingQuestion(params.question)
      ? "SEQUENCE QUESTION: award a step only if the student idea shows that step in the correct relative order."
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const parsed = await qwenGradingJson(EXAMINER_MATCH_SYSTEM, user);
  const rawMatches = Array.isArray(parsed?.matches) ? parsed.matches : [];

  const byId = new Map(params.rubricIdeas.map((r) => [r.id, r]));
  const matches: CriterionMatchRow[] = [];

  for (const rubric of params.rubricIdeas) {
    const rawRow = rawMatches.find(
      (m: unknown) =>
        m &&
        typeof m === "object" &&
        (m as { criterion_id?: string }).criterion_id === rubric.id,
    );
    const row = parseCriterionMatchRow(rawRow, rubric);
    matches.push(row ?? {
      criterion_id: rubric.id,
      criterion_description: rubric.idea,
      core_concept: rubric.idea,
      marks_available: rubric.marks,
      matched: false,
      marks_awarded: 0,
      matching_idea_id: null,
      matching_idea_text: null,
      match_type: "no_match",
      match_reasoning: "No match returned for this criterion.",
      confidence: 0,
    });
  }

  for (const raw of rawMatches) {
    const id = raw && typeof raw === "object" ? (raw as { criterion_id?: string }).criterion_id : undefined;
    if (id && byId.has(id) && !matches.some((m) => m.criterion_id === id)) {
      const rubric = byId.get(id)!;
      const row = parseCriterionMatchRow(raw, rubric);
      if (row) matches.push(row);
    }
  }

  const totalMarksAvailable = matches.reduce((s, m) => s + m.marks_available, 0);
  let totalMarksAwarded = matches.reduce((s, m) => s + m.marks_awarded, 0);
  const lowConfidenceFlags = [
    ...new Set(
      [
        ...(Array.isArray(parsed?.low_confidence_flags)
          ? parsed.low_confidence_flags.filter((x: unknown) => typeof x === "string")
          : []),
        ...matches.filter((m) => m.confidence < 0.75 && m.matched).map((m) => m.criterion_id),
      ].filter(Boolean),
    ),
  ] as string[];

  if (typeof parsed?.total_marks_awarded === "number" && Number.isFinite(parsed.total_marks_awarded)) {
    totalMarksAwarded = Math.round(parsed.total_marks_awarded);
  }

  return {
    matches,
    total_marks_awarded: totalMarksAwarded,
    total_marks_available: totalMarksAvailable,
    low_confidence_flags: lowConfidenceFlags,
  };
}

function ideaIndexFromId(matchingIdeaId: string | null): number {
  if (!matchingIdeaId) return -1;
  const m = /^idea_(\d+)$/i.exec(matchingIdeaId.trim());
  if (!m) return -1;
  return Math.max(0, parseInt(m[1], 10) - 1);
}

export async function matchStudentIdeasToRubricExaminer(
  params: MatchStudentIdeasToRubricParams,
): Promise<RubricMatchEngineResult> {
  const question = params.question.trim();
  const studentAnswer = params.studentAnswer.trim();

  const examinerResult = await runEvidenceBasedCriterionMatching({
    question,
    subject: params.subject,
    rubricIdeas: params.rubricIdeas,
    studentIdeas: params.studentIdeas,
    fullStudentAnswer: studentAnswer,
  });

  const markBreakdown: MarkBreakdownItem[] = [];
  const matchedRubricPoints: MatchedRubricPointDetail[] = [];
  const missingRubricPoints: MissingRubricPointDetail[] = [];

  for (const match of examinerResult.matches) {
    const rubric = params.rubricIdeas.find((r) => r.id === match.criterion_id);
    if (!rubric) continue;

    const ideaIdx = ideaIndexFromId(match.matching_idea_id);
    const evidenceFromIdea =
      ideaIdx >= 0 && params.studentIdeas[ideaIdx]
        ? params.studentIdeas[ideaIdx].idea
        : match.matching_idea_text?.trim() || studentAnswer.slice(0, 200);

    let awarded = match.matched && match.marks_awarded > 0;
    let reason = match.match_reasoning || (awarded ? "Concept demonstrated." : "Required concept not shown.");

    if (awarded) {
      const evidenceOk = studentAnswerExplicitlySupportsMarkPoint(
        studentAnswer,
        rubric,
        evidenceFromIdea,
        question,
      );
      if (!evidenceOk) {
        awarded = false;
        reason = "Revoked: required concept not clearly stated in the student's written answer.";
      }
    }

    if (match.confidence < 0.75 && awarded) {
      reason = `${reason} [Low confidence ${match.confidence.toFixed(2)} — review recommended.]`.trim();
    }

    const marks = awarded ? Math.min(rubric.marks, match.marks_awarded) : 0;

    markBreakdown.push({
      rubricId: rubric.id,
      idea: rubric.idea,
      awarded,
      marks,
      reason,
      matchMethod: match.match_type === "exact" ? "exact" : match.match_type === "synonym" ? "synonym" : "llmVerifier",
      matchStrategy: "evidenceBasedExaminer",
    });

    if (awarded) {
      matchedRubricPoints.push({
        rubricId: rubric.id,
        rubricIdea: rubric.idea,
        marksAwarded: marks,
        matchedStudentIdea: evidenceFromIdea,
        matchMethod: match.match_type === "exact" ? "exact" : "synonym",
        reason,
      });
    } else {
      missingRubricPoints.push({
        rubricId: rubric.id,
        rubricIdea: rubric.idea,
        marks: rubric.marks,
        reason,
      });
    }
  }

  let totalScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  totalScore = Math.max(0, Math.min(params.maxScore, totalScore));

  return {
    matchedRubricPoints,
    missingRubricPoints,
    markBreakdown,
    totalScore,
  };
}

export function useExaminerEvidenceMatcher(): boolean {
  const mode = (process.env["RAG_EVIDENCE_MATCHER"] ?? "examiner").trim().toLowerCase();
  return mode !== "legacy";
}
