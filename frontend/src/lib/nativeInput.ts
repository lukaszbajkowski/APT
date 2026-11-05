import { useEffect, useRef, type RefObject } from "react";

/**
 * Natywne pole daty / godziny (systemowy wybór na telefonie) jako pole niekontrolowane przez Reacta.
 * Safari na iOS przy „Wyzeruj” czyści pole bez zdarzenia „input”, a kontrolowane pole React od razu
 * przywracał do starej wartości – wyglądało, jakby przycisk nie działał. Tu słuchamy wszystkich zdarzeń
 * („input”, „change”, „blur”) i sami ustawiamy wartość pola, gdy zmieni się z zewnątrz.
 */
export function useNativeValue(ref: RefObject<HTMLInputElement>, value: string, onValue: (v: string) => void) {
  const cb = useRef(onValue);
  cb.current = onValue;
  const last = useRef(value);
  useEffect(() => {
    last.current = value;
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [ref, value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      if (el.value !== last.current) {
        last.current = el.value;
        cb.current(el.value);
      }
    };
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    el.addEventListener("blur", sync);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
      el.removeEventListener("blur", sync);
    };
  }, [ref]);
}
