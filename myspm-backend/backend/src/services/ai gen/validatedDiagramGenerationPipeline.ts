/**
 * Four-step validated generation pipeline:
 * 1) Question agent — RAG-grounded question text
 * 2) Diagram classifier agent — per-question needDiagram
 * 3) Diagram generator agent — Qwen Image
 * 4) Relevance validator agent — question + diagram vs RAG; retry whole loop if fail
 */

import { chatCompletion, generateImage } from "./llmProvider";
import {
  buildEducationalDiagramPrompt,
  EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,
  shouldGenerateEducationalDiagrams,
} from "./educationalDiagramService";
import { extractGeneratedQuestionStems } from "./extractQuestionStems";
import type { GenerateImageItem } from "./generateFromRagEnhancements";
import { generateQuestionFromRagContext } from "./ragQuestionGenerator";
import { validateDiagramImageRelevance } from "./diagramVisionValidation";
import { buildAgent4TextValidatorSystemPrompt } from "./diagramValidatorSyllabusPrompts";
import type { RetrievedChunk } from "../rag/types";

export type DiagramPlan = {
  questionIndex: number;
  stem: string;
  needDiagram: boolean;
  imagePrompt: string;
};

export type PipelineValidationResult = {
  approved: boolean;
  score: number;
  feedback: string;
  issues: string[];
};

export type ValidatedDiagramPipelineInput = {
  query: string;
  subject?: string | null;
  hits: RetrievedChunk[];
  generateImage?: boolean;
  imagePrompt?: string | null;
  initialAnswerRaw?: string;
};

export type ValidatedDiagramPipelineResult = {
  answerRaw: string;
  generatedImages: GenerateImageItem[];
  attempts: number;
  validation: PipelineValidationResult | null;
};

function maxPipelineAttempts(): number {
  const raw = Number(process.env["RAG_VALIDATED_GENERATION_MAX_ATTEMPTS"] ?? "3");
  return Number.isFinite(raw) ? Math.max(1, Math.min(5, Math.floor(raw))) : 3;
}

export function isValidatedDiagramPipelineEnabled(
  subject: string | null | undefined,
  generateImage?: boolean,
): boolean {
  if (process.env["RAG_VALIDATED_DIAGRAM_PIPELINE"] === "false") return false;
  return shouldGenerateEducationalDiagrams(subject, "", generateImage);
}

function ragExcerptForValidation(hits: RetrievedChunk[]): string {
  return hits
    .slice(0, 6)
    .map((h, i) => `[${i + 1}] ${h.title}${h.chapter ? ` — ${h.chapter}` : ""}\n${h.content.slice(0, 800)}`)
    .join("\n\n---\n\n");
}

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

