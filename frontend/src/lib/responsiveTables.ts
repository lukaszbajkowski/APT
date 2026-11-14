import { useEffect } from "react";
import { isPhone } from "./device";

/**
 * Na telefonie tabele zamieniają się w karty (CSS w app.css, `table[data-cards]`).
 * Ten hak dopisuje każdej komórce etykietę z nagłówka kolumny (`data-label`),
 * żeby w karcie było widać, co oznacza wartość. Działa dla wszystkich tabel Mantine;
 * tabelę, która ma zostać tabelą, oznacz atrybutem `data-keep-table`.
 */
export function useResponsiveTables() {
  useEffect(() => {
    let frame = 0;
    const label = () => {
      frame = 0;
      // telefon: listy wyboru bez wpisywania (bez klawiatury) – wybór tylko z listy
      if (isPhone) {
        document.querySelectorAll<HTMLInputElement>(".mantine-Select-input:not([readonly]):not([data-allow-typing])").forEach((el) => {
          el.readOnly = true;
          el.inputMode = "none";
        });
      }
      document.querySelectorAll<HTMLTableElement>("table.mantine-Table-table:not([data-keep-table])").forEach((table) => {
        const head = table.tHead?.rows[0];
        if (!head) return;
        const names: string[] = [];
        for (const th of Array.from(head.cells)) {
          const text = (th.textContent ?? "").replace(/[↑↓]/g, "").trim();
          for (let i = 0; i < (th.colSpan || 1); i++) names.push(text);
        }
        table.dataset.cards = "";
        for (const body of Array.from(table.tBodies)) {
          for (const row of Array.from(body.rows)) {
            let col = 0;
            for (const td of Array.from(row.cells)) {
              const name = names[col] ?? "";
              if (name) {
                if (td.dataset.label !== name) td.dataset.label = name;
              } else if (td.dataset.label !== undefined) delete td.dataset.label;
              col += td.colSpan || 1;
            }
          }
        }
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(label);
    };
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      obs.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
