import type {
  AcceptedConceptBundle,
  GradeSubmissionInput,
  MarkBreakdownItem,
  RubricIdea,
  StudentIdea,
} from "../types";
import { buildGradingContextFromChunks } from "../retrieval/retrievalService";
import { formatSpmStudentFriendlyRulesBlock } from "./gradingPolicy";
import { formatSufficiencyMarkingBlock, formatPartialCreditBlock } from "./gradingPolicy";
import { finalizeRubricIdeas, getOrCreateRubric, getRubricById } from "../rubric/rubricService";
import {
  filterGroundedStudentIdeas,
  isDiagramDeixisAnswer,
  studentAnswerExplicitlySupportsMarkPoint,
  type EvidenceOnlyMarkingOptions,
} from "./gradingEvidencePolicy";
import {
  gradingUsesVisualFigure,
  isOpenPoolGradingMode,
  VISUAL_FIGURE_REVOKE_REASON,
} from "./gradingPolicy";
import { fixMissingIdeasAgainstStudentAnswer } from "./gradingFairness";
import {
  applyExaminerPriorityMarking,
  buildPostScoreFeedback,
  formatFeedbackWithModelAnswer,
  resolveGradingModelLabel,
  runSpmCorrectnessValidation,
} from "./gradingStages";
import { analyzeQuestion, mapAnalysisToRubricQuestionType } from "./questionAnalysisService";
import { detectAnswerLanguage } from "./gradingTextUtils";
import {
  matchStudentIdeasToRubric,
  matchStudentIdeasToRubricExaminer,
  useExaminerEvidenceMatcher,
} from "../rubric/rubricMatchingService";
import { isSequenceMarkingQuestion } from "./sequenceMarkingService";
import {
  detectEquationPartialWins,
  filterEquationGapsNotInAnswer,
} from "./gradingEquationFeedback";

/**
 * Grading pipeline (v2) â€” fixed stage order:
 *
 * 1. Question Type Analyzer
 * 2. Cached Rubric Generator
 * 3. Student Idea Extractor
 * 4. Evidence-Based Matcher
 * 5. Scientific Validator
 * 6. Distinct Evidence Checker
 * 7. Fairness Recovery
 * 8. Examiner Moderation Layer
 * 9. Feedback Generator
 */
import { qwenGradingJson } from "./qwenGradingClient";

export type PipelineResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  matchedIdeas: string[];
  missingIdeas: string[];
  markBreakdown: MarkBreakdownItem[];
  strengths: string[];
  improvements: string[];
  model: string;
  studentIdeasDetected: string[];
  rubricIdeas: string[];
  acceptedConcepts: AcceptedConceptBundle[];
  contradictionCheckPassed: boolean;
  outsideRubricAwardCount?: number;
  /** True when v2 used merged/audited context supplied by gradeService (not independent retrieval). */
  usedAuditedContext?: boolean;
};

/** Equation, ordered sequence, and validMembers pools still use the legacy matcher. */
function rubricIdeasNeedLegacyMatcher(rubricIdeas: RubricIdea[]): boolean {
  return rubricIdeas.some(
    (r) =>
      r.kind === "equation" ||
      r.gradingMode === "ordered_sequence" ||
      (isOpenPoolGradingMode(r.gradingMode) && (r.validMembers?.length ?? 0) > 0),
  );
}

function sumAwardedMarks(markBreakdown: MarkBreakdownItem[]): number {
  return markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
}

function listsFromBreakdown(markBreakdown: MarkBreakdownItem[]): {
  matchedIdeas: string[];
  missingIdeas: string[];
} {
  return {
    matchedIdeas: markBreakdown.filter((row) => row.awarded).map((row) => row.idea),
    missingIdeas: markBreakdown.filter((row) => !row.awarded).map((row) => row.idea),
  };
}

function evidenceRevokeReason(question: string, studentAnswer: string, options: EvidenceOnlyMarkingOptions): string {
  if (
    gradingUsesVisualFigure({ question, ...options }) &&
    isDiagramDeixisAnswer(studentAnswer)
  ) {
    return VISUAL_FIGURE_REVOKE_REASON;
  }
  return "The written answer does not state the required scientific point clearly (diagram comments or vague wording are not credited).";
}

