import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  ragDb,
  ragPastPaperChunksTable,
  ragPastPapersTable,
  ragTextbookChunksTable,
  ragTextbooksTable,
} from "../../lib/ragDb";
import type {
  GradingContextPayload,
  RetrieveChunksInput,
  RetrieveChunksResult,
  RetrievedChunk,
  RetrievedChunkSource,
} from "./types";

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
const PAST_PAPER_RETRIEVAL_BOOST = 0.12;

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

  const filters = [
    subject ? eq(ragTextbooksTable.subject, subject) : undefined,
    form ? eq(ragTextbooksTable.form, form) : undefined,
  ].filter((v): v is ReturnType<typeof eq> => v != null);
  const whereClause = filters.length > 0 ? and(...filters, tokenClause) : tokenClause;

  const tokenPredicatesPaper = searchTokens.flatMap((token) => [
    ilike(ragPastPaperChunksTable.content, `%${token}%`),
    ilike(ragPastPaperChunksTable.conceptTitle, `%${token}%`),
    ilike(ragPastPaperChunksTable.conceptSummary, `%${token}%`),
    ilike(ragPastPaperChunksTable.keywords, `%${token}%`),
  ]);
  const tokenClausePaper = or(...tokenPredicatesPaper);
  const paperFilters = [
    subject ? eq(ragPastPapersTable.subject, subject) : undefined,
    form ? eq(ragPastPapersTable.form, form) : undefined,
  ].filter((v): v is ReturnType<typeof eq> => v != null);
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
      ? await ragDb
          .select({
            paperId: ragPastPapersTable.paperId,
            subject: ragPastPapersTable.subject,
            form: ragPastPapersTable.form,
            title: ragPastPapersTable.title,
            chunkId: ragPastPaperChunksTable.chunkId,
            chunkIndex: ragPastPaperChunksTable.chunkIndex,
            conceptTitle: ragPastPaperChunksTable.conceptTitle,
            conceptSummary: ragPastPaperChunksTable.conceptSummary,
            keywords: ragPastPaperChunksTable.keywords,
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

  const mapToScored = (
    sourceType: RetrievedChunkSource,
    textbookId: string,
    subjectVal: string,
    formVal: string,
    titleVal: string,
    chunkId: string,
    chunkIndex: number,
    conceptTitle: string | null | undefined,
    conceptSummary: string | null | undefined,
    keywords: string | null | undefined,
    content: string,
    chapter: string | undefined,
    pageStart: number | undefined,
    pageEnd: number | undefined,
    scoreBoost: number,
  ): RetrievedChunk => {
    const retrievalText = [conceptTitle ?? "", conceptSummary ?? "", keywords ?? "", content]
      .filter(Boolean)
      .join("\n");
    const base =
      conceptProfile == null
        ? scoreChunkRelevance(query, retrievalText)
        : scoreChunk(queryTokens, equationAnchors, retrievalText, query, conceptProfile);
    return {
      score: base + scoreBoost,
      sourceType,
      textbookId,
      subject: subjectVal,
      form: formVal,
      title: titleVal,
      chunkId,
      chunkIndex,
      conceptTitle: conceptTitle ?? undefined,
      conceptSummary: conceptSummary ?? undefined,
      keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : undefined,
      chapter,
      pageStart,
      pageEnd,
      content,
    };
  };

  const textbookScored: RetrievedChunk[] = qualityFilteredRows.map((row) =>
    mapToScored(
      "textbook",
      row.textbookId,
      row.subject,
      row.form,
      row.title,
      row.chunkId,
      row.chunkIndex,
      row.conceptTitle,
      row.conceptSummary,
      row.keywords,
      row.content,
      row.chapter ?? undefined,
      row.pageStart ?? undefined,
      row.pageEnd ?? undefined,
      0,
    ),
  );

  const paperScored: RetrievedChunk[] = qualityFilteredPaperRows.map((row) =>
    mapToScored(
      "past_paper",
      row.paperId,
      row.subject,
      row.form,
      row.title,
      row.chunkId,
      row.chunkIndex,
      row.conceptTitle,
      row.conceptSummary,
      row.keywords,
      row.content,
      undefined,
      undefined,
      undefined,
      PAST_PAPER_RETRIEVAL_BOOST,
    ),
  );

  const scored: RetrievedChunk[] = [...textbookScored, ...paperScored]
    .filter((row) => row.score >= 0.35)
    .filter((row) =>
      passesRelevanceGate(
        queryTokens,
        equationAnchors,
        [row.conceptTitle ?? "", row.conceptSummary ?? "", row.content].join("\n"),
        conceptProfile,
      ),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    query,
    count: scored.length,
    chunks: scored,
  };
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
