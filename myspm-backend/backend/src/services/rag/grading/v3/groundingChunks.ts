/**
 * Textbook chunk selection for evidence-centric assessment (shared with question generation).
 */

import { retrieveChunks, isLowQualityChunk } from "../../retrieval/retrievalService";
import { formatChunksExcerpt, partitionDskpAndTextbookChunks } from "../../retrieval/dskpChunkFilter";
import type { RetrievedChunk } from "../../types";
import { qwenGradingJson } from "../qwenGradingClient";

function chunkRef(chunk: RetrievedChunk): string {
  return `textbook:${chunk.textbookId}:chunk:${chunk.chunkId}`;
}

export function chunkRefsFromList(chunks: RetrievedChunk[]): string[] {
  return chunks.map(chunkRef);
}

async function retrieveTextbookChunks(params: {
  question: string;
  subject: string;
  form: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const result = await retrieveChunks({
    query: params.question,
    subject: params.subject,
    form: params.form,
    topK: params.topK ?? 12,
  });
  return result.chunks.filter(
    (c) => c.sourceType === "textbook" && !isLowQualityChunk(c.content) && c.content.trim().length >= 80,
  );
}

type SuitabilityResult = {
  suitable: boolean;
  reason: string;
  selectedChunkIds: string[];
};

async function assessTextbookChunkSuitability(params: {
  question: string;
  subject: string;
  maxScore: number;
  chunks: RetrievedChunk[];
}): Promise<SuitabilityResult> {
  if (params.chunks.length === 0) {
    return { suitable: false, reason: "No textbook chunks retrieved.", selectedChunkIds: [] };
  }

  const catalog = params.chunks.map((c, i) => ({
    index: i,
    chunkId: c.chunkId,
    title: c.title,
    preview: c.content.trim().slice(0, 500),
  }));

  const system = [
    "Assess whether textbook excerpts support SPM marking for this question.",
    'Return JSON: { "suitable": boolean, "reason": string, "selectedIndices": number[] }',
    "selectedIndices: 0-based indices of excerpts to use (1–4).",
  ].join("\n");

  const user = [
    `Subject: ${params.subject}`,
    `Question: ${params.question}`,
    `Max marks: ${params.maxScore}`,
    `Excerpts:\n${JSON.stringify(catalog)}`,
  ].join("\n\n");

  try {
    const parsed = await qwenGradingJson(system, user);
    const suitable = parsed?.suitable === true;
    const indices = Array.isArray(parsed?.selectedIndices)
      ? parsed.selectedIndices
          .filter((n: unknown) => typeof n === "number" && n >= 0 && n < params.chunks.length)
          .map((n: number) => Math.floor(n))
      : suitable
        ? params.chunks.slice(0, 3).map((_, i) => i)
        : [];
    const selected = [...new Set(indices as number[])]
      .map((i) => params.chunks[i])
      .filter((c): c is RetrievedChunk => Boolean(c));
    if (!suitable || selected.length === 0) {
      return {
        suitable: false,
        reason: typeof parsed?.reason === "string" ? parsed.reason : "Not suitable.",
        selectedChunkIds: [],
      };
    }
    return {
      suitable: true,
      reason: typeof parsed?.reason === "string" ? parsed.reason : "Suitable.",
      selectedChunkIds: selected.map((c) => c.chunkId),
    };
  } catch {
    const fallback = params.chunks.slice(0, 3);
    return {
      suitable: fallback.length > 0,
      reason: "Suitability check failed; using top hits.",
      selectedChunkIds: fallback.map((c) => c.chunkId),
    };
  }
}

function selectChunksByIds(all: RetrievedChunk[], ids: string[]): RetrievedChunk[] {
  const set = new Set(ids);
  const picked = all.filter((c) => set.has(c.chunkId));
  return picked.length > 0 ? picked : all.slice(0, 3);
}

function consecutiveChunksAroundPrimary(
  pool: RetrievedChunk[],
  primary: RetrievedChunk,
  maxNeighbors: number,
): RetrievedChunk[] {
  const sameBook = pool
    .filter((c) => c.textbookId === primary.textbookId)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
  const byIndex = new Map(sameBook.map((c) => [c.chunkIndex, c]));
  const neighbors: RetrievedChunk[] = [];
  for (let gap = 1; gap <= maxNeighbors && neighbors.length < maxNeighbors; gap++) {
    for (const idx of [primary.chunkIndex - gap, primary.chunkIndex + gap]) {
      const chunk = byIndex.get(idx);
      if (chunk && chunk.chunkId !== primary.chunkId) neighbors.push(chunk);
    }
  }
  return neighbors;
}

export function buildCandidateChunkPool(
  hits: RetrievedChunk[],
  primaryChunk: RetrievedChunk | null,
  maxPool = 8,
  consecutiveFromDb: RetrievedChunk[] = [],
): RetrievedChunk[] {
  const textbooks = hits.filter((h) => h.sourceType === "textbook" && h.content.trim().length >= 40);
  if (textbooks.length === 0 && consecutiveFromDb.length === 0) return [];
  if (!primaryChunk) return textbooks.slice(0, maxPool);

  const pool: RetrievedChunk[] = [];
  const seen = new Set<string>();
  const add = (chunk: RetrievedChunk) => {
    if (seen.has(chunk.chunkId)) return;
    seen.add(chunk.chunkId);
    pool.push(chunk);
  };

  add(primaryChunk);
  for (const chunk of consecutiveFromDb) {
    if (chunk.textbookId === primaryChunk.textbookId) add(chunk);
  }
  for (const chunk of consecutiveChunksAroundPrimary([...consecutiveFromDb, ...textbooks], primaryChunk, maxPool)) {
    add(chunk);
  }
  const primaryIdx = primaryChunk.chunkIndex;
  const rest = textbooks
    .filter((c) => !seen.has(c.chunkId))
    .sort((a, b) => Math.abs(a.chunkIndex - primaryIdx) - Math.abs(b.chunkIndex - primaryIdx));
  for (const chunk of rest) add(chunk);
  return pool.slice(0, maxPool);
}

export function questionDraftContextChunks(
  pool: RetrievedChunk[],
  primaryChunk: RetrievedChunk | null,
  maxChunks = 3,
): RetrievedChunk[] {
  if (pool.length === 0) return [];
  if (!primaryChunk) return pool.slice(0, maxChunks);
  const neighbors = consecutiveChunksAroundPrimary(pool, primaryChunk, maxChunks - 1);
  return [primaryChunk, ...neighbors].slice(0, maxChunks);
}

export async function resolveGroundingChunksForQuestion(params: {
  question: string;
  subject: string;
  maxScore: number;
  hits: RetrievedChunk[];
  primaryChunk: RetrievedChunk | null;
  candidatePool?: RetrievedChunk[];
}): Promise<RetrievedChunk[]> {
  const pool = params.candidatePool ?? buildCandidateChunkPool(params.hits, params.primaryChunk);
  if (pool.length === 0) return [];
  if (pool.length === 1) return pool;

  const suitability = await assessTextbookChunkSuitability({
    question: params.question,
    subject: params.subject,
    maxScore: params.maxScore,
    chunks: pool,
  });

  if (suitability.suitable && suitability.selectedChunkIds.length > 0) {
    return selectChunksByIds(pool, suitability.selectedChunkIds);
  }
  return questionDraftContextChunks(pool, params.primaryChunk, 3);
}

export function mergeChunksExcerpt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return formatChunksExcerpt(chunks, "TEXTBOOK GROUNDING EVIDENCE");
}

