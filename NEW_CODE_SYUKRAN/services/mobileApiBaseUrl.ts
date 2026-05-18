import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const FALLBACK_DEFAULT_PREFIX = "http://10.0.2.2:3000";

const fromEnv =
  process.env.EXPO_PUBLIC_DEFAULT_MOBILE_API_BASE_URL_PREFIX?.trim() ||
  process.env.DEFAULT_MOBILE_API_BASE_URL_PREFIX?.trim() ||
  "";

export const DEFAULT_MOBILE_API_BASE_URL_PREFIX = fromEnv.length > 0 ? fromEnv : FALLBACK_DEFAULT_PREFIX;
const STORAGE_KEY = "MYSPM_MOBILE_API_BASE_URL_PREFIX";

function normalizePrefix(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return toReachablePrefix(DEFAULT_MOBILE_API_BASE_URL_PREFIX);
  const noTrailing = trimmed.replace(/\/+$/, "");
  const idx = noTrailing.toLowerCase().indexOf("/api/mobile");
  if (idx >= 0) {
    return toReachablePrefix(
      noTrailing.slice(0, idx).replace(/\/+$/, "") || DEFAULT_MOBILE_API_BASE_URL_PREFIX,
    );
  }
  return toReachablePrefix(noTrailing);
}

function toReachablePrefix(prefix: string): string {
  if (Platform.OS !== "web") return prefix;
  return prefix.replace("://10.0.2.2:", "://localhost:");
}

export async function getMobileApiBaseUrlPrefix(): Promise<string> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return normalizePrefix(raw ?? "");
}

export async function setMobileApiBaseUrlPrefix(input: string): Promise<string> {
  const normalized = normalizePrefix(input);
  await AsyncStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export async function getMobileApiBaseUrl(): Promise<string> {
  const prefix = await getMobileApiBaseUrlPrefix();
  return `${prefix}/api/mobile`;
}

