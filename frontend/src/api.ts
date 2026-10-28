// Cienka warstwa nad fetch: ciasteczko sesji idzie automatycznie,
// token CSRF dodajemy do każdego żądania zmieniającego dane.

export type Role = "admin" | "hr" | "manager" | "viewer" | "agency" | "employee";

export interface Scope {
  agency_id: number | null;
  department_id: number | null;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  scopes: Scope[];
  agency_id?: number | null;
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
  real_role?: Role | null;
  sim_role?: Role | null;
  sim_agency_id?: number | null;
  sim_department_id?: number | null;
}

export interface DictionaryItem {
  id: number;
  code: string | null;
  name: string;
  is_active: boolean;
  email?: string | null;
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
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_phone_verified?: boolean;
  contact_email_verified?: boolean;
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
  archived?: boolean;
  termination_date?: string | null;
}

export type FieldType = "text" | "textarea" | "date" | "select" | "checkbox" | "number";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: { value: string; label: string }[];
  help: string | null;
  format?: string | null;
  pattern?: string | null;
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
  strict_pdf: boolean;
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
  can_delete?: boolean;
  download: ("pdf" | "docx")[];
  masked: boolean;
  pdf_error: string | null;
  signature_roles: string[];
  signed_at: string | null;
  has_signed_pdf: boolean;
  signature_pending: boolean;
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
  backup: BackupStatus | null;
}

export interface BackupRun {
  at: string;
  ok: boolean;
  info: string;
}

