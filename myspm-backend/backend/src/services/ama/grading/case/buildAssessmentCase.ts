import { formatSpmStudentFriendlyRulesBlock } from "../shared/gradingPolicy";
import {
  buildModelAnswerQualityRulesBlock,
  buildModelAnswerVerbFormatRulesBlock,
  buildKssmTextbookModelAnswerWordingBlock,
} from "../feedback/modelAnswerFeedbackFormatPolicy";
import { withMandatoryMarkingLanguage } from "../shared/gradingMandatoryLanguage";
import { questionInvitesOpenTopicRecall } from "../shared/gradingPolicy";
import { qwenGradingJson } from "../shared/qwenGradingClient";
import {
  classifyAssessmentIntent,
  defaultMarkRuleKind,
  intentGuidanceForLlm,
} from "../analysis/classifyIntent";
import {
  extractEmbeddedSchemePoints,
  extractJawapanText,
} from "../analysis/markSchemeInference";
import { embeddedSchemeLooksLikeCalculation } from "../analysis/calculationStructureDetect";
import {
  finalizeCalculationAssessmentCase,
  validateAcfTopology,
} from "./calculationAcfPolicy";
import { finalizeAssessmentCase } from "./acfFinalizePolicy";
import { joinPerPointExemplarsForStorage, splitReferenceIntoPointExemplars } from "./perPointModelAnswer";
import {
  applyVerificationToAcf,
  computeEmpiricalFormulaFromComposition,
  parseEmpiricalCompositionQuestion,
  solveCalculationQuestion,
  verifyCalculationReferenceAnswer,
} from "../matching/calculationAnswerVerification";
import { isChemistryCalculationSubject } from "./calculationSubjectPolicy";
import { buildCalculationWorkedModelAnswer } from "./calculationModelAnswer";
import { retrieveEvidenceContext, type RetrievedEvidenceContext } from "./groundingChunks";
import type {
  AssessmentCaseFile,
  AssessmentIntent,
  EvidenceRelation,
  EvidenceUnit,
  MarkRule,
  VerifiedCalculationAnswer,
} from "../shared/types";
import type { QuestionAnalysis } from "../../types";

function distributeCreditWeights(pointCount: number, maxScore: number): number[] {
  const n = Math.max(1, pointCount);
  const total = Math.max(1, maxScore);
  if (n === 1) return [total];
  if (n === total) return Array.from({ length: n }, () => 1);
  // Prefer 1 mark per point; leftover marks go to the last point.
  if (n < total) {
    const weights = Array.from({ length: n }, () => 1);
    weights[n - 1] = total - (n - 1);
    return weights;
  }
  // More points than marks: first `total` points get 1, rest get 0 (supporting).
  return Array.from({ length: n }, (_, i) => (i < total ? 1 : 0));
}

function coreConceptFromPoint(content: string): string {
  const beforeDash = content.split(/\s*[—–-]\s*/)[0]?.trim() || content.trim();
  const words = beforeDash.split(/\s+/).filter(Boolean).slice(0, 5);
  return (words.join(" ") || beforeDash).slice(0, 80);
}

/**
 * Build theory ACF units + model answer from Jawapan / Marking points already in the question.
 * Skips extractEvidence + buildReferenceModelAnswer LLM calls.
 *
 * Scheme-first: prose marking points always become independent theory credit units,
 * even if stem wording looked calculation-like. Calculation-stage schemes return null
 * so the calculation ACF path can build ordered stages.
 */
function tryBuildTheoryEvidenceFromEmbeddedScheme(params: {
  question: string;
  maxScore: number;
  intent: AssessmentIntent;
}): Pick<
  AssessmentCaseFile,
  "assessedUnderstanding" | "units" | "relations" | "markRule" | "referenceModelAnswer"
