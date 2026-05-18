import AsyncStorage from "@react-native-async-storage/async-storage";

import { AUTH_TOKEN_STORAGE_KEY } from "../constants/storageKeys";
import { getMobileApiBaseUrlPrefix } from "./mobileApiBaseUrl";
import { networkLoggerFinish, networkLoggerStart } from "./networkLogger";

function truncateText(input: string, max = 2000): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…(truncated ${input.length - max} chars)`;
}

function tryParseJson(text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

export async function ragApiGet<T>(endpoint: string, query?: Record<string, string>): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  const prefix = await getMobileApiBaseUrlPrefix();
  let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") params.set(k, v);
    }
    path += `?${params.toString()}`;
  }
  const url = `${prefix}/api${path}`;

  console.log("[RAG API][Request]", { method: "GET", url });
  const t0 = Date.now();
  const logId = networkLoggerStart({ method: "GET", url, requestBody: null });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const rawText = await response.text();
    const parsed = tryParseJson(rawText);
    const data = (parsed ?? { error: truncateText(rawText) }) as T & { error?: string };

    console.log("[RAG API][Response]", {
      method: "GET",
      url,
      status: response.status,
      ok: response.ok,
      body: parsed ?? truncateText(rawText),
    });

    networkLoggerFinish(logId, {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - t0,
      responseBody: parsed ?? truncateText(rawText),
    });

    if (!response.ok) {
      throw new Error(data.error ?? "Request failed");
    }

    return data;
  } catch (error) {
    networkLoggerFinish(logId, {
      durationMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function ragApiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

  const prefix = await getMobileApiBaseUrlPrefix();
  const url = `${prefix}/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  console.log("[RAG API][Request]", { method: "POST", url });
  const t0 = Date.now();
  const logId = networkLoggerStart({ method: "POST", url, requestBody: body });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    const parsed = tryParseJson(rawText);
    const data = (parsed ?? { error: truncateText(rawText) }) as T & { error?: string };

    console.log("[RAG API][Response]", {
      method: "POST",
      url,
      status: response.status,
      ok: response.ok,
      body: parsed ?? truncateText(rawText),
    });

    networkLoggerFinish(logId, {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - t0,
      responseBody: parsed ?? truncateText(rawText),
    });

    if (!response.ok) {
      throw new Error(data.error ?? "Request failed");
    }

    return data;
  } catch (error) {
    networkLoggerFinish(logId, {
      durationMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

