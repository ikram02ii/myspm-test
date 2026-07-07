import { and, asc, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import {
  ragDb,
  ragPastPaperChunksTable,
  ragPastPapersTable,
  ragTextbookChunksTable,
  ragTextbooksTable,
} from "../../../lib/ragDb";
import { pastPaperFormWhereClause, textbookFormWhereClause } from "./pastPaperFormFilter";
import type {
  GradingContextPayload,
  RetrieveChunksInput,
  RetrieveChunksResult,
  RetrievedChunk,
  RetrievedChunkSource,
} from "../types";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "for",
  "in",
  "on",
  "is",
  "are",
  "what",
  "how",
  "find",
  "solve",
  "explain",
  "show",
]);

const TOC_HINTS = [
  "table of contents",
  "contents",
  "chapter",
  "learning standard",
  "mind stimulation",
  "interactive zone",
  "info zone",
  "-- ",
  "of 32 --",
];

type ConceptProfile = {
  requiredPhrases: string[];
  offTopicPhrases: string[];
};

const CONCEPT_PROFILES: Array<{ matcher: (query: string) => boolean; profile: ConceptProfile }> = [
  {
    matcher: (query) => {
      const q = query.toLowerCase();
      return (
        (q.includes("function of the nucleus") || q.includes("function of nucleus") || q.includes("nucleus function")) &&
        q.includes("nucleus")
      );
    },
    profile: {
      requiredPhrases: [
        "controls all cell activities",
        "controls cell activities",
        "dna",
        "chromosome",
        "chromosomes",
        "determines cell characteristics",
        "metabolic function",
      ],
      offTopicPhrases: ["diagram", "amoeba", "mitosis", "hiv", "virus"],
    },
  },
];

function getConceptProfile(query: string): ConceptProfile | null {
  const matched = CONCEPT_PROFILES.find((entry) => entry.matcher(query));
  return matched?.profile ?? null;
}

/** Strip SQL LIKE wildcards from user-provided chapter filters */
function sanitizeChapterFilter(raw: string): string {
  return raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Round-robin pick across chapters so general (non-topic) generation does not
 * ground every question on consecutive chunks from a single chapter.
 */
export function diversifyChunksAcrossChapters(
  ranked: RetrievedChunk[],
  topK: number,
): RetrievedChunk[] {
  if (ranked.length <= topK) return ranked;

  const byChapter = new Map<string, RetrievedChunk[]>();
  for (const chunk of ranked) {
    const key =
      chunk.chapter?.trim() ||
      (chunk.sourceType === "past_paper"
        ? `paper:${chunk.title}:${chunk.year ?? ""}`
        : `doc:${chunk.textbookId}`);
    const list = byChapter.get(key) ?? [];
    list.push(chunk);
    byChapter.set(key, list);
  }

  if (byChapter.size <= 1) return ranked.slice(0, topK);

  const queues = [...byChapter.values()];
  const out: RetrievedChunk[] = [];
  let round = 0;
  while (out.length < topK && round < topK * 2) {
    let added = false;
    for (const queue of queues) {
      if (out.length >= topK) break;
      const chunk = queue[round];
      if (chunk) {
        out.push(chunk);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }

  return out.length > 0 ? out : ranked.slice(0, topK);
}

/** Reserve slots for past-paper chunks when the pool has any (generation should cite exam papers). */
export function ensurePastPaperMix(
  ranked: RetrievedChunk[],
  selected: RetrievedChunk[],
  topK: number,
  minPast = MIN_PAST_PAPER_IN_TOP_K,
): RetrievedChunk[] {
  const papersInPool = ranked.filter((c) => c.sourceType === "past_paper");
  if (papersInPool.length === 0) return selected.slice(0, topK);

  const out: RetrievedChunk[] = [];
  const used = new Set<string>();
  const chunkKey = (c: RetrievedChunk) => `${c.sourceType}:${c.textbookId}:${c.chunkId}`;

  for (const paper of papersInPool) {
    if (out.filter((c) => c.sourceType === "past_paper").length >= minPast) break;
    const key = chunkKey(paper);
    if (used.has(key)) continue;
    out.push(paper);
    used.add(key);
  }

  for (const chunk of selected) {
    if (out.length >= topK) break;
    const key = chunkKey(chunk);
    if (used.has(key)) continue;
    out.push(chunk);
    used.add(key);
  }

  for (const chunk of ranked) {
    if (out.length >= topK) break;
    const key = chunkKey(chunk);
    if (used.has(key)) continue;
    out.push(chunk);
    used.add(key);
  }

  return out.length > 0 ? out : selected.slice(0, topK);
}

function countPhraseHits(text: string, phrases: string[]): number {
  const lowered = text.toLowerCase();
  return phrases.reduce((count, phrase) => (lowered.includes(phrase) ? count + 1 : count), 0);
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
        .filter((t) => !STOPWORDS.has(t)),
    ),
  );
}

export function looksLikeTableOfContents(chunkText: string): boolean {
  const lowered = chunkText.toLowerCase();
  const tocHitCount = TOC_HINTS.reduce((count, hint) => (lowered.includes(hint) ? count + 1 : count), 0);
  const manyShortLines = chunkText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 35).length;

  return tocHitCount >= 2 || manyShortLines >= 15;
}