export interface BackupStatus {
  local: BackupRun | null;
  offsite: BackupRun | null;
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

// Konto obsługiwane przez tę kartę przeglądarki (kilka kont może być zalogowanych naraz).
const ACCOUNT_KEY = "apt-account";
let accountId: number | null = (() => {
  try {
    const v = Number(sessionStorage.getItem(ACCOUNT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
})();

export function setAccountId(id: number | null) {
  accountId = id;
  try {
    if (id === null) sessionStorage.removeItem(ACCOUNT_KEY);
    else sessionStorage.setItem(ACCOUNT_KEY, String(id));
  } catch {
    /* tryb prywatny */
  }
}

export function getAccountId(): number | null {
  return accountId;
}

/** Adres pliku / obrazu (bez nagłówków): dopisuje, które konto ma go pobrać. */
export function withAcct(url: string): string {
  if (accountId === null) return url;
  return url + (url.includes("?") ? "&" : "?") + `acct=${accountId}`;
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

let linkAccess: string | null = null;

/** Klucz dostępu strony „aktualizacja danych” (po potwierdzeniu daty urodzenia) – tylko w pamięci. */
export function setLinkAccess(key: string | null): void {
  linkAccess = key;
}
export function getLinkAccess(): string | null {
  return linkAccess;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accountId !== null) headers["X-APT-Account"] = String(accountId);
  if (linkAccess && path.startsWith("/data-link/")) headers["X-Link-Access"] = linkAccess;
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
  const headers: Record<string, string> = {};
  if (accountId !== null) headers["X-APT-Account"] = String(accountId);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
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
  agency: "Agencja pracy",
  employee: "Pracownik",
};

export const ACTION_LABELS: Record<string, string> = {
  login: "Logowanie",
  logout: "Wylogowanie",
  session_expired: "Automatyczne wylogowanie (wygaśnięcie sesji)",
  login_failed: "Nieudane logowanie",
  login_blocked: "Próba logowania na zablokowane konto",
  password_changed: "Zmiana hasła",
  password_change_failed: "Nieudana zmiana hasła",
  password_reset: "Reset hasła",
  user_created: "Utworzenie użytkownika",
  user_updated: "Zmiana użytkownika",
  user_unlocked: "Odblokowanie konta",
  employee_created: "Dodanie pracownika",
  agency_report_sent: "Wysłanie zestawienia do agencji",
  agency_report_downloaded: "Pobranie zestawienia dla agencji",
  medical_exam_added: "Dodanie badania lekarskiego",
  medical_exam_viewed: "Podgląd badania lekarskiego",
  medical_exam_deleted: "Usunięcie badania lekarskiego",
  employee_request_created: "Zgłoszenie nowej osoby (agencja)",
  employee_request_approved: "Zatwierdzenie zgłoszenia agencji",
  employee_request_rejected: "Odrzucenie zgłoszenia agencji",
  role_simulation: "Symulacja uprawnień",
  employee_updated: "Zmiana danych pracownika",
  employee_terminated: "Przeniesienie do archiwum",
  employee_restored: "Przywrócenie z archiwum",
  pesel_viewed: "Odczyt PESEL",
  photo_uploaded: "Zmiana zdjęcia",
  signature_link_despite_account: "Link do podpisu mimo konta pracownika",
  data_link_created: "Wysłano link do aktualizacji danych",
  data_link_cancelled: "Unieważniono link do aktualizacji danych",
  data_link_locked: "Zablokowano link do aktualizacji danych",
  contact_code_sent: "Wysłano kod potwierdzający kontakt",
  contact_changed: "Zmiana danych kontaktowych",
  hr_thread_created: "Nowa wiadomość do kadr",
  hr_message_sent: "Wiadomość pracownika do kadr",
  hr_message_replied: "Odpowiedź kadr",
  hr_thread_status: "Zmiana statusu wiadomości",
  contact_removed: "Usunięcie danych kontaktowych",
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
  card_scanned: "Skanowanie karty",
  password_reset_requested: "Prośba o reset hasła e-mailem",
  password_set_by_link: "Ustawienie hasła przez link z e-maila",
  password_link_sent: "Wysłanie linku do ustawienia hasła",
  employees_exported: "Eksport listy pracowników",
  report_exported: "Eksport zestawienia",
  template_created: "Dodanie szablonu",
  template_updated: "Zmiana szablonu",
  template_file_replaced: "Nowa wersja pliku szablonu",
  document_generated: "Wygenerowanie dokumentu",
  document_downloaded: "Pobranie dokumentu",
  document_viewed: "Podgląd dokumentu",
  document_deleted: "Trwałe usunięcie dokumentu",
  document_trashed: "Usunięcie dokumentu (do kosza)",
  document_restored: "Przywrócenie dokumentu z kosza",
  document_emailed: "Wysłanie dokumentu e-mailem",
  hr_thread_auto_closed: "Automatyczne zamknięcie rozmowy",
  signature_removed: "Usunięcie podpisu",
  employee_purged: "Trwałe usunięcie danych pracownika (retencja)",
  retention_purge: "Usunięcie danych po okresie przechowywania",
  retention_hold_set: "Wstrzymanie usunięcia danych",
  retention_hold_cleared: "Zniesienie wstrzymania usunięcia",
  mfa_enabled: "Włączenie logowania dwuetapowego",
  passkey_added: "Dodanie klucza dostępu",
  passkey_removed: "Usunięcie klucza dostępu",
  passkey_reauth_failed: "Nieudane potwierdzenie przed dodaniem klucza",
  employee_account_invited: "Zaproszenie do konta pracownika",
  employee_account_activated: "Aktywacja konta pracownika",
  employee_account_disabled: "Wyłączenie konta pracownika",
  employee_account_enabled: "Włączenie konta pracownika",
  employee_account_reset: "Reset dostępu konta pracownika",
  mfa_disabled: "Wyłączenie logowania dwuetapowego",
  mfa_reset: "Reset logowania dwuetapowego",
  mfa_failed: "Błędny kod logowania dwuetapowego",
  mfa_recovery_used: "Logowanie kodem zapasowym",
  mfa_recovery_regenerated: "Nowe kody zapasowe",
  training_created: "Dodanie szkolenia",
  employee_rehired: "Ponowne zatrudnienie",
  signature_requested: "Wysłanie dokumentu do podpisu",
  signature_cancelled: "Anulowanie prośby o podpis",
  signature_scan_uploaded: "Dołączenie skanu podpisanego dokumentu",
  document_signed: "Podpisanie dokumentu",
  planned_change_created: "Zaplanowanie zmiany przydziału",
  planned_change_applied: "Wprowadzenie zaplanowanej zmiany",
  planned_change_cancelled: "Anulowanie zaplanowanej zmiany",
  checklist_created: "Utworzenie checklisty",
  checklist_item_updated: "Zmiana pozycji checklisty",
  checklist_template_updated: "Zmiana szablonu checklisty",
  position_requirements_set: "Zmiana wymaganych szkoleń stanowiska",
  trainings_imported: "Import szkoleń",
  training_updated: "Zmiana szkolenia",
  training_deleted: "Usunięcie szkolenia",
  training_scan_uploaded: "Dodanie skanu zaświadczenia",
  training_scan_deleted: "Usunięcie skanu zaświadczenia",
  training_type_created: "Dodanie rodzaju szkolenia",
  training_type_updated: "Zmiana rodzaju szkolenia",
  training_program_saved: "Zmiana katalogu szkoleń stanowiskowych",
  training_program_deleted: "Usunięcie pozycji z katalogu szkoleń",
  training_mentors_set: "Zmiana uprawnień opiekunów szkoleń",
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

export interface ReportRow {
  name: string;
  count: number;
}

export interface ReportSummary {
  generated_at: string;
  active: number;
  terminated: number;
  by_agency: ReportRow[];
  by_department: ReportRow[];
  by_position: ReportRow[];
  by_country: ReportRow[];
  by_sex: ReportRow[];
  agency_department: { agency: string; department: string; count: number }[];
  months: { month: string; label: string; hired: number; terminated: number }[];
  missing_photo: number;
  missing_pesel: number | null;
}

// ---------- szkolenia ----------

export type TrainingKind = "general" | "position";

export interface TrainingProgram {
  id: number;
  type_id: number;
  name: string;
  department_id: number | null;
  department: string | null;
  standard_days: number | null;
  is_active: boolean;
  mentors: { id: number; name: string; active: boolean }[];
}

export interface MentorProgram {
  id: number;
  type_name: string;
  name: string;
  department: string | null;
}

export interface TrainingType {
  id: number;
  name: string;
  kind: TrainingKind;
  validity_months: number | null;
  fields: TemplateField[]; // z szablonu dokumentu
  programs: TrainingProgram[];
  template_id: number | null;
  template_name: string | null;
  is_active: boolean;
  in_use: number;
}

export type TrainingStatus = "valid" | "expiring" | "expired" | "none" | "completed" | "planned" | "in_progress" | "overdue";

export interface Training {
  id: number;
  employee_id: number;
  type_id: number;
  type_name: string;
  kind: TrainingKind;
  program_id: number | null;
  name: string | null;
  department_id: number | null;
  department: string | null;
  start_date: string | null;
  exam_date: string | null;
  end_date: string | null;
  completed_on: string | null;
  valid_until: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
  standard_days: number | null;
  values: Record<string, string | boolean | number | null>;
  notes: string | null;
  has_scan: boolean;
  scan_name: string | null;
  status: TrainingStatus;
  days: number | null;
  can_generate: boolean;
  created_by_name: string | null;
}

export interface ExpiringTraining {
  training_id: number;
  employee_id: number;
  number: string;
  last_name: string;
  first_name: string;
  department: string | null;
  type_name: string;
  name: string | null;
  valid_until: string;
  status: TrainingStatus;
}

export const TRAINING_STATUS: Record<TrainingStatus, { label: string; color: string }> = {
  valid: { label: "ważne", color: "teal" },
  expiring: { label: "kończy się", color: "orange" },
  expired: { label: "wygasło", color: "red" },
  none: { label: "bez daty", color: "gray" },
  completed: { label: "ukończone", color: "teal" },
  planned: { label: "zaplanowane", color: "gray" },
  in_progress: { label: "w trakcie", color: "blue" },
  overdue: { label: "ponad standard", color: "red" },
};

export interface InProgressTraining {
  training_id: number;
  employee_id: number;
  number: string;
  last_name: string;
  first_name: string;
  name: string | null;
  type_name: string;
  department: string | null;
  mentor_name: string | null;
  start_date: string;
  exam_date: string | null;
  standard_days: number | null;
  days: number;
  status: TrainingStatus;
}

export interface MedicalExam {
  id: number;
  kind: "wstepne" | "okresowe" | "kontrolne";
  kind_label: string;
  exam_date: string;
  valid_until: string | null;
  state: "valid" | "expiring" | "expired" | "none";
  has_file: boolean;
  original_name: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  can_delete: boolean;
}

export interface EmployeeRequest {
  id: number;
  agency: { id: number; name: string };
  first_name: string;
  last_name: string;
  pesel: string | null;
  birth_date: string | null;
  country_id: number | null;
  department_id: number | null;
  position_id: number | null;
  hire_date: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_by_name: string | null;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  employee_id: number | null;
}