/**
 * Enforce that each awarded mark is supported by a DISTINCT piece of student evidence.
 *
 * A short answer containing only one concept can match multiple rubric rows and earn
 * N marks even though only 1 concept was demonstrated.  This gate catches that case.
 *
 * The check only fires when the answer is genuinely brief relative to the mark
 * allocation (< 6 words per awarded mark).  Longer answers pass through untouched
 * because they can legitimately cover many separate points.
 *
 * Concept distinctness is measured by whether each awarded row can claim at least
 * one content token from the student answer that no earlier row has already claimed.
 * Rows that cannot claim a fresh token do not represent an independent concept and
 * have their mark revoked.
 */
function enforceDistinctEvidencePerMark(
  markBreakdown: MarkBreakdownItem[],
  studentAnswer: string,
  maxScore: number,
): MarkBreakdownItem[] {
  if (maxScore < 2) return markBreakdown;

  const awardedRows = markBreakdown.filter((r) => r.awarded && !r.awardedOutsideRubric);
  if (awardedRows.length < 2) return markBreakdown;

  const totalAwarded = awardedRows.reduce((s, r) => s + r.marks, 0);
  if (totalAwarded < 2) return markBreakdown;

  // Only apply when the student wrote fewer than 6 words per awarded mark.
  // This threshold is proportional: a 3-mark question needs â‰¥18 words to pass through.
  const answerWords = studentAnswer.trim().split(/\s+/).filter(Boolean);
  if (answerWords.length >= totalAwarded * 6) return markBreakdown;

  const STOP = new Set([
    "the","a","an","of","in","is","are","to","and","or","that","it","its",
    "its","this","by","at","be","was","were","has","have","for","with","from",
  ]);
  function keyTokens(text: string): Set<string> {
    return new Set(
      text.toLowerCase().split(/\W+/).filter((w) => w.length >= 4 && !STOP.has(w)),
    );
  }

  const studentTokens = keyTokens(studentAnswer);

  // For each awarded row, check whether it contributes at least one content token
  // from the student answer that hasn't been claimed by a previous row.
  let distinctConcepts = 0;
  const usedTokens = new Set<string>();

  for (const row of awardedRows) {
    const rowTokens = keyTokens(row.idea);
    const freshTokens = [...rowTokens].filter((t) => studentTokens.has(t) && !usedTokens.has(t));
    if (freshTokens.length > 0) {
      distinctConcepts += 1;
      freshTokens.forEach((t) => usedTokens.add(t));
    }
  }

  // If every row claimed a fresh token, the student genuinely wrote distinct points.
  if (distinctConcepts >= totalAwarded) return markBreakdown;

  const result = markBreakdown.map((r) => ({ ...r }));
  let toRevoke = totalAwarded - Math.max(1, distinctConcepts);
  for (let i = result.length - 1; i >= 0 && toRevoke > 0; i--) {
    if (!result[i].awarded || result[i].awardedOutsideRubric) continue;
    result[i].awarded = false;
    result[i].reason = "Revoked: answer does not contain enough distinct content to independently support multiple mark points.";
    toRevoke -= result[i].marks;
  }
  return result;
}

function enforceEvidenceOnlyMarks(
  markBreakdown: MarkBreakdownItem[],
  rubricIdeas: RubricIdea[],
  studentAnswer: string,
  question: string,
  markingPolicyOptions: EvidenceOnlyMarkingOptions,
): MarkBreakdownItem[] {
  return markBreakdown.map((row) => {
    if (!row.awarded) return row;
    // Outside-rubric credits were already evidence-gated when created â€” do not re-check.
    if (row.awardedOutsideRubric === true) return row;
    const rubric = rubricIdeas.find((r) => r.id === row.rubricId);
    // Row has no matching rubric idea (e.g. synthetic row) â€” keep as-is.
    if (!rubric) return row;
    if (isDiagramDeixisAnswer(studentAnswer)) {
      return {
        ...row,
        awarded: false,
        reason: evidenceRevokeReason(question, studentAnswer, markingPolicyOptions),
      };
    }
    if (!studentAnswerExplicitlySupportsMarkPoint(studentAnswer, rubric, studentAnswer, question)) {
      return {
        ...row,
        awarded: false,
        reason: evidenceRevokeReason(question, studentAnswer, markingPolicyOptions),
      };
    }
    return row;
  });
}

