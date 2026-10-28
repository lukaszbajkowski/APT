// Instalacja aplikacji (PWA). Przeglądarki oparte na Chrome zgłaszają `beforeinstallprompt` zaraz po
// załadowaniu strony, więc zdarzenie zapamiętujemy globalnie i oddajemy komponentom, gdy go potrzebują.

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return deferred;
}

export function clearInstallPrompt() {
  deferred = null;
  emit();
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
