import { MOBILE_API_BASE_URL } from "../constants/api";

export type MobileAuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  school?: number;
};

export type MobileLoginResponse = {
  token: string;
  user: MobileAuthUser;
  /** False when student has school_id set (onboarding done). */
  needsOnboarding: boolean;
};

export type MobileSignUpPayload = {
  name: string;
  email: string;
  password: string;
  school?: string;
};

export type MobileGoogleAuthPayload = {
  idToken: string;
  school?: string;
};

type ApiErrorBody = {
  error?: string;
};

type ApiJson = Record<string, unknown>;

function parseAuthResponse(data: unknown): MobileLoginResponse {
  if (typeof data !== "object" || data == null) {
    throw new Error("Invalid authentication response");
  }
  const d = data as Record<string, unknown>;
  if (
    typeof d.token !== "string" ||
    typeof d.needsOnboarding !== "boolean" ||
    typeof d.user !== "object" ||
    d.user == null
  ) {
    throw new Error("Invalid authentication response");
  }
  return data as MobileLoginResponse;
}

async function postJson(endpoint: string, requestBody: ApiJson): Promise<{
  status: number;
  ok: boolean;
  data: unknown;
}> {
  const url = `${MOBILE_API_BASE_URL}${endpoint}`;
  console.log("[Mobile API][Request]", {
    method: "POST",
    url,
    body: requestBody,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    console.log("[Mobile API][Response]", {
      method: "POST",
      url,
      status: response.status,
      ok: response.ok,
      body: data,
    });

    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  } catch (error) {
    console.log("[Mobile API][Network Error]", {
      method: "POST",
      url,
      body: requestBody,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function loginWithPassword(email: string, password: string): Promise<MobileLoginResponse> {
  const response = await postJson("/auth/login", {
    email: email.trim().toLowerCase(),
    password,
  });
  const data = response.data as MobileLoginResponse | ApiErrorBody;

  if (!response.ok) {
    const apiMessage = "error" in data ? data.error : undefined;
    throw new Error(apiMessage ?? "Login failed");
  }

  return parseAuthResponse(data);
}

export async function signUpWithPassword(payload: MobileSignUpPayload): Promise<MobileLoginResponse> {
  const response = await postJson("/auth/signup", {
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    school: payload.school?.trim(),
  });
  const data = response.data as MobileLoginResponse | ApiErrorBody;

  if (!response.ok) {
    const apiMessage = "error" in data ? data.error : undefined;
    throw new Error(apiMessage ?? "Signup failed");
  }

  return parseAuthResponse(data);
}

export async function authenticateWithGoogle(
  payload: MobileGoogleAuthPayload
): Promise<MobileLoginResponse> {
  const response = await postJson("/auth/google", {
    idToken: payload.idToken,
    school: payload.school?.trim(),
  });
  const data = response.data as MobileLoginResponse | ApiErrorBody;

  if (!response.ok) {
    const apiMessage = "error" in data ? data.error : undefined;
    throw new Error(apiMessage ?? "Google authentication failed");
  }

  return parseAuthResponse(data);
}

export const loginWithGoogle = authenticateWithGoogle;
export const signUpWithGoogle = authenticateWithGoogle;
