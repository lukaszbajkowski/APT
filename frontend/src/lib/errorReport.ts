import { reportClientError } from "../api";

/* Błędy JS z przeglądarki trafiają do „Stan systemu → Błędy” (administrator). Bez danych osobowych:
 * wysyłamy rodzaj błędu, komunikat i ścieżkę ekranu bez parametrów; serwer dodatkowo wycina cyfry i e-maile.
 * Najwyżej 10 zgłoszeń na wczytanie strony, każde inne tylko raz. */
const sent = new Set<string>();
let left = 10;

function where(): string {
  // ścieżka bez parametrów i bez identyfikatorów (/pracownicy/123 → /pracownicy/:id)
  return window.location.pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function reportError(err: unknown, kind?: string): void {
  if (left <= 0) return;
  const e = err instanceof Error ? err : null;
  const k = kind ?? e?.name ?? "Błąd";
  const message = (e?.message ?? String(err ?? "")).slice(0, 1000);
  // ostatni fragment stosu: plik i miejsce w kodzie (bez danych), pomaga znaleźć źródło
  const at = e?.stack?.split("\n").find((l) => /\.(js|tsx?)/.test(l))?.trim().slice(0, 300) ?? "";
  const key = `${k}|${message}|${where()}`;
  if (sent.has(key)) return;
  sent.add(key);
  left -= 1;
  reportClientError({ kind: k, message: at ? `${message} — ${at}` : message, path: where() });
}

export function installErrorReporting(): void {
  window.addEventListener("error", (ev) => {
    // błędy ładowania zasobów (obrazki itp.) pomijamy – zgłaszamy tylko błędy skryptów
    if (ev.error || ev.message) reportError(ev.error ?? ev.message, ev.error ? undefined : "Błąd skryptu");
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason as { status?: number } | undefined;
    // odrzucone zapytania API (np. 4xx) obsługuje interfejs – tu tylko prawdziwe wyjątki
    if (r && typeof r.status === "number") return;
    reportError(ev.reason, "Nieobsłużone odrzucenie");
  });
}
