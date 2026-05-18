import type { QuestionAnalysis, RubricIdea } from "./types";
import type { RubricStructureContext } from "./rubricStructureHints";
import {
  enrichRubricRowFromSynonymClusters,
  normalizeAnswerText,
  rubricIdeaRequiresRouteDetail,
} from "./gradingFairnessMatch";

function significantTokens(text: string): string[] {
  return normalizeAnswerText(text)
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 2 &&
        !/\b(the|and|for|are|was|with|from|that|this|when|than|then|will|have|has|had|not|but|its|more|most|less|also|only|very|such|into|each|their|they|them|explain|describe|how|why|what|which|rate|reaction|increases|increase|faster|slower)\b/i.test(
          t,
        ),
    );
}

function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(significantTokens(a));
  const tb = new Set(significantTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter / Math.min(ta.size, tb.size);
}

/** Only keep requiresCausalLink when an isolated keyword would be ambiguous without a relationship. */
export function ideaGenuinelyNeedsCausalLink(idea: string): boolean {
  const n = normalizeAnswerText(idea);
  const tokens = n.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length >= 5) return false;
  if (/\b(move|faster|kinetic|collision|activation|energy|exposed|surface|particle|transport|transports|distribut)\b/i.test(n)) {
    return false;
  }
  if (tokens.length <= 2 && /\b(collision|temperature|energy|osmosis|diffusion)\b/i.test(n)) return true;
  return false;
}

export function sanitizeRequiresCausalLink(ideas: RubricIdea[]): RubricIdea[] {
  return ideas.map((idea) => {
    if (!idea.requiresCausalLink) return idea;
    if (ideaGenuinelyNeedsCausalLink(idea.idea)) return idea;
    const { requiresCausalLink: _removed, ...rest } = idea;
    return rest;
  });
}

function isVagueSummaryIdea(idea: string): boolean {
  const n = normalizeAnswerText(idea);
  return (
    /\b(explain how|describe how|how does|how do|why does|why do|kesan|bagaimana)\b/i.test(n) ||
    (/\bhow\b/.test(n) && /\b(increase|decrease|affect|influences|meningkat|berkurang)\b/i.test(n) && n.split(/\s+/).length > 10)
  );
}

function ideaTokensSubsetOf(shorter: string, longer: string): boolean {
  const short = significantTokens(shorter);
  const long = new Set(significantTokens(longer));
  if (short.length < 2) return false;
  const covered = short.filter((t) => long.has(t)).length;
  return covered / short.length >= 0.85;
}

export function dedupeAndPruneRubricIdeas(ideas: RubricIdea[]): RubricIdea[] {
  const kept: RubricIdea[] = [];
  for (const idea of ideas) {
    const dup = kept.some((k) => tokenOverlapRatio(k.idea, idea.idea) >= 0.72);
    if (dup) continue;
    kept.push(idea);
  }

  const withoutSummary: RubricIdea[] = [];
  for (const idea of kept) {
    if (!isVagueSummaryIdea(idea.idea)) {
      withoutSummary.push(idea);
      continue;
    }
    const atomicCovers = kept.filter((k) => k !== idea && !isVagueSummaryIdea(k.idea));
    const summaryTokens = significantTokens(idea.idea);
    const coveredByAtomic =
      atomicCovers.length >= 2 &&
      summaryTokens.filter((t) => atomicCovers.some((a) => significantTokens(a.idea).includes(t))).length >=
        Math.min(3, summaryTokens.length);
    if (!coveredByAtomic) withoutSummary.push(idea);
  }

  const pruned: RubricIdea[] = [];
  for (const idea of withoutSummary) {
    const swallowed = pruned.some(
      (k) => ideaTokensSubsetOf(k.idea, idea.idea) && k.idea.length < idea.idea.length && isVagueSummaryIdea(idea.idea),
    );
    if (swallowed) continue;
    const redundantLong = pruned.findIndex(
      (k) => ideaTokensSubsetOf(k.idea, idea.idea) && idea.idea.length > k.idea.length * 1.25,
    );
    if (redundantLong >= 0 && isVagueSummaryIdea(idea.idea)) {
      pruned.splice(redundantLong, 1);
    }
    pruned.push(idea);
  }

  return pruned.map((idea, idx) => ({ ...idea, id: `i${idx + 1}` }));
}

