import { qwenGradingJson } from "../shared/qwenGradingClient";
import { withMandatoryMarkingLanguage } from "../shared/gradingMandatoryLanguage";
import { buildCalculationStagePromptLines, isCalculationIntent } from "../case/calculationAcfPolicy";
import { resolveCalculationDomain } from "../case/calculationSubjectPolicy";
import { substantiateUnderstandingDemonstrationWithTrace } from "../matching/udmEvidenceGate";
import { mergeLlmTicksWithClauseScan, scanGroundedEvidenceSpans } from "../matching/clauseEvidenceScan";
import {
  isUdmTraceEnabled,
  logUdmTraceStage,
  snapshotUdmTicks,
} from "../shared/udmTickTrace";
import { buildTheoryEvaluationSystemLines } from "../prompts/theory/evaluateUnderstandingPrompt";
import { answerDepthDirectiveForIntent } from "../agents/classifyIntent";
import type { AssessmentCaseFile, MissingGap, UnderstandingDemonstration } from "../shared/types";

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
  /** Prior question steps / context for multi-part questions (context-aware grading). */
  questionContext?: string;
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
    buildTheoryEvaluationSystemLines({
      isCalc,
      calcStageBlock,
      depthLines: isCalc ? [] : answerDepthDirectiveForIntent(params.acf.intent),
    }).join("\n"),
  );

  const questionContext = params.questionContext?.trim();

  const user = [
    `Question: ${params.question}`,
    questionContext
      ? `Earlier parts / context already established in this question (CONTEXT-AWARE MARKING: do NOT mark a point as missing just because it was already given, asked, or answered in these earlier parts — grade only what THIS part requires):\n${questionContext.slice(0, 2000)}`
      : "",
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

  // Safety net (theory only): merge deterministic grounded spans so under-marking
  // does not occur when the LLM misses an obvious quote. Calc stages stay LLM+numeric.
  let proposed = raw;
  if (!isCalc) {
    const scanHits = scanGroundedEvidenceSpans({
      studentAnswer: params.studentAnswer,
      creditUnits,
    });
    const mergedTicks = mergeLlmTicksWithClauseScan({
      studentAnswer: params.studentAnswer,
      creditUnits,
      llmTicks: raw.unitsDemonstrated,
      scanHits,
    });
    if (scanHits.length > 0) {
      console.info("[grade:clauseScan]", {
        hits: scanHits.map((h) => ({
          unitId: h.unitId,
          coverRatio: Number(h.coverRatio.toFixed(3)),
          quote: h.quote.slice(0, 120),
        })),
        llmValidBefore: raw.unitsDemonstrated.filter((d) => d.valid).length,
        mergedValid: mergedTicks.filter((d) => d.valid).length,
      });
    }
    proposed = {
      ...raw,
      unitsDemonstrated: mergedTicks,
    };
  }

  const gated = await substantiateUnderstandingDemonstrationWithTrace({
    question: params.question,
    studentAnswer: params.studentAnswer,
    acf: params.acf,
    udm: proposed,
    questionContext,
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
