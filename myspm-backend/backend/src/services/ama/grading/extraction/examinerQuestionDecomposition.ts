/**
 * Examiner question decomposition — FIRST step of theory ACF build.
 *
 * Workflow (binding):
 *   Question → decompose (this module) → mark allocation → marking points
 *   → model answer per point → grade student against those points only.
 *
 * The question alone determines requirements and marks. Textbook / model answer
 * must NEVER invent marking points. There are no half-marks: one assessable
 * requirement = one whole mark (unless the stem clearly awards one mark for a
 * combined idea).
 */

import type { QuestionAnalysis } from "../../types";
import { withMandatoryMarkingLanguage } from "../shared/gradingMandatoryLanguage";
import { qwenGradingJson } from "../shared/qwenGradingClient";
import type {
  AssessmentIntent,
  ExaminerMarkingPointPlan,
  ExaminerQuestionDecomposition,
  ExaminerRequirement,
  EvidenceUnit,
} from "../shared/types";
import {
  buildMarkingPointDecompositionGuidance,
  planIdentifyPlusElaborationMarks,
  recommendWholeMarkCountForStem,
} from "../extraction/markingPointDecomposition";
import { parseStemRequiredItemCount } from "../case/acfFinalizePolicy";
import { COMMAND_WORD_DEPTH_POLICY_LINES } from "../agents/classifyIntent";

const DEMAND_KINDS = new Set([
  "fact_recall",
  "reason_mechanism",
  "contrast",
  "importance_application",
  "definition",
  "calculation_stage",
  "general",
]);

