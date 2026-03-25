import { MOBILE_API_BASE_URL } from "../constants/api";

export type MobileAuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  school?: string;
};

export type MobileLoginResponse = {
  token: string;
  user: MobileAuthUser;
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

  if (!("token" in data) || !("user" in data)) {
    throw new Error("Invalid login response");
  }

  return data;
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

  if (!("token" in data) || !("user" in data)) {
    throw new Error("Invalid signup response");
  }

  return data;
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

  if (!("token" in data) || !("user" in data)) {
    throw new Error("Invalid Google authentication response");
  }

  return data;
}

export const loginWithGoogle = authenticateWithGoogle;
export const signUpWithGoogle = authenticateWithGoogle;
