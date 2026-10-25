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
  mfa_enabled: boolean;
  mfa_required: boolean;
}

export interface Me {
  user: User;
  csrf_token: string;
  session_idle_minutes: number;
  mfa_pending: boolean;
  mfa_setup_required: boolean;
  recovery_codes_left: number;
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
  retention_until: string | null;
  retention_hold_until: string | null;
}

export interface DuplicateRef {
  id: number;
  number: string;
  name: string;
}

export type FieldType = "text" | "textarea" | "date" | "select" | "checkbox" | "number";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: { value: string; label: string }[];
  help: string | null;
}

export interface DocTemplate {
  id: number;
  name: string;
  description: string | null;
  language: string;
  version: number;
  original_filename: string;
  variables: string[];
  builtins: string[];
  fields: TemplateField[];
  sensitive: boolean;
  allow_manager: boolean;
  download_formats: DownloadFormats;
  is_active: boolean;
  updated_at: string;
}

export type DownloadFormats = "pdf" | "docx" | "both";

export const DOWNLOAD_FORMAT_LABELS: Record<DownloadFormats, string> = {
  pdf: "PDF",
  docx: "Word",
  both: "PDF i Word",
};

export interface GeneratedDoc {
  id: string;
  template_id: number | null;
  template_name: string;
  template_version: number;
  has_pdf: boolean;
  created_by_name: string | null;
  created_at: string;
  contains_sensitive: boolean;
  accessible: boolean;
  can_view: boolean;
  download: ("pdf" | "docx")[];
  masked: boolean;
  pdf_error: string | null;
}

export interface Dashboard {
  active: number;
  terminated: number;
  added_30_days: number;
  without_photo: number;
  without_pesel: number | null;
  cards_printed_30_days: number;
  recent: Employee[];
  retention_due: number | null;
}

export interface RetentionItem {
  id: number;
  number: string;
  name: string;
  agency: string | null;
  termination_date: string | null;
  retention_end: string | null;
  delete_after: string | null;
  hold_until: string | null;
  hold_reason: string | null;
}

export interface RetentionOverview {
  years: number;
  today: string;
  due: RetentionItem[];
  upcoming: RetentionItem[];
  held: RetentionItem[];
  missing_date: RetentionItem[];
}

export const LANGUAGES: Record<string, string> = {
  pl: "polski",
  en: "angielski",
  uk: "ukraiński",
  ru: "rosyjski",
  de: "niemiecki",
  es: "hiszpański",
  ro: "rumuński",
  hi: "hindi",
  ne: "nepalski",
};

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

export const MFA_PATH = "/logowanie-dwuetapowe";

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
    if (res.status === 403 && code === "mfa_setup_required" && window.location.pathname !== MFA_PATH) {
      window.location.assign(MFA_PATH);
    }
    throw new ApiError(res.status, message, code, extra);
  }
  return data as T;
}

/** POST zwracający plik (np. PDF) – zapisuje go na dysku użytkownika. */
export async function apiDownload(path: string, body: unknown, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const { message, code, data: extra } = errorMessage(data?.detail, res.status);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, message, code, extra);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  cards_printed: "Druk kart",
  card_printed: "Druk karty",
  template_created: "Dodanie szablonu",
  template_updated: "Zmiana szablonu",
  template_file_replaced: "Nowa wersja pliku szablonu",
  document_generated: "Wygenerowanie dokumentu",
  document_downloaded: "Pobranie dokumentu",
  document_viewed: "Podgląd dokumentu",
  employee_purged: "Trwałe usunięcie danych pracownika (retencja)",
  retention_purge: "Usunięcie danych po okresie przechowywania",
  retention_hold_set: "Wstrzymanie usunięcia danych",
  retention_hold_cleared: "Zniesienie wstrzymania usunięcia",
  mfa_enabled: "Włączenie logowania dwuetapowego",
  mfa_disabled: "Wyłączenie logowania dwuetapowego",
  mfa_reset: "Reset logowania dwuetapowego",
  mfa_failed: "Błędny kod logowania dwuetapowego",
  mfa_recovery_used: "Logowanie kodem zapasowym",
  mfa_recovery_regenerated: "Nowe kody zapasowe",
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
