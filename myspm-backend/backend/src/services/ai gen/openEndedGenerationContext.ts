import { randomUUID } from "crypto";
import type { RetrievedChunk } from "../ama/types";

type CachedRetrieval = {
  hits: RetrievedChunk[];
  expiresAt: number;
};

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CachedRetrieval>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
}

export function storeRetrievalContext(hits: RetrievedChunk[]): string {
  pruneExpired();
  const id = randomUUID();
  cache.set(id, { hits, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getRetrievalContext(contextId: string | undefined | null): RetrievedChunk[] | null {
  if (!contextId?.trim()) return null;
  pruneExpired();
  const entry = cache.get(contextId.trim());
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(contextId.trim());
    return null;
  }
  return entry.hits;
}
