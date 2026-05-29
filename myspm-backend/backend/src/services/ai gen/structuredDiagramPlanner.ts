import { chatCompletion } from "./llmProvider";
import { extractGeneratedQuestionStems } from "./extractQuestionStems";

export type BiologyCellFocusLabel =
  | "cellWall"
  | "cellMembrane"
  | "vacuole"
  | "chloroplast"
  | "nucleus"
  | "cytoplasm";

export type StructuredQuestionDiagram =
  | {
      type: "biology-cell";
      questionIndex: number;
      title?: string;
      subtitle?: string;
      layout: "plant" | "animal" | "comparison";
      state?: "normal" | "hypotonic" | "hypertonic";
      focusLabels?: BiologyCellFocusLabel[];
    };

type DiagramTarget = {
  questionIndex: number;
  stem: string;
};

function shouldPlanBiologyDiagramFromStem(stem: string): boolean {
  return /\b(cell|cells|organelle|osmosis|plasmolys|turgid|hypertonic|hypotonic|plant cell|animal cell|cell wall|cell membrane|plasma membrane|chloroplast|vacuole|nucleus|golgi|mitochondr|compare|comparison)\b/i.test(
    stem,
  );
}

function normalizePlannerJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutFences = trimmed.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

  const candidates = [withoutFences];
  const arrStart = withoutFences.indexOf("[");
  const arrEnd = withoutFences.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    candidates.push(withoutFences.slice(arrStart, arrEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function normalizeFocusLabel(input: unknown): BiologyCellFocusLabel | undefined {
  const raw = String(input ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!raw) return undefined;
  if (raw === "cellwall" || raw === "wall") return "cellWall";
  if (raw === "cellmembrane" || raw === "membrane" || raw === "plasmamembrane") return "cellMembrane";
  if (raw === "vacuole" || raw === "centralvacuole") return "vacuole";
  if (raw === "chloroplast" || raw === "chloroplasts") return "chloroplast";
  if (raw === "nucleus" || raw === "nuclei") return "nucleus";
  if (raw === "cytoplasm") return "cytoplasm";
  return undefined;
}

function normalizeStructuredDiagram(raw: unknown, allowedIndexes: Set<number>): StructuredQuestionDiagram | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const type = String(obj.type ?? "").trim().toLowerCase();
  if (type !== "biology-cell") return undefined;

  const questionIndex = Number(obj.questionIndex);
  if (!Number.isInteger(questionIndex) || !allowedIndexes.has(questionIndex)) return undefined;

  const layoutRaw = String(obj.layout ?? "").trim().toLowerCase();
  const layout =
    layoutRaw === "plant" || layoutRaw === "animal" || layoutRaw === "comparison"
      ? layoutRaw
      : undefined;
  if (!layout) return undefined;

  const stateRaw = String(obj.state ?? "").trim().toLowerCase();
  const state =
    stateRaw === "normal" || stateRaw === "hypotonic" || stateRaw === "hypertonic"
      ? stateRaw
      : undefined;

  const focusLabels = Array.isArray(obj.focusLabels)
    ? obj.focusLabels
        .map((item) => normalizeFocusLabel(item))
        .filter((item): item is BiologyCellFocusLabel => Boolean(item))
    : [];

  return {
    type: "biology-cell",
    questionIndex,
    title: typeof obj.title === "string" ? obj.title.trim() || undefined : undefined,
    subtitle: typeof obj.subtitle === "string" ? obj.subtitle.trim() || undefined : undefined,
    layout,
    state,
    focusLabels: focusLabels.length > 0 ? [...new Set(focusLabels)] : undefined,
  };
}

function heuristicallyPlanBiologyCellDiagram(target: DiagramTarget): StructuredQuestionDiagram {
  const stem = target.stem.toLowerCase();
  const mentionsPlant = /\bplant cell|sel tumbuhan|chloroplast|cell wall|dinding sel|vacuole|vakuol\b/.test(stem);
  const mentionsAnimal = /\banimal cell|sel haiwan\b/.test(stem);
  const isComparison = /\b(compare|comparison|difference|different|kedua-dua|both|plant and animal|sel tumbuhan dan sel haiwan)\b/.test(
    stem,
  );
  const isHypertonic = /\bhypertonic|plasmolys|layu\b/.test(stem);
  const isHypotonic = /\bhypotonic|turgid|distilled\b/.test(stem);

  const focusLabels: BiologyCellFocusLabel[] = [];
  if (/\bcell wall|dinding sel\b/.test(stem)) focusLabels.push("cellWall");
  if (/\bcell membrane|plasma membrane|membran plasma\b/.test(stem)) focusLabels.push("cellMembrane");
  if (/\bvacuole|vakuol\b/.test(stem)) focusLabels.push("vacuole");
  if (/\bchloroplast|kloroplas\b/.test(stem)) focusLabels.push("chloroplast");
  if (/\bnucleus|nukleus\b/.test(stem)) focusLabels.push("nucleus");
  if (/\bcytoplasm|sitoplasma\b/.test(stem)) focusLabels.push("cytoplasm");

  if (isComparison || (mentionsPlant && mentionsAnimal)) {
    return {
      type: "biology-cell",
      questionIndex: target.questionIndex,
      layout: "comparison",
      state: "normal",
      title: "Plant vs animal cell",
      subtitle: "Comparison diagram generated for this question",
      focusLabels: focusLabels.length > 0 ? focusLabels : ["cellWall", "vacuole", "nucleus"],
    };
  }

  if (mentionsPlant || isHypertonic || isHypotonic) {
    return {
      type: "biology-cell",
      questionIndex: target.questionIndex,
      layout: "plant",
      state: isHypertonic ? "hypertonic" : isHypotonic ? "hypotonic" : "normal",
      title: isHypertonic
        ? "Plant cell in hypertonic solution"
        : isHypotonic
          ? "Plant cell in hypotonic solution"
          : "Plant cell structure",
      subtitle: "Structured biology diagram generated for this question",
      focusLabels: focusLabels.length > 0 ? focusLabels : ["cellWall", "vacuole", "chloroplast", "nucleus"],
    };
  }

  return {
    type: "biology-cell",
    questionIndex: target.questionIndex,
    layout: "animal",
    state: "normal",
    title: "Animal cell structure",
    subtitle: "Structured biology diagram generated for this question",
    focusLabels: focusLabels.length > 0 ? focusLabels : ["nucleus", "cytoplasm", "cellMembrane"],
  };
}

function mergeStructuredDiagrams(
  preferred: StructuredQuestionDiagram[],
  fallback: StructuredQuestionDiagram[],
): StructuredQuestionDiagram[] {
  const byIndex = new Map<number, StructuredQuestionDiagram>();
  for (const item of fallback) {
    byIndex.set(item.questionIndex, item);
  }
  for (const item of preferred) {
    byIndex.set(item.questionIndex, item);
  }
  return [...byIndex.values()].sort((a, b) => a.questionIndex - b.questionIndex);
}

export async function planStructuredQuestionDiagrams(params: {
  subject: string | null | undefined;
  query: string;
  answer: string;
}): Promise<StructuredQuestionDiagram[]> {
  const subjectNorm = params.subject?.trim().toLowerCase() ?? "";
  if (subjectNorm !== "biology") return [];

  const targets = extractGeneratedQuestionStems(params.answer)
    .filter((item) => shouldPlanBiologyDiagramFromStem(item.stem))
    .map((item) => ({ questionIndex: item.questionIndex, stem: item.stem }));

  if (targets.length === 0) return [];

  const fallback = targets.map((target) => heuristicallyPlanBiologyCellDiagram(target));
  const allowedIndexes = new Set(targets.map((target) => target.questionIndex));

  try {
    const plannerRaw = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You are a diagram planner for SPM Biology questions. Return JSON only, with no markdown fences. " +
            "Output an array of objects. Allowed object shape: " +
            '{"type":"biology-cell","questionIndex":1,"layout":"plant|animal|comparison","state":"normal|hypotonic|hypertonic","title":"...","subtitle":"...","focusLabels":["cellWall","cellMembrane","vacuole","chloroplast","nucleus","cytoplasm"]}. ' +
            "Use layout='plant' for plant-only questions, especially plant cell in hypotonic/hypertonic/osmosis questions. " +
            "Use layout='comparison' only when the question explicitly compares plant and animal cells or a comparison diagram would directly help answer. " +
            "Use layout='animal' for organelle/animal-cell questions. " +
            "For plant cell in hypertonic solution, set state='hypertonic'. For hypotonic/turgid/distilled water plant-cell questions, set state='hypotonic'. " +
            "Only use the allowed focusLabels values.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              query: params.query,
              questions: targets,
            },
            null,
            2,
          ),
        },
      ],
      { subject: params.subject, query: `${params.query} diagram planner` },
    );

    const parsed = normalizePlannerJson(plannerRaw);
    const items = Array.isArray(parsed) ? parsed : [];
    const normalized = items
      .map((item) => normalizeStructuredDiagram(item, allowedIndexes))
      .filter((item): item is StructuredQuestionDiagram => Boolean(item));

    return mergeStructuredDiagrams(normalized, fallback);
  } catch {
    return fallback;
  }
}
