import { useEffect } from "react";

/** Tytuł karty przeglądarki i wpisu w historii: „Nazwa ekranu – APT iD” (czytniki ekranu ogłaszają go po zmianie ekranu). */
export function useDocTitle(title: string | undefined | null) {
  useEffect(() => {
    document.title = title ? `${title} – APT iD` : "APT iD";
  }, [title]);
}
