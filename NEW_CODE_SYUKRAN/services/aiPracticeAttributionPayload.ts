import type { RagSourceAttribution } from "./mobilePracticeSets";
import type { AiPracticeAttribution } from "./aiPracticeAttributionStore";

/** Compact JSON for navigation params (survives web route serialization). */
export function buildAiAttributionPayload(
  sourceLabel: string,
  sources: RagSourceAttribution[],
): string {
  return JSON.stringify({
    l: sourceLabel.trim(),
    s: sources.slice(0, 6).map((row) => ({
      label: row.label,
      t: row.sourceType,
      e: row.excerpt?.slice(0, 300) ?? "",
    })),
  });
}

export function parseAiAttributionPayload(raw?: string): AiPracticeAttribution | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as {
      l?: string;
      s?: Array<{ label?: string; t?: string; e?: string }>;
    };
    const sourceLabel = typeof parsed.l === "string" ? parsed.l.trim() : "";
    const sources: RagSourceAttribution[] = (parsed.s ?? [])
      .map((row, index) => {
        const label = typeof row.label === "string" ? row.label.trim() : "";
        if (!label) return null;
        return {
          sourceType: row.t === "past_paper" ? ("past_paper" as const) : ("textbook" as const),
          documentId: "",
          chunkId: String(index),
          chunkIndex: index,
          title: null,
          subject: null,
          form: null,
          chapter: null,
          year: null,
          paperLabel: null,
          questionRef: null,
          pageStart: null,
          pageEnd: null,
          sourceName: null,
          relevanceScore: 0,
          label,
          excerpt: typeof row.e === "string" ? row.e : "",
        };
      })
      .filter((row): row is RagSourceAttribution => row !== null);

    if (!sourceLabel && sources.length === 0) return null;
    return { sourceLabel, sources };
  } catch {
    return null;
  }
}