function textDensity(chunkText: string): number {
  const cleaned = chunkText.replace(/\s+/g, " ").trim();
  if (!cleaned) return 0;
  const alphaNumCount = (cleaned.match(/[a-z0-9]/gi) ?? []).length;
  return alphaNumCount / cleaned.length;
}

export function isLowQualityChunk(chunkText: string): boolean {
  const cleaned = chunkText.replace(/\s+/g, " ").trim();
  if (cleaned.length < 140) return true;
  if (looksLikeTableOfContents(cleaned)) return true;
  if (textDensity(cleaned) < 0.45) return true;
  return false;
}

/** Past-paper mark-scheme chunks are often shorter than textbook pages; keep a lighter bar. */
function isLowQualityPastPaperChunk(chunkText: string): boolean {
  const cleaned = chunkText.replace(/\s+/g, " ").trim();
  if (cleaned.length < 80) return true;
  if (looksLikeTableOfContents(cleaned)) return true;
  return false;
}

/** Slight preference so official mark schemes compete with long textbook passages. */
const PAST_PAPER_RETRIEVAL_BOOST = 0.22;

const MIN_PAST_PAPER_IN_TOP_K = 2;

function buildSearchTokens(queryTokens: string[]): string[] {
  const filtered = queryTokens.filter((token) => {
    if (/^\d$/.test(token)) return false; // single digit is too broad in textbook math content
    if (/^[a-z]$/.test(token)) return false; // single letter variables like x are too broad
    return true;
  });
  return filtered.length > 0 ? filtered : queryTokens;
}

function extractEquationAnchors(query: string): string[] {
  const matches = query.toLowerCase().match(/\b(?:\d+[a-z]+|[a-z]+\d+|\d{2,})\b/g) ?? [];
  return Array.from(new Set(matches));
}

function scoreChunk(
  queryTokens: string[],
  equationAnchors: string[],
  chunkContent: string,
  queryPhrase: string,
  conceptProfile: ConceptProfile | null,
): number {
  if (queryTokens.length === 0) return 0;
  const loweredChunk = chunkContent.toLowerCase();
  const numericTokens = queryTokens.filter((t) => /^\d+$/.test(t));
  const lexicalTokens = queryTokens.filter((t) => !/^\d+$/.test(t));

  let overlapLexical = 0;
  let overlapNumeric = 0;
  for (const token of queryTokens) {
    if (loweredChunk.includes(token)) {
      if (/^\d+$/.test(token)) overlapNumeric += 1;
      else overlapLexical += 1;
    }
  }

  const lexicalDenominator = Math.max(1, lexicalTokens.length);
  const lexicalScore = overlapLexical / lexicalDenominator;
  const numericScore = numericTokens.length > 0 ? overlapNumeric / numericTokens.length : 0;

  const phraseBoost = loweredChunk.includes(queryPhrase.toLowerCase()) ? 0.3 : 0;
  const anchorMatches = equationAnchors.filter((anchor) => loweredChunk.includes(anchor)).length;
  const anchorBoost = equationAnchors.length > 0 ? (anchorMatches / equationAnchors.length) * 0.6 : 0;
  const conceptRequiredHits = conceptProfile
    ? countPhraseHits(loweredChunk, conceptProfile.requiredPhrases)
    : 0;
  const conceptOffTopicHits = conceptProfile ? countPhraseHits(loweredChunk, conceptProfile.offTopicPhrases) : 0;
  const conceptBoost = conceptRequiredHits * 0.6;
  const offTopicPenalty = conceptOffTopicHits > 0 && conceptRequiredHits === 0 ? 0.9 : 0;

  const finalScore = lexicalScore + numericScore * 0.35 + phraseBoost + anchorBoost + conceptBoost - offTopicPenalty;
  return finalScore;
}