function clampMarks(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

function normalizeDemandKind(raw: string): string {
  const s = (raw || "").toLowerCase().trim();
  if (DEMAND_KINDS.has(s)) return s;
  if (/\b(role|function|purpose|importance)\b/.test(s)) return "importance_application";
  if (/\b(explain|reason|mechanism|how|why)\b/.test(s)) return "reason_mechanism";
  if (/\b(compare|contrast|difference)\b/.test(s)) return "contrast";
  if (/\b(define|definition)\b/.test(s)) return "definition";
  if (/\b(identify|name|state|list|recall|fact)\b/.test(s)) return "fact_recall";
  return "general";
}

function unitTypeForDemand(kind: string): EvidenceUnit["type"] {
  switch (kind) {
    case "reason_mechanism":
    case "importance_application":
      return "claim";
    case "contrast":
      return "dimension";
    case "definition":
      return "fact";
    default:
      return "fact";
  }
}

/** Deterministic fallback when the LLM decomposition fails or returns garbage. */
export function buildFallbackExaminerDecomposition(params: {
  question: string;
  maxScore: number;
  analysis?: QuestionAnalysis | null;
  intent?: AssessmentIntent | null;
}): ExaminerQuestionDecomposition {
  const question = params.question.trim();
  const analysis = params.analysis ?? null;
  const identifyPlan = planIdentifyPlusElaborationMarks(question, analysis);
  const itemCount = parseStemRequiredItemCount(question);
  const recommended =
    identifyPlan?.recommendedMaxScore ??
    recommendWholeMarkCountForStem(question, analysis) ??
    clampMarks(params.maxScore);

  if (identifyPlan) {
    const requirements: ExaminerRequirement[] = [
      {
        id: "req1",
        stemFragment: question,
        commandWord: analysis?.commandWord || "identify",
        whatIsAsked: `Identify/name each of the ${identifyPlan.itemCount} required item(s).`,
      },
      {
        id: "req2",
        stemFragment: question,
        commandWord: "explain",
        whatIsAsked: `State the role/function/explanation for each of the ${identifyPlan.itemCount} item(s).`,
      },
    ];
    const markingPoints: ExaminerMarkingPointPlan[] = [];
    for (let i = 0; i < identifyPlan.itemCount; i++) {
      markingPoints.push({
        id: `u${i + 1}`,
        requirementId: "req1",
        demandKind: "fact_recall",
        assessableRequirement: `Correctly identify/name item ${i + 1} required by the stem.`,
        coreConcept: `item ${i + 1} name`,
        marks: 1,
      });
    }
    for (let i = 0; i < identifyPlan.itemCount; i++) {
      markingPoints.push({
        id: `u${identifyPlan.itemCount + i + 1}`,
        requirementId: "req2",
        demandKind: "importance_application",
        assessableRequirement: `State the role/function/explanation for item ${i + 1}.`,
        coreConcept: `item ${i + 1} role`,
        marks: 1,
      });
    }
    return {
      requirements,
      markingPoints,
      recommendedMaxScore: identifyPlan.recommendedMaxScore,
      examinerRationale:
        "Fallback: identify+elaboration stem → one whole mark per name and one whole mark per role/function (no half-marks).",
    };
  }

  const n = clampMarks(
    itemCount != null && itemCount === recommended
      ? itemCount
      : recommended,
  );
  const cmd = analysis?.commandWord || params.intent?.category || "general";
  const markingPoints: ExaminerMarkingPointPlan[] = Array.from({ length: n }, (_, i) => ({
    id: `u${i + 1}`,
    requirementId: "req1",
    demandKind: cmd === "explain" || cmd === "describe" ? "reason_mechanism" : "fact_recall",
    assessableRequirement: `Independent assessable idea ${i + 1} required by the stem.`,
    coreConcept: `idea ${i + 1}`,
    marks: 1,
  }));
  return {
    requirements: [
      {
        id: "req1",
        stemFragment: question,
        commandWord: String(cmd),
        whatIsAsked: params.intent?.assessedUnderstanding || "Answer what the stem asks.",
      },
    ],
    markingPoints,
    recommendedMaxScore: n,
    examinerRationale: "Fallback: one whole mark per independent idea up to the mark budget.",
  };
}

function parseDecomposition(raw: unknown, fallback: ExaminerQuestionDecomposition): ExaminerQuestionDecomposition {
  if (!raw || typeof raw !== "object") return fallback;
  const row = raw as Record<string, unknown>;

  const requirements: ExaminerRequirement[] = Array.isArray(row["requirements"])
    ? row["requirements"]
        .map((item, idx): ExaminerRequirement | null => {
          if (!item || typeof item !== "object") return null;
          const r = item as Record<string, unknown>;
          const whatIsAsked = typeof r["whatIsAsked"] === "string" ? r["whatIsAsked"].trim() : "";
          if (!whatIsAsked) return null;
          return {
            id: typeof r["id"] === "string" && r["id"].trim() ? r["id"].trim() : `req${idx + 1}`,
            stemFragment: typeof r["stemFragment"] === "string" ? r["stemFragment"].trim() : "",
            commandWord: typeof r["commandWord"] === "string" ? r["commandWord"].trim() : "",
            whatIsAsked,
          };
        })
        .filter((x): x is ExaminerRequirement => x != null)
    : [];

  const markingPoints: ExaminerMarkingPointPlan[] = Array.isArray(row["markingPoints"])
    ? row["markingPoints"]
        .map((item, idx): ExaminerMarkingPointPlan | null => {
          if (!item || typeof item !== "object") return null;
          const r = item as Record<string, unknown>;
          const assessableRequirement =
            typeof r["assessableRequirement"] === "string" ? r["assessableRequirement"].trim() : "";
          if (!assessableRequirement) return null;
          const marksRaw = r["marks"];
          const marks =
            typeof marksRaw === "number" && Number.isFinite(marksRaw) ? Math.max(1, Math.floor(marksRaw)) : 1;
          const coreConcept =
            typeof r["coreConcept"] === "string" && r["coreConcept"].trim()
              ? r["coreConcept"].trim().slice(0, 80)
              : assessableRequirement.split(/\s+/).slice(0, 5).join(" ");
          return {
            id: typeof r["id"] === "string" && r["id"].trim() ? r["id"].trim() : `u${idx + 1}`,
            requirementId:
              typeof r["requirementId"] === "string" && r["requirementId"].trim()
                ? r["requirementId"].trim()
                : "req1",
            demandKind: normalizeDemandKind(typeof r["demandKind"] === "string" ? r["demandKind"] : "general"),
            assessableRequirement,
            coreConcept,
            marks,
          };
        })
        .filter((x): x is ExaminerMarkingPointPlan => x != null)
    : [];

  if (markingPoints.length < 1) return fallback;

  // Enforce whole-mark atomicity: prefer 1 mark per point when count matches budget.
  const sumMarks = markingPoints.reduce((s, p) => s + p.marks, 0);
  const recommendedRaw =
    typeof row["recommendedMaxScore"] === "number" && Number.isFinite(row["recommendedMaxScore"])
      ? Math.floor(row["recommendedMaxScore"] as number)
      : sumMarks;
  const recommendedMaxScore = clampMarks(Math.max(sumMarks, recommendedRaw));

  // If LLM merged marks into fewer heavy points, split weights to 1 where possible.
  let points = markingPoints;
  if (sumMarks === recommendedMaxScore && points.every((p) => p.marks === 1)) {
    // already atomic
  } else if (points.length === recommendedMaxScore) {
    points = points.map((p) => ({ ...p, marks: 1 }));
  }

  const rationale =
    typeof row["examinerRationale"] === "string" && row["examinerRationale"].trim()
      ? row["examinerRationale"].trim()
      : fallback.examinerRationale;

  return {
    requirements: requirements.length > 0 ? requirements : fallback.requirements,
    markingPoints: points.map((p, i) => ({ ...p, id: p.id || `u${i + 1}` })),
    recommendedMaxScore: clampMarks(
      points.reduce((s, p) => s + p.marks, 0) || recommendedMaxScore,
    ),
    examinerRationale: rationale,
  };
}

/**
 * LLM examiner decomposition of the question stem ONLY (no textbook).
 * Falls back deterministically if the model fails.
 */
export async function decomposeQuestionAsExaminer(params: {
  question: string;
  subject: string;
  form: string;
  maxScoreHint: number;
  intent: AssessmentIntent;
  questionAnalysis?: QuestionAnalysis | null;
}): Promise<ExaminerQuestionDecomposition> {
  const fallback = buildFallbackExaminerDecomposition({
    question: params.question,
    maxScore: params.maxScoreHint,
    analysis: params.questionAnalysis ?? params.intent.analysis,
    intent: params.intent,
  });

  const structuralHint =
    recommendWholeMarkCountForStem(params.question, params.questionAnalysis ?? params.intent.analysis) ??
    null;
  const guidance = buildMarkingPointDecompositionGuidance(
    params.question,
    structuralHint ?? params.maxScoreHint,
    params.questionAnalysis ?? params.intent.analysis,
  );

  const system = withMandatoryMarkingLanguage(
    [
      "You are an experienced SPM (Malaysia Form 4/5) examiner.",
      "Your ONLY job is QUESTION DECOMPOSITION and MARK ALLOCATION.",
      "Do NOT write a model answer. Do NOT use textbook content. Do NOT invent syllabus facts.",
      "",
      "EXAMINER WORKFLOW (binding — follow in order):",
      "1) Read the question carefully, sentence by sentence / clause by clause.",
      "2) Identify EVERY distinct requirement the student must answer.",
      "3) Split compound questions (e.g. identify AND explain/state roles) into independent requirements.",
      "4) Allocate WHOLE marks to each assessable requirement (there are NO half-marks).",
      "5) Output marking points: one point = one independently awardable requirement.",
      "6) recommendedMaxScore MUST equal the sum of marking-point marks.",
      "",
      "CRITICAL RULES:",
      "- Marking points MUST come from the QUESTION, never from a model answer or textbook.",
      "- NEVER merge two independent requirements into one marking point.",
      "- If the stem asks to identify/name N items AND explain/state roles/functions of each: allocate N name marks + N role/function marks.",
      "- A student who only names the items must be able to earn the name marks without the role marks.",
      "- Prefer creditWeight/marks = 1 per point.",
      "- Match command-word depth: State/Identify = name/term only; Explain = reason; Describe = features as asked.",
      ...COMMAND_WORD_DEPTH_POLICY_LINES,
      "",
      "Structural guidance for THIS stem:",
      ...guidance.map((g) => `- ${g}`),
      structuralHint != null
        ? `Structural whole-mark hint for this stem shape: ${structuralHint} marks (use unless the stem clearly requires a different whole-mark total).`
        : `Client mark hint: ${params.maxScoreHint} (adjust upward if the stem has more independent requirements; never fuse to fit a too-small budget).`,
      "",
      "Return JSON only:",
      "{",
      '  "examinerRationale": string,',
      '  "requirements": [{ "id", "stemFragment", "commandWord", "whatIsAsked" }],',
      '  "markingPoints": [{ "id", "requirementId", "demandKind", "assessableRequirement", "coreConcept", "marks" }],',
      '  "recommendedMaxScore": number',
      "}",
      'demandKind MUST be one of: fact_recall | reason_mechanism | contrast | importance_application | definition | calculation_stage | general',
      "assessableRequirement = what earns the mark (examiner requirement), NOT a full exemplar sentence.",
      "coreConcept = shortest phrase (1–5 words) the student must express for that mark.",
    ].join("\n"),
  );

  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `Question: ${params.question}`,
    `Intent family: ${params.intent.family}`,
    `Intent category: ${params.intent.category}`,
    `Command word: ${params.intent.analysis?.commandWord ?? "unknown"}`,
    `Is compound: ${params.intent.isCompound ? "yes" : "no"}`,
  ].join("\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const decomp = parseDecomposition(parsed, fallback);
    // Prefer structural identify+elaboration plan when LLM under-allocated.
    if (
      structuralHint != null &&
      decomp.recommendedMaxScore < structuralHint &&
      fallback.recommendedMaxScore >= structuralHint
    ) {
      console.info("[acf] examiner decomposition under-allocated — using structural fallback", {
        llmMarks: decomp.recommendedMaxScore,
        structuralHint,
      });
      return fallback;
    }
    console.info("[acf] examiner question decomposition", {
      requirements: decomp.requirements.length,
      markingPoints: decomp.markingPoints.length,
      recommendedMaxScore: decomp.recommendedMaxScore,
      rationale: decomp.examinerRationale.slice(0, 160),
    });
    return decomp;
  } catch (err) {
    console.warn("[acf] examiner decomposition failed — using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

/** Convert examiner marking points into ACF evidence units (scoring substrate). */
export function unitsFromExaminerDecomposition(
  decomp: ExaminerQuestionDecomposition,
): EvidenceUnit[] {
  return decomp.markingPoints.map((p, idx) => ({
    id: p.id || `u${idx + 1}`,
    type: unitTypeForDemand(p.demandKind),
    content: p.assessableRequirement,
    coreConcept: p.coreConcept,
    aliases: [],
    creditWeight: Math.max(1, p.marks),
    required: true,
  }));
}

/** Prompt block: binding examiner plan for downstream unit enrichment / model answer. */
export function formatExaminerDecompositionForPrompt(decomp: ExaminerQuestionDecomposition): string {
  const reqLines = decomp.requirements.map(
    (r) => `- [${r.id}] (${r.commandWord}) ${r.whatIsAsked}${r.stemFragment ? ` ← "${r.stemFragment}"` : ""}`,
  );
  const mpLines = decomp.markingPoints.map(
    (p) =>
      `- [${p.id}] (${p.marks} mark, ${p.demandKind}, from ${p.requirementId}) ${p.assessableRequirement} | coreConcept: "${p.coreConcept}"`,
  );
  return [
    "BINDING EXAMINER QUESTION DECOMPOSITION (from the question ONLY — do NOT invent new marks from textbook):",
    `Recommended total marks: ${decomp.recommendedMaxScore}`,
    `Rationale: ${decomp.examinerRationale}`,
    "Requirements:",
    ...reqLines,
    "Marking points (create exactly these credit units, same order/ids):",
    ...mpLines,
    "Workflow reminder: Question → decomposition → mark allocation → marking points → model answer → grade against marking points only.",
  ].join("\n");
}