const TRANSPORT_VERB = /\b(transport|transports|carry|carries|move|moves|translocat|distribut|distributes|flow|flows)\b/i;

function fragmentTooShortToSplit(text: string): boolean {
  const words = significantTokens(text);
  return words.length < 4;
}

function splitMergedTransportRow(idea: RubricIdea): RubricIdea[] | null {
  const text = idea.idea.trim();
  if (!TRANSPORT_VERB.test(text) || !rubricIdeaRequiresRouteDetail(text)) return null;
  if (fragmentTooShortToSplit(text)) return null;

  const fromIdx = text.search(/\bfrom\b/i);
  const whatPart = (fromIdx > 0 ? text.slice(0, fromIdx) : text).replace(/\s+/g, " ").trim();
  const routePart = (fromIdx >= 0 ? text.slice(fromIdx) : "").trim();

  const whatIdea =
    whatPart.length >= 8
      ? whatPart
      : "States what is transported or the main substance/role carried";
  const routeIdea =
    routePart.length >= 8 ? routePart : "States the route or direction (source to destination)";
  if (fragmentTooShortToSplit(whatIdea) || fragmentTooShortToSplit(routeIdea)) return null;

  const splitRows: RubricIdea[] = [
    {
      ...idea,
      id: "i1",
      idea: whatIdea.slice(0, 200),
      marks: 1,
      kind: idea.kind === "function" ? "function" : "point",
    },
    {
      ...idea,
      id: "i2",
      idea: routeIdea.slice(0, 200),
      marks: 1,
      kind: idea.kind === "function" ? "function" : "point",
    },
  ];
  return splitRows.map((row) => enrichRubricRowFromSynonymClusters(row));
}

const STOP_BACKFILL = new Set([
  "the", "and", "for", "are", "was", "with", "from", "that", "this", "when", "than", "then", "will", "have", "has",
  "had", "not", "but", "its", "one", "two", "may", "can", "use", "also", "only", "very", "such", "more", "most", "less",
  "like", "just", "even", "other", "onto", "upon", "over", "under", "both", "some", "any", "all", "per", "via", "your",
  "explain", "describe", "state", "name", "give", "list", "any", "valid", "example", "correct",
]);

function keywordsFromIdeaText(idea: string): string[] {
  return [
    ...new Set(
      normalizeAnswerText(idea)
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP_BACKFILL.has(w)),
    ),
  ].slice(0, 5);
}

function inferKindFromIdea(idea: RubricIdea): RubricIdea["kind"] {
  if (idea.kind) return idea.kind;
  if (idea.openEnded === true) return "example";
  const n = normalizeAnswerText(idea.idea);
  if (/\b(equation|balanced|reactant|product|coefficient|persamaan)\b/i.test(n)) return "equation";
  if (/\b(method|formula|substitut|working)\b/i.test(n)) return "method";
  if (/\b(accuracy|final\s+value|answer\s+with\s+unit)\b/i.test(n)) return "accuracy";
  if (/\b(application|suggest|predict|reasoning)\b/i.test(n)) return "application";
  return "point";
}

/** D1: deterministic metadata repair for DB rows and fresh LLM rubrics. */
export function backfillRubricRowMetadata(ideas: RubricIdea[], analysis: QuestionAnalysis): RubricIdea[] {
  const demand = analysis.demandType;
  let rows = ideas.map((row) => {
    const kind = inferKindFromIdea(row);
    const openEnded =
      row.openEnded ??
      (kind === "example" || kind === "application" || demand === "example" || demand === "application");
    const next: RubricIdea = {
      ...row,
      kind,
      openEnded,
      demandType: row.demandType ?? demand,
    };
    if (analysis.isEquationQuestion && kind === "equation") {
      next.equationType = row.equationType ?? analysis.equationType ?? "symbol";
    }
    if (!next.keywords || next.keywords.length === 0) {
      next.keywords = openEnded ? [] : keywordsFromIdeaText(next.idea);
    }
    return next;
  });

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === "accuracy" && !row.dependsOnRowId) {
      for (let j = i - 1; j >= 0; j -= 1) {
        if (rows[j].kind === "method") {
          rows[i] = { ...row, dependsOnRowId: rows[j].id };
          break;
        }
      }
    }
  }

  rows = rows.map((row) => {
    if (!rubricIdeaRequiresRouteDetail(row.idea)) return row;
    const n = normalizeAnswerText(row.idea);
    if (/\broots\b|\bakar\b/.test(n)) return row;
    return {
      ...row,
      idea: `${row.idea} (source to destination, e.g. leaves to roots or other parts)`.slice(0, 220),
    };
  });

  return rows;
}