export function scoreChunkRelevance(query: string, chunkText: string): number {
  const queryTokens = tokenize(query);
  const anchors = extractEquationAnchors(query);
  return scoreChunk(queryTokens, anchors, chunkText, query, null);
}

function passesRelevanceGate(
  queryTokens: string[],
  equationAnchors: string[],
  chunkContent: string,
  conceptProfile: ConceptProfile | null,
): boolean {
  if (queryTokens.length === 0) return false;
  const loweredChunk = chunkContent.toLowerCase();
  const numericTokens = queryTokens.filter((t) => /^\d+$/.test(t));
  const lexicalTokens = queryTokens.filter((t) => !/^\d+$/.test(t));

  const matchedLexical = lexicalTokens.filter((t) => loweredChunk.includes(t)).length;
  const matchedNumeric = numericTokens.filter((t) => loweredChunk.includes(t)).length;

  // Require at least one lexical hit when possible to avoid pure-number matches.
  if (lexicalTokens.length > 0 && matchedLexical === 0) return false;
  // For equation-like queries, require at least one numeric anchor.
  if (numericTokens.length > 0 && matchedNumeric === 0) return false;
  // For equation-like queries, require equation anchors to appear.
  if (equationAnchors.length > 0) {
    const matchedAnchors = equationAnchors.filter((anchor) => loweredChunk.includes(anchor)).length;
    const requiredAnchors = equationAnchors.length >= 2 ? 2 : 1;
    if (matchedAnchors < requiredAnchors) return false;
  }
  // Require stronger overlap for short symbolic queries.
  const totalMatches = matchedLexical + matchedNumeric;
  if (queryTokens.length >= 3 && totalMatches < 2) return false;
  if (conceptProfile) {
    const requiredHits = countPhraseHits(loweredChunk, conceptProfile.requiredPhrases);
    if (requiredHits === 0) return false;
    const offTopicHits = countPhraseHits(loweredChunk, conceptProfile.offTopicPhrases);
    if (offTopicHits > 0 && requiredHits < 2) return false;
  }

  return true;
}

