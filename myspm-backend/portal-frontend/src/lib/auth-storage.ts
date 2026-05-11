const AUTH_KEY = "myspm_auth";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  school?: string;
};

export type StoredAuth = {
  token: string;
  user: AuthUser;
};

export function getAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.token || !parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthToken(): string | null {
  return getAuth()?.token ?? null;
}
