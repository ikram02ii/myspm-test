const DEFAULT_MOBILE_API_BASE_URL = "http://10.0.2.2:3000/api/mobile";

const fromEnv = process.env.EXPO_PUBLIC_MOBILE_API_BASE_URL?.trim();
const selectedBaseUrl = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MOBILE_API_BASE_URL;

export const MOBILE_API_BASE_URL = selectedBaseUrl.replace(/\/+$/, "");
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? "";
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() ?? "";
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? "";
