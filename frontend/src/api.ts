// Cienka warstwa nad fetch: ciasteczko sesji idzie automatycznie,
// token CSRF dodajemy do każdego żądania zmieniającego dane.

export type Role = "admin" | "hr" | "manager" | "viewer";

export interface Scope {
  agency_id: number | null;
  department_id: number | null;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  scopes: Scope[];
}

export interface Me {
  user: User;
  csrf_token: string;
  session_idle_minutes: number;
}

export interface DictionaryItem {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface AuditEntry {
  id: number;
  ts: string;
  user_id: number | null;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

function errorMessage(detail: unknown, status: number): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object" && "message" in detail) {
    const d = detail as { message: string; code?: string };
    return { message: d.message, code: d.code };
  }
  if (Array.isArray(detail)) return { message: "Niepoprawne dane w formularzu." };
  return { message: `Błąd serwera (${status}).` };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { message, code } = errorMessage(data?.detail, res.status);
    if (res.status === 401 && path !== "/auth/login" && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, message, code);
  }
  return data as T;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  hr: "Kadry",
  manager: "Kierownik",
  viewer: "Podgląd",
};

export const ACTION_LABELS: Record<string, string> = {
  login: "Logowanie",
  logout: "Wylogowanie",
  login_failed: "Nieudane logowanie",
  login_blocked: "Próba logowania na zablokowane konto",
  password_changed: "Zmiana hasła",
  password_change_failed: "Nieudana zmiana hasła",
  password_reset: "Reset hasła",
  user_created: "Utworzenie użytkownika",
  user_updated: "Zmiana użytkownika",
  user_unlocked: "Odblokowanie konta",
};

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
