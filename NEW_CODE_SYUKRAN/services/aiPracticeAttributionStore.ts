import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { RagSourceAttribution } from "./mobilePracticeSets";

export type AiPracticeAttribution = {
  sourceLabel: string;
  sources: RagSourceAttribution[];
};

const STORAGE_KEY = "MYSPM_AI_PRACTICE_ATTRIBUTION";
const WEB_SESSION_KEY = "MYSPM_AI_PRACTICE_ATTRIBUTION";

/** In-memory cache (fast path within same JS session). */
let latestAttribution: AiPracticeAttribution | null = null;

function compactAttribution(attribution: AiPracticeAttribution): AiPracticeAttribution {
  return {
    sourceLabel: attribution.sourceLabel?.trim() ?? "",
    sources: (attribution.sources ?? []).slice(0, 8),
  };
}

function writeWebSessionAttribution(attribution: AiPracticeAttribution | null): void {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return;
  try {
    if (!attribution) {
      sessionStorage.removeItem(WEB_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(WEB_SESSION_KEY, JSON.stringify(compactAttribution(attribution)));
  } catch {
    // ignore quota / private mode
  }
}

function readWebSessionAttribution(): AiPracticeAttribution | null {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WEB_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiPracticeAttribution;
    const hasLabel = Boolean(parsed?.sourceLabel?.trim());
    const hasSources = Array.isArray(parsed?.sources) && parsed.sources.length > 0;
    if (!hasLabel && !hasSources) return null;
    return {
      sourceLabel: parsed.sourceLabel?.trim() ?? "",
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return null;
  }
}

export function setAiPracticeAttribution(attribution: AiPracticeAttribution): void {
  const sourceLabel = attribution.sourceLabel?.trim() ?? "";
  const sources = attribution.sources ?? [];
  if (!sourceLabel && sources.length === 0) {
    latestAttribution = null;
    writeWebSessionAttribution(null);
    void AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  latestAttribution = compactAttribution({ sourceLabel, sources });
  writeWebSessionAttribution(latestAttribution);
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(latestAttribution));
}

/** Await storage write before navigating to practice (web-safe). */
export async function persistAiPracticeAttribution(
  attribution: AiPracticeAttribution,
): Promise<void> {
  const sourceLabel = attribution.sourceLabel?.trim() ?? "";
  const sources = attribution.sources ?? [];
  if (!sourceLabel && sources.length === 0) {
    latestAttribution = null;
    writeWebSessionAttribution(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  latestAttribution = compactAttribution({ sourceLabel, sources });
  writeWebSessionAttribution(latestAttribution);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(latestAttribution));
}

export function getAiPracticeAttribution(): AiPracticeAttribution | null {
  if (latestAttribution?.sourceLabel?.trim() || (latestAttribution?.sources?.length ?? 0) > 0) {
    return latestAttribution;
  }
  const fromWeb = readWebSessionAttribution();
  if (fromWeb) latestAttribution = fromWeb;
  return latestAttribution;
}

export async function loadAiPracticeAttribution(): Promise<AiPracticeAttribution | null> {
  if (latestAttribution?.sourceLabel?.trim() || (latestAttribution?.sources?.length ?? 0) > 0) {
    return latestAttribution;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return latestAttribution;
    const parsed = JSON.parse(raw) as AiPracticeAttribution;
    const hasLabel = Boolean(parsed?.sourceLabel?.trim());
    const hasSources = Array.isArray(parsed?.sources) && parsed.sources.length > 0;
    if (hasLabel || hasSources) {
      latestAttribution = {
        sourceLabel: parsed.sourceLabel?.trim() ?? "",
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return latestAttribution;
}

export function clearAiPracticeAttribution(): void {
  latestAttribution = null;
  writeWebSessionAttribution(null);
  void AsyncStorage.removeItem(STORAGE_KEY);
}
