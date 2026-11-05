import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, UnstyledButton } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { useLang, useT } from "../lib/i18n";

// po polsku własne skróty (Intl daje „pon.”); w innym języku aplikacji nazwy z przeglądarki (Intl) – dokładne i bez tłumacza
const MONTHS_PL = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const DAYS_PL = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];
function names(lang: string | null) {
  if (!lang) return { months: MONTHS_PL, days: DAYS_PL };
  try {
    const mf = new Intl.DateTimeFormat(lang, { month: "long" });
    const df = new Intl.DateTimeFormat(lang, { weekday: "short" });
    return {
      months: Array.from({ length: 12 }, (_, i) => mf.format(new Date(2024, i, 1))),
      days: Array.from({ length: 7 }, (_, i) => df.format(new Date(2024, 0, 1 + i))), // 1.01.2024 = poniedziałek
    };
  } catch {
    return { months: MONTHS_PL, days: DAYS_PL };
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const todayIso = () => {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
};
const addDays = (v: string, n: number) => {
  const p = parse(v)!;
  const d = new Date(p.y, p.m, p.d + n);
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Kalendarz miesiąca (komputer): wybór dnia kliknięciem albo klawiaturą (strzałki, PageUp/PageDown – miesiąc,
 * Enter – wybór). Zastępuje natywny kalendarz przeglądarki, którego Safari na macOS nie zamyka po wyborze.
 * Wartości: RRRR-MM-DD.
 */
export function MonthCalendar({ value, onPick, min, max }: { value: string; onPick: (v: string) => void; min?: string; max?: string }) {
  const t = useT();
  const lang = useLang();
  const { months: MONTHS, days: DAYS } = names(lang);
  const start = parse(value) ?? parse(todayIso())!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [focus, setFocus] = useState(value || todayIso());
  const grid = useRef<HTMLDivElement>(null);

  // pierwszy dzień tygodnia: poniedziałek
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(view.y, view.m, 1 - lead + i);
    return { v: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), other: d.getMonth() !== view.m };
  });
  const off = (v: string) => (!!min && v < min) || (!!max && v > max);
  const shift = (n: number) => {
    const d = new Date(view.y, view.m + n, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  // fokus na dzień tylko przy poruszaniu się klawiaturą po kalendarzu – samo otwarcie nie może zabrać fokusu
  // z pola daty (inaczej nie da się wpisać daty ręcznie)
  const navigating = useRef(false);
  useEffect(() => {
    if (!navigating.current) return;
    grid.current?.querySelector<HTMLElement>(`[data-v="${focus}"]`)?.focus();
  }, [focus, view]);

  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]);
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const p = parse(focus)!;
      const d = new Date(p.y, p.m + (e.key === "PageUp" ? -1 : 1), p.d);
      next = iso(d.getFullYear(), d.getMonth(), d.getDate());
    } else if (e.key === "Home") next = iso(view.y, view.m, 1);
    else if (e.key === "End") next = iso(view.y, view.m + 1, 0);
    if (!next) return;
    e.preventDefault();
    navigating.current = true;
    const p = parse(next)!;
    if (p.y !== view.y || p.m !== view.m) setView({ y: p.y, m: p.m });
    setFocus(next);
  };

  const today = todayIso();
  return (
    <div className="ui-cal">
      <div className="ui-cal-head">
        <ActionIcon variant="subtle" color="gray" onClick={() => shift(-1)} aria-label={t("Poprzedni miesiąc")}>
          <IconChevronLeft size={18} />
        </ActionIcon>
        <span className="ui-cal-title" aria-live="polite">
          {MONTHS[view.m]} {view.y}
        </span>
        <ActionIcon variant="subtle" color="gray" onClick={() => shift(1)} aria-label={t("Następny miesiąc")}>
          <IconChevronRight size={18} />
        </ActionIcon>
      </div>
      <div className="ui-cal-grid" role="grid" ref={grid} onKeyDown={onKey}>
        {DAYS.map((d) => (
          <span key={d} className="ui-cal-dow" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((c) => (
          <UnstyledButton
            key={c.v}
            data-v={c.v}
            className="ui-cal-day"
            data-other={c.other || undefined}
            data-today={c.v === today || undefined}
            data-selected={c.v === value || undefined}
            disabled={off(c.v)}
            tabIndex={c.v === focus ? 0 : -1}
            aria-label={`${c.day} ${MONTHS[+c.v.slice(5, 7) - 1]} ${c.v.slice(0, 4)}`}
            aria-pressed={c.v === value}
            onClick={() => onPick(c.v)}
          >
            {c.day}
          </UnstyledButton>
        ))}
      </div>
      <div className="ui-cal-foot">
        <UnstyledButton className="ui-cal-link" disabled={off(today)} onClick={() => onPick(today)}>
          {t("Dziś")}
        </UnstyledButton>
      </div>
    </div>
  );
}
