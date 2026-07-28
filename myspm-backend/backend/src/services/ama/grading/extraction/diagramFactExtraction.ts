/**
 * Vision / diagram fact extraction for grading context only.
 * Never awards marks — enrich retrieval and rubric context.
 */
import type {
  DiagramArrow,
  DiagramAxes,
  DiagramContext,
  DiagramDataPoint,
  DiagramKeyValue,
  DiagramLabel,
  DiagramType,
} from "../../types";
import { formatDiagramContextRubricOnlyPreamble } from "../shared/gradingPolicy";

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model =
    process.env["QWEN_GRADING_MODEL"]?.trim() || process.env["QWEN_MODEL"]?.trim() || "qwen-plus";

  if (!apiKey || !baseUrl) {
    throw new Error("Qwen grading is not configured (set QWEN_GRADING_API_KEY/BASE_URL or reuse QWEN_OCR_*).");
  }

  return { apiKey, baseUrl, model };
}

function normalizeDiagramDataUrl(imageBase64: string): string {
  const trimmed = imageBase64.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}

const DIAGRAM_TYPES: ReadonlySet<DiagramType> = new Set<DiagramType>([
  "biology_organ",
  "biology_process",
  "physics_circuit",
  "physics_ray",
  "physics_mechanics",
  "chemistry_apparatus",
  "chemistry_reaction",
  "graph",
  "table",
  "geometry",
  "other",
]);

function clamp01(value: number, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : trimmed;
  }
  return null;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value.trim());
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function sanitizeDiagramLabels(value: unknown): DiagramLabel[] {
  if (!Array.isArray(value)) return [];
  const out: DiagramLabel[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = asTrimmedString(r["id"] ?? r["label"] ?? r["letter"]);
    const refersTo = asTrimmedString(r["refersTo"] ?? r["refers_to"] ?? r["name"] ?? r["meaning"]);
    if (!id || !refersTo) continue;
    const confidenceRaw = typeof r["confidence"] === "number" ? r["confidence"] : Number(r["confidence"]);
    const confidence = clamp01(confidenceRaw, 0.7);
    out.push({ id: id.slice(0, 16), refersTo: refersTo.slice(0, 120), confidence });
  }
  return out.slice(0, 24);
}

function sanitizeAxis(value: unknown): NonNullable<DiagramAxes["x"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const quantity = asTrimmedString(r["quantity"] ?? r["label"] ?? r["name"]);
  if (!quantity) return undefined;
  const unit = asTrimmedString(r["unit"] ?? r["units"]);
  const min = asOptionalNumber(r["min"]);
  const max = asOptionalNumber(r["max"]);
  return {
    quantity: quantity.slice(0, 80),
    ...(unit ? { unit: unit.slice(0, 24) } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function sanitizeAxes(value: unknown): DiagramAxes | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const x = sanitizeAxis(r["x"]);
  const y = sanitizeAxis(r["y"]);
  if (!x && !y) return undefined;
  return { ...(x ? { x } : {}), ...(y ? { y } : {}) };
}

function sanitizeDataPoints(value: unknown): DiagramDataPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramDataPoint[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const x = asNumberOrString(r["x"]);
    const y = asNumberOrString(r["y"]);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  return out.length > 0 ? out.slice(0, 50) : undefined;
}

function sanitizeArrows(value: unknown): DiagramArrow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramArrow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const from = asTrimmedString(r["from"]);
    const to = asTrimmedString(r["to"]);
    if (!from || !to) continue;
    const meaning = asTrimmedString(r["meaning"]);
    out.push({
      from: from.slice(0, 80),
      to: to.slice(0, 80),
      ...(meaning ? { meaning: meaning.slice(0, 120) } : {}),
    });
  }
  return out.length > 0 ? out.slice(0, 16) : undefined;
}

function sanitizeKeyValues(value: unknown): DiagramKeyValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DiagramKeyValue[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = asTrimmedString(r["name"]);
    const valueField = asNumberOrString(r["value"]);
    if (!name || valueField === null) continue;
    const unit = asTrimmedString(r["unit"] ?? r["units"]);
    out.push({
      name: name.slice(0, 60),
      value: valueField,
      ...(unit ? { unit: unit.slice(0, 24) } : {}),
    });
  }
  return out.length > 0 ? out.slice(0, 24) : undefined;
}

function sanitizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const text = asTrimmedString(raw);
    if (text) out.push(text.slice(0, 240));
  }
  return out.slice(0, max);
}

