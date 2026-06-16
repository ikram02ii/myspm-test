/**
 * Pipeline stages: examiner credit pass, SPM correctness validation, post-score feedback.
 */
import type {
  MarkBreakdownItem,
  QuestionAnalysis,
  RubricIdea,
  StudentIdea,
} from "../types";
import { studentAnswerExplicitlySupportsMarkPoint, type EvidenceOnlyMarkingOptions } from "./gradingEvidencePolicy";
import {
  formatDiagramImageEvidenceBlock,
  formatPartialCreditBlock,
  formatSpmExamStandardMarkingBlock,
  formatSpmStudentFriendlyRulesBlock,
  formatSufficiencyMarkingBlock,
  gradingUsesVisualFigure,
  isStrictContextBindingQuestion,
} from "./gradingPolicy";
import { formatCriticalEvidenceRuleBlock, formatFeedbackEvidenceOnlyBlock } from "./gradingEvidencePolicy";
import {
  detectEquationPartialWins,
  ensureEquationPartialAcknowledgment,
  filterEquationGapsNotInAnswer,
  formatEquationFeedbackBlock,
  softenEquationFeedbackContradictions,
} from "./gradingEquationFeedback";
import { qwenGradingJson, resolveQwenGradingConfig } from "./qwenGradingClient";
import {
  formatGradingContextForPrompt,
  type PipelineGradingContext,
} from "./gradingContext";
import { withMandatoryMarkingLanguage } from "./gradingMandatoryLanguage";
import { studentAnswerMentionsAllComparisonSubjects } from "./gradingComparisonSubjects";

export type ExaminerCreditPassInput = {
  question: string;
  studentAnswer: string;
  studentIdeas: StudentIdea[];
  rubricIdeas: RubricIdea[];
  markBreakdown: MarkBreakdownItem[];
  maxScore: number;
  subject: string;
  textbookContext?: string;
  questionAnalysis?: QuestionAnalysis | null;
  gradingContext?: PipelineGradingContext | null;
  markingPolicyOptions?: EvidenceOnlyMarkingOptions;
};

export type ExaminerCreditPassResult = {
  markBreakdown: MarkBreakdownItem[];
  score: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  outsideRubricCount: number;
};

type RubricRowCredit = {
  rubricId?: string;
  award?: boolean;
  reason?: string;
  awardedOutsideRubric?: boolean;
};

function sumAwarded(breakdown: MarkBreakdownItem[]): number {
  return breakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
}

