import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken, setUnauthorizedHandler, type Me, type Role } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const setMe = useCallback((value: Me | null) => {
    setCsrfToken(value?.csrf_token ?? null);
    setMeState(value);
  }, []);

  const clear = useCallback(() => {
    setMe(null);
    queryClient.clear();
  }, [setMe, queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    api<Me>("/auth/me")
      .then(setMe)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
        setMe(null);
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [clear, setMe]);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api<Me>("/auth/login", { method: "POST", body: { username, password } });
      setMe(result);
      return result;
    },
    [setMe],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      login,
      logout,
      setMe,
      hasRole: (...roles) => !!me && roles.includes(me.user.role),
    }),
    [me, loading, login, logout, setMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth poza AuthProvider");
  return ctx;
}