/**
 * Parse a model reply into a typed DiagramContext. Returns null if the reply
 * is not parseable JSON or contains no usable content (caller may then build
 * a prose fallback).
 */
function parseDiagramContext(rawText: string): DiagramContext | null {
  const jsonText = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const rawType = asTrimmedString(obj["diagramType"] ?? obj["type"]).toLowerCase();
  const diagramType: DiagramType = DIAGRAM_TYPES.has(rawType as DiagramType)
    ? (rawType as DiagramType)
    : "other";

  const summary = asTrimmedString(obj["summary"] ?? obj["description"]).slice(0, 800);
  const labels = sanitizeDiagramLabels(obj["labels"]);
  const axes = sanitizeAxes(obj["axes"]);
  const dataPoints = sanitizeDataPoints(obj["dataPoints"] ?? obj["data_points"]);
  const arrows = sanitizeArrows(obj["arrows"]);
  const keyValues = sanitizeKeyValues(obj["keyValues"] ?? obj["key_values"]);
  const observations = sanitizeStringList(obj["observations"], 12);
  const ambiguities = sanitizeStringList(obj["ambiguities"], 6);
  const confidenceRaw = typeof obj["confidence"] === "number" ? obj["confidence"] : Number(obj["confidence"]);
  const confidence = clamp01(confidenceRaw, 0.6);

  const hasContent =
    summary.length > 0 ||
    labels.length > 0 ||
    !!axes ||
    !!dataPoints ||
    !!arrows ||
    !!keyValues ||
    observations.length > 0;
  if (!hasContent) return null;

  return {
    diagramType,
    summary,
    labels,
    ...(axes ? { axes } : {}),
    ...(dataPoints ? { dataPoints } : {}),
    ...(arrows ? { arrows } : {}),
    ...(keyValues ? { keyValues } : {}),
    observations,
    ...(ambiguities.length > 0 ? { ambiguities } : {}),
    confidence,
  };
}

/**
 * Render a DiagramContext as a compact, human-readable block. Used both for
 * the grader prompt (so it can mark against typed fields) and as the
 * back-compat string returned to API clients that still expect prose.
 */
