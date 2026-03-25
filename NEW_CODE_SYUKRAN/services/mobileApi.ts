import AsyncStorage from "@react-native-async-storage/async-storage";

import { MOBILE_API_BASE_URL } from "../constants/api";
import { AUTH_TOKEN_STORAGE_KEY } from "../constants/storageKeys";

export async function mobileApiGet<T>(endpoint: string): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const url = `${MOBILE_API_BASE_URL}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "GET", url });
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json()) as T & { error?: string };
  console.log("[Mobile API][Response]", {
    method: "GET",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

export async function mobileApiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const url = `${MOBILE_API_BASE_URL}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "POST", url });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  console.log("[Mobile API][Response]", {
    method: "POST",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}
