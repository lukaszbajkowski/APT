import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setAccountId, setCsrfToken, setUnauthorizedHandler, type Me, type Role } from "./api";
import { useIdleLogout } from "./idle";

export interface Account {
  id: number;
  username: string;
  full_name: string;
  role: Role;
}

interface AuthState {
  me: Me | null;
  accounts: Account[];
  switchAccount: (id: number) => void;
  addAccount: () => void;
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const queryClient = useQueryClient();
  const meRef = useRef<Me | null>(null);

  const setMe = useCallback((value: Me | null) => {
    setCsrfToken(value?.csrf_token ?? null);
    if (value) setAccountId(value.user.id);
    meRef.current = value;
    setMeState(value);
  }, []);

  // Czyścimy dane tylko po wygaśnięciu prawdziwej sesji. Gość (np. strona resetu hasła)
  // też dostaje 401 z /auth/me – wyczyszczenie pamięci zapytań zawiesiłoby jego stronę.
  const clear = useCallback(() => {
    if (meRef.current === null) return;
    try {
      sessionStorage.setItem("apt-session-expired", "1");
    } catch {
      /* tryb prywatny */
    }
    setMe(null);
    queryClient.clear();
  }, [setMe, queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    api<Me>("/auth/me")
      .catch(async (e) => {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        // konto tej karty wylogowano – spróbuj innego zalogowanego w tej przeglądarce
        setAccountId(null);
        const others = await api<Account[]>("/auth/accounts").catch(() => [] as Account[]);
        if (others.length === 0) throw e;
        setAccountId(others[0].id);
        return api<Me>("/auth/me");
      })
      .then((m) => {
        setMe(m);
        // ostatnio użyte konto jest domyślne dla nowych kart
        if (!m.mfa_pending) api("/auth/active", { method: "POST" }).catch(() => undefined);
      })
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

  // lista kont zalogowanych w tej przeglądarce (do przełącznika)
  useEffect(() => {
    if (!me || me.mfa_pending) {
      setAccounts([]);
      return;
    }
    api<Account[]>("/auth/accounts")
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [me]);

  const switchAccount = useCallback((id: number) => {
    setAccountId(id);
    window.location.assign("/");
  }, []);

  const addAccount = useCallback(() => {
    window.location.assign("/login?dodaj=1");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      setAccountId(null);
      queryClient.clear();
    }
    // wylogowano jedno konto – jeśli w przeglądarce jest drugie, przechodzimy do niego
    const others = await api<Account[]>("/auth/accounts").catch(() => [] as Account[]);
    if (others.length > 0) switchAccount(others[0].id);
  }, [setMe, queryClient, switchAccount]);

  const onIdle = useCallback(async () => {
    try {
      await api("/auth/logout?reason=idle", { method: "POST" });
    } catch {
      /* sesja mogła już wygasnąć na serwerze */
    }
    setMe(null);
    queryClient.clear();
    window.location.assign("/login?powod=bezczynnosc");
  }, [setMe, queryClient]);
  useIdleLogout(!!me && !me.mfa_pending, me?.session_idle_minutes ?? 0, onIdle);

  const value = useMemo<AuthState>(
    () => ({
      me,
      accounts,
      switchAccount,
      addAccount,
      loading,
      login,
      logout,
      setMe,
      hasRole: (...roles) => !!me && roles.includes(me.user.role),
    }),
    [me, accounts, switchAccount, addAccount, loading, login, logout, setMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth poza AuthProvider");
  return ctx;
}