> | null {
  const points = extractEmbeddedSchemePoints(params.question);
  if (points.length < 1) return null;

  // Calculation-stage schemes (Formula / Working / Final) stay on the calc path.
  if (embeddedSchemeLooksLikeCalculation(points)) return null;

  // One assessable idea per mark: use exactly maxScore units when possible.
  const unitPoints =
    points.length === params.maxScore
      ? points
      : points.length > params.maxScore
        ? points.slice(0, params.maxScore)
        : points;

  const weights = distributeCreditWeights(unitPoints.length, params.maxScore);
  const units: EvidenceUnit[] = unitPoints.map((content, idx) => ({
    id: `u${idx + 1}`,
    type: "fact",
    content,
    coreConcept: coreConceptFromPoint(content),
    aliases: [],
    creditWeight: weights[idx] ?? 0,
    required: (weights[idx] ?? 0) > 0,
  }));

  // Force non-calculation mark rule even if upstream intent was misclassified.
  const theoryFamily =
    params.intent.family === "calculation" ? "explanation" : params.intent.family;
  const openPool =
    questionInvitesOpenTopicRecall(params.question) || theoryFamily === "recall";
  const markRule: MarkRule = {
    kind: defaultMarkRuleKind(theoryFamily, openPool),
    maxMarks: params.maxScore,
    openPool,
  };

  const jawapan = extractJawapanText(params.question)?.trim() || "";
  const referenceModelAnswer =
    jawapan ||
    joinPerPointExemplarsForStorage(unitPoints, params.question);

  return {
    assessedUnderstanding:
      params.intent.family === "calculation"
        ? `Independent marking points from the embedded scheme (${unitPoints.length} unit(s)).`
        : params.intent.assessedUnderstanding,
    units,
    relations: [],
    markRule,
    referenceModelAnswer,
  };
}

function parseUnits(raw: unknown[]): EvidenceUnit[] {
  const out: EvidenceUnit[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const content = typeof row["content"] === "string" ? row["content"].trim() : "";
    if (!content) return;
    const coreConcept = typeof row["coreConcept"] === "string" ? row["coreConcept"].trim() : "";
    const creditWeightRaw = row["creditWeight"];
    const creditWeight =
      typeof creditWeightRaw === "number" && Number.isFinite(creditWeightRaw)
        ? Math.max(0, creditWeightRaw)
        : 1;
    const aliases = Array.isArray(row["aliases"])
      ? row["aliases"].filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean)
      : [];
    const supports = Array.isArray(row["supports"])
      ? row["supports"].filter((s): s is string => typeof s === "string")
      : undefined;
    const typeRaw = typeof row["type"] === "string" ? row["type"] : "fact";
    const type = ["fact", "stage", "claim", "entity", "dimension", "justification"].includes(typeRaw)
      ? (typeRaw as EvidenceUnit["type"])
      : "fact";
    const unit: EvidenceUnit = {
      id: typeof row["id"] === "string" && row["id"].trim() ? row["id"].trim() : `u${idx + 1}`,
      type,
      content,
      aliases,
      creditWeight,
      required: row["required"] === true,
    };
    if (coreConcept) unit.coreConcept = coreConcept;
    if (supports && supports.length > 0) unit.supports = supports;
    out.push(unit);
  });
  return out;
}

function parseRelations(raw: unknown[]): EvidenceRelation[] {
  return raw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const from = typeof row["from"] === "string" ? row["from"].trim() : "";
      const to = typeof row["to"] === "string" ? row["to"].trim() : "";
      if (!from || !to) return null;
      const typeRaw = typeof row["type"] === "string" ? row["type"] : "causes";
      const type = ["causes", "enables", "contrasts", "sequence_next", "justifies", "predicts_from"].includes(typeRaw)
        ? (typeRaw as EvidenceRelation["type"])
        : "causes";
      return {
        id: typeof row["id"] === "string" && row["id"].trim() ? row["id"].trim() : `r${idx + 1}`,
        type,
        from,
        to,
        requiredForMarks: row["requiredForMarks"] !== false,
      } satisfies EvidenceRelation;
    })
    .filter((r): r is EvidenceRelation => r != null);
}

