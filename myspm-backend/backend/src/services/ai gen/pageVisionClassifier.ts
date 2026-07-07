import { compressImageForVision } from "./compressImageForVision";
import { resolveQwenVisionPair, resolveVisionModel } from "./visionPdfExtract";

export type PageExtractionRoute = "text" | "vision";

export type PageClassification = {
  pageNumber: number;
  route: PageExtractionRoute;
  confidence: number;
  heuristicScore: number;
  reasons: string[];
  textCharCount: number;
};

const DIAGRAM_HINTS =
  /\b(diagram|rajah|figure|fig\.|graph|chart|table|illustration|structure|labelled|labeled|photo|image|sketch|cross[\s-]?section|micrograph)\b/i;

function minTextCharsForTextRoute(): number {
  const raw = Number(process.env["RAG_PAGE_MIN_TEXT_CHARS"] ?? "160");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 160;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && "text" in item && typeof (item as { text?: string }).text === "string") {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function dataUrlForBuffer(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function parseClassifierJson(raw: string): { needsVision: boolean; reason?: string } | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const needsVision =
      obj.needsVision === true ||
      obj.needs_vision === true ||
      /^(true|yes|ya|1)$/i.test(String(obj.needsVision ?? obj.needs_vision ?? "").trim());
    const reason = typeof obj.reason === "string" ? obj.reason.trim() : undefined;
    return { needsVision, reason };
  } catch {
    return null;
  }
}

/**
 * Fast heuristic: decide text-only vs vision extraction from pdf-parse output.
 */
export function classifyPageFromExtractedText(params: {
  pageNumber: number;
  text: string;
}): PageClassification {
  const text = params.text.trim();
  const reasons: string[] = [];
  let score = 0;
  const minChars = minTextCharsForTextRoute();

  if (text.length < minChars) {
    score += 2;
    reasons.push(`sparse_text(${text.length}<${minChars})`);
  }
  if (text.length < 35) {
    score += 2;
    reasons.push("very_low_text_likely_figure_page");
  }
  if (DIAGRAM_HINTS.test(text)) {
    score += 1;
    reasons.push("diagram_keywords_in_extracted_text");
  }
  if (/\bRajah\s+\d+/i.test(text) || /\bFigure\s+\d+/i.test(text)) {
    score += 2;
    reasons.push("explicit_figure_reference");
  }

  const route: PageExtractionRoute = score >= 2 ? "vision" : "text";
  return {
    pageNumber: params.pageNumber,
    route,
    confidence: Math.min(1, score / 4),
    heuristicScore: score,
    reasons,
    textCharCount: text.length,
  };
}

/**
 * Optional VLM yes/no for borderline pages (heuristic score === 1) or when forced.
 */
export async function confirmPageNeedsVisionWithVlm(params: {
  image: Buffer;
  mime?: string;
  pageNumber: number;
}): Promise<{ needsVision: boolean; reason: string }> {
  const { apiKey, baseUrl } = resolveQwenVisionPair();
  const model = resolveVisionModel();
  const mime = params.mime ?? "image/jpeg";

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
            { type: "image_url", image_url: { url: dataUrlForBuffer(params.image, mime) } },
            {
              type: "text",
              text: `This is page ${params.pageNumber} of an SPM textbook or exam PDF.

Does this page contain diagrams, graphs, charts, tables-as-images, microscope photos, or labelled figures where plain text extraction would lose important visual information?

Reply with JSON only: {"needsVision": true|false, "reason": "one short phrase"}`,
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
    throw new Error(rawText.slice(0, 400) || `Vision classify HTTP ${response.status}`);
  }

  const p = parsed as Record<string, unknown>;
  if (!response.ok) {
    const errObj = p?.error as Record<string, unknown> | undefined;
    throw new Error(
      (typeof errObj?.message === "string" && errObj.message) ||
        rawText.slice(0, 400) ||
        `Vision classify failed (${response.status})`,
    );
  }

  const choices = p?.choices as unknown[] | undefined;
  const first = choices?.[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const text = messageContentToString(message?.content).trim();
  const decision = parseClassifierJson(text);
  if (!decision) {
    const lowered = text.toLowerCase();
    return {
      needsVision: /\b(yes|true|ya)\b/.test(lowered),
      reason: text.slice(0, 120) || "vlm_unparsed",
    };
  }
  return { needsVision: decision.needsVision, reason: decision.reason ?? "vlm" };
}

export async function refineBorderlineClassificationWithVlm(params: {
  pageNumber: number;
  classification: PageClassification;
  pagePng: Buffer;
}): Promise<PageClassification> {
  const { buffer, mime } = await compressImageForVision(params.pagePng);
  const vlm = await confirmPageNeedsVisionWithVlm({
    image: buffer,
    mime,
    pageNumber: params.pageNumber,
  });
  return {
    ...params.classification,
    route: vlm.needsVision ? "vision" : "text",
    confidence: vlm.needsVision ? 0.9 : 0.85,
    heuristicScore: params.classification.heuristicScore,
    reasons: [...params.classification.reasons, `vlm:${vlm.reason}`],
  };
}

export function classifyAllPagesFromText(pages: Array<{ pageNumber: number; text: string }>): PageClassification[] {
  return pages.map((page) => classifyPageFromExtractedText(page));
}
