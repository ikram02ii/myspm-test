import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image, Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

import { AUTH_USER_STORAGE_KEY } from "../constants/storageKeys";
import { mobileApiPostFormData } from "./mobileApi";
import { mobileApiGet } from "./mobileApi";
import type { MobileAuthUser } from "./mobileAuth";

const UPLOAD_MAX_WIDTH = 1280;
const UPLOAD_JPEG_QUALITY = 0.82;

async function prepareImageForUpload(photoUri: string): Promise<string> {
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(photoUri, (w, h) => resolve({ width: w, height: h }), reject);
    });
    const actions =
      size.width > UPLOAD_MAX_WIDTH ? [{ resize: { width: UPLOAD_MAX_WIDTH } }] : [];
    const result = await ImageManipulator.manipulateAsync(photoUri, actions, {
      compress: UPLOAD_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    const result = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ resize: { width: UPLOAD_MAX_WIDTH } }],
      { compress: UPLOAD_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  }
}

async function appendImageToFormData(form: FormData, photoUri: string): Promise<void> {
  const uri = await prepareImageForUpload(photoUri);
  const fileName = `scan-${Date.now()}.jpg`;

  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    form.append("image", blob, fileName);
    return;
  }

  form.append("image", {
    uri,
    name: fileName,
    type: "image/jpeg",
  } as any);
}

export type MobileScanUploadResponse = {
  key: string;
  url: string;
};

export type ScanHistoryItem = {
  key: string;
  url: string;
  uploadedAt: string | null;
  size: number | null;
};

export type ScanHistoryResponse = {
  items: ScanHistoryItem[];
};

/** POST /api/scan success body (Qwen OCR text) */
export type AiScanOcrResult = {
  text: string;
};

async function getStoredUserEmail(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as MobileAuthUser;
    const e = typeof user.email === "string" ? user.email.trim() : "";
    return e.length > 0 ? e : null;
  } catch {
    return null;
  }
}

function getAiScanBaseUrl(): string | null {
  const u = process.env.EXPO_PUBLIC_AI_SCAN_BASE_URL?.trim();
  return u && u.length > 0 ? u.replace(/\/$/, "") : null;
}

/**
 * POST image to main API `POST /api/scan` (multipart: image + email). Requires `auth_user` in AsyncStorage. Set EXPO_PUBLIC_AI_SCAN_BASE_URL in .env (base URL only, no /api).
 */
export async function uploadScanImageWithAiTutor(photoUri: string): Promise<AiScanOcrResult> {
  const email = await getStoredUserEmail();
  if (!email) {
    throw new Error("Sign in so your scan can be stored under your account (email required).");
  }

  const form = new FormData();
  form.append("email", email);
  await appendImageToFormData(form, photoUri);

  const base = getAiScanBaseUrl();
  if (!base) {
    throw new Error("EXPO_PUBLIC_AI_SCAN_BASE_URL is not set");
  }
  const url = `${base}/api/scan`;

  const response = await fetch(url, { method: "POST", body: form });
  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 280) || `Scan failed (${response.status})`);
  }

  if (!response.ok) {
    const err = parsed as { error?: string; detail?: string };
    throw new Error(err.detail || err.error || `Scan failed (${response.status})`);
  }

  return parsed as AiScanOcrResult;
}

export function isAiScanBackendConfigured(): boolean {
  return getAiScanBaseUrl() != null;
}

export async function uploadScanImage(photoUri: string): Promise<MobileScanUploadResponse> {
  const attemptUpload = async () => {
    const form = new FormData();
    await appendImageToFormData(form, photoUri);
    return await mobileApiPostFormData<MobileScanUploadResponse>("/scan/upload", form);
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await attemptUpload();
    } catch (error) {
      lastError = error;
      console.error(error);
      // small backoff for intermittent mobile networks
      await new Promise((r) => setTimeout(r, attempt * 450));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

export async function fetchScanHistory(): Promise<ScanHistoryResponse> {
  return await mobileApiGet<ScanHistoryResponse>("/scan/history");
}