export async function retrieveChunks(input: RetrieveChunksInput): Promise<RetrieveChunksResult> {
  const query = input.query.trim();
  if (!query) {
    throw new Error("query is required");
  }

  const subject = input.subject?.trim();
  const form = input.form?.trim();
  const chapterFilterRaw = input.chapterFilter?.trim();
  const chapterFilterSanitized =
    chapterFilterRaw && chapterFilterRaw.length >= 2 ? sanitizeChapterFilter(chapterFilterRaw) : "";
  const chapterFilterClause =
    chapterFilterSanitized.length >= 2
      ? ilike(ragTextbookChunksTable.chapter, `%${chapterFilterSanitized}%`)
      : undefined;
  const chapterHintLower = input.chapterHint?.trim().toLowerCase() ?? "";
  const requestedTopK = typeof input.topK === "number" ? input.topK : Number.NaN;
  const topK = Number.isFinite(requestedTopK) ? Math.max(1, Math.min(20, Math.floor(requestedTopK))) : 6;
  const candidateLimit = Math.min(500, Math.max(100, topK * 20));
  const queryTokens = tokenize(query);
  const searchTokens = buildSearchTokens(queryTokens);
  const equationAnchors = extractEquationAnchors(query);
  const conceptProfile = getConceptProfile(query);
  if (queryTokens.length === 0) {
    return { query, count: 0, chunks: [] };
  }

  const tokenPredicates = searchTokens.flatMap((token) => [
    ilike(ragTextbookChunksTable.content, `%${token}%`),
    ilike(ragTextbookChunksTable.conceptTitle, `%${token}%`),
    ilike(ragTextbookChunksTable.conceptSummary, `%${token}%`),
    ilike(ragTextbookChunksTable.keywords, `%${token}%`),
  ]);
  const tokenClause = or(...tokenPredicates);
  if (!tokenClause) {
    return { query, count: 0, chunks: [] };
  }

  const textbookFormClause = textbookFormWhereClause(form);
  const filters = [
    subject ? eq(ragTextbooksTable.subject, subject) : undefined,
    textbookFormClause,
    chapterFilterClause,
  ].filter((v): v is NonNullable<typeof v> => v != null);
  const whereClause = filters.length > 0 ? and(...filters, tokenClause) : tokenClause;

  const tokenPredicatesPaper = searchTokens.flatMap((token) => [
    ilike(ragPastPaperChunksTable.content, `%${token}%`),
    ilike(ragPastPaperChunksTable.conceptTitle, `%${token}%`),
    ilike(ragPastPaperChunksTable.conceptSummary, `%${token}%`),
    ilike(ragPastPaperChunksTable.keywords, `%${token}%`),
  ]);
  const tokenClausePaper = or(...tokenPredicatesPaper);
  const paperFormClause = pastPaperFormWhereClause(form);
  const paperFilters = [
    subject ? eq(ragPastPapersTable.subject, subject) : undefined,
    paperFormClause,
  ].filter((v): v is NonNullable<typeof v> => v != null);
  const whereClausePaper =
    tokenClausePaper == null
      ? undefined
      : paperFilters.length > 0
        ? and(...paperFilters, tokenClausePaper)
        : tokenClausePaper;

  const rows = await ragDb
    .select({
      textbookId: ragTextbooksTable.textbookId,
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      title: ragTextbooksTable.title,
      sourceName: ragTextbooksTable.sourceName,
      chunkId: ragTextbookChunksTable.chunkId,
      chunkIndex: ragTextbookChunksTable.chunkIndex,
      conceptTitle: ragTextbookChunksTable.conceptTitle,
      conceptSummary: ragTextbookChunksTable.conceptSummary,
      keywords: ragTextbookChunksTable.keywords,
      chapter: ragTextbookChunksTable.chapter,
      pageStart: ragTextbookChunksTable.pageStart,
      pageEnd: ragTextbookChunksTable.pageEnd,
      content: ragTextbookChunksTable.content,
      uploadedAt: ragTextbooksTable.uploadedAt,
    })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
    .where(whereClause)
    .orderBy(desc(ragTextbooksTable.uploadedAt))
    .limit(candidateLimit);

  const paperRows =
    whereClausePaper != null
      ? await ragDb!
          .select({
            paperId: ragPastPapersTable.paperId,
            subject: ragPastPapersTable.subject,
            form: ragPastPapersTable.form,
            title: ragPastPapersTable.title,
            year: ragPastPapersTable.year,
            paperLabel: ragPastPapersTable.paperLabel,
            sourceName: ragPastPapersTable.sourceName,
            chunkId: ragPastPaperChunksTable.chunkId,
            chunkIndex: ragPastPaperChunksTable.chunkIndex,
            conceptTitle: ragPastPaperChunksTable.conceptTitle,
            conceptSummary: ragPastPaperChunksTable.conceptSummary,
            keywords: ragPastPaperChunksTable.keywords,
            questionRef: ragPastPaperChunksTable.questionRef,
            maxMarks: ragPastPaperChunksTable.maxMarks,
            pageStart: ragPastPaperChunksTable.pageStart,
            pageEnd: ragPastPaperChunksTable.pageEnd,
            content: ragPastPaperChunksTable.content,
            uploadedAt: ragPastPapersTable.uploadedAt,
          })
          .from(ragPastPaperChunksTable)
          .innerJoin(ragPastPapersTable, eq(ragPastPaperChunksTable.pastPaperDbId, ragPastPapersTable.id))
          .where(whereClausePaper)
          .orderBy(desc(ragPastPapersTable.uploadedAt))
          .limit(candidateLimit)
      : [];

  const qualityFilteredRows = rows.filter((row) => !isLowQualityChunk(row.content));
  const qualityFilteredPaperRows = paperRows.filter((row) => !isLowQualityPastPaperChunk(row.content));

  const mapRowToScored = (params: {
    sourceType: RetrievedChunkSource;
    textbookId: string;
    subject: string;
    form: string;
    title: string;
    chunkId: string;
    chunkIndex: number;
    conceptTitle: string | null | undefined;
    conceptSummary: string | null | undefined;
    keywords: string | null | undefined;
    content: string;
    chapter?: string;
    pageStart?: number;
    pageEnd?: number;
    questionRef?: string;
    maxMarks?: number | null;
    year?: number | null;
    paperLabel?: string | null;
    sourceName?: string | null;
    scoreBoost: number;
  }): RetrievedChunk => {
    const retrievalText = [params.conceptTitle ?? "", params.conceptSummary ?? "", params.keywords ?? "", params.content]
      .filter(Boolean)
      .join("\n");
    const base =
      conceptProfile == null
        ? scoreChunkRelevance(query, retrievalText)
        : scoreChunk(queryTokens, equationAnchors, retrievalText, query, conceptProfile);
    return {
      score: base + params.scoreBoost,
      sourceType: params.sourceType,
      textbookId: params.textbookId,
      subject: params.subject,
      form: params.form,
      title: params.title,
      chunkId: params.chunkId,
      chunkIndex: params.chunkIndex,
      conceptTitle: params.conceptTitle ?? undefined,
      conceptSummary: params.conceptSummary ?? undefined,
      keywords: params.keywords ? params.keywords.split(",").map((k) => k.trim()).filter(Boolean) : undefined,
      chapter: params.chapter,
      pageStart: params.pageStart,
      pageEnd: params.pageEnd,
      questionRef: params.questionRef,
      maxMarks: params.maxMarks ?? undefined,
      year: params.year ?? undefined,
      paperLabel: params.paperLabel ?? undefined,
      sourceName: params.sourceName ?? undefined,
      content: params.content,
    };
  };

  const textbookScored: RetrievedChunk[] = qualityFilteredRows.map((row) => {
    const chapterBoost =
      chapterHintLower.length >= 2 && row.chapter?.toLowerCase().includes(chapterHintLower) ? 0.45 : 0;
    return mapRowToScored({
      sourceType: "textbook",
      textbookId: row.textbookId,
      subject: row.subject,
      form: row.form,
      title: row.title,
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      conceptTitle: row.conceptTitle,
      conceptSummary: row.conceptSummary,
      keywords: row.keywords,
      content: row.content,
      chapter: row.chapter ?? undefined,
      pageStart: row.pageStart ?? undefined,
      pageEnd: row.pageEnd ?? undefined,
      sourceName: row.sourceName ?? undefined,
      scoreBoost: chapterBoost,
    });
  });

  const paperScored: RetrievedChunk[] = qualityFilteredPaperRows.map((row) =>
    mapRowToScored({
      sourceType: "past_paper",
      textbookId: row.paperId,
      subject: row.subject,
      form: row.form,
      title: row.title,
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      conceptTitle: row.conceptTitle,
      conceptSummary: row.conceptSummary,
      keywords: row.keywords,
      content: row.content,
      pageStart: row.pageStart ?? undefined,
      pageEnd: row.pageEnd ?? undefined,
      questionRef: row.questionRef ?? undefined,
      maxMarks: row.maxMarks ?? undefined,
      year: row.year ?? undefined,
      paperLabel: row.paperLabel ?? undefined,
      sourceName: row.sourceName ?? undefined,
      scoreBoost: PAST_PAPER_RETRIEVAL_BOOST,
    }),
  );

  const ranked: RetrievedChunk[] = [...textbookScored, ...paperScored]
    .filter((row) => row.score >= 0.35)
    .filter((row) =>
      passesRelevanceGate(
        queryTokens,
        equationAnchors,
        [row.conceptTitle ?? "", row.conceptSummary ?? "", row.content].join("\n"),
        conceptProfile,
      ),
    )
    .sort((a, b) => b.score - a.score);

  const generalSyllabusMode = chapterFilterSanitized.length < 2 && chapterHintLower.length < 2;
  const diversified = generalSyllabusMode
    ? diversifyChunksAcrossChapters(ranked, topK)
    : ranked.slice(0, topK);
  const scored = ensurePastPaperMix(ranked, diversified, topK);

  return {
    query,
    count: scored.length,
    chunks: scored,
  };
}

