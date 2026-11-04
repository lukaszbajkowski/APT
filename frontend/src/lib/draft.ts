import { useCallback, useEffect, useState } from "react";

/**
 * Szkic tekstu w pamięci karty przeglądarki (sessionStorage): przypadkowe „Wstecz” albo zamknięcie wiadomości
 * nie kasuje wpisanego tekstu – po powrocie jest na miejscu. Czyści się po wysłaniu.
 */
export function useDraft(key: string): [string, (v: string) => void, () => void] {
  const read = () => {
    try {
      return sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const [value, setValue] = useState(read);
  useEffect(() => setValue(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        if (v) sessionStorage.setItem(key, v);
        else sessionStorage.removeItem(key);
      } catch {
        /* brak pamięci przeglądarki – szkic tylko do zamknięcia ekranu */
      }
    },
    [key],
  );
  const clear = useCallback(() => set(""), [set]);
  return [value, set, clear];
}
