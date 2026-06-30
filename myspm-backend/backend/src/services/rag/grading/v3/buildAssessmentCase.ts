import { qwenGradingJson } from "../qwenGradingClient";
import { questionInvitesOpenTopicRecall } from "../gradingPolicy";
import {
  classifyAssessmentIntent,
  defaultMarkRuleKind,
  intentGuidanceForLlm,
} from "./classifyIntent";
import {
  finalizeCalculationAssessmentCase,
  validateAcfTopology,
} from "./calculationAcfPolicy";
import { finalizeAssessmentCase } from "./acfFinalizePolicy";
import {
  applyVerificationToAcf,
  computeEmpiricalFormulaFromComposition,
  parseEmpiricalCompositionQuestion,
  solveCalculationQuestion,
  verifyCalculationReferenceAnswer,
} from "./calculationAnswerVerification";
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
} from "./types";
import type { QuestionAnalysis } from "../../types";

function parseUnits(raw: unknown[]): EvidenceUnit[] {
  const out: EvidenceUnit[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const content = typeof row["content"] === "string" ? row["content"].trim() : "";
    if (!content) return;
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
  const unitLines = params.units
    .filter((u) => u.creditWeight > 0)
    .map((u) => `- ${u.content}`)
    .join("\n");

  const system = [
    "Write a short SPM reference model answer.",
    'Return JSON only: { "modelAnswer": string }',
    "Match question language. Rephrase textbook content as a student would write.",
    "A concise answer demonstrating full understanding earns full marks.",
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Assessed understanding: ${params.assessedUnderstanding}`,
    params.excerpt ? `Evidence:\n${params.excerpt.slice(0, 6000)}` : "",
    `Expected evidence units:\n${unitLines}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const ma = typeof parsed?.modelAnswer === "string" ? parsed.modelAnswer.trim() : "";
    if (ma.length > 0) return ma;
  } catch {
    /* fallback */
  }

  return params.units
    .filter((u) => u.creditWeight > 0)
    .slice(0, params.maxScore + 2)
    .map((u) => u.content)
    .join("; ");
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

  const system = [
    "You extract syllabus-grounded evidence for SPM assessment — NOT a rubric row list.",
    "Build evidence units and relationships that represent what an examiner would credit.",
    params.intent.family === "calculation"
      ? "CALCULATION questions: follow calculation guidance exactly. Never use coverage_chain."
      : null,
    params.intent.family === "calculation"
      ? "Relation convention: relation.from = prerequisite, relation.to = dependent; dependent.supports lists prerequisite unit ids."
      : null,
    "Supporting facts: creditWeight=0, required=false — never load-bearing in requiredForMarks relations.",
    "",
    'Return JSON: {',
    '  "assessedUnderstanding": string,',
    '  "markRule": { "kind": "count_distinct_units|coverage_chain|ordered_stages|paired_entities|claim_plus_reason", "openPool": boolean },',
    '  "units": [{ "id", "type", "content", "aliases", "creditWeight", "required", "supports" }],',
    '  "relations": [{ "id", "type", "from", "to", "requiredForMarks" }]',
    "}",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

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
