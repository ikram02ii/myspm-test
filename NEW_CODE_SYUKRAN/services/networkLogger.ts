type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish };

export type NetworkLogEntry = {
  id: string;
  ts: number;
  method: string;
  url: string;
  requestBody?: Jsonish;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  responseBody?: Jsonish;
  error?: string;
};

const MAX_LOGS = 200;

const logs: NetworkLogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function safeToJsonish(input: unknown): Jsonish {
  if (input === null) return null;
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) return input.map((x) => safeToJsonish(x));
  if (typeof input === "object") {
    const out: Record<string, Jsonish> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = safeToJsonish(v);
    }
    return out;
  }
  return String(input);
}

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function networkLoggerSubscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function networkLoggerGetLogs(): NetworkLogEntry[] {
  return [...logs].reverse();
}

export function networkLoggerClear() {
  logs.length = 0;
  notify();
}

export function networkLoggerStart(entry: {
  method: string;
  url: string;
  requestBody?: unknown;
}): string {
  const newEntry: NetworkLogEntry = {
    id: id(),
    ts: Date.now(),
    method: entry.method,
    url: entry.url,
    requestBody: entry.requestBody === undefined ? undefined : safeToJsonish(entry.requestBody),
  };
  logs.unshift(newEntry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  notify();
  return newEntry.id;
}

export function networkLoggerFinish(
  entryId: string,
  patch: {
    status?: number;
    ok?: boolean;
    durationMs?: number;
    responseBody?: unknown;
    error?: string;
  },
) {
  const idx = logs.findIndex((l) => l.id === entryId);
  if (idx < 0) return;
  const prev = logs[idx];
  logs[idx] = {
    ...prev,
    status: patch.status ?? prev.status,
    ok: patch.ok ?? prev.ok,
    durationMs: patch.durationMs ?? prev.durationMs,
    responseBody: patch.responseBody === undefined ? prev.responseBody : safeToJsonish(patch.responseBody),
    error: patch.error ?? prev.error,
  };
  notify();
}

