import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from "../constants/api";

let configured = false;

export function configureGoogleSignIn(): void {
  if (configured) return;
  try {
    // Expo Go on iOS may not include the native Google Sign-In module
    // (@react-native-google-signin/google-signin). If the native module
    // isn't available, avoid crashing so the rest of the app (Scan POC) works.
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      scopes: ["profile", "email"],
    });
    configured = true;
  } catch (e) {
    configured = false;
    console.warn("[GoogleSignIn] Native module missing; skipping configure.", e);
  }
}

export async function getGoogleIdToken(): Promise<string> {
  if (!configured) {
    configureGoogleSignIn();
  }
  if (!configured) {
    throw new Error("Google Sign-In is not available in this build (Expo Go on iOS).");
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  // Clear previous local Google session so account picker is shown again.
  await GoogleSignin.signOut().catch(() => undefined);
  const result = await GoogleSignin.signIn();
  const idToken =
    "data" in result && result.data && "idToken" in result.data ? result.data.idToken : null;
  if (!idToken) {
    // throw new Error("Google sign in failed: missing identity token");
    throw new Error("Please login to continue")
  }
  return idToken;
}

export function mapGoogleSignInError(error: unknown): string {
  if (typeof error !== "object" || error == null) {
    return "Google sign in failed";
  }

  const code = "code" in error ? (error as { code?: string }).code : undefined;
  if (code === statusCodes.SIGN_IN_CANCELLED) {
    return "Google sign in cancelled";
  }
  if (code === statusCodes.IN_PROGRESS) {
    return "Google sign in in progress";
  }
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return "Google Play Services not available";
  }
  if ("message" in error && typeof (error as { message?: string }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Google sign in failed";
}
