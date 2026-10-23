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
  code: string | null;
  name: string;
  is_active: boolean;
}

export interface PositionItem {
  id: number;
  name: string;
  department_id: number | null;
  is_active: boolean;
}

export interface CountryItem {
  id: number;
  name: string;
  iso_code: string | null;
  is_active: boolean;
}

export interface Ref {
  id: number;
  name: string;
}

export type Sex = "K" | "M";
export type EmployeeStatus = "active" | "terminated";

export interface Employee {
  id: number;
  number: number;
  number_display: string;
  first_name: string;
  last_name: string;
  sex: Sex | null;
  birth_date: string | null;
  age: number | null;
  has_pesel: boolean;
  pesel_masked: string | null;
  country: Ref | null;
  agency: Ref | null;
  department: Ref | null;
  position: Ref | null;
  hire_date: string | null;
  termination_date: string | null;
  status: EmployeeStatus;
  notes: string | null;
  has_photo: boolean;
  photo_version: string | null;
  personal_data_visible: boolean;
}

export interface DuplicateRef {
  id: number;
  number: string;
  name: string;
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
  data?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
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

function errorMessage(
  detail: unknown,
  status: number,
): { message: string; code?: string; data?: Record<string, unknown> } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object" && "message" in detail) {
    const d = detail as { message: string; code?: string };
    return { message: d.message, code: d.code, data: detail as Record<string, unknown> };
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    const msg = first?.msg?.replace(/^Value error, /, "");
    return { message: msg ? `Niepoprawne dane: ${msg}` : "Niepoprawne dane w formularzu." };
  }
  if (status === 413) return { message: "Plik jest za duży." };
  return { message: `Błąd serwera (${status}).` };
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { message, code, data: extra } = errorMessage(data?.detail, res.status);
    if (res.status === 401 && path !== "/auth/login" && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, message, code, extra);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Wystąpił nieoczekiwany błąd.";
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
  employee_created: "Dodanie pracownika",
  employee_updated: "Zmiana danych pracownika",
  employee_terminated: "Przeniesienie do archiwum",
  employee_restored: "Przywrócenie z archiwum",
  pesel_viewed: "Odczyt PESEL",
  photo_uploaded: "Zmiana zdjęcia",
  photo_deleted: "Usunięcie zdjęcia",
  agency_created: "Dodanie APT",
  agency_updated: "Zmiana APT",
  department_created: "Dodanie wydziału",
  department_updated: "Zmiana wydziału",
  position_created: "Dodanie stanowiska",
  position_updated: "Zmiana stanowiska",
  country_created: "Dodanie kraju",
  country_updated: "Zmiana kraju",
  import_completed: "Import z pliku",
};

export const FIELD_LABELS: Record<string, string> = {
  first_name: "imię",
  last_name: "nazwisko",
  sex: "płeć",
  birth_date: "data urodzenia",
  pesel: "PESEL",
  country_id: "obywatelstwo",
  agency_id: "APT",
  department_id: "wydział",
  position_id: "stanowisko",
  hire_date: "data zatrudnienia",
  notes: "uwagi",
};

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
