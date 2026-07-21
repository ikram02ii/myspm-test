import { resolveQwenVisionPair, resolveVisionModel } from "./visionPdfExtract";
import {
  buildAgent4TextValidatorSystemPrompt,
  buildDiagramVisionCheckPromptBody,
  type TemperatureCurveDirection,
} from "./diagramValidatorSyllabusPrompts";

export type { TemperatureCurveDirection } from "./diagramValidatorSyllabusPrompts";

export { buildAgent4TextValidatorSystemPrompt } from "./diagramValidatorSyllabusPrompts";

export type DiagramVisionValidationResult = {
  relevant: boolean;
  reason: string;
  /** Better image prompt from the vision model when invalid; use for regenerate. */
  newImagePrompt?: string;
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

/** Detect cooling vs heating from question stem (Physics phase-change graphs). */
export function inferTemperatureCurveDirection(stem: string): TemperatureCurveDirection {
  const t = stem.toLowerCase();
  const cooling =
    /\b(cooling curve|cooling|freez(?:e|ing)|solidif|liquid to solid|gas to liquid|heat (?:is )?(?:being )?removed|heat removed|loses heat|temperature (?:drops|decreases|falls|goes down))\b/;
  const heating =
    /\b(heating curve|heating|melt(?:ing)?|boil(?:ing)?|solid to liquid|liquid to gas|heat (?:is )?(?:being )?(?:added|supplied)|heat added|gains heat|temperature (?:rises|increases|goes up))\b/;
  if (cooling.test(t)) return "cooling";
  if (heating.test(t)) return "heating";
  return "neutral";
}

/** Full vision validation prompt (exported for review / tests). */
export function buildDiagramVisionCheckPrompt(
  subject: string,
  questionStem: string,
  topicName?: string | null,
): string {
  return buildDiagramVisionCheckPromptBody(
    subject,
    questionStem,
    inferTemperatureCurveDirection(questionStem),
    topicName,
  );
}

/** Short fix hint for image regeneration after vision rejection. */
export function buildDiagramVisionFixHint(subject: string, questionStem: string, reason: string): string {
  const dir = inferTemperatureCurveDirection(questionStem);
  const s = subject.trim().toLowerCase();
  if (dir === "cooling") {
    return `Fix: ${reason}. Draw a COOLING curve — temperature decreases left-to-right (downward slope), not a heating curve.`;
  }
  if (dir === "heating") {
    return `Fix: ${reason}. Draw a HEATING curve — temperature increases left-to-right (upward slope), not a cooling curve.`;
  }
  if (s === "biology") {
    return `Fix: ${reason}. Match the exact organism/tissue/cell type named in the question (see KSSM Biology syllabus).`;
  }
  if (s === "physics" || s === "science") {
    return `Fix: ${reason}. Match the exact graph, circuit, ray diagram, or apparatus in the Physics syllabus topic.`;
  }
  if (s === "chemistry") {
    return `Fix: ${reason}. Match the correct molecule, ion, or laboratory apparatus for the experiment named.`;
  }
  if (s === "math" || s === "additional math") {
    return `Fix: ${reason}. Graph or geometry must match the equation, coordinates, or construction in the question.`;
  }
  return `Fix: ${reason}. Diagram must match the SPM syllabus topic in the question exactly.`;
}

function parseVisionDecision(decision: Record<string, unknown> | null, fallback: string): DiagramVisionValidationResult {
  if (!decision) {
    return { relevant: false, reason: fallback.slice(0, 120) };
  }

  const relevant =
    decision.is_valid === true ||
    decision.relevant === true ||
    /^(true|yes|ya)$/i.test(String(decision.is_valid ?? decision.relevant ?? "").trim());

  const reasonRaw =
    (typeof decision.error_reason === "string" && decision.error_reason.trim()) ||
    (typeof decision.reason === "string" && decision.reason.trim()) ||
    fallback.slice(0, 120);

  const newImagePrompt =
    typeof decision.new_image_prompt === "string" && decision.new_image_prompt.trim()
      ? decision.new_image_prompt.trim().slice(0, 500)
      : undefined;

  return {
    relevant,
    reason: reasonRaw,
    newImagePrompt: relevant ? undefined : newImagePrompt,
  };
}

/** Agent 4 vision step: does the generated image match the question stem? */
export async function validateDiagramImageRelevance(params: {
  questionStem: string;
  imageUrl: string;
  subject: string;
  topicName?: string | null;
}): Promise<DiagramVisionValidationResult> {
  const { apiKey, baseUrl } = resolveQwenVisionPair();
  const model = resolveVisionModel();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: params.imageUrl } },
            {
              type: "text",
              text: buildDiagramVisionCheckPrompt(params.subject, params.questionStem, params.topicName),
            },
          ],
        },
      ],
    }),
  });

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { relevant: false, reason: "vision_parse_failed" };
  }

  const p = parsed as Record<string, unknown>;
  const choices = p?.choices as unknown[] | undefined;
  const first = choices?.[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  const decision = parseJsonObject(content);
  return parseVisionDecision(decision, content);
}
