import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearAuth,
  getAuth,
  setAuth,
  type AuthUser,
  type StoredAuth,
} from "@/lib/auth-storage";

type AuthContextValue = {
  auth: StoredAuth | null;
  user: AuthUser | null;
  login: (payload: StoredAuth) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<StoredAuth | null>(() =>
    typeof window !== "undefined" ? getAuth() : null,
  );

  const login = useCallback((payload: StoredAuth) => {
    setAuth(payload);
    setAuthState(payload);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuthState(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      user: auth?.user ?? null,
      login,
      logout,
    }),
    [auth, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