/**
 * Load physically adjacent textbook chunks (by chunk_index) for rubric/question grounding.
 * Ingest order is sequential — related content usually spans consecutive indices.
 */
export async function fetchConsecutiveTextbookChunks(
  primary: RetrievedChunk,
  radius = 2,
): Promise<RetrievedChunk[]> {
  if (!ragDb || primary.sourceType !== "textbook") return [primary];

  const lo = Math.max(0, primary.chunkIndex - radius);
  const hi = primary.chunkIndex + radius;

  const rows = await ragDb
    .select({
      textbookId: ragTextbooksTable.textbookId,
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      title: ragTextbooksTable.title,
      chunkId: ragTextbookChunksTable.chunkId,
      chunkIndex: ragTextbookChunksTable.chunkIndex,
      conceptTitle: ragTextbookChunksTable.conceptTitle,
      conceptSummary: ragTextbookChunksTable.conceptSummary,
      keywords: ragTextbookChunksTable.keywords,
      chapter: ragTextbookChunksTable.chapter,
      pageStart: ragTextbookChunksTable.pageStart,
      pageEnd: ragTextbookChunksTable.pageEnd,
      content: ragTextbookChunksTable.content,
    })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
    .where(
      and(
        eq(ragTextbooksTable.textbookId, primary.textbookId),
        gte(ragTextbookChunksTable.chunkIndex, lo),
        lte(ragTextbookChunksTable.chunkIndex, hi),
      ),
    )
    .orderBy(asc(ragTextbookChunksTable.chunkIndex));

  const quality = rows.filter((row) => !isLowQualityChunk(row.content));
  if (quality.length === 0) return [primary];

  return quality.map((row) => ({
    score: primary.score - Math.abs(row.chunkIndex - primary.chunkIndex) * 0.05,
    sourceType: "textbook" as const,
    textbookId: row.textbookId,
    subject: row.subject,
    form: row.form,
    title: row.title,
    chunkId: row.chunkId,
    chunkIndex: row.chunkIndex,
    conceptTitle: row.conceptTitle ?? undefined,
    conceptSummary: row.conceptSummary ?? undefined,
    keywords: row.keywords
      ? row.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : undefined,
    chapter: row.chapter ?? undefined,
    pageStart: row.pageStart ?? undefined,
    pageEnd: row.pageEnd ?? undefined,
    content: row.content,
  }));
}

function tagForSource(sourceType: RetrievedChunkSource): string {
  return sourceType === "past_paper" ? "[PAST PAPER MARK SCHEME]" : "[TEXTBOOK CONTEXT]";
}

export function buildGradingContextFromChunks(query: string, chunks: RetrievedChunk[]): GradingContextPayload {
  const contextBlocks = chunks.map((chunk, index) => {
    const contextTag = tagForSource(chunk.sourceType);
    return {
      label: `Context ${index + 1}`,
      contextTag,
      sourceType: chunk.sourceType,
      content: chunk.content,
      score: chunk.score,
      source: {
        textbookId: chunk.textbookId,
        subject: chunk.subject,
        form: chunk.form,
        title: chunk.title,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
      },
    };
  });

  const mergedContextText = contextBlocks
    .map(
      (block) =>
        `${block.contextTag} [${block.label}] ${block.source.title} (${block.source.subject} ${block.source.form})\n${block.content}`,
    )
    .join("\n\n---\n\n");

  return {
    query,
    contextBlocks,
    mergedContextText,
  };
}

export function buildGradingContextPayload(result: RetrieveChunksResult): GradingContextPayload {
  return buildGradingContextFromChunks(result.query, result.chunks);
}
