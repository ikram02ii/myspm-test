import { mobileApiPostFormData } from "./mobileApi";
import { mobileApiGet } from "./mobileApi";

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
  const form = new FormData();
  form.append("image", {
    uri: photoUri,
    name: `scan-${Date.now()}.jpg`,
    type: "image/jpeg",
  } as any);

  return await mobileApiPostFormData<MobileScanUploadResponse>("/scan/upload", form);
}

export async function fetchScanHistory(): Promise<ScanHistoryResponse> {
  return await mobileApiGet<ScanHistoryResponse>("/scan/history");
}

