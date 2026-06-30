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

/**
 * Question-structure words that appear in exam questions but carry no topic
 * signal for textbook retrieval. Keeping them inflates the token denominator
 * in `scoreChunk`, which lowers the lexical-overlap ratio below the 0.35 gate
 * even when the chunk is relevant.
 */
const RETRIEVAL_NOISE_WORDS = new Set([
  // command verbs (already STOPWORDS: explain, show, find, solve)
  "describe", "state", "calculate", "name", "define", "write", "compare",
  "suggest", "predict", "determine", "identify", "list", "outline", "give",
  // structural question words
  "answer", "your", "reference", "based", "concept", "observation", "observation",
  "observations", "experiments", "experiment", "student", "students", "carried",
  "study", "differences", "difference", "following", "given", "when", "where",
  "using", "between", "during", "both", "each", "some", "all", "any", "two",
  "three", "one", "four", "five", "above", "below", "also", "only", "not",
  "with", "from", "about", "whether", "that", "these", "those", "they",
  // generic / low-signal verbs (topic nouns are the signal, not these)
  "affects", "affect", "causes", "cause", "results", "result", "shows",
  "stored", "stores", "used", "use", "known", "know", "has", "have",
]);

/**
 * Clean a question string so it makes a better textbook chunk search query.
 *
 * Generated questions are often bilingual (EN: … \nBM: …), contain scenario
 * wording, BM translations, and mark annotations ("(3 marks)"). These dilute
 * keyword matching against plain textbook chunk text.
 *
 * Strategy:
 *  1. Keep only the English portion (before the first BM: line).
 *  2. Strip leading "EN:" prefix.
 *  3. Remove mark annotations like "(2 marks)" / "(3 markah)".
 *  4. Remove question-structure and command words that add token-denominator
 *     noise without contributing topic signal.
 *  5. Collapse whitespace and truncate to a safe length.
 *
 * We deliberately keep scenario nouns (substances, materials, named entities)
 * because those ARE the topic keywords for retrieval.
 */
export function cleanQuestionForRetrieval(raw: string): string {
  let q = raw.trim();

  // 1. Separate EN and BM portions before any cleaning.
  const bmIdx = q.search(/\nBM\s*:/i);
  const enRaw = bmIdx > 0 ? q.slice(0, bmIdx) : q;

  // 2. Clean the EN portion: strip prefix, marks, structure words.
  let enClean = enRaw.replace(/^EN\s*:\s*/i, "").trim();
  enClean = enClean.replace(/\(\s*\d+\s*marks?\s*\)/gi, "").replace(/\(\s*\d+\s*markah\s*\)/gi, "").trim();
  const enWords = enClean.split(/\s+/).filter((w) => {
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    return lower.length >= 2 && !RETRIEVAL_NOISE_WORDS.has(lower);
  });

  q = (enWords.length >= 4 ? enWords : enClean.split(/\s+/)).join(" ");

  // 3. Collapse whitespace and truncate.
  return q.replace(/\s+/g, " ").trim().slice(0, 350);
}

export function chunkRefsFromList(chunks: RetrievedChunk[]): string[] {
  return chunks.map(chunkRef);
}

/**
 * Use a lightweight LLM call to convert a real-life application question into
 * its underlying scientific concept for textbook retrieval.
 *
 * Real-life questions describe a scenario (a household situation, an experiment
 * setup, etc.) instead of naming the science topic directly. Plain keyword
 * retrieval then matches the scenario words in the wrong chapter rather than the
 * chapter that actually teaches the mechanism. This call asks the LLM to name
 * the underlying syllabus concept so retrieval can target the correct chapter.
 */
async function extractConceptQuery(question: string, subject: string): Promise<string | null> {
  const system = [
    "You are a Malaysian SPM textbook search assistant.",
    "Given a question, extract the core scientific concept a textbook chapter would cover to answer it.",
    "Ignore any real-life application or scenario wording and name only the underlying syllabus topic.",
    "Return ONLY a short keyword phrase of the underlying scientific topic — max 12 words.",
    'Return JSON: { "concept": "..." }',
  ].join(" ");

  const cleaned = cleanQuestionForRetrieval(question);
  const user = `Subject: ${subject}\nQuestion: ${cleaned}`;

  try {
    const parsed = await qwenGradingJson(system, user);
    const concept = typeof parsed?.concept === "string" ? parsed.concept.trim() : null;
    return concept && concept.length >= 5 ? concept : null;
  } catch {
    return null;
  }
}

