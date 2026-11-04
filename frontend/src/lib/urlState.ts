import { useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Zakładka zapisana w adresie (`?widok=archiwum`): przetrwa odświeżenie, powrót i link. Zmiana nie dodaje
 * wpisu do historii („Wstecz” nie przełącza zakładek po kolei).
 */
export function useUrlTab<T extends string>(name: string, values: readonly T[], fallback: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name) as T | null;
  const value = raw && values.includes(raw) ? raw : fallback;
  const set = useCallback(
    (v: T) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (v === fallback) n.delete(name);
          else n.set(name, v);
          return n;
        },
        { replace: true },
      ),
    [name, fallback, setParams],
  );
  return [value, set];
}

/**
 * Otwarty element (wiadomość, komunikat) w adresie (`?id=12`): otwarcie dodaje wpis do historii, więc systemowy
 * „Wstecz” (Android, gest przesunięcia) zamyka element zamiast opuszczać ekran. Strzałka w aplikacji robi to samo.
 */
export function useUrlOpen(name = "id"): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pushed = useRef(false);
  const raw = params.get(name);
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const set = useCallback(
    (id: number | null) => {
      if (id === null) {
        if (pushed.current) {
          pushed.current = false;
          navigate(-1);
        } else
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              n.delete(name);
              return n;
            },
            { replace: true },
          );
        return;
      }
      const replace = value !== null; // przejście z jednego otwartego do drugiego nie mnoży wpisów
      if (!replace) pushed.current = true;
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set(name, String(id));
          return n;
        },
        { replace },
      );
    },
    [name, navigate, setParams, value],
  );
  return [value, set];
}