function renderDiagramContextForGrader(d: DiagramContext): string {
  const lines: string[] = [];
  lines.push(`Diagram type: ${d.diagramType} (vision confidence: ${d.confidence.toFixed(2)})`);
  if (d.summary) lines.push(`Summary: ${d.summary}`);
  if (d.labels.length > 0) {
    lines.push("Labels:");
    for (const label of d.labels) {
      lines.push(`  - ${label.id} = ${label.refersTo} (conf: ${label.confidence.toFixed(2)})`);
    }
  }
  if (d.axes?.x || d.axes?.y) {
    if (d.axes.x) {
      const x = d.axes.x;
      const range = x.min != null && x.max != null ? ` [${x.min} to ${x.max}]` : "";
      lines.push(`X-axis: ${x.quantity}${x.unit ? ` (${x.unit})` : ""}${range}`);
    }
    if (d.axes.y) {
      const y = d.axes.y;
      const range = y.min != null && y.max != null ? ` [${y.min} to ${y.max}]` : "";
      lines.push(`Y-axis: ${y.quantity}${y.unit ? ` (${y.unit})` : ""}${range}`);
    }
  }
  if (d.dataPoints && d.dataPoints.length > 0) {
    const shown = d.dataPoints.slice(0, 16).map((p) => `(${p.x}, ${p.y})`).join(", ");
    const more = d.dataPoints.length > 16 ? `, ... (+${d.dataPoints.length - 16} more)` : "";
    lines.push(`Data points: ${shown}${more}`);
  }
  if (d.arrows && d.arrows.length > 0) {
    lines.push("Arrows:");
    for (const arrow of d.arrows.slice(0, 10)) {
      lines.push(`  - ${arrow.from} -> ${arrow.to}${arrow.meaning ? `: ${arrow.meaning}` : ""}`);
    }
  }
  if (d.keyValues && d.keyValues.length > 0) {
    lines.push("Key values:");
    for (const kv of d.keyValues.slice(0, 16)) {
      lines.push(`  - ${kv.name} = ${kv.value}${kv.unit ? ` ${kv.unit}` : ""}`);
    }
  }
  if (d.observations.length > 0) {
    lines.push("Observations:");
    for (const obs of d.observations.slice(0, 8)) lines.push(`  - ${obs}`);
  }
  if (d.ambiguities && d.ambiguities.length > 0) {
    lines.push(`Ambiguities (use cautiously): ${d.ambiguities.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Fallback when the vision model returns prose instead of JSON. Wraps the
 * prose in a minimal DiagramContext with low confidence so downstream code
 * always sees a typed object.
 */
function buildDiagramFallbackFromProse(prose: string): DiagramContext {
  const summary = prose.replace(/\s+/g, " ").trim().slice(0, 800);
  return {
    diagramType: "other",
    summary,
    labels: [],
    observations: [],
    confidence: 0.3,
  };
}

function buildEnrichedRetrievalQuery(question: string, diagram?: DiagramContext): string {
  if (!diagram) return question;

  const parts: string[] = [question];
  if (diagram.summary) parts.push(diagram.summary);

  if (diagram.labels.length > 0) {
    const labelPairs = diagram.labels.map((label) => `${label.id}=${label.refersTo}`).join(", ");
    parts.push(`Diagram labels: ${labelPairs}`);
  }

  if (diagram.keyValues && diagram.keyValues.length > 0) {
    const kvPairs = diagram.keyValues
      .map((kv) => `${kv.name}=${kv.value}${kv.unit ? ` ${kv.unit}` : ""}`)
      .join(", ");
    parts.push(`Key values: ${kvPairs}`);
  }

  if (diagram.axes?.x || diagram.axes?.y) {
    const axisParts: string[] = [];
    if (diagram.axes.x) axisParts.push(`x=${diagram.axes.x.quantity}${diagram.axes.x.unit ? ` (${diagram.axes.x.unit})` : ""}`);
    if (diagram.axes.y) axisParts.push(`y=${diagram.axes.y.quantity}${diagram.axes.y.unit ? ` (${diagram.axes.y.unit})` : ""}`);
    parts.push(`Axes: ${axisParts.join(", ")}`);
  }

  if (diagram.observations.length > 0) {
    parts.push(`Observations: ${diagram.observations.slice(0, 4).join("; ")}`);
  }

  return parts.join("\n").slice(0, 1200);
}

function buildDiagramSystemPromptForSubject(subject?: string): string {
  const base = [
    "You are an SPM exam vision assistant. Convert the diagram, table, chart, or labelled figure into a STRUCTURED JSON object that an automated marker can consume directly.",
    "Return JSON ONLY (no prose, no code fences, no markdown).",
    "JSON schema (omit fields you cannot determine; never invent):",
    "{",
    '  "diagramType": "biology_organ" | "biology_process" | "physics_circuit" | "physics_ray" | "physics_mechanics" | "chemistry_apparatus" | "chemistry_reaction" | "graph" | "table" | "geometry" | "other",',
    '  "summary": "1-2 sentence plain summary of what the figure shows",',
    '  "labels": [{ "id": "P", "refersTo": "phloem", "confidence": 0.0-1.0 }],',
    '  "axes": { "x": { "quantity": "time", "unit": "s", "min": 0, "max": 10 }, "y": { ... } },',
    '  "dataPoints": [{ "x": 0, "y": 0 }, { "x": 1, "y": 2 }],',
    '  "arrows": [{ "from": "sun", "to": "leaf", "meaning": "light energy" }],',
    '  "keyValues": [{ "name": "R1", "value": 4, "unit": "ohm" }],',
    '  "observations": ["graph is linear from 0-3s", "slope decreases after 3s"],',
    '  "ambiguities": ["label R unclear, could be retina or rod"],',
    '  "confidence": 0.0-1.0',
    "}",
    "Rules:",
    "- Use the question's subject domain to disambiguate labels; do not guess cross-subject meanings.",
    "- For label letters in the figure, ALWAYS populate `labels[]` with the letter as `id` and the biological/physical/chemical term as `refersTo`.",
    "- For graphs: populate `axes` (with units), and `dataPoints` if discrete points are shown; otherwise leave `dataPoints` out and put trend descriptions into `observations`.",
    "- For circuits: list components in `keyValues` (e.g. R1, V, I) with units.",
    "- If you are unsure, lower the per-label or overall `confidence` and add a note to `ambiguities` â€” DO NOT guess.",
    "- If the visual is irrelevant to the question, return `{ \"diagramType\": \"other\", \"summary\": \"No relevant diagram context.\", \"labels\": [], \"observations\": [], \"confidence\": 0.1 }`.",
    "- In `summary`, `observations`, and `ambiguities`, use short plain language Form 4/5 students can read (no university-style phrasing).",
  ];

  const normalized = (subject || "").trim().toLowerCase();
  let subjectHint: string | null = null;
  if (normalized === "biology") {
    subjectHint =
      "Subject hint: Biology. Likely diagrams = organs, tissues, cells, processes (photosynthesis, respiration, transport). Map letters to biological terms in BM or EN as shown in SPM textbooks.";
  } else if (normalized === "physics") {
    subjectHint =
      "Subject hint: Physics. Likely diagrams = circuits (V, I, R), ray diagrams (object, image, focal length), mechanics (forces, vectors), graphs (v-t, s-t).";
  } else if (normalized === "chemistry") {
    subjectHint =
      "Subject hint: Chemistry. Likely diagrams = apparatus (delivery tube, gas jar), reactions, electrolysis (anode/cathode), graphs (rate vs time, pH).";
  } else if (
    normalized === "mathematics" ||
    normalized === "additional mathematics" ||
    normalized === "add math" ||
    normalized === "matematik" ||
    normalized === "matematik tambahan"
  ) {
    subjectHint =
      "Subject hint: Mathematics. Likely diagrams = graphs of functions, geometric figures, statistical charts. Capture intercepts, turning points, asymptotes in `keyValues` and trends in `observations`.";
  }

  if (subjectHint) base.push(subjectHint);
  return base.join("\n");
}

async function generateDiagramContextWithQwen(params: {
  question: string;
  subject?: string;
  imageUrl?: string;
  imageBase64?: string;
}): Promise<{ diagram: DiagramContext; rawText: string; model: string }> {
  const config = resolveQwenConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const configuredVisionModel =
    process.env["QWEN_VISION_MODEL"]?.trim() ||
    process.env["QWEN_GRADING_VISION_MODEL"]?.trim() ||
    "qwen-vl-plus";
  const fallbackVisionModel = process.env["QWEN_VISION_FALLBACK_MODEL"]?.trim() || "qwen-vl-plus";

  const imageRef = params.imageUrl?.trim() || (params.imageBase64 ? normalizeDiagramDataUrl(params.imageBase64) : "");
  if (!imageRef) {
    throw new Error("diagram image is missing");
  }

  const modelCandidates = [configuredVisionModel];
  if (!modelCandidates.includes(fallbackVisionModel)) {
    modelCandidates.push(fallbackVisionModel);
  }

  const maxTokensRaw = Number(process.env["QWEN_VISION_MAX_TOKENS"]?.trim());
  const maxTokens = Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? Math.floor(maxTokensRaw) : 900;

  let lastError: string | null = null;
  const startedAt = Date.now();
  for (const model of modelCandidates) {
    const payload = {
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildDiagramSystemPromptForSubject(params.subject),
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageRef } },
            {
              type: "text",
              text: [
                `Subject: ${params.subject?.trim() || "General"}`,
                "Question:",
                params.question.slice(0, 1200),
                "",
                "Return compact DiagramContext JSON only. Keep summary ≤2 sentences; labels ≤12; observations ≤6. JSON ONLY.",
              ].join("\n"),
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(rawText);
    } catch {
      lastError = rawText.slice(0, 500) || `Qwen diagram context failed (${response.status})`;
      continue;
    }

    if (!response.ok) {
      const message =
        parsedResponse?.error?.message ||
        parsedResponse?.message ||
        (typeof parsedResponse?.error === "string" ? parsedResponse.error : null) ||
        rawText.slice(0, 500) ||
        `Qwen diagram context failed (${response.status})`;

      // Retry another model only for access/not-found issues.
      const modelMissing = /does not exist|not found|no access|unauthorized|forbidden/i.test(message || "");
      if (modelMissing) {
        lastError = message;
        continue;
      }
      throw new Error(message);
    }

    const content = parsedResponse?.choices?.[0]?.message?.content;
    const rawReply = messageContentToString(content).trim();
    if (!rawReply) {
      lastError = "Diagram context generation returned empty text.";
      continue;
    }

    const parsedDiagram = parseDiagramContext(rawReply);
    const diagram = parsedDiagram ?? buildDiagramFallbackFromProse(rawReply);
    console.info("[rag][grade] vision extract timing", {
      model,
      elapsedMs: Date.now() - startedAt,
      rawLength: rawReply.length,
      maxTokens,
    });
    return { diagram, rawText: rawReply, model };
  }

  throw new Error(lastError || "Qwen diagram context failed for all candidate vision models.");
}

export {
  generateDiagramContextWithQwen,
  renderDiagramContextForGrader,
  buildEnrichedRetrievalQuery,
};