function rubricRowSummary(ideas: RubricIdea[], breakdown: MarkBreakdownItem[]): string {
  return ideas
    .map((idea) => {
      const row = breakdown.find((r) => r.rubricId === idea.id);
      const status = row?.awarded ? "AWARDED" : "NOT AWARDED";
      return [
        `- id=${idea.id} marks=${idea.marks} kind=${idea.kind} demand=${idea.demandType ?? "n/a"} status=${status}`,
        `  idea: ${idea.idea}`,
        idea.requiresCausalLink ? "  requires_causal_link: true" : null,
        idea.comparisonSubjects?.length ? `  comparison_subjects: ${idea.comparisonSubjects.join(" | ")}` : null,
        row?.reason ? `  matcher reason: ${row.reason}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function codeRevokeLog(breakdown: MarkBreakdownItem[]): string {
  const revoked = breakdown.filter((r) => !r.awarded && /revoked/i.test(r.reason ?? ""));
  if (revoked.length === 0) return "";
  return revoked
    .map((r) => `- ${r.idea}: ${r.reason}`)
    .slice(0, 8)
    .join("\n");
}

export async function applyExaminerPriorityMarking(
  input: ExaminerCreditPassInput,
): Promise<ExaminerCreditPassResult> {
  const breakdown = input.markBreakdown.map((r) => ({ ...r }));
  let score = sumAwarded(breakdown);
  const maxScore = input.maxScore;

  if (score >= maxScore || !input.studentAnswer.trim()) {
    return buildResult(breakdown, score, 0);
  }

  const remaining = maxScore - score;
  const unawarded = breakdown.filter((r) => !r.awarded && r.marks > 0);
  if (unawarded.length === 0 && remaining <= 0) {
    return buildResult(breakdown, score, 0);
  }

  const strictCtx = isStrictContextBindingQuestion(input.question);
  const contextExcerpt = (input.textbookContext ?? "").trim().slice(0, 4000);

  const system = withMandatoryMarkingLanguage(
    [
      formatSpmExamStandardMarkingBlock(input.markingPolicyOptions),
      formatSufficiencyMarkingBlock(),
      formatSpmStudentFriendlyRulesBlock(),
      "Return JSON only:",
      `{`,
      `  "rubricRowCredits": [`,
      `    { "rubricId": string, "award": boolean, "reason": string }`,
      `  ]`,
      `}`,
      "Rules:",
      "- You MUST review existing rubric row ids and ONLY set award=true when the first matcher missed valid explicit evidence.",
      "- ONLY set award=true when you can quote an exact phrase from the student answer that matches the rubric row.",
      "- NEVER credit model-answer or rubric wording that does not appear in the student answer.",
      `- You MUST NOT add more than ${remaining} additional mark(s) total.`,
      "- NEVER award equation marks unless the equation is fully correct at SPM level.",
      "- ONLY award if the student answer text already contains the mark point — NEVER infer unstated science.",
      "- NEVER award because a diagram/figure shows the point if the student did not write it in their answer.",
      "- ONLY use existing rubricId values from the rubric rows list below — no outside-rubric entries.",
      strictCtx
        ? "- CONTEXT-BOUND: ONLY award if consistent with the named source in the question."
        : "- Valid SPM paraphrases are allowed ONLY when the mark-point detail is clearly present in the student's words.",
      input.gradingContext
        ? [
            "",
            "QUESTION TYPE (binding):",
            formatGradingContextForPrompt(input.gradingContext),
            "- You MUST apply the same per-row type rules as Stage 4 (recall / comparison / causal / definition / example).",
            "- NEVER re-award rows listed under CODE REVOKES unless the student answer now clearly satisfies that gate.",
          ].join("\n")
        : "",
    ].join("\n"),
  );

  const user = [
    `Subject: ${input.subject}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Student ideas extracted:\n${input.studentIdeas.map((s, i) => `${i + 1}. ${s.idea}`).join("\n") || "(none)"}`,
    `Marks already awarded: ${score}/${maxScore}. You may add at most ${remaining} more.`,
    "Rubric rows:",
    rubricRowSummary(input.rubricIdeas, breakdown),
    (() => {
      const log = codeRevokeLog(breakdown);
      return log ? `CODE REVOKES (do not override without stronger student evidence):\n${log}` : null;
    })(),
    contextExcerpt ? `Marking context (reference only):\n${contextExcerpt}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  let rubricRowCredits: RubricRowCredit[] = [];

  try {
    // consistency lock: Half B marking pipeline requires temperature 0 (stage 8)
    const parsed = await qwenGradingJson(system, user, { temperature: 0 });
    rubricRowCredits = Array.isArray(parsed?.rubricRowCredits) ? parsed.rubricRowCredits : [];
  } catch {
    return buildResult(breakdown, score, 0);
  }

  let budget = remaining;
  let outsideRubricCount = 0;

  for (const credit of rubricRowCredits) {
    if (budget <= 0) break;
    if (credit.award !== true) continue;

    const rubricId = typeof credit.rubricId === "string" ? credit.rubricId.trim() : "";
    const reason = (typeof credit.reason === "string" && credit.reason.trim()) || "";

    // OUTSIDE_RUBRIC credits are disabled — Stage 8 may only re-evaluate existing rubric rows.
    // Holistic outside-rubric awards were the primary source of grading inconsistency.
    if (rubricId === "OUTSIDE_RUBRIC") continue;

    // Standard rubric-row credit
    if (!rubricId) continue;
    const row = breakdown.find((r) => r.rubricId === rubricId);
    const rubricIdea = input.rubricIdeas.find((r) => r.id === rubricId);
    if (!row || row.awarded || !rubricIdea) continue;
    if (rubricIdea.kind === "equation" || rubricIdea.demandType === "equation") continue;
    if (!studentAnswerExplicitlySupportsMarkPoint(input.studentAnswer, rubricIdea, input.studentAnswer, input.question)) {
      continue;
    }

    const marks = Math.min(budget, row.marks, rubricIdea.marks);
    if (marks <= 0) continue;

    row.awarded = true;
    row.marks = marks;
    row.reason = reason || "SPM exam-standard review: mark point clearly shown in the answer.";
    row.matchMethod = "llmVerifier";
    row.matchStrategy = "examStandardReview";
    row.awardedOutsideRubric = false;
    budget -= marks;
  }

  score = Math.min(maxScore, sumAwarded(breakdown));
  return buildResult(breakdown, score, outsideRubricCount);
}

function buildResult(
  markBreakdown: MarkBreakdownItem[],
  score: number,
  outsideRubricCount: number,
): ExaminerCreditPassResult {
  const matchedIdeas = markBreakdown.filter((r) => r.awarded).map((r) => r.idea);
  const missingIdeas = markBreakdown.filter((r) => !r.awarded).map((r) => r.idea);
  return { markBreakdown, score, matchedIdeas, missingIdeas, outsideRubricCount };
}

/**
 * Minimum LLM confidence to apply credit.
 * Lowered to 0.62 â€” the judge already has strict criteria in its prompt;
 * an additional high threshold was causing too many false rejections.
 */
export type SpmCorrectnessValidationInput = {
  question: string;
  studentAnswer: string;
  subject: string;
  maxScore: number;
  currentScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  markBreakdown: MarkBreakdownItem[];
  questionAnalysis?: QuestionAnalysis | null;
  gradingContext?: PipelineGradingContext | null;
  textbookContext?: string;
};

function minCorrectnessConfidence(ctx?: PipelineGradingContext | null): number {
  if (ctx?.isRecallQ || ctx?.isDefinitionQ) return 0.9;
  if (ctx?.isCompareQ || ctx?.isCauseEffectQ) return 0.8;
  return 0.62;
}

export type SpmCorrectnessValidationResult = {
  markBreakdown: MarkBreakdownItem[];
  score: number;
  creditsAdded: number;
};

// â”€â”€â”€ System prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildSystem(subject: string, remaining: number, ctx?: PipelineGradingContext | null): string {
  const minConf = minCorrectnessConfidence(ctx);
  return withMandatoryMarkingLanguage(
    [
      `You are an SPM examiner judge for ${subject}.`,
      "",
      "Your ONLY job is to answer one question:",
      '"Does the student\'s answer contain a scientifically correct SPM-level concept that deserves credit,',
      'even if the rubric did not explicitly include it?"',
      "",
      "ONLY award credit when ALL of the following are true:",
      "- The student MUST have written something scientifically correct at SPM Form 4/5 level.",
      "- The answer MUST be relevant to the question being asked.",
      "- A fair SPM examiner MUST accept this answer.",
      "- The student MUST have actually written this in their answer (not implied, not inferred).",
      "",
      "NEVER award credit when ANY of the following apply:",
      "- The answer is scientifically wrong or contradictory.",
      "- The answer is vague ('it helps', 'it is important', 'because of the cell').",
      "- The answer is off-topic or unrelated to the question.",
      "- The student did not actually write this concept.",
      `- Awarding would exceed the remaining ${remaining} mark(s) available.`,
      "",
      "SPM LEVEL RULE:",
      "ONLY accept concepts taught in Malaysian SPM Form 4 or Form 5 textbooks.",
      "NEVER accept university-level or A-Level concepts not in the SPM syllabus.",
      "",
      "Return JSON only — exactly one of these two shapes:",
      "",
      "If credit IS deserved:",
      '{ "outsideRubricCredit": true, "detectedConcept": "<short concept name>", "studentEvidence": "<short exact quote from student answer>", "scientificReasoning": "<why this is correct at SPM level>", "confidence": <0.0 to 1.0> }',
      "",
      "If credit is NOT deserved:",
      '{ "outsideRubricCredit": false, "reason": "<why not>" }',
      "",
      "Rules for the credit object:",
      "- detectedConcept MUST be a short label of what the student correctly demonstrated.",
      "- studentEvidence MUST be copied DIRECTLY from the student answer — NEVER paraphrase from rubric.",
      `- ONLY apply credit when confidence >= ${minConf}.`,
      ctx
        ? [
            "",
            "QUESTION TYPE (binding):",
            formatGradingContextForPrompt(ctx),
            "- ONLY add credit for the TYPE of answer this question demands.",
            "- NEVER add explanation marks on pure recall questions.",
            "- NEVER add comparison marks unless both compared entities are explicitly named in the student answer.",
          ].join("\n")
        : "",
    ].join("\n"),
  );
}

// â”€â”€â”€ User prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildUser(input: SpmCorrectnessValidationInput): string {
  const awarded = input.markBreakdown.filter((r) => r.awarded);
  const unawarded = input.markBreakdown.filter((r) => !r.awarded);

  return [
    `Question: ${input.question}`,
    "",
    `Student answer: ${input.studentAnswer}`,
    "",
    `Current score: ${input.currentScore} / ${input.maxScore}`,
    input.questionAnalysis
      ? `Command word: ${input.questionAnalysis.commandWord} | Question type: ${input.questionAnalysis.questionType}`
      : null,
    "",
    awarded.length > 0
      ? `Already credited:\n${awarded.map((r) => `- ${r.idea}`).join("\n")}`
      : "Already credited: none",
    "",
    unawarded.length > 0
      ? `Not yet credited (rubric rows that were not matched):\n${unawarded.map((r) => `- ${r.idea}`).join("\n")}`
      : "Not yet credited: none",
    "",
    input.textbookContext
      ? `SPM syllabus reference (use only to verify scientific correctness â€” do not award based on this alone):\n${input.textbookContext.slice(0, 1500)}`
      : null,
    "",
    "Question to answer: Does the student answer contain a correct SPM-level concept that deserves credit",
    "but was NOT captured by any of the previous marking stages?",
    "Look carefully at what the student actually wrote. If yes, return the credit object. If no, return outsideRubricCredit=false.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// â”€â”€â”€ Hallucination guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Check that the evidence phrase the LLM quoted actually appears in the
 * student's answer. Uses a lenient token-overlap approach (not exact substring)
 * to handle minor quoting differences.
 */
function evidenceAppearsInAnswer(evidence: string, studentAnswer: string): boolean {
  const ev = evidence.toLowerCase().replace(/^["'Â«Â»]+|["'Â«Â»]+$/g, "").trim();
  const sa = studentAnswer.toLowerCase();
  if (!ev || ev.length < 2) return false;
  // Direct substring check
  if (sa.includes(ev)) return true;
  // Token overlap: if â‰¥60% of evidence tokens appear in the answer
  const tokens = ev.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => sa.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

// â”€â”€â”€ Main export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function runSpmCorrectnessValidation(
  input: SpmCorrectnessValidationInput,
): Promise<SpmCorrectnessValidationResult> {
  const breakdown = input.markBreakdown.map((r) => ({ ...r }));
  const remaining = input.maxScore - input.currentScore;

  if (remaining <= 0 || !input.studentAnswer.trim()) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  let parsed: any;
  try {
    // consistency lock: Half B marking pipeline requires temperature 0 (stage 5)
    parsed = await qwenGradingJson(
      buildSystem(input.subject, remaining, input.gradingContext),
      buildUser(input),
      { temperature: 0 },
    );
  } catch {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  // Not granting credit
  if (!parsed?.outsideRubricCredit) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const detectedConcept = typeof parsed.detectedConcept === "string" ? parsed.detectedConcept.trim() : "";
  const studentEvidence = typeof parsed.studentEvidence === "string" ? parsed.studentEvidence.trim() : "";
  const scientificReasoning = typeof parsed.scientificReasoning === "string" ? parsed.scientificReasoning.trim() : "";

  // Reject if below confidence threshold
  if (confidence < minCorrectnessConfidence(input.gradingContext)) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  if (
    input.gradingContext?.isCompareQ &&
    input.gradingContext.comparisonSubjects.length >= 2 &&
    !studentAnswerMentionsAllComparisonSubjects(
      input.studentAnswer,
      input.gradingContext.comparisonSubjects,
    )
  ) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  // Reject if concept or evidence is missing
  if (!detectedConcept || !studentEvidence || studentEvidence.length < 2) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  // Hallucination guard: evidence must appear in student answer
  if (!evidenceAppearsInAnswer(studentEvidence, input.studentAnswer)) {
    return { markBreakdown: breakdown, score: input.currentScore, creditsAdded: 0 };
  }

  const newScore = Math.min(input.maxScore, input.currentScore + 1);

  breakdown.push({
    idea: detectedConcept,
    awarded: true,
    marks: 1,
    reason: [
      `SPM correctness validation: "${studentEvidence}"`,
      scientificReasoning ? `â€” ${scientificReasoning}` : "",
      `(confidence: ${(confidence * 100).toFixed(0)}%)`,
    ]
      .filter(Boolean)
      .join(" "),
    matchMethod: "llmVerifier",
    matchStrategy: "spmCorrectnessValidation",
    awardedOutsideRubric: true,
  });

  return { markBreakdown: breakdown, score: newScore, creditsAdded: 1 };
}

export type PostScoreFeedbackInput = {
  question: string;
  studentAnswer: string;
  score: number;
  maxScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  rubricIdeas?: string[];
  markBreakdown?: MarkBreakdownItem[];
  questionAnalysis?: QuestionAnalysis | null;
  gradingContext?: PipelineGradingContext | null;
  subject: string;
  language: "english" | "malay" | "mixed";
  usesVisualFigure?: boolean;
  /** Book-grounded reference answer stored at rubric creation (consistent across marks). */
  referenceModelAnswer?: string;
};

export type PostScoreFeedbackResult = {
  feedback: string;
  /** SPM model answer â€” only when the student did not earn full marks. */
  modelAnswer?: string;
};

function extractQuotedSnippet(reason: string): string | null {
  const m = reason.match(/"([^"]{2,220})"/);
  return m?.[1]?.trim() || null;
}

function buildEvidenceSummary(markBreakdown: MarkBreakdownItem[] | undefined): {
  awardedEvidence: string[];
  missedEvidence: string[];
} {
  if (!markBreakdown || markBreakdown.length === 0) {
    return { awardedEvidence: [], missedEvidence: [] };
  }
  const awarded = markBreakdown
    .filter((row) => row.awarded)
    .map((row) => {
      const quote = extractQuotedSnippet(row.reason);
      return quote
        ? `Awarded: ${row.idea} | student evidence: "${quote}"`
        : `Awarded: ${row.idea} | reason: ${row.reason}`;
    })
    .slice(0, 6);
  const missed = markBreakdown
    .filter((row) => !row.awarded)
    .map((row) => {
      const quote = extractQuotedSnippet(row.reason);
      return quote
        ? `Not awarded: ${row.idea} | student wording checked: "${quote}" | reason: ${row.reason}`
        : `Not awarded: ${row.idea} | reason: ${row.reason}`;
    })
    .slice(0, 6);
  return { awardedEvidence: awarded, missedEvidence: missed };
}

/**
 * After marks are fixed in code, generate SPM Form 4/5 student feedback (and model answer if not full marks).
 * Must not contradict the score or claim the student wrote ideas that are not in their answer.
 */
export async function buildPostScoreFeedback(
  input: PostScoreFeedbackInput,
): Promise<PostScoreFeedbackResult> {
  const lang =
    input.language === "malay" ? "Malay" : input.language === "mixed" ? "Mixed English/Malay" : "English";
  const notFullMark = input.score < input.maxScore;
  const usesVisual =
    input.usesVisualFigure ??
    gradingUsesVisualFigure({ question: input.question });
  const evidence = buildEvidenceSummary(input.markBreakdown);
  const isEquationQuestion =
    input.questionAnalysis?.isEquationQuestion === true ||
    input.questionAnalysis?.demandType === "equation";
  const equationPartialWins = isEquationQuestion ? detectEquationPartialWins(input.studentAnswer) : [];
  const missingForPrompt = isEquationQuestion
    ? filterEquationGapsNotInAnswer(input.missingIdeas, input.studentAnswer)
    : input.missingIdeas;

  const system = [
    "Write feedback for a Malaysian SPM student after their answer has already been marked.",
    "MARKING FEEDBACK RULES (binding — score is already final):",
    "- You MUST NOT change the score or imply a different mark total.",
    "- When explaining why a mark was NOT awarded: you MUST quote ONLY from the student's answer, then explain why that wording failed.",
    "- NEVER use rubric or model-answer text to explain a failure.",
    "- When explaining why a mark WAS awarded: you MUST quote the student's phrase that earned it.",
    formatSpmStudentFriendlyRulesBlock(),
    formatPartialCreditBlock(),
    formatCriticalEvidenceRuleBlock(),
    formatFeedbackEvidenceOnlyBlock(),
    isEquationQuestion ? formatEquationFeedbackBlock() : null,
    usesVisual ? formatDiagramImageEvidenceBlock() : null,
    "Return JSON only: { \"feedback\": string, \"modelAnswer\": string | null }.",
    [
      "FEEDBACK (feedback field):",
      "- 2â€“4 short sentences at SPM Form 4/5 level â€” clear, calm, like a helpful teacher.",
      "- Match the student's language style (English, Malay, or mixed).",
      "- Start with what they did well OR why marks were limited (based on the final score only).",
      "- You MUST link comments to the student's actual wording from the evidence section below.",
      "- When explaining why a mark was NOT awarded: quote ONLY from the student's answer (short exact phrase in quotation marks), then explain why that wording did not earn the mark.",
      "- Never use rubric text or model-answer wording to explain a failure — only the student's own words.",
      "- When explaining why a mark WAS awarded: quote the student's phrase that earned it.",
      "- If the student wrote nothing useful for a gap, say what concept was missing without inventing a quote.",
      input.gradingContext?.isCompareQ && input.gradingContext.comparisonSubjects.length >= 2
        ? `- For comparison marks missed: name which entity was not mentioned (${input.gradingContext.comparisonSubjects.join(" / ")}).`
        : null,
      input.gradingContext?.isSeqQ
        ? "- For sequence marks: say whether a stage was missing or in the wrong order — do not treat them the same."
        : null,
      "- Mention at least one correct thing the student wrote when score > 0, and at least one missing/incorrect concept when score < maxScore.",
      "- For partial marks: say which type of point was missing or unclear â€” do not list rubric jargon.",
      isEquationQuestion
        ? "- For zero marks on an equation: your FIRST sentence MUST validate any partial equation parts listed below (formulas, arrows, +, state symbols) before explaining structural failure."
        : "- For zero marks: encourage them to write the science in their own words; never say they were correct.",
      isEquationQuestion && input.score === 0 && equationPartialWins.length > 0
        ? "- Mandatory opening: acknowledge at least one item from EQUATION PARTS ALREADY WRITTEN before any correction."
        : null,
      isEquationQuestion
        ? "- Never ask the student to include a formula, symbol, or arrow that already appears in their answer — validate it."
        : null,
      "- Never claim they mentioned a term or idea unless it appears in the student answer below.",
      "- Never say a concept was missing if the awarded evidence links show it was credited.",
      "- Never ask for a vague umbrella phrase (general protection, safety, unsafe) when the student already stated a specific hazard, injury, or mechanism in their answer.",
      "- Do NOT contradict the student: if they wrote a consequence (hurt, spill, injury, expose), do not say they failed to explain why â€” that consequence IS the explanation.",
      "- Do NOT include a model answer inside feedback â€” use modelAnswer field only.",
    ].join("\n"),
    notFullMark
      ? input.referenceModelAnswer?.trim()
        ? [
            "MODEL ANSWER (modelAnswer field):",
            "- A reference model answer from the textbook is provided below — use it for concepts and mark coverage only.",
            `- Write the modelAnswer field in the student's language (${lang}). Do NOT copy Malay textbook wording if the student wrote English.`,
            lang === "English"
              ? "- Student language is English: modelAnswer MUST be entirely in English (same science as the reference)."
              : lang === "Malay"
                ? "- Student language is Malay: modelAnswer MUST be entirely in Bahasa Melayu."
                : "- Student uses mixed language: prefer English, or EN + BM lines if the question stem is bilingual.",
            "- You MAY shorten or rephrase; MUST keep the same scientific concepts and mark coverage.",
            "- Do NOT contradict the reference or add advanced content beyond maxScore.",
            `Reference model answer (concepts only — rephrase into ${lang}):\n${input.referenceModelAnswer.trim()}`,
          ].join("\n")
        : [
            "MODEL ANSWER (modelAnswer field — required because score < maxScore):",
            "- Write a model answer at EXACTLY SPM Form 4/5 level — not A-Level, not university, not advanced.",
            "- Use only vocabulary, concepts, and depth found in Malaysian SPM textbooks (Form 4/5).",
            "- Keep it concise: match the mark allocation. 1 mark = 1 short point. 2 marks = 2 short points.",
            "- Use simple, direct school English or Bahasa Melayu. Short sentences. No academic jargon.",
            "- Write what a student would write in an exam — not a teacher's explanation or a textbook paragraph.",
            "- Do NOT copy rubric row text verbatim — rephrase in plain student language.",
            "- Do NOT include university-level mechanisms, biochemical pathways, or advanced detail not expected at SPM.",
            "- Do NOT pad with extra information beyond what the marks require.",
            "- Cover only the mark points the student missed (see gaps below) — not a full lesson.",
            "- Do NOT mention diagrams unless the question is about labelling; give the words an examiner expects written.",
            usesVisual
              ? "- This is a diagram/figure question: the model answer must NAME structures/functions/values in words — not 'see the diagram'."
              : null,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
      : "MODEL ANSWER: set modelAnswer to null (student earned full marks).",
    "The score is final â€” wording must agree with it.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const user = [
    `Subject: ${input.subject}`,
    `Language: ${lang}`,
    `Question: ${input.question}`,
    `Student answer: ${input.studentAnswer}`,
    `Score: ${input.score} / ${input.maxScore}`,
    usesVisual ? "This question uses a diagram/figure (marks need written scientific wording)." : null,
    input.questionAnalysis
      ? [
          `Question demand: command=${input.questionAnalysis.commandWord}, type=${input.questionAnalysis.questionType}, demandType=${input.questionAnalysis.demandType}`,
          `Required depth: ${input.questionAnalysis.requiredDepth ?? "n/a"}`,
          `Core concepts: ${(input.questionAnalysis.coreConcepts ?? []).join(" | ") || "(n/a)"}`,
          `Optional details (do not force): ${(input.questionAnalysis.optionalDetails ?? []).join(" | ") || "(none)"}`,
          `Requires examples: ${input.questionAnalysis.requiresExamples === true ? "yes" : "no"}`,
          `Grading strictness: ${input.questionAnalysis.gradingStrictness ?? "moderate"}`,
        ].join("\n")
      : null,
    `Points credited: ${input.matchedIdeas.join(" | ") || "(none)"}`,
    `Gaps / mark points missed: ${missingForPrompt.join(" | ") || "(none)"}`,
    isEquationQuestion && equationPartialWins.length > 0
      ? `EQUATION PARTS ALREADY WRITTEN (validate in feedback — do NOT tell the student to add these again):\n- ${equationPartialWins.join("\n- ")}`
      : null,
    evidence.awardedEvidence.length > 0
      ? `Awarded evidence links:\n- ${evidence.awardedEvidence.join("\n- ")}`
      : "Awarded evidence links: (none)",
    evidence.missedEvidence.length > 0
      ? `Not-awarded evidence links:\n- ${evidence.missedEvidence.join("\n- ")}`
      : "Not-awarded evidence links: (none)",
    input.rubricIdeas?.length ? `Mark scheme ideas: ${input.rubricIdeas.join(" | ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  try {
    // consistency lock: Half B marking pipeline requires temperature 0 (stage 9)
    const parsed = await qwenGradingJson(system, user, { temperature: 0 });
    const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "";
    let modelAnswer: string | undefined;
    if (notFullMark) {
      const raw = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
      if (raw.length > 0) modelAnswer = raw;
    }
    if (feedback.length > 0) {
      let adjusted = isEquationQuestion
        ? softenEquationFeedbackContradictions(feedback, input.studentAnswer)
        : feedback;
      if (isEquationQuestion) {
        adjusted = ensureEquationPartialAcknowledgment(
          adjusted,
          input.studentAnswer,
          input.score,
          input.maxScore,
          input.language,
        );
      }
      return { feedback: adjusted, modelAnswer };
    }
  } catch {
    // fall through
  }
  return { feedback: "" };
}

export function formatFeedbackWithModelAnswer(params: {
  feedback: string;
  modelAnswer?: string;
  score: number;
  maxScore: number;
  language: "english" | "malay" | "mixed";
}): { feedback: string; modelAnswer?: string } {
  const fb = params.feedback.trim();
  if (params.score >= params.maxScore || !params.modelAnswer?.trim()) {
    return { feedback: fb, modelAnswer: undefined };
  }
  const label =
    params.language === "malay"
      ? "Jawapan model"
      : params.language === "mixed"
        ? "Model answer / Jawapan model"
        : "Model answer";
  return {
    feedback: fb,
    modelAnswer: `${label}:\n${params.modelAnswer.trim()}`,
  };
}

export function resolveGradingModelLabel(suffix: string): string {
  try {
    return `${resolveQwenGradingConfig().model}${suffix}`;
  } catch {
    return `qwen-unknown${suffix}`;
  }
}

