// Rodzaj urządzenia – decyduje, który interfejs dostaje użytkownik (telefon albo komputer).
// Nie zależy od szerokości okna: telefon obrócony w poziom dalej ma interfejs telefonu,
// a zwężone okno na komputerze dalej ma interfejs komputera (tylko węższy).
//
// telefon – ekran dotykowy, krótszy bok < 600 px (krótszy bok nie zmienia się przy obracaniu)
// tablet  – ekran dotykowy, krótszy bok ≥ 600 px; dostaje interfejs komputerowy
// komputer – mysz / gładzik
//
// Do podglądu na komputerze: ?urzadzenie=telefon|tablet|komputer (zapamiętane do zamknięcia karty).
export type Device = "phone" | "tablet" | "desktop";

const OVERRIDE_KEY = "apt-device";
const NAMES: Record<string, Device> = { telefon: "phone", tablet: "tablet", komputer: "desktop" };

function override(): Device | null {
  try {
    const q = new URLSearchParams(window.location.search).get("urzadzenie");
    if (q && NAMES[q]) {
      sessionStorage.setItem(OVERRIDE_KEY, NAMES[q]);
      return NAMES[q];
    }
    if (q === "auto") sessionStorage.removeItem(OVERRIDE_KEY);
    const s = sessionStorage.getItem(OVERRIDE_KEY);
    return s === "phone" || s === "tablet" || s === "desktop" ? s : null;
  } catch {
    return null;
  }
}

export function detectDevice(): Device {
  if (typeof window === "undefined") return "desktop";
  const forced = override();
  if (forced) return forced;
  // tylko rodzaj wskaźnika i rozmiar ekranu – podpowiedź „mobile” z przeglądarki bywa ustawiona też na tabletach
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const short = Math.min(window.screen.width, window.screen.height);
  if (touch && short < 600) return "phone";
  if (touch) return "tablet";
  return "desktop";
}

// ustalane raz, przed pierwszym wyświetleniem – interfejs nie przeskakuje przy obracaniu ani zmianie okna
export const device: Device = detectDevice();
export const isPhone = device === "phone";

export function markDevice() {
  document.documentElement.dataset.device = device;
}

/** Czy pokazać interfejs telefonu. Stała przez całą wizytę (hak dla czytelności w komponentach). */
export function useIsPhone(): boolean {
  return isPhone;
}
