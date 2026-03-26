import AsyncStorage from "@react-native-async-storage/async-storage";

import { AUTH_TOKEN_STORAGE_KEY } from "../constants/storageKeys";
import { getMobileApiBaseUrl } from "./mobileApiBaseUrl";
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

export async function mobileApiGet<T>(endpoint: string): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const baseUrl = await getMobileApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "GET", url });
  const t0 = Date.now();
  const logId = networkLoggerStart({ method: "GET", url });
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const rawText = await response.text();
    const parsed = tryParseJson(rawText);
    const data = (parsed ?? { error: truncateText(rawText) }) as T & { error?: string };
    console.log("[Mobile API][Response]", {
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

export async function mobileApiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const baseUrl = await getMobileApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "POST", url });
  const t0 = Date.now();
  const logId = networkLoggerStart({ method: "POST", url, requestBody: body as unknown });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    const parsed = tryParseJson(rawText);
    const data = (parsed ?? { error: truncateText(rawText) }) as T & { error?: string };
    console.log("[Mobile API][Response]", {
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

export async function mobileApiPostFormData<T>(endpoint: string, formData: FormData): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const baseUrl = await getMobileApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "POST_FORMDATA", url });
  const t0 = Date.now();
  const logId = networkLoggerStart({ method: "POST_FORMDATA", url });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const rawText = await response.text();
    const parsed = tryParseJson(rawText);
    const data = (parsed ?? { error: truncateText(rawText) }) as T & { error?: string };
    console.log("[Mobile API][Response]", {
      method: "POST_FORMDATA",
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