export async function classifyDiagramNeedsAgent(params: {
  subject: string;
  query: string;
  answer: string;
  imagePrompt?: string | null;
}): Promise<DiagramPlan[]> {
  const stems = extractGeneratedQuestionStems(params.answer);
  if (stems.length === 0) return [];

  const catalog = stems.map((s) => ({
    questionIndex: s.questionIndex,
    stem: s.stem.slice(0, 600),
  }));

  const system = [
    "You are agent 2 in an SPM question pipeline: diagram necessity classifier.",
    "Questions are already finalized. For EACH question decide if a black-and-white textbook diagram would help.",
    "",
    "CRITICAL — the diagram is a QUESTION STIMULUS, never an answer key:",
    "- The diagram must show ONLY the given scenario, setup, apparatus, or structure the student is asked to READ or INTERPRET.",
    "- NEVER draw, highlight, mark, point to, circle, or otherwise reveal the correct answer.",
    "- Do NOT illustrate the thing the student must identify, name, choose, calculate, or predict.",
    "- If the diagram itself would give away the answer (e.g. 'Which graph shows cooling?' or 'Identify the labelled organelle X'), set needDiagram=false.",
    "- If the question already fully describes the answer in the stem, a diagram is redundant → needDiagram=false.",
    "- Only set needDiagram=true when the diagram provides neutral context the student needs, WITHOUT resolving the question.",
    "",
    'Return JSON only: {"plans":[{"questionIndex":1,"needDiagram":true|false,"imagePrompt":"..."}]}',
    "imagePrompt: when needDiagram=true, one specific silent line-art prompt describing ONLY the neutral setup (no answer, no highlighted/labelled correct part); else empty string.",
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `User topic request: ${params.query}`,
    "Remember: draw only the given setup — the diagram must NOT reveal the correct answer.",
    `Questions:\n${JSON.stringify(catalog, null, 2)}`,
  ].join("\n\n");

  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { subject: params.subject, query: params.query },
    );
    const parsed = parseJsonObject(raw);
    const plansRaw = Array.isArray(parsed?.plans) ? parsed.plans : [];
    const byIndex = new Map<number, DiagramPlan>();

    for (const stem of stems) {
      byIndex.set(stem.questionIndex, {
        questionIndex: stem.questionIndex,
        stem: stem.stem,
        needDiagram: false,
        imagePrompt: "",
      });
    }

    for (const item of plansRaw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const questionIndex = Number(row.questionIndex);
      if (!Number.isInteger(questionIndex) || questionIndex < 1) continue;
      const stem = stems.find((s) => s.questionIndex === questionIndex)?.stem ?? "";
      const needDiagram =
        row.needDiagram === true || /^(true|yes|ya|1)$/i.test(String(row.needDiagram ?? "").trim());
      const imagePrompt =
        typeof row.imagePrompt === "string" && row.imagePrompt.trim()
          ? row.imagePrompt.trim().slice(0, 500)
          : buildEducationalDiagramPrompt({
              subject: params.subject,
              questionStem: stem,
              userQuery: params.query,
              imagePrompt: params.imagePrompt,
            });
      byIndex.set(questionIndex, {
        questionIndex,
        stem,
        needDiagram,
        imagePrompt: needDiagram ? imagePrompt : "",
      });
    }

    return [...byIndex.values()].sort((a, b) => a.questionIndex - b.questionIndex);
  } catch (err) {
    console.warn("[validated-pipeline] diagram classifier failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return stems.map((s) => ({
      questionIndex: s.questionIndex,
      stem: s.stem,
      needDiagram: false,
      imagePrompt: "",
    }));
  }
}

