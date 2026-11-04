// Strefy czasowe. Firma działa w czasie polskim (Europe/Warsaw); użytkownik może być w innej strefie –
// wykrytej z urządzenia albo wybranej ręcznie w „Logowanie i powiadomienia”. Godziny pokazujemy w strefie
// użytkownika, a gdy różni się ona od polskiej, dopisujemy miasto strefy albo czas polski.
import { translateText as t } from "./i18n";

export const HOME_TZ = "Europe/Warsaw";

export function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || HOME_TZ;
  } catch {
    return HOME_TZ;
  }
}

let userTz = deviceTz();
/** Ustawia strefę wyświetlania (z konta albo urządzenia) – wywołuje I18nProvider. */
export function setUserTz(tz: string | null | undefined) {
  userTz = tz && validTz(tz) ? tz : deviceTz();
}
export const currentTz = () => userTz;

export function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("pl-PL", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** „Europe/Kyiv” → „Kyiv”, „America/New_York” → „New York”. */
export const tzCity = (tz: string) => {
  const c = tz.split("/").pop()!.replace(/_/g, " ");
  return c === "Kiev" ? "Kyiv" : c; // starsza nazwa strefy w części przeglądarek
};

/** Przesunięcie strefy względem UTC w minutach dla danej chwili. */
export function tzOffset(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Czy w tej chwili strefa użytkownika ma inną godzinę niż Polska. */
export const differsFromHome = (at: Date = new Date(), tz = userTz) => tzOffset(at, tz) !== tzOffset(at, HOME_TZ);

const fmt = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => d.toLocaleString("pl-PL", { timeZone: tz, ...o });
export const timeIn = (d: Date, tz = userTz) => fmt(d, tz, { hour: "2-digit", minute: "2-digit" });

/** Data i godzina w strefie użytkownika; poza strefą polską z miastem strefy: „04.11.2026, 23:00 (Kyiv)”. */
export function dateTimeText(value: string | Date): string {
  const d = new Date(value);
  const s = fmt(d, userTz, { dateStyle: "short", timeStyle: "short" });
  return differsFromHome(d) ? `${s} (${tzCity(userTz)})` : s;
}

/** Godzina w strefie użytkownika (listy wiadomości): dziś godzina, wcześniej dzień i miesiąc. */
export function shortTimeText(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => fmt(x, userTz, { year: "numeric", month: "2-digit", day: "2-digit" });
  return day(d) === day(new Date()) ? timeIn(d) : fmt(d, userTz, { day: "2-digit", month: "2-digit" });
}

/**
 * Godzina ustalona przez firmę (przerwa techniczna, termin): „22:00 czasu polskiego (23:00 u Ciebie)”;
 * w Polsce samo „22:00”.
 */
export function homeTimeText(value: string | Date): string {
  const d = new Date(value);
  const home = timeIn(d, HOME_TZ);
  return differsFromHome(d) ? `${home} ${t("czasu polskiego")} (${timeIn(d)} ${t("u Ciebie")})` : home;
}

/** Wartość pola datetime-local („2026-11-04T22:00”) w danej strefie → ISO (UTC). */
export function zonedInputToIso(value: string, tz: string): string | null {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let at = guess - tzOffset(new Date(guess), tz) * 60_000;
  at = guess - tzOffset(new Date(at), tz) * 60_000; // poprawka na zmianę czasu
  return new Date(at).toISOString();
}

/** ISO → wartość pola datetime-local w danej strefie. */
export function isoToZonedInput(iso: string | null, tz: string): string {
  if (!iso) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Strefy do wyboru: najczęstsze u pracowników na górze, potem wszystkie. */
export const COMMON_TZ = ["Europe/Warsaw", "Europe/Kyiv", "Europe/Minsk", "Europe/Vilnius", "Europe/Berlin", "Europe/London", "Europe/Bucharest", "Asia/Tbilisi", "Asia/Kolkata", "Asia/Manila", "Asia/Kathmandu"];
export function allTimezones(): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? COMMON_TZ;
  return [...COMMON_TZ.filter((z) => validTz(z)), ...all.filter((z) => !COMMON_TZ.includes(z))];
}
/** „Kyiv (UTC+2)” – etykieta strefy z aktualnym przesunięciem. */
export function tzLabel(tz: string): string {
  const off = tzOffset(new Date(), tz);
  const sign = off >= 0 ? "+" : "−";
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `${tz === HOME_TZ ? t("Czas polski") : tzCity(tz)} (UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""})`;
}
