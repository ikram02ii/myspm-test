import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

import { mobileApiPostFormData } from "./mobileApi";
import { mobileApiGet } from "./mobileApi";

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

export async function uploadScanImage(photoUri: string): Promise<MobileScanUploadResponse> {
  const attemptUpload = async () => {
    const uri = await prepareImageForUpload(photoUri);
    const form = new FormData();
    form.append("image", {
      uri,
      name: `scan-${Date.now()}.jpg`,
      type: "image/jpeg",
    } as any);
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