export async function extractStudentIdeas(question: string, studentAnswer: string, language: string): Promise<StudentIdea[]> {
  const system = [
    "Extract concise ideas from a student's answer â€” EVIDENCE ONLY.",
    formatSpmStudentFriendlyRulesBlock(),
    formatPartialCreditBlock(),
    formatSufficiencyMarkingBlock(),
    "CRITICAL: Each idea must be an exact quote or tight paraphrase of words the student actually wrote.",
    "Never copy concepts from the question stem, model answer, or rubric â€” only from the student answer text below.",
    "Return JSON only: { \"ideas\": [{ \"idea\": string, \"hasCausalLink\": boolean }] }.",
    "Do NOT add mechanisms, purposes, outcomes, or scientific details that are not in the answer.",
    "Do NOT infer what a vague phrase probably meant.",
    gradingUsesVisualFigure({ question }) || isDiagramDeixisAnswer(studentAnswer)
      ? "Do NOT extract meta-comments about the diagram/figure/part. Only extract scientific points the student actually wrote (names, functions, processes, values)."
      : "",
    [
      "ATOMIZE COMPOUND LISTS (mandatory):",
      "Aggressively split compound clauses into separate ideas.",
      "If the student lists multiple distinct points in ONE sentence or phrase — using conjunctions",
      "(and, or, with, serta, dan, atau, serta dengan) OR commas/semicolons — you MUST output each",
      "distinct point as its own standalone string in the ideas array.",
      "Example: \"gloves and goggles\" → two ideas: \"gloves\" and \"goggles\".",
      "Example: \"wear gloves, use goggles, tie hair\" → three separate ideas.",
      "Do not leave merged lists in a single idea when the items are independently markable.",
      "Each atomized fragment must still be grounded in words the student actually wrote.",
    ].join("\n"),
    [
      "SHORT ANSWER RULE:",
      "If the answer is only one word or one indivisible phrase with no list structure, extract it exactly as written — do not expand it.",
    ].join("\n"),
  ].join("\n");
  const sequenceQ = isSequenceMarkingQuestion(question);
  const user = [
    `Question: ${question}`,
    `Student answer: ${studentAnswer}`,
    `Language: ${language}`,
    sequenceQ
      ? [
          "SEQUENCE QUESTION: split the answer into one idea per stage/level/step (e.g. cell, tissue, organ, or each model name).",
          "Keep fragments in the order the student wrote them. Include every stage mentioned, even if only one word.",
        ].join("\n")
      : "Split into short atomized ideas using only wording from the student answer.",
    "Apply ATOMIZE COMPOUND LISTS: split on and/or/commas whenever multiple distinct markable items appear.",
    "Do not fill gaps or invent points the student did not write.",
    "hasCausalLink=true only if this idea line explicitly contains because/so that/to/kerana/supaya/untuk etc.",
  ].join("\n\n");
  const parsed = await qwenGradingJson(system, user);
  const ideas = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  return ideas
    .map((row: any) => ({
      idea: typeof row?.idea === "string" ? row.idea.trim() : "",
      hasCausalLink:
        typeof row?.hasCausalLink === "boolean"
          ? row.hasCausalLink
          : typeof row?.hasCausalLink === "string"
            ? /^(true|yes|1)$/i.test(row.hasCausalLink)
            : false,
    }))
    .filter((row: StudentIdea) => row.idea.length > 0);
}