async function buildReferenceModelAnswer(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  excerpt?: string;
  assessedUnderstanding: string;
  units: EvidenceUnit[];
}): Promise<string> {
  const creditUnits = params.units.filter((u) => u.creditWeight > 0);
  if (creditUnits.length === 0) return "";

  const unitLines = creditUnits
    .map((u) => `- [${u.id}] (${u.creditWeight} mark${u.creditWeight === 1 ? "" : "s"}) ${u.content}`)
    .join("\n");
  const totalMarks = creditUnits.reduce((sum, u) => sum + u.creditWeight, 0);

  const system = withMandatoryMarkingLanguage(
    [
      "You MUST write an SPM Form 4/5 reference model answer — one full exemplar sentence per marking point.",
      formatSpmStudentFriendlyRulesBlock(),
      buildModelAnswerQualityRulesBlock(params.maxScore, params.question),
      buildKssmTextbookModelAnswerWordingBlock(),
      buildModelAnswerVerbFormatRulesBlock(params.maxScore, params.question),
      'You MUST return JSON only: { "pointExemplars": string[] }',
      `pointExemplars MUST have exactly ${creditUnits.length} entries — one per marking point below, in the same order.`,
      `These ${creditUnits.length} points total ${totalMarks} mark(s) (question maxScore=${params.maxScore}).`,
      "Each entry MUST be a complete student-facing exemplar for THAT marking point only (not rubric shorthand).",
      "When a marking point is worth more than 1 mark, write a richer exemplar for that single point — do NOT invent extra array entries.",
      "Do NOT collapse multiple marking points into one paragraph — students must see how each mark is earned.",
      "Depth may follow each unit's demand (short fact for State/Define; reasoning for Explain/Why) — still keep one block per unit.",
      "The combined exemplars MUST fully answer the question stem.",
      "You MUST match question language. If evidence excerpt uses formal wording, you MUST simplify to KSSM textbook student phrasing.",
    ].join("\n"),
  );

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Assessed understanding: ${params.assessedUnderstanding}`,
    params.excerpt ? `Evidence:\n${params.excerpt.slice(0, 6000)}` : "",
    `Marking points (write one exemplar per row, same order):\n${unitLines}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallbackFromUnits = () =>
    joinPerPointExemplarsForStorage(
      creditUnits.map((u) => u.content),
      params.question,
    );

  try {
    const parsed = await qwenGradingJson(system, user);
    let rows = Array.isArray(parsed?.pointExemplars)
      ? (parsed.pointExemplars as unknown[])
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter(Boolean)
      : [];

    // Align to rubric unit count — never keep a single blob when multiple marks exist.
    if (rows.length !== creditUnits.length) {
      const blob = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
      if (blob && creditUnits.length > 1) {
        const split = splitReferenceIntoPointExemplars(blob, creditUnits.length, params.question);
        if (split.length === creditUnits.length) rows = split;
      }
    }

    if (rows.length > creditUnits.length) {
      rows = rows.slice(0, creditUnits.length);
    }
    if (rows.length > 0 && rows.length < creditUnits.length) {
      while (rows.length < creditUnits.length) {
        rows.push(creditUnits[rows.length]!.content);
      }
    }

    if (rows.length === creditUnits.length) {
      return joinPerPointExemplarsForStorage(rows, params.question);
    }
  } catch {
    /* fallback */
  }

  return fallbackFromUnits();
}

export async function extractEvidenceForAssessment(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  intent: AssessmentIntent;
  evidenceContext: RetrievedEvidenceContext;
  verifiedCalculationAnswer?: VerifiedCalculationAnswer;
}): Promise<
  Pick<
    AssessmentCaseFile,
    | "assessedUnderstanding"
    | "units"
    | "relations"
    | "markRule"
    | "referenceModelAnswer"
    | "verifiedAt"
    | "verificationMethod"
    | "verificationNote"
  >
