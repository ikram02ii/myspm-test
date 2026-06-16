import { qwenGradingJson } from "../qwenGradingClient";
import type { AssessmentCaseFile, MissingGap, UnderstandingDemonstration } from "./types";

function parseDemonstration(parsed: Record<string, unknown>, acf: AssessmentCaseFile): UnderstandingDemonstration {
  const unitById = new Map(acf.units.map((u) => [u.id, u]));
  const relById = new Map(acf.relations.map((r) => [r.id, r]));

  const unitsDemonstrated = (Array.isArray(parsed["unitsDemonstrated"]) ? parsed["unitsDemonstrated"] : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const unitId = typeof row["unitId"] === "string" ? row["unitId"].trim() : "";
      const quote = typeof row["quote"] === "string" ? row["quote"].trim() : "";
      if (!unitId || !quote) return null;
      return { unitId, quote, valid: row["valid"] !== false };
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
}): Promise<UnderstandingDemonstration> {
  const creditUnits = params.acf.units.filter((u) => u.creditWeight > 0);
  const supportingUnits = params.acf.units.filter((u) => u.creditWeight === 0);

  const system = [
    "You are an SPM examiner evaluating demonstrated understanding against grounded evidence.",
    "Do NOT require students to repeat every supporting fact if the main understanding is shown.",
    "Credit paraphrases, BM/EN equivalents, and concise single-sentence explanations.",
    "Only credit what the student actually wrote — quote their words.",
    "",
    'Return JSON: {',
    '  "unitsDemonstrated": [{ "unitId", "quote", "valid": boolean }],',
    '  "relationsDemonstrated": [{ "relationId", "quote" }],',
    '  "unitsMissing": [{ "unitId", "reason" }],',
    '  "relationsMissing": [{ "relationId", "reason" }],',
    '  "invalidClaims": [{ "text", "reason" }]',
    "}",
  ].join("\n");

  const user = [
    `Question: ${params.question}`,
    `Max marks: ${params.acf.maxScore}`,
    `Assessed understanding: ${params.acf.assessedUnderstanding}`,
    `Intent: ${params.acf.intent.family} / ${params.acf.intent.category}`,
    `Mark rule: ${params.acf.markRule.kind}`,
    "",
    "Creditworthy evidence units:",
    JSON.stringify(
      creditUnits.map((u) => ({ id: u.id, content: u.content, aliases: u.aliases, required: u.required })),
      null,
      0,
    ),
    supportingUnits.length > 0
      ? `Supporting-only units (do NOT require separately):\n${JSON.stringify(supportingUnits.map((u) => ({ id: u.id, content: u.content, supports: u.supports })))}`
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
  return parseDemonstration(parsed ?? {}, params.acf);
}