function fallbackFeedback(params: {
  score: number;
  maxScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  language: "english" | "malay" | "mixed";
  usesVisualFigure?: boolean;
  studentAnswer?: string;
  isEquationQuestion?: boolean;
}): string {
  const lang = params.language === "malay" ? "malay" : "english";
  const isEq = params.isEquationQuestion === true && (params.studentAnswer?.trim().length ?? 0) > 0;
  const partialWins = isEq ? detectEquationPartialWins(params.studentAnswer!) : [];
  const missingGaps =
    isEq && params.studentAnswer
      ? filterEquationGapsNotInAnswer(params.missingIdeas, params.studentAnswer)
      : params.missingIdeas;
  const visualHint =
    params.usesVisualFigure && params.score < params.maxScore
      ? lang === "malay"
        ? " Tulis nama/fungsi/nilai dalam ayat anda â€” hanya merujuk rajah tidak dikira."
        : " Write names, functions, or values in your own words â€” only referring to the diagram is not credited."
      : "";
  if (lang === "malay") {
    if (params.score >= params.maxScore) {
      return `Bagus â€” betul. Anda sudah nyatakan perkara utama: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
    }
    if (params.score === 0) {
      if (partialWins.length > 0) {
        const ack = partialWins.slice(0, 2).join(" ");
        const gaps = missingGaps.slice(0, 2).join("; ");
        return gaps.length > 0
          ? `${ack} Walau bagaimanapun, persamaan penuh belum lengkap: ${gaps}.${visualHint}`
          : `${ack} Walau bagaimanapun, persamaan penuh belum lengkap atau tidak seimbang.${visualHint}`;
      }
      return `Jawapan ini kurang tepat atau terlalu kosong. Cuba sertakan: ${missingGaps.slice(0, 2).join("; ")}.${visualHint}`;
    }
    return `Ada bahagian betul: ${params.matchedIdeas.slice(0, 2).join(", ")}. Tambah atau betulkan: ${params.missingIdeas.slice(0, 2).join("; ")}.${visualHint}`;
  }
  if (params.score >= params.maxScore) {
    return `Well done â€” correct. You gave the main points: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
  }
  if (params.score === 0) {
    if (partialWins.length > 0) {
      const ack = partialWins.slice(0, 2).join(" ");
      const gaps = missingGaps.slice(0, 2).join("; ");
      return gaps.length > 0
        ? `${ack} However, the full equation is not complete yet: ${gaps}.${visualHint}`
        : `${ack} However, the full equation is not complete or balanced yet.${visualHint}`;
    }
    return `This answer is not clear enough or is wrong. Try to include: ${missingGaps.slice(0, 2).join("; ")}.${visualHint}`;
  }
  return `Partly right: ${params.matchedIdeas.slice(0, 2).join(", ")}. You still need to add or fix: ${params.missingIdeas.slice(0, 2).join("; ")}.${visualHint}`;
}

function sanitizeFeedback(feedback: string, opts?: { maxSentences?: number }): string {
  const maxSentences = typeof opts?.maxSentences === "number" && opts.maxSentences > 0 ? opts.maxSentences : 3;
  const cleaned = (feedback || "")
    .replace(/\[Low-?context-?warning\][^\n]*/gi, "")
    .replace(/\[TEXTBOOK CONTEXT\]/gi, "")
    .replace(/\[PAST PAPER MARK SCHEME\]/gi, "")
    .replace(/(^|\n)\s*model answer\s*[:\-].*?(?=\n|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) return cleaned;
  return sentences.slice(0, maxSentences).join(" ").trim();
}

/** Same heuristic as gradeService: practice MCQ "Ask AI" with letter-only answer. */
function looksLikeMcqWithLetterOptions(question: string): boolean {
  const q = question.replace(/\r/g, "\n");
  return /\bA\s*[\.)]\s*\S/m.test(q) && /\bB\s*[\.)]\s*\S/m.test(q);
}

function isMcqLetterOnlyExplanationRequest(question: string, studentAnswer: string, maxScore: number): boolean {
  if (maxScore !== 1) return false;
  const letter = studentAnswer.trim().toUpperCase();
  if (!/^[A-D]$/.test(letter)) return false;
  return looksLikeMcqWithLetterOptions(question);
}

function buildModelAnswer(awardedRows: MarkBreakdownItem[], missingRows: MarkBreakdownItem[]): string {
  const ideas = [...awardedRows.map((r) => r.idea), ...missingRows.map((r) => r.idea)];
  return ideas.slice(0, 6).join("; ");
}

