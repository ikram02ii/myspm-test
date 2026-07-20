import { qwenGradingJson } from "../qwenGradingClient";
import { withMandatoryMarkingLanguage } from "../gradingMandatoryLanguage";
import { buildCalculationStagePromptLines, isCalculationIntent } from "./calculationAcfPolicy";
import { resolveCalculationDomain } from "./calculationSubjectPolicy";
import { substantiateUnderstandingDemonstrationWithTrace } from "./udmEvidenceGate";
import {
  isUdmTraceEnabled,
  logUdmTraceStage,
  snapshotUdmTicks,
} from "./udmTickTrace";
import type { AssessmentCaseFile, MissingGap, UnderstandingDemonstration } from "./types";

export function parseUnderstandingDemonstration(
  parsed: Record<string, unknown>,
  acf: AssessmentCaseFile,
): UnderstandingDemonstration {
  const unitById = new Map(acf.units.map((u) => [u.id, u]));
  const relById = new Map(acf.relations.map((r) => [r.id, r]));

  const unitsDemonstrated = (Array.isArray(parsed["unitsDemonstrated"]) ? parsed["unitsDemonstrated"] : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const unitId = typeof row["unitId"] === "string" ? row["unitId"].trim() : "";
      const quote = typeof row["quote"] === "string" ? row["quote"].trim() : "";
      if (!unitId || !quote) return null;
      return { unitId, quote, valid: row["valid"] === true };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const relationsDemonstrated = (Array.isArray(parsed["relationsDemonstrated"]) ? parsed["relationsDemonstrated"] : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const relationId = typeof row["relationId"] === "string" ? row["relationId"].trim() : "";
      const quote = typeof row["quote"] === "string" ? row["quote"].trim() : "";
      if (!relationId || !quote) return null;
      return { relationId, quote };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const unitsMissing: MissingGap[] = [];
  for (const item of Array.isArray(parsed["unitsMissing"]) ? parsed["unitsMissing"] : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["unitId"] === "string" ? row["unitId"].trim() : "";
    if (!id) continue;
    const unit = unitById.get(id);
    const reason = typeof row["reason"] === "string" ? row["reason"].trim() : "Not demonstrated.";
    unitsMissing.push({ id, kind: "unit", label: unit?.content ?? id, reason });
  }

  const relationsMissing: MissingGap[] = [];
  for (const item of Array.isArray(parsed["relationsMissing"]) ? parsed["relationsMissing"] : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["relationId"] === "string" ? row["relationId"].trim() : "";
    if (!id) continue;
    const rel = relById.get(id);
    const reason = typeof row["reason"] === "string" ? row["reason"].trim() : "Link not demonstrated.";
    const label = rel
      ? `${unitById.get(rel.from)?.content ?? rel.from} → ${unitById.get(rel.to)?.content ?? rel.to}`
      : id;
    relationsMissing.push({ id, kind: "relation", label, reason });
  }

  const invalidClaims = (Array.isArray(parsed["invalidClaims"]) ? parsed["invalidClaims"] : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const text = typeof row["text"] === "string" ? row["text"].trim() : "";
      const reason = typeof row["reason"] === "string" ? row["reason"].trim() : "";
      if (!text) return null;
      return { text, reason };
    })
    .filter((x): x is { text: string; reason: string } => x != null);

  return {
    unitsDemonstrated,
    relationsDemonstrated,
    unitsMissing,
    relationsMissing,
    invalidClaims,
  };
}

export async function evaluateUnderstanding(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  textbookExcerpt?: string;
  /** Calc only — expected final for numeric check. Theory grades marking points only. */
  referenceModelAnswer?: string;
}): Promise<UnderstandingDemonstration> {
  const creditUnits = params.acf.units.filter((u) => u.creditWeight > 0);
  const supportingUnits = params.acf.units.filter((u) => u.creditWeight === 0);
  const isCalc = isCalculationIntent(params.acf);
  const reference =
    isCalc
      ? params.referenceModelAnswer?.trim() || params.acf.referenceModelAnswer?.trim() || ""
      : "";

  const markingPointRows = creditUnits.map((u, i) => ({
    mark: i + 1,
    unitId: u.id,
    markingPoint: u.content,
    aliases: u.aliases,
    marksAvailable: u.creditWeight,
  }));

  const calcStageBlock = isCalc
    ? buildCalculationStagePromptLines({
        maxScore: params.acf.maxScore,
        domain: resolveCalculationDomain(params.acf.subject),
        policy: params.acf.markRule.calcPolicy ?? "show_working",
        creditUnits: creditUnits.map((u) => ({ content: u.content, creditWeight: u.creditWeight })),
      }).join("\n")
    : "";

  const system = withMandatoryMarkingLanguage(
    [
      "You are an SPM examiner. Grade by comparing the student answer to EACH marking point independently.",
      "Process: read the question → read the student answer → for EVERY marking point below, decide valid:true or valid:false.",
      "Final score = number of marking points with valid:true (subject to mark rule).",
      "A unit earns valid:true ONLY when the student explicitly shows THAT marking point in their own words.",
      "NEVER compare the student to a full model answer blob — only to each marking point row.",
      "NEVER withhold one point because another point is missing.",
      "Paraphrase with the same scientific meaning is enough when the marking point is explicit.",
      "Set valid:false when that marking point is missing, vague, or factually wrong.",
      "Mark invalidClaims ONLY for clear scientific falsehoods — NEVER for incompleteness.",
      isCalc
        ? calcStageBlock
        : [
            "For EACH marking point: quote the student's words, then set valid:true only if that point is clearly demonstrated.",
            "You MUST set valid:false when the idea is implied, guessed, vague, or missing.",
            "Each valid:true unit MUST include a quote copied from the student answer (not from the rubric).",
          ].join(" "),
    "You MAY credit paraphrases and BM/EN equivalents ONLY when the scientific meaning is explicit in the student's text.",
    "COMPOUND SENTENCES: one student sentence may demonstrate multiple units ONLY when each unit's concept is explicitly written.",
    "PARTIAL CREDIT: reserve valid:true for units clearly demonstrated; most incomplete answers MUST leave units in unitsMissing.",
    "VAGUE ANSWERS: generic phrases without the required scientific term MUST NOT earn valid:true.",
    "COMPARE/DIFFERENCE stems: award EACH named side independently. An answer that correctly covers only one side earns that unit only — NEVER zero the whole answer for missing the other side, and NEVER invent invalidClaims solely for incompleteness.",
    "When the stem requires a fixed set of items (e.g. two nucleus particles), you MUST mark invalidClaims for scientifically wrong items (e.g. electron in nucleus) and MUST NOT credit wrong items even if one correct item is present unless the mark scheme awards partial.",
    "You MUST credit ONLY what the student actually wrote — you MUST quote their words.",
    "",
    'You MUST return JSON only: {',
    '  "unitsDemonstrated": [{ "unitId", "quote", "valid": boolean }],',
    '  "relationsDemonstrated": [{ "relationId", "quote" }],',
    '  "unitsMissing": [{ "unitId", "reason" }],',
    '  "relationsMissing": [{ "relationId", "reason" }],',
    '  "invalidClaims": [{ "text", "reason" }]',
    "}",
    ].join("\n"),
  );

  const user = [
    `Question: ${params.question}`,
    `Max marks: ${params.acf.maxScore}`,
    `Assessed understanding: ${params.acf.assessedUnderstanding}`,
    `Intent: ${params.acf.intent.family} / ${params.acf.intent.category}`,
    `Mark rule: ${params.acf.markRule.kind}`,
    "",
    "Creditworthy marking points — compare student answer to EACH row (SOLE source of marks):",
    JSON.stringify(markingPointRows, null, 0),
    reference
      ? `Expected final / worked reference (calc stages only — not a marking checklist):\n${reference.slice(0, 4000)}`
      : "",
    supportingUnits.length > 0
      ? `Supporting-only units (informational, never required for marks):\n${JSON.stringify(supportingUnits.map((u) => ({ id: u.id, content: u.content, supports: u.supports })))}`
      : "",
    params.acf.relations.length > 0
      ? `Required relationships:\n${JSON.stringify(params.acf.relations, null, 0)}`
      : "",
    params.textbookExcerpt ? `Grounding excerpt:\n${params.textbookExcerpt.slice(0, 4000)}` : "",
    "",
    `Student answer:\n${params.studentAnswer}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await qwenGradingJson(system, user, { temperature: 0 });
  const raw = parseUnderstandingDemonstration(
    parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    params.acf,
  );

  if (isUdmTraceEnabled()) {
    logUdmTraceStage({
      stage: "raw",
      question: params.question,
      rows: snapshotUdmTicks(params.acf, raw),
    });
  }

  const gated = await substantiateUnderstandingDemonstrationWithTrace({
    question: params.question,
    studentAnswer: params.studentAnswer,
    acf: params.acf,
    udm: raw,
  });

  if (isUdmTraceEnabled()) {
    logUdmTraceStage({
      stage: "after_gate",
      question: params.question,
      rows: snapshotUdmTicks(params.acf, gated.udm, gated.failReasons),
    });
  }

  return gated.udm;
}