export type RetrievedEvidenceContext = {
  dskpExcerpt: string;
  textbookExcerpt: string;
  mergedExcerpt: string;
  chunkRefs: string[];
  contextSource: "textbook" | "llm_fallback";
};

export async function retrieveEvidenceContext(params: {
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  seedChunkContent?: string;
  seedChunkRefs?: string[];
  skipRetrieval?: boolean;
}): Promise<RetrievedEvidenceContext> {
  let excerpt = params.seedChunkContent?.trim() ?? "";
  let chunkRefs = params.seedChunkRefs ?? [];

  if (params.skipRetrieval && excerpt.length >= 80) {
    return {
      dskpExcerpt: "",
      textbookExcerpt: excerpt,
      mergedExcerpt: excerpt,
      chunkRefs,
      contextSource: "textbook",
    };
  }

  const all = await retrieveTextbookChunks({
    question: params.question,
    subject: params.subject,
    form: params.form,
  });
  const { dskp, textbook } = partitionDskpAndTextbookChunks(all);
  const topDskp = dskp.sort((a, b) => b.score - a.score).slice(0, 4);
  const dskpExcerpt = formatChunksExcerpt(topDskp, "DSKP SYLLABUS MANDATE");

  const suitability = await assessTextbookChunkSuitability({
    question: params.question,
    subject: params.subject,
    maxScore: params.maxScore,
    chunks: textbook.length > 0 ? textbook : all,
  });

  if (suitability.suitable) {
    const selected = selectChunksByIds(textbook.length > 0 ? textbook : all, suitability.selectedChunkIds);
    const textbookExcerpt = formatChunksExcerpt(selected, "TEXTBOOK GROUNDING EVIDENCE");
    const mergedExcerpt = [dskpExcerpt, textbookExcerpt].filter(Boolean).join("\n\n");
    return {
      dskpExcerpt,
      textbookExcerpt,
      mergedExcerpt,
      chunkRefs: [...topDskp, ...selected].map(chunkRef),
      contextSource: mergedExcerpt.length >= 80 ? "textbook" : "llm_fallback",
    };
  }

  if (topDskp.length > 0) {
    return {
      dskpExcerpt,
      textbookExcerpt: "",
      mergedExcerpt: dskpExcerpt,
      chunkRefs: topDskp.map(chunkRef),
      contextSource: "llm_fallback",
    };
  }

  if (excerpt.length > 0 && chunkRefs.length > 0) {
    return {
      dskpExcerpt: "",
      textbookExcerpt: excerpt,
      mergedExcerpt: excerpt,
      chunkRefs,
      contextSource: "textbook",
    };
  }

  return {
    dskpExcerpt: "",
    textbookExcerpt: "",
    mergedExcerpt: "",
    chunkRefs: [],
    contextSource: "llm_fallback",
  };
}