export async function gradeWithPipelineV2(input: GradeSubmissionInput): Promise<PipelineResult> {
  const question = input.question.trim();
  const studentAnswer = input.studentAnswer.trim();
  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const maxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const subject = input.subject?.trim() || "General";
  const form = input.form?.trim() || "General";

  const mergedFromParent = (input.mergedGradingContextText ?? "").trim();
  const auditedChunks = input.auditedRetrievedChunks ?? [];
  const auditedExcerpt =
    mergedFromParent.length > 0
      ? mergedFromParent
      : auditedChunks.length > 0
        ? buildGradingContextFromChunks(question, auditedChunks).mergedContextText
        : "";
  const usedAuditedContext = auditedExcerpt.length > 0;

  // â”€â”€ 1. Question Type Analyzer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const questionAnalysis = input.questionAnalysis ?? analyzeQuestion(question, subject);
  const rubricQuestionType = mapAnalysisToRubricQuestionType(questionAnalysis);
  const language = detectAnswerLanguage(studentAnswer);

  // â”€â”€ 2. Cached Rubric Generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const savedRubricId = input.rubricId?.trim();
  const rubric = savedRubricId
    ? await getRubricById(savedRubricId)
    : await getOrCreateRubric({
        question,
        subject,
        form,
        maxScore,
        questionType: rubricQuestionType,
        skipNearestCachedRubric: true,
        useAuditContextOnly: true,
        auditedContextExcerpt: auditedExcerpt.length > 0 ? auditedExcerpt : null,
        questionAnalysis,
      });
  if (!rubric) {
    throw new Error(`Saved rubric not found: ${savedRubricId}`);
  }
  if (savedRubricId && rubric.maxScore !== maxScore) {
    throw new Error(`Saved rubric maxScore ${rubric.maxScore} does not match request maxScore ${maxScore}.`);
  }
  if (savedRubricId && rubric.subject.trim().toLowerCase() !== subject.trim().toLowerCase()) {
    throw new Error(`Saved rubric subject ${rubric.subject} does not match request subject ${subject}.`);
  }

  const staleRows = rubric.ideas.filter(
    (r) => r.kind === undefined || r.openEnded === undefined || r.demandType === undefined,
  );
  if (staleRows.length > 0) {
    console.warn(
      `[gradePipeline] rubric ${rubric.rubricId} has ${staleRows.length} stale ` +
        "rows â€” backfill will apply. Consider regenerating this rubric.",
    );
  }

  // â”€â”€ 3. Student Idea Extractor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const studentIdeasRaw = await extractStudentIdeas(question, studentAnswer, language);
  const studentIdeas = filterGroundedStudentIdeas(studentIdeasRaw, studentAnswer);
  const rubricIdeasForMarking = finalizeRubricIdeas(
    rubric.ideas,
    question,
    rubric.maxScore,
    questionAnalysis,
    subject,
  );
  const rubricIdeaTexts = rubricIdeasForMarking.map((idea) => idea.idea);
  const studentIdeaTexts = studentIdeas.map((idea) => idea.idea);

  const markingPolicyOptions: EvidenceOnlyMarkingOptions = {
    question,
    diagramContextStructured: input.diagramContextStructured ?? null,
    diagramImageUrl: input.diagramImageUrl,
    diagramImageBase64: input.diagramImageBase64,
  };

  // â”€â”€ 4. Evidence-Based Matcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const useExaminerMatcher =
    useExaminerEvidenceMatcher() && !rubricIdeasNeedLegacyMatcher(rubricIdeasForMarking);
  const matchResult = useExaminerMatcher
    ? await matchStudentIdeasToRubricExaminer({
        question,
        studentAnswer,
        studentIdeas,
        rubricIdeas: rubricIdeasForMarking,
        questionAnalysis,
        subject,
        maxScore,
        diagramImageUrl: input.diagramImageUrl,
        diagramImageBase64: input.diagramImageBase64,
        diagramContextStructured: input.diagramContextStructured ?? null,
      })
    : await matchStudentIdeasToRubric({
    question,
    studentAnswer,
    studentIdeas,
    rubricIdeas: rubricIdeasForMarking,
    questionAnalysis,
    subject,
    maxScore,
    diagramImageUrl: input.diagramImageUrl,
    diagramImageBase64: input.diagramImageBase64,
    diagramContextStructured: input.diagramContextStructured ?? null,
  });

  let markBreakdown = enforceEvidenceOnlyMarks(
    matchResult.markBreakdown,
    rubricIdeasForMarking,
    studentAnswer,
    question,
    markingPolicyOptions,
  );
  let { matchedIdeas, missingIdeas } = listsFromBreakdown(markBreakdown);
  let score = sumAwardedMarks(markBreakdown);

  // â”€â”€ 5. Scientific Validator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const correctnessValidation = await runSpmCorrectnessValidation({
    question,
    studentAnswer,
    subject,
    maxScore,
    currentScore: score,
    matchedIdeas,
    missingIdeas,
    markBreakdown,
    questionAnalysis,
    textbookContext: auditedExcerpt || undefined,
  });
  if (correctnessValidation.creditsAdded > 0) {
    markBreakdown = correctnessValidation.markBreakdown;
    score = correctnessValidation.score;
    ({ matchedIdeas, missingIdeas } = listsFromBreakdown(markBreakdown));
  }

  // â”€â”€ 6. Distinct Evidence Checker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  markBreakdown = enforceDistinctEvidencePerMark(markBreakdown, studentAnswer, maxScore);
  score = Math.min(maxScore, sumAwardedMarks(markBreakdown));
  ({ matchedIdeas, missingIdeas } = listsFromBreakdown(markBreakdown));

  // â”€â”€ 7. Fairness Recovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fairness = await fixMissingIdeasAgainstStudentAnswer({
    question,
    subject,
    studentAnswer,
    missingIdeas,
    matchedIdeas,
    markBreakdown,
    rubricIdeas: rubricIdeasForMarking,
    score,
    maxScore,
    questionAnalysis,
  });
  markBreakdown = fairness.markBreakdown ?? markBreakdown;
  score = Math.min(maxScore, fairness.score);
  matchedIdeas = fairness.matchedIdeas;
  missingIdeas = fairness.missingIdeas;

  // â”€â”€ 8. Examiner Moderation Layer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const examinerPass = await applyExaminerPriorityMarking({
    question,
    studentAnswer,
    studentIdeas,
    rubricIdeas: rubricIdeasForMarking,
    markBreakdown,
    maxScore,
    subject,
    textbookContext: auditedExcerpt || undefined,
    questionAnalysis,
    markingPolicyOptions,
  });
  markBreakdown = enforceEvidenceOnlyMarks(
    examinerPass.markBreakdown,
    rubricIdeasForMarking,
    studentAnswer,
    question,
    markingPolicyOptions,
  );
  score = Math.min(maxScore, sumAwardedMarks(markBreakdown));
  ({ matchedIdeas, missingIdeas } = listsFromBreakdown(markBreakdown));

  const outsideRubricAwardCount =
    examinerPass.outsideRubricCount + correctnessValidation.creditsAdded;

  const markBreakdownOut = markBreakdown;
  const matchedRows2 = markBreakdownOut.filter((row) => row.awarded);
  const missingRows2 = markBreakdownOut.filter((row) => !row.awarded);

  const acceptedConcepts: AcceptedConceptBundle[] = rubric.ideas.map((idea) => ({
    rubricIdea: idea.idea,
    acceptedPhrases: [
      ...(idea.keywords ?? []),
      ...(idea.acceptedConcepts ?? []),
      ...(idea.acceptedSynonyms ?? []),
    ],
  }));

  // â”€â”€ 9. Feedback Generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const usesVisualFigure = gradingUsesVisualFigure(markingPolicyOptions);
  let modelAnswer = buildModelAnswer(matchedRows2, missingRows2);

  const isEquationQuestion =
    questionAnalysis?.isEquationQuestion === true || questionAnalysis?.demandType === "equation";

  const feedbackMaxSentences = isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore)
    ? 8
    : isEquationQuestion && score < maxScore
      ? 5
      : undefined;

  let feedback = sanitizeFeedback(
    fallbackFeedback({
      score,
      maxScore,
      matchedIdeas,
      missingIdeas,
      language,
      usesVisualFigure,
      studentAnswer,
      isEquationQuestion,
    }),
    { maxSentences: feedbackMaxSentences },
  );

  try {
    const post = await buildPostScoreFeedback({
      question,
      studentAnswer,
      score,
      maxScore,
      matchedIdeas,
      missingIdeas,
      rubricIdeas: rubricIdeaTexts,
      markBreakdown: markBreakdownOut,
      questionAnalysis,
      subject,
      language,
      usesVisualFigure,
    });
    if (post.feedback.trim().length > 0) {
      feedback = sanitizeFeedback(post.feedback, { maxSentences: feedbackMaxSentences });
    }
    if (score < maxScore && post.modelAnswer?.trim()) {
      modelAnswer = post.modelAnswer.trim();
    }
  } catch {
    /* keep fallback */
  }

  const formatted = formatFeedbackWithModelAnswer({
    feedback,
    modelAnswer: score < maxScore ? modelAnswer : undefined,
    score,
    maxScore,
    language,
  });

  return {
    score,
    feedback: formatted.feedback,
    modelAnswer: formatted.modelAnswer ?? (score < maxScore ? modelAnswer : undefined),
    matchedIdeas,
    missingIdeas,
    markBreakdown: markBreakdownOut,
    strengths: matchedIdeas,
    improvements: score === maxScore ? [] : missingIdeas,
    model: resolveGradingModelLabel("-pipeline-v2"),
    studentIdeasDetected: studentIdeaTexts,
    rubricIdeas: rubricIdeaTexts,
    acceptedConcepts,
    contradictionCheckPassed: fairness.contradictionCheckPassed,
    outsideRubricAwardCount,
    usedAuditedContext,
  };
}
