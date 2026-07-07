import { resolveQwenVisionPair, resolveVisionModel } from "./visionPdfExtract";
import {
  buildAgent4TextValidatorSystemPrompt,
  buildDiagramVisionCheckPromptBody,
  type TemperatureCurveDirection,
} from "./diagramValidatorSyllabusPrompts";

export type { TemperatureCurveDirection } from "./diagramValidatorSyllabusPrompts";

export { buildAgent4TextValidatorSystemPrompt } from "./diagramValidatorSyllabusPrompts";

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
export function buildDiagramVisionCheckPrompt(subject: string, questionStem: string): string {
  return buildDiagramVisionCheckPromptBody(subject, questionStem, inferTemperatureCurveDirection(questionStem));
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

/** Agent 4 vision step: does the generated image match the question stem? */
export async function validateDiagramImageRelevance(params: {
  questionStem: string;
  imageUrl: string;
  subject: string;
}): Promise<{ relevant: boolean; reason: string }> {
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
              text: buildDiagramVisionCheckPrompt(params.subject, params.questionStem),
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
  const relevant =
    decision?.relevant === true || /^(true|yes|ya)$/i.test(String(decision?.relevant ?? "").trim());
  return {
    relevant,
    reason: typeof decision?.reason === "string" ? decision.reason : content.slice(0, 120),
  };
}