async function retrieveTextbookChunks(params: {
  question: string;
  subject: string;
  form: string;
  topK?: number;
  chapterFilter?: string;
  chapterHint?: string;
}): Promise<RetrievedChunk[]> {
  const result = await retrieveChunks({
    query: params.question,
    subject: params.subject,
    form: params.form,
    topK: params.topK ?? 12,
    chapterFilter: params.chapterFilter,
    chapterHint: params.chapterHint,
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

function normalizeChapter(chapter: string | undefined | null): string {
  return (chapter ?? "").trim().toLowerCase();
}

/**
 * Keep evidence chunks coherent to a single chapter.
 *
 * Keyword retrieval can match scattered words across different chapters and mix
 * them into one rubric, producing off-topic grounding.
 *
 * The dominant chapter is the chapter of the single highest-scoring chunk — the
 * most topically distinctive match. We deliberately do NOT use summed scores:
 * generic words can rack up many weak matches in an intro chapter and hijack a
 * question that really belongs to a later chapter. The best single chunk
 * reflects the true topic far better.
 *
 * Chunks with no chapter label are kept when the best chunk itself has no label,
 * so we never discard usable evidence just because metadata is missing.
 */
function filterToDominantChapter(chunks: RetrievedChunk[]): RetrievedChunk[] {
  if (chunks.length <= 1) return chunks;

  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  const dominantChapter = normalizeChapter(sorted[0]?.chapter);

  // Top chunk has no chapter label → can't filter reliably, keep as-is.
  if (!dominantChapter) return chunks;

  const inDominant = chunks.filter((c) => normalizeChapter(c.chapter) === dominantChapter);
  // Safety: if filtering leaves too little, keep the original set.
  return inDominant.length > 0 ? inDominant : chunks;
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
  /** When the question's chapter is known, restrict retrieval to that chapter. */
  chapterFilter?: string;
  /** Soft ranking boost toward a chapter heading (used when filter is absent). */
  chapterHint?: string;
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

  const chapterFilter = params.chapterFilter?.trim() || undefined;
  const chapterHint = params.chapterHint?.trim() || undefined;

  // When the chapter is known, search WITHIN that chapter first. Wrap retrieval
  // so a strict chapter filter that yields nothing automatically retries without
  // it — this keeps grounding from breaking on chapter-label mismatches while
  // still scoping correctly when labels line up.
  const search = async (query: string): Promise<RetrievedChunk[]> => {
    if (chapterFilter) {
      const scoped = await retrieveTextbookChunks({
        question: query,
        subject: params.subject,
        form: params.form,
        chapterFilter,
        chapterHint,
      });
      if (scoped.length > 0) return scoped;
    }
    return retrieveTextbookChunks({
      question: query,
      subject: params.subject,
      form: params.form,
      chapterHint,
    });
  };

  // Pass 1 — keyword query: strip bilingual noise, marks, and structure words.
  const retrievalQuery = cleanQuestionForRetrieval(params.question);
  const keywordChunks = await search(retrievalQuery);

  // Pass 2 — concept query: always run in parallel to catch real-life application
  // questions where keyword matches land in the wrong chapter. The LLM strips the
  // scenario context and returns the underlying science concept. We compare both
  // passes and use whichever gives higher-scoring chunks.
  const conceptQuery = await extractConceptQuery(params.question, params.subject);
  const conceptChunks = conceptQuery ? await search(conceptQuery) : [];

  const bestKeyword = keywordChunks.length > 0 ? Math.max(...keywordChunks.map((c) => c.score)) : 0;
  const bestConcept = conceptChunks.length > 0 ? Math.max(...conceptChunks.map((c) => c.score)) : 0;
  // Prefer concept chunks when they score noticeably better (real-life question
  // keywords hit the wrong chapters), otherwise keep keyword chunks.
  const all = bestConcept > bestKeyword + 0.05 ? conceptChunks : keywordChunks.length > 0 ? keywordChunks : conceptChunks;
  const { dskp, textbook } = partitionDskpAndTextbookChunks(all);
  const topDskp = dskp.sort((a, b) => b.score - a.score).slice(0, 4);
  const dskpExcerpt = formatChunksExcerpt(topDskp, "DSKP SYLLABUS MANDATE");

  // Chapter coherence: lock evidence to the single best-matching chapter so a
  // question never grounds on stray chunks from other chapters that merely
  // shared a keyword. Drops cross-chapter contamination.
  const coherentTextbook = filterToDominantChapter(textbook);

  // High-confidence bypass: if textbook chunks already score well, skip the
  // non-deterministic LLM suitability check and use them directly. This prevents
  // flaky llm_fallback caused by LLM saying "not suitable" for clearly relevant chunks.
  // Thresholds: 1+ chunk at ≥0.5 OR 2+ chunks at ≥0.4 (both are high enough to trust).
  const chunksToCheck = coherentTextbook.length > 0 ? coherentTextbook : all;
  const highConfidence = chunksToCheck.filter((c) => c.score >= 0.4).slice(0, 4);
  const bypassSuitability =
    highConfidence.filter((c) => c.score >= 0.5).length >= 1 || highConfidence.length >= 2;
  if (bypassSuitability) {
    const textbookExcerpt = formatChunksExcerpt(highConfidence, "TEXTBOOK GROUNDING EVIDENCE");
    const mergedExcerpt = [dskpExcerpt, textbookExcerpt].filter(Boolean).join("\n\n");
    return {
      dskpExcerpt,
      textbookExcerpt,
      mergedExcerpt,
      chunkRefs: [...topDskp, ...highConfidence].map(chunkRef),
      contextSource: mergedExcerpt.length >= 80 ? "textbook" : "llm_fallback",
    };
  }

  const suitability = await assessTextbookChunkSuitability({
    question: params.question,
    subject: params.subject,
    maxScore: params.maxScore,
    chunks: chunksToCheck,
  });

  if (suitability.suitable) {
    const selected = selectChunksByIds(chunksToCheck, suitability.selectedChunkIds);
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
