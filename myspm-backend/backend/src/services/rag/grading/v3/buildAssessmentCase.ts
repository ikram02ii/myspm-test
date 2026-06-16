import { qwenGradingJson } from "../qwenGradingClient";
import { questionInvitesOpenTopicRecall } from "../gradingPolicy";
import {
  classifyAssessmentIntent,
  defaultMarkRuleKind,
  intentGuidanceForLlm,
} from "./classifyIntent";
import { retrieveEvidenceContext, type RetrievedEvidenceContext } from "./groundingChunks";
import type {
  AssessmentCaseFile,
  AssessmentIntent,
  EvidenceRelation,
  EvidenceUnit,
  MarkRule,
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
}): Promise<Pick<AssessmentCaseFile, "assessedUnderstanding" | "units" | "relations" | "markRule" | "referenceModelAnswer">> {
  const openPool =
    questionInvitesOpenTopicRecall(params.question) || params.intent.family === "recall";
  const defaultKind = defaultMarkRuleKind(params.intent.family, openPool);
  const guidance = intentGuidanceForLlm(params.intent, params.maxScore);

  const system = [
    "You extract syllabus-grounded evidence for SPM assessment — NOT a rubric row list.",
    "Build evidence units and relationships that represent what an examiner would credit.",
    "Do NOT split one explanation chain into mandatory separate credit units.",
    "Supporting facts: creditWeight=0, supports=[parent unit id].",
    "",
    'Return JSON: {',
    '  "assessedUnderstanding": string,',
    '  "markRule": { "kind": "count_distinct_units|coverage_chain|ordered_stages|paired_entities|claim_plus_reason", "openPool": boolean },',
    '  "units": [{ "id", "type", "content", "aliases", "creditWeight", "required", "supports" }],',
    '  "relations": [{ "id", "type", "from", "to", "requiredForMarks" }]',
    "}",
  ].join("\n");

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
    kind,
    maxMarks: params.maxScore,
    openPool: ruleRaw["openPool"] === true || openPool,
  };

  const referenceModelAnswer = await buildReferenceModelAnswer({
    question: params.question,
    subject: params.subject,
    form: params.form,
    maxScore: params.maxScore,
    excerpt: params.evidenceContext.mergedExcerpt,
    assessedUnderstanding,
    units,
  });

  return { assessedUnderstanding, units, relations, markRule, referenceModelAnswer };
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
    }));

  const extracted = await extractEvidenceForAssessment({
    question,
    subject,
    form,
    maxScore,
    intent,
    evidenceContext,
  });

  return {
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
  };
}