> {
  const openPool =
    params.intent.family !== "calculation" &&
    (questionInvitesOpenTopicRecall(params.question) || params.intent.family === "recall");
  const defaultKind = defaultMarkRuleKind(params.intent.family, openPool);
  const guidance = intentGuidanceForLlm(params.intent, params.maxScore, params.question, params.subject);

  const system = withMandatoryMarkingLanguage(
    [
      "You MUST extract syllabus-grounded evidence for SPM assessment — NOT a rubric row list.",
      "You MUST build evidence units and relationships that represent what an examiner would credit.",
      params.intent.family === "calculation"
        ? "CALCULATION questions: you MUST follow calculation guidance exactly. NEVER use coverage_chain."
        : null,
      params.intent.family === "calculation"
        ? "Relation convention: relation.from = prerequisite, relation.to = dependent; dependent.supports lists prerequisite unit ids."
        : null,
      "Supporting facts: creditWeight=0, required=false — MUST NEVER be load-bearing in requiredForMarks relations.",
      'For EVERY unit you MUST also output "coreConcept": the shortest phrase (1–5 words) a student must express to earn this mark — the minimal creditable essence of "content", with no filler, examples, or explanation. Same rule for every subject and question.',
      "",
      'You MUST return JSON only: {',
      '  "assessedUnderstanding": string,',
      '  "markRule": { "kind": "count_distinct_units|coverage_chain|ordered_stages|paired_entities|claim_plus_reason", "openPool": boolean },',
      '  "units": [{ "id", "type", "content", "coreConcept", "aliases", "creditWeight", "required", "supports" }],',
      '  "relations": [{ "id", "type", "from", "to", "requiredForMarks" }]',
      "}",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Intent category: ${params.intent.category}`,
    `Intent family: ${params.intent.family}`,
    "",
    "Guidance:",
    ...guidance.map((g) => `- ${g}`),
    "",
    params.evidenceContext.dskpExcerpt ? `DSKP:\n${params.evidenceContext.dskpExcerpt.slice(0, 3000)}` : "",
    params.evidenceContext.textbookExcerpt
      ? `Textbook evidence:\n${params.evidenceContext.textbookExcerpt.slice(0, 6000)}`
      : "Textbook evidence: (none — use SPM syllabus knowledge)",
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await qwenGradingJson(system, user);
  const assessedUnderstanding =
    typeof parsed?.assessedUnderstanding === "string" && parsed.assessedUnderstanding.trim()
      ? parsed.assessedUnderstanding.trim()
      : params.intent.assessedUnderstanding;

  const units = parseUnits(Array.isArray(parsed?.units) ? parsed.units : []);
  const relations = parseRelations(Array.isArray(parsed?.relations) ? parsed.relations : []);

  if (units.length === 0) {
    throw new Error("Evidence extraction returned no units");
  }

  const ruleRaw = parsed?.markRule && typeof parsed.markRule === "object" ? (parsed.markRule as Record<string, unknown>) : {};
  const kindRaw = typeof ruleRaw["kind"] === "string" ? ruleRaw["kind"] : defaultKind;
  const kind = [
    "count_distinct_units",
    "coverage_chain",
    "ordered_stages",
    "paired_entities",
    "claim_plus_reason",
  ].includes(kindRaw)
    ? (kindRaw as MarkRule["kind"])
    : defaultKind;

  const markRule: MarkRule = {
    kind: params.intent.family === "calculation" && kind === "coverage_chain" ? defaultKind : kind,
    maxMarks: params.maxScore,
    openPool: params.intent.family === "calculation" ? false : ruleRaw["openPool"] === true || openPool,
  };

  let acfSlice = { assessedUnderstanding, units, relations, markRule, referenceModelAnswer: "" as string };

  if (params.intent.family === "calculation") {
    const finalized = finalizeCalculationAssessmentCase({
      v: 3,
      question: params.question,
      subject: params.subject,
      form: params.form,
      maxScore: params.maxScore,
      intent: params.intent,
      assessedUnderstanding,
      units,
      relations,
      markRule,
      chunkRefs: [],
      contextSource: params.evidenceContext.contextSource,
    });
    acfSlice = {
      assessedUnderstanding: finalized.assessedUnderstanding,
      units: finalized.units,
      relations: finalized.relations,
      markRule: finalized.markRule,
      referenceModelAnswer: "",
    };
    const topologyIssues = validateAcfTopology({
      v: 3,
      question: params.question,
      subject: params.subject,
      form: params.form,
      maxScore: params.maxScore,
      intent: params.intent,
      assessedUnderstanding: acfSlice.assessedUnderstanding,
      units: acfSlice.units,
      relations: acfSlice.relations,
      markRule: acfSlice.markRule,
      chunkRefs: [],
      contextSource: params.evidenceContext.contextSource,
    });
    if (topologyIssues.length > 0 && process.env.NODE_ENV === "development") {
      console.warn("[acf:calculation] topology notes after normalization", topologyIssues);
    }
  }

  const isChemCalc =
    params.intent.family === "calculation" && isChemistryCalculationSubject(params.subject);

  const referenceModelAnswer =
    params.intent.family === "calculation" && isChemCalc
      ? ""
      : await buildReferenceModelAnswer({
          question: params.question,
          subject: params.subject,
          form: params.form,
          maxScore: params.maxScore,
          excerpt: params.evidenceContext.mergedExcerpt,
          assessedUnderstanding: acfSlice.assessedUnderstanding,
          units: acfSlice.units,
        });

  let resultAcf = {
    assessedUnderstanding: acfSlice.assessedUnderstanding,
    units: acfSlice.units,
    relations: acfSlice.relations,
    markRule: acfSlice.markRule,
    referenceModelAnswer:
      params.verifiedCalculationAnswer?.referenceModelAnswer || referenceModelAnswer || undefined,
    verifiedAt: params.verifiedCalculationAnswer?.verifiedAt,
    verificationMethod: params.verifiedCalculationAnswer?.verificationMethod,
  };

  if (isChemCalc && params.verifiedCalculationAnswer) {
    return resultAcf;
  }

  if (isChemCalc) {
    const compositionQ = parseEmpiricalCompositionQuestion(params.question);
    const deterministicExpected = compositionQ
      ? computeEmpiricalFormulaFromComposition(compositionQ)
      : null;

    let finalCandidate =
      deterministicExpected ??
      (await solveCalculationQuestion({
        question: params.question,
        subject: params.subject,
        form: params.form,
        textbookExcerpt:
          params.evidenceContext.textbookExcerpt ?? params.evidenceContext.mergedExcerpt,
      }));

    const verification = await verifyCalculationReferenceAnswer({
      question: params.question,
      subject: params.subject,
      form: params.form,
      candidateAnswer: finalCandidate,
      textbookExcerpt: params.evidenceContext.textbookExcerpt ?? params.evidenceContext.mergedExcerpt,
    });

    let workedModelAnswer: string | undefined;
    if (verification.status === "verified" && verification.answer) {
      workedModelAnswer = await buildCalculationWorkedModelAnswer({
        question: params.question,
        subject: params.subject,
        form: params.form,
        maxScore: params.maxScore,
        verifiedFinalAnswer: verification.answer,
        excerpt: params.evidenceContext.mergedExcerpt,
        units: acfSlice.units,
      });
    }

    resultAcf = applyVerificationToAcf(resultAcf, verification, workedModelAnswer);

    if (verification.status === "pending_review" && process.env.NODE_ENV === "development") {
      console.warn("[acf:calculation] reference answer not cached — pending human review", {
        question: params.question.slice(0, 120),
        note: verification.verificationNote,
      });
    }
  }

  return resultAcf;
}

export async function buildAssessmentCaseFile(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  questionAnalysis?: QuestionAnalysis | null;
  seedChunkContent?: string;
  seedChunkRefs?: string[];
  skipRetrieval?: boolean;
  evidenceContext?: RetrievedEvidenceContext;
  verifiedCalculationAnswer?: VerifiedCalculationAnswer;
  chapterFilter?: string;
  chapterHint?: string;
}): Promise<AssessmentCaseFile> {
  const question = params.question.trim();
  const maxScore = Math.max(1, Math.floor(params.maxScore));
  const subject = params.subject.trim() || "General";
  const form = params.form.trim() || "General";

  const intent = classifyAssessmentIntent({
    question,
    subject,
    maxScore,
    questionAnalysis: params.questionAnalysis ?? null,
  });

  // Fast path: AI practice questions already embed Jawapan / Marking points.
  // Skip textbook retrieval + evidence LLM + model-answer LLM.
  const embedded = tryBuildTheoryEvidenceFromEmbeddedScheme({ question, maxScore, intent });
  if (embedded) {
    // Scheme-first: prose Jawapan units win — force theory-family intent for agent routing.
    const theoryIntent: AssessmentIntent =
      intent.family === "calculation"
        ? {
            ...intent,
            category: "explain",
            family: "explanation",
            assessedUnderstanding: embedded.assessedUnderstanding,
          }
        : intent;

    console.info("[acf] embedded mark-scheme fast path", {
      units: embedded.units.length,
      maxScore,
      intent: theoryIntent.family,
      creditWeights: embedded.units.map((u) => u.creditWeight),
    });
    const draft: AssessmentCaseFile = {
      v: 3,
      question,
      subject,
      form,
      maxScore,
      intent: theoryIntent,
      assessedUnderstanding: embedded.assessedUnderstanding,
      units: embedded.units,
      relations: embedded.relations,
      markRule: embedded.markRule,
      referenceModelAnswer: embedded.referenceModelAnswer,
      chunkRefs: params.seedChunkRefs ?? [],
      contextSource: "embedded_mark_scheme",
    };
    return finalizeAssessmentCase(draft);
  }

  const evidenceContext =
    params.evidenceContext ??
    (await retrieveEvidenceContext({
      question,
      subject,
      form,
      maxScore,
      seedChunkContent: params.seedChunkContent,
      seedChunkRefs: params.seedChunkRefs,
      skipRetrieval: params.skipRetrieval,
      chapterFilter: params.chapterFilter,
      chapterHint: params.chapterHint,
    }));

  const extracted = await extractEvidenceForAssessment({
    question,
    subject,
    form,
    maxScore,
    intent,
    evidenceContext,
    verifiedCalculationAnswer: params.verifiedCalculationAnswer,
  });

  const draft: AssessmentCaseFile = {
    v: 3,
    question,
    subject,
    form,
    maxScore,
    intent,
    assessedUnderstanding: extracted.assessedUnderstanding,
    units: extracted.units,
    relations: extracted.relations,
    markRule: extracted.markRule,
    referenceModelAnswer: extracted.referenceModelAnswer,
    chunkRefs: evidenceContext.chunkRefs,
    contextSource: evidenceContext.contextSource,
    verifiedAt: extracted.verifiedAt,
    verificationMethod: extracted.verificationMethod,
    verificationNote: extracted.verificationNote,
  };

  return intent.family === "calculation"
    ? draft
    : finalizeAssessmentCase(draft);
}