/** Split any row that bundles transport/carry + route into separate mark points (all subjects). */
function splitBundledTransportRows(ideas: RubricIdea[], maxScore: number): RubricIdea[] {
  if (maxScore < 2 || ideas.length === 0) return ideas;

  const hasWhatOnly = ideas.some((i) => TRANSPORT_VERB.test(i.idea) && !rubricIdeaRequiresRouteDetail(i.idea));
  const hasRouteRow = ideas.some((i) => rubricIdeaRequiresRouteDetail(i.idea) && !TRANSPORT_VERB.test(i.idea));
  if (hasWhatOnly && hasRouteRow) return ideas;

  const expanded: RubricIdea[] = [];
  for (const idea of ideas) {
    const split = splitMergedTransportRow(idea);
    if (split) expanded.push(...split);
    else expanded.push(idea);
  }

  if (expanded.length > ideas.length) return expanded;

  if (
    ideas.length >= 2 &&
    ideas.every((i) => rubricIdeaRequiresRouteDetail(i.idea) || isVagueSummaryIdea(i.idea)) &&
    ideas.some((i) => TRANSPORT_VERB.test(i.idea))
  ) {
    const primary = ideas.find((i) => TRANSPORT_VERB.test(i.idea)) ?? ideas[0];
    const split = splitMergedTransportRow({ ...primary, idea: ideas.map((i) => i.idea).join("; ") });
    if (split) return split;
  }

  return ideas;
}

/** Drop extra “distribution/growth” rows when a route row already exists (common LLM duplicate). */
function dropOverlappingTransportCompanionRows(ideas: RubricIdea[]): RubricIdea[] {
  const routeRows = ideas.filter((i) => rubricIdeaRequiresRouteDetail(i.idea));
  if (routeRows.length === 0) return ideas;
  return ideas.filter((idea) => {
    if (routeRows.some((r) => r.id === idea.id)) return true;
    if (!TRANSPORT_VERB.test(idea.idea) && !/\bdistribut/i.test(idea.idea)) return true;
    return !routeRows.some((r) => tokenOverlapRatio(r.idea, idea.idea) >= 0.32);
  });
}

function capRubricRows(ideas: RubricIdea[], maxScore: number): RubricIdea[] {
  if (ideas.length <= maxScore) return ideas;
  const ranked = ideas.map((idea, idx) => ({
    idea,
    idx,
    rank: isVagueSummaryIdea(idea.idea) ? 2 : rubricIdeaRequiresRouteDetail(idea.idea) ? 0 : 1,
  }));
  ranked.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  return ranked.slice(0, maxScore).map((r) => r.idea);
}

/** Subject-agnostic post-processing only (no per-question answer templates). */
export function refineRubricIdeas(
  ideas: RubricIdea[],
  _question: string,
  maxScore: number,
  _structureContext?: RubricStructureContext | null,
  _analysis?: QuestionAnalysis | null,
): RubricIdea[] {
  const expanded = splitBundledTransportRows(ideas, maxScore);
  const companions = dropOverlappingTransportCompanionRows(expanded);
  const pruned = dedupeAndPruneRubricIdeas(companions);
  const capped = capRubricRows(pruned, maxScore);
  const sanitized = sanitizeRequiresCausalLink(capped);
  const enriched = (sanitized.length > 0 ? sanitized : ideas).map((row) => enrichRubricRowFromSynonymClusters(row));
  return enriched;
}