export async function generateDiagramsAgent(params: {
  subject: string;
  plans: DiagramPlan[];
}): Promise<GenerateImageItem[]> {
  const results: GenerateImageItem[] = [];
  for (const plan of params.plans.filter((p) => p.needDiagram && p.imagePrompt.trim())) {
    try {
      const urls = await generateImage(plan.imagePrompt, {
        promptExtend: false,
        n: 1,
        negativePrompt: EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,
      });
      const url = urls[0];
      if (url) {
        results.push({ url, prompt: plan.imagePrompt, questionIndex: plan.questionIndex });
      }
    } catch (err) {
      console.error("[validated-pipeline] diagram generation failed", {
        questionIndex: plan.questionIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function validateQuestionDiagramRelevanceAgent(params: {
  subject: string;
  query: string;
  answer: string;
  hits: RetrievedChunk[];
  plans: DiagramPlan[];
  generatedImages: GenerateImageItem[];
}): Promise<PipelineValidationResult> {
  const stems = extractGeneratedQuestionStems(params.answer);
  const system = buildAgent4TextValidatorSystemPrompt();

  const user = [
    `Subject: ${params.subject}`,
    `User request: ${params.query}`,
    `RAG:\n${ragExcerptForValidation(params.hits).slice(0, 5000)}`,
    `Answer:\n${params.answer.slice(0, 4000)}`,
    `Diagram plans: ${JSON.stringify(params.plans.map((p) => ({ q: p.questionIndex, need: p.needDiagram })))}`,
    `Images: ${JSON.stringify(params.generatedImages.map((i) => ({ q: i.questionIndex, prompt: i.prompt.slice(0, 120) })))}`,
    `Question count: ${stems.length}`,
  ].join("\n\n");

  let textValidation: PipelineValidationResult = {
    approved: false,
    score: 0,
    feedback: "Validator failed",
    issues: ["validator_error"],
  };

  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { subject: params.subject, query: params.query },
    );
    const parsed = parseJsonObject(raw);
    if (parsed) {
      textValidation = {
        approved: parsed.approved === true,
        score: typeof parsed.score === "number" ? parsed.score : parsed.approved === true ? 0.85 : 0.4,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback.trim() : "",
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.filter((i): i is string => typeof i === "string")
          : [],
      };
    }
  } catch (err) {
    textValidation.feedback = err instanceof Error ? err.message : String(err);
  }

  if (!textValidation.approved) return textValidation;

  const imagesByIndex = new Map<number, GenerateImageItem>();
  for (const img of params.generatedImages) {
    if (typeof img.questionIndex === "number") imagesByIndex.set(img.questionIndex, img);
  }

  for (const plan of params.plans) {
    if (!plan.needDiagram) continue;
    const img = imagesByIndex.get(plan.questionIndex);
    if (!img?.url) {
      return {
        approved: false,
        score: 0.3,
        feedback: `Question ${plan.questionIndex} needs a diagram but generation failed.`,
        issues: [`missing_diagram_q${plan.questionIndex}`],
      };
    }
    if (!img.url.startsWith("http") && !img.url.startsWith("data:")) continue;
    try {
      const vision = await validateDiagramImageRelevance({
        questionStem: plan.stem,
        imageUrl: img.url,
        subject: params.subject,
      });
      if (!vision.relevant) {
        return {
          approved: false,
          score: 0.35,
          feedback: `Diagram for Q${plan.questionIndex} mismatches stem (${vision.reason}).`,
          issues: [`diagram_mismatch_q${plan.questionIndex}`],
        };
      }
    } catch (err) {
      console.warn("[validated-pipeline] vision check failed — rejecting", {
        questionIndex: plan.questionIndex,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        approved: false,
        score: 0.2,
        feedback: `Vision check failed for Q${plan.questionIndex}; diagram not verified.`,
        issues: [`vision_check_failed_q${plan.questionIndex}`],
      };
    }
  }

  return textValidation;
}

export async function runValidatedDiagramGenerationPipeline(
  input: ValidatedDiagramPipelineInput,
): Promise<ValidatedDiagramPipelineResult> {
  const subject = input.subject?.trim() ?? "General";
  const maxAttempts = maxPipelineAttempts();
  const retryFeedback: string[] = [];
  let answerRaw = input.initialAnswerRaw?.trim() ?? "";
  let generatedImages: GenerateImageItem[] = [];
  let validation: PipelineValidationResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.info("[validated-pipeline] attempt", { attempt, maxAttempts, subject });

    if (!(attempt === 1 && answerRaw)) {
      answerRaw = await generateQuestionFromRagContext(input.hits, {
        query: input.query,
        subject: input.subject,
        retryFeedback,
      });
    }

    if (!answerRaw.trim()) {
      retryFeedback.push("Empty output — produce parseable Soalan blocks.");
      continue;
    }

    const plans = await classifyDiagramNeedsAgent({
      subject,
      query: input.query,
      answer: answerRaw,
      imagePrompt: input.imagePrompt,
    });
    generatedImages = await generateDiagramsAgent({ subject, plans });
    validation = await validateQuestionDiagramRelevanceAgent({
      subject,
      query: input.query,
      answer: answerRaw,
      hits: input.hits,
      plans,
      generatedImages,
    });

    console.info("[validated-pipeline] validation", {
      attempt,
      approved: validation.approved,
      score: validation.score,
    });

    if (validation.approved) {
      return { answerRaw, generatedImages, attempts: attempt, validation };
    }

    if (validation.feedback) retryFeedback.push(validation.feedback);
    else if (validation.issues.length > 0) retryFeedback.push(validation.issues.join("; "));
  }

  const approved = validation?.approved === true;
  return {
    answerRaw,
    generatedImages: approved ? generatedImages : [],
    attempts: maxAttempts,
    validation,
  };
}
