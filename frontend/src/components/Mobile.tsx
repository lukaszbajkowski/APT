/*
 * Wspólne klocki ekranów (zaprojektowane najpierw pod telefon, działają też na komputerze).
 * Zasady: jedna wypełniona akcja na ekran, akcje sekcji jako tekst, wiersz listy = tytuł + jedna
 * linia opisu + strzałka, akcje wiersza w arkuszu od dołu z podpisami, pusta sekcja = jeden wiersz,
 * akcje nieodwracalne osobno w ramce z opisem skutku, stan zawsze z ikoną i słowem.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type TouchEvent , useLayoutEffect} from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";
import { Button, Drawer, Group, Modal, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertTriangle, IconArchive, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconX } from "@tabler/icons-react";

/* ——— tytuł i powrót w pasku górnym telefonu ——— */
export interface MobileHeader {
  title?: string;
  subtitle?: string;
  back?: string;
  /** własna akcja strzałki (np. cofnięcie kroku formularza) – ma pierwszeństwo przed `back` */
  onBack?: () => void;
  /** tytuł po przewinięciu poniżej nagłówka ekranu (np. imię i nazwisko zamiast „Pracownik”) */
  scrolledTitle?: string;
  scrolledSubtitle?: string;
  /** podgląd na pełnym ekranie: zamiast strzałki i menu konta krzyżyk „Zamknij” po prawej (wywołuje onBack) */
  close?: boolean;
}
const HeaderCtx = createContext<{ header: MobileHeader; set: (h: MobileHeader | null) => void }>({ header: {}, set: () => undefined });

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<MobileHeader>({});
  return <HeaderCtx.Provider value={{ header, set: (h) => setHeader(h ?? {}) }}>{children}</HeaderCtx.Provider>;
}

/** Ekran ustawia własny tytuł (np. imię i nazwisko) i adres powrotu w pasku górnym telefonu. */
export function useMobileHeader(h: MobileHeader | null) {
  const { set } = useContext(HeaderCtx);
  const cb = useRef(h?.onBack);
  cb.current = h?.onBack;
  const key = JSON.stringify(h) + (h?.onBack ? "+cb" : "");
  useEffect(() => {
    set(h && h.onBack ? { ...h, onBack: () => cb.current?.() } : h);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useMobileHeaderValue() {
  return useContext(HeaderCtx).header;
}

/* ——— sekcja: nagłówek + opcjonalna akcja tekstowa ——— */
export function Section({
  title,
  action,
  children,
  plain,
}: {
  title: string;
  action?: { label: string; onClick?: () => void; to?: string; icon?: ReactNode };
  children: ReactNode;
  plain?: boolean;
}) {
  return (
    <section className="ui-section">
      <div className="ui-section-head">
        <h2 className="ui-section-title">{title}</h2>
        {action &&
          (action.to ? (
            <Link to={action.to} className="ui-text-action">
              {action.icon}
              {action.label}
            </Link>
          ) : (
            <UnstyledButton className="ui-text-action" onClick={action.onClick}>
              {action.icon}
              {action.label}
            </UnstyledButton>
          ))}
      </div>
      {plain ? children : <div className="ui-group">{children}</div>}
    </section>
  );
}

/* ——— wiersz „etykieta – wartość” ——— */
export function InfoRow({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? "ui-info ui-info-stacked" : "ui-info"}>
      <span className="ui-info-k">{label}</span>
      <span className="ui-info-v">{children}</span>
    </div>
  );
}

/* ——— wiersz listy: ikona, tytuł, jedna linia opisu, strzałka lub akcja ——— */
export function ListRow({
  title,
  description,
  leading,
  trailing,
  to,
  onClick,
  muted,
}: {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  muted?: boolean;
}) {
  const body = (
    <>
      {leading && <span className="ui-row-leading">{leading}</span>}
      <span className="ui-row-text">
        <span className="ui-row-title" data-muted={muted || undefined}>
          {title}
        </span>
        {description && <span className="ui-row-desc">{description}</span>}
      </span>
      {trailing ?? ((to || onClick) && <IconChevronRight size={18} className="ui-row-chevron" aria-hidden />)}
    </>
  );
  if (to)
    return (
      <Link to={to} className="ui-row" data-interactive>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <UnstyledButton className="ui-row" data-interactive onClick={onClick}>
        {body}
      </UnstyledButton>
    );
  return <div className="ui-row">{body}</div>;
}

/* ——— pusta sekcja jako jeden wiersz ——— */
export function CompactEmpty({ title, text, action }: { title: string; text?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="ui-row">
      <span className="ui-row-text">
        <span className="ui-row-title">{title}</span>
        {text && <span className="ui-row-desc">{text}</span>}
      </span>
      {action && (
        <UnstyledButton className="ui-text-action" onClick={action.onClick}>
          {action.label}
        </UnstyledButton>
      )}
    </div>
  );
}

/* ——— przeciąganie arkusza w dół, żeby go zamknąć (jak w iOS) ——— */
export function useDragToClose(onClose: () => void) {
  const st = useRef<{ y: number; dy: number; el: HTMLElement | null }>({ y: 0, dy: 0, el: null });
  return {
    onTouchStart: (e: TouchEvent) => {
      st.current = { y: e.touches[0].clientY, dy: 0, el: (e.currentTarget as HTMLElement).closest(".mantine-Drawer-content") };
      if (st.current.el) st.current.el.style.transition = "none";
    },
    onTouchMove: (e: TouchEvent) => {
      const dy = Math.max(0, e.touches[0].clientY - st.current.y);
      st.current.dy = dy;
      if (st.current.el) st.current.el.style.transform = `translateY(${dy}px)`;
    },
    onTouchEnd: () => {
      const { el, dy } = st.current;
      if (!el) return;
      el.style.transition = "transform 180ms ease-out";
      if (dy > 80) {
        el.style.transform = "translateY(100%)";
        window.setTimeout(() => {
          onClose();
          el.style.transform = "";
          el.style.transition = "";
        }, 170);
      } else el.style.transform = "";
    },
  };
}

/** Przesunięcie palcem w bok (np. między zakładkami). Ignoruje ruchy pionowe i przewijane w bok elementy. */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const st = useRef<{ x: number; y: number; skip: boolean }>({ x: 0, y: 0, skip: false });
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      const skip = !!t.closest("input, textarea, select, .mantine-Tabs-list, .mantine-ScrollArea-root, [data-no-swipe], .mantine-TableScrollContainer-scrollContainer");
      st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, skip };
    },
    onTouchEnd: (e: TouchEvent) => {
      if (st.current.skip) return;
      const dx = e.changedTouches[0].clientX - st.current.x;
      const dy = e.changedTouches[0].clientY - st.current.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onLeft();
      else onRight();
    },
  };
}

/**
 * Strony obok siebie przesuwane palcem: treść jedzie za palcem, po puszczeniu dojeżdża do sąsiedniej strony.
 * Wszystkie strony są wczytane od razu, więc sąsiednia treść jest gotowa w trakcie przesuwania.
 */
export function SwipePager({ index, onIndex, children }: { index: number; onIndex: (i: number) => void; children: ReactNode[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const st = useRef({ x: 0, y: 0, t: 0, dx: 0, lock: "" as "" | "x" | "y", skip: false });
  const [height, setHeight] = useState<number | undefined>(undefined);
  const n = children.length;

  const place = (dx: number, animate: boolean) => {
    const el = track.current;
    if (!el) return;
    el.style.transition = animate ? "transform 280ms cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = `translate3d(calc(${-index * 100}% + ${dx}px), 0, 0)`;
  };
  useEffect(() => place(0, true));

  // wysokość = wysokość bieżącej strony (bez pustego miejsca pod krótszymi zakładkami)
  useEffect(() => {
    const el = pages.current[index];
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [index, n]);

  // przesuwanie działa w całym ekranie (także w pustym miejscu pod krótką listą i nad nią)
  const handlers = useRef({ start: (_e: globalThis.TouchEvent) => {}, move: (_e: globalThis.TouchEvent) => {}, end: () => {} });
  handlers.current.start = (e) => {
    const t = e.target as HTMLElement;
    const skip =
      typeof t?.closest !== "function" ||
      !!t.closest("input, textarea, select, [data-no-swipe], .mantine-ScrollArea-root, .mantine-TableScrollContainer-scrollContainer, .mantine-Drawer-root, .mantine-Modal-root, .mantine-Popover-dropdown, .ui-chat, .tabbar, .mantine-AppShell-navbar");
    st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0, lock: "", skip };
  };
  handlers.current.move = (e) => {
    const c = st.current;
    if (c.skip) return;
    const dx = e.touches[0].clientX - c.x;
    const dy = e.touches[0].clientY - c.y;
    if (!c.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      c.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (c.lock !== "x") return;
    // opór na pierwszej i ostatniej stronie
    const edge = (index === 0 && dx > 0) || (index === n - 1 && dx < 0);
    c.dx = edge ? dx / 3 : dx;
    place(c.dx, false);
  };
  handlers.current.end = () => {
    const c = st.current;
    if (c.lock !== "x") return;
    const w = wrap.current?.offsetWidth ?? 390;
    const fast = Math.abs(c.dx) / Math.max(1, Date.now() - c.t) > 0.4;
    let next = index;
    if ((c.dx < -w * 0.25 || (fast && c.dx < -30)) && index < n - 1) next = index + 1;
    if ((c.dx > w * 0.25 || (fast && c.dx > 30)) && index > 0) next = index - 1;
    c.lock = "";
    if (next !== index) onIndex(next);
    else place(0, true);
  };
  useEffect(() => {
    const s0 = (e: globalThis.TouchEvent) => handlers.current.start(e);
    const m0 = (e: globalThis.TouchEvent) => handlers.current.move(e);
    const e0 = () => handlers.current.end();
    document.addEventListener("touchstart", s0, { passive: true });
    document.addEventListener("touchmove", m0, { passive: true });
    document.addEventListener("touchend", e0, { passive: true });
    document.addEventListener("touchcancel", e0, { passive: true });
    return () => {
      document.removeEventListener("touchstart", s0);
      document.removeEventListener("touchmove", m0);
      document.removeEventListener("touchend", e0);
      document.removeEventListener("touchcancel", e0);
    };
  }, []);

  return (
    <div
      ref={wrap}
      className="ui-pager"
      style={{ height, transition: "height 200ms ease" }}
    >
      <div ref={track} className="ui-pager-track">
        {children.map((c, i) => (
          <div
            key={i}
            ref={(el) => {
              pages.current[i] = el;
            }}
            className="ui-pager-page"
            role="tabpanel"
            aria-hidden={i !== index}
            {...((i !== index ? { inert: "" } : {}) as object)}
          >
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Uchwyt i nagłówek arkusza: przeciągnij w dół albo stuknij uchwyt, żeby zamknąć. */
export function SheetHandle({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  const drag = useDragToClose(onClose);
  return (
    <div className="ui-sheet-drag" {...drag}>
      <button type="button" className="ui-sheet-grip" aria-label="Zamknij" onClick={onClose} />
      {children}
    </div>
  );
}

/* ——— arkusz akcji od dołu, każda akcja z podpisem ——— */
export interface SheetAction {
  label: string;
  description?: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  warn?: boolean;
  disabled?: boolean;
  /** panel zostaje otwarty (np. wybór pliku – zamyka go dopiero wybrany plik) */
  keepOpen?: boolean;
}
export function ActionSheet({
  opened,
  onClose,
  title,
  subtitle,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: SheetAction[];
}) {
  const t = useT();
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      radius="lg"
      withCloseButton={false}
      classNames={{ content: "ui-sheet" }}
      aria-label={title}
    >
      <SheetHandle onClose={onClose}>
        <div className="ui-sheet-head">
          <div className="ui-sheet-title">{title}</div>
          {subtitle && <div className="ui-row-desc">{subtitle}</div>}
        </div>
      </SheetHandle>
      {actions.map((a) => (
        <UnstyledButton
          key={a.label}
          className="ui-sheet-action"
          data-danger={a.danger || undefined}
          data-warn={a.warn || undefined}
          disabled={a.disabled}
          onClick={() => {
            if (!a.keepOpen) onClose();
            a.onClick();
          }}
        >
          {a.icon && <span className="ui-sheet-icon">{a.icon}</span>}
          <span className="ui-row-text">
            <span className="ui-row-title">{a.label}</span>
            {a.description && <span className="ui-row-desc">{a.description}</span>}
          </span>
        </UnstyledButton>
      ))}
      <UnstyledButton className="ui-sheet-close" onClick={onClose}>
        {t("Zamknij")}
      </UnstyledButton>
    </Drawer>
  );
}

/* ——— akcje nieodwracalne ——— */
export function DangerZone({ title = "Działania wymagające ostrożności", children }: { title?: string; children: ReactNode }) {
  return (
    <section className="ui-danger">
      <h2 className="ui-danger-title">{title}</h2>
      {children}
    </section>
  );
}
export function DangerAction({ label, description, onClick, loading }: { label: string; description: string; onClick: () => void; loading?: boolean }) {
  return (
    <UnstyledButton className="ui-danger-action" onClick={onClick} disabled={loading}>
      <span className="ui-row-title">{loading ? `${label}…` : label}</span>
      <span className="ui-row-desc">{description}</span>
    </UnstyledButton>
  );
}

/* ——— stan z ikoną i słowem (nigdy sam kolor) ——— */
type Tone = "ok" | "warn" | "error" | "neutral" | "wait";
const TONE_ICON: Record<Tone, typeof IconCheck> = { ok: IconCheck, warn: IconAlertTriangle, error: IconX, neutral: IconArchive, wait: IconClock };
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className="ui-status" data-tone={tone}>
      <Icon size={12} stroke={3} aria-hidden />
      <span className="ui-cap">{children}</span>
    </span>
  );
}

/** Pierwsza litera wielka (etykiety z serwera bywają pisane małą literą). */
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/* ——— nagłówek ekranu listy (telefon): duży tytuł, opis, jedna akcja obok ——— */
export function PageHead({
  title,
  subtitle,
  action,
  extra,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: { label: string; icon: ReactNode; onClick?: () => void; to?: string; variant?: "primary" | "outline" };
  extra?: { label: string; icon: ReactNode; onClick: () => void };
}) {
  const cls = action?.variant === "outline" ? "ui-head-action ui-head-action-outline" : "ui-head-action";
  return (
    <div className="ui-head">
      <div className="ui-head-text">
        <h1 className="ui-head-title">{title}</h1>
        {subtitle && <span className="ui-head-sub">{subtitle}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flex: "none" }}>
      {extra && (
        <UnstyledButton className="ui-head-action ui-head-action-outline" aria-label={extra.label} onClick={extra.onClick}>
          {extra.icon}
        </UnstyledButton>
      )}
      {action &&
        (action.to ? (
          <Link to={action.to} className={cls} aria-label={action.label}>
            {action.icon}
          </Link>
        ) : (
          <UnstyledButton className={cls} aria-label={action.label} onClick={action.onClick}>
            {action.icon}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

/* ——— pigułki filtrów przewijane w bok ——— */
export interface Chip {
  label: string;
  active?: boolean;
  warn?: boolean;
  count?: number;
  onClick: () => void;
  menu?: boolean;
  icon?: ReactNode;
}
export function Chips({ items }: { items: Chip[] }) {
  return (
    <div className="ui-chips" data-no-swipe>
      {items.map((c) => (
        <UnstyledButton key={c.label} className="ui-chip" data-active={c.active || undefined} data-warn={c.warn || undefined} aria-pressed={!!c.active} onClick={c.onClick}>
          {c.icon}
          {c.label}
          {c.count !== undefined && <span className="ui-chip-count">{c.count}</span>}
          {c.menu && <IconChevronDown size={13} stroke={2.6} aria-hidden />}
        </UnstyledButton>
      ))}
    </div>
  );
}

/* ——— przełącznik 2–3 widoków (pełna szerokość) ——— */
export function Segments({ value, onChange, items, swipe }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; swipe?: boolean }) {
  // przesunięcie palcem w bok na ekranie przełącza na sąsiednią zakładkę
  const cur = useRef({ value, items, onChange });
  cur.current = { value, items, onChange };
  useEffect(() => {
    if (!swipe) return;
    const st = { x: 0, y: 0, skip: false };
    const start = (e: globalThis.TouchEvent) => {
      const t = e.target as HTMLElement;
      st.skip = typeof t?.closest === "function" && !!t.closest("input, textarea, select, [data-no-swipe], .mantine-Drawer-root, .mantine-Modal-root, .mantine-ScrollArea-root, .mantine-TableScrollContainer-scrollContainer, .ui-chat, nav, .tabbar");
      st.x = e.touches[0].clientX;
      st.y = e.touches[0].clientY;
    };
    const end = (e: globalThis.TouchEvent) => {
      if (st.skip) return;
      const dx = e.changedTouches[0].clientX - st.x;
      const dy = e.changedTouches[0].clientY - st.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const { value: v, items: its, onChange: go } = cur.current;
      const i = its.findIndex((x) => x.value === v) + (dx < 0 ? 1 : -1);
      if (i < 0 || i >= its.length) return;
      document.body.dataset.slide = dx < 0 ? "l" : "r";
      window.setTimeout(() => delete document.body.dataset.slide, 260);
      go(its[i].value);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
    };
  }, [swipe]);
  return (
    <div className="ui-seg" role="tablist" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <UnstyledButton key={i.value} role="tab" aria-selected={i.value === value} className="ui-seg-item" data-active={i.value === value || undefined} onClick={() => onChange(i.value)}>
          {i.label}
        </UnstyledButton>
      ))}
    </div>
  );
}

/* ——— nagłówek grupy w liście (np. „Po terminie · 3”) ——— */
export function GroupLabel({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <h2 className="ui-section-title" data-warn={warn || undefined} style={{ display: "flex", alignItems: "center", gap: 6, margin: "8px 0 0" }}>
      {warn && <IconAlertTriangle size={14} stroke={2.6} aria-hidden />}
      {children}
    </h2>
  );
}

/* ——— wybór z listy w arkuszu od dołu (jeden lub kilka) ——— */
export function PickSheet({
  opened,
  onClose,
  title,
  options,
  value,
  onChange,
  multiple,
  clearLabel,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  clearLabel?: string;
}) {
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label={title}>
      <SheetHandle onClose={onClose}>
        <div className="ui-sheet-head">
          <div className="ui-sheet-title">{title}</div>
        </div>
      </SheetHandle>
      <div style={{ overflowY: "auto", maxHeight: "60dvh" }}>
        {clearLabel && (
          <UnstyledButton
            className="ui-sheet-action"
            onClick={() => {
              onChange([]);
              onClose();
            }}
          >
            <span className="ui-row-text">
              <span className="ui-row-title">{clearLabel}</span>
            </span>
            {value.length === 0 && <IconCheck size={20} className="ui-sheet-icon" aria-hidden />}
          </UnstyledButton>
        )}
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <UnstyledButton
              key={o.value}
              className="ui-sheet-action"
              aria-pressed={on}
              onClick={() => {
                if (multiple) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
                else {
                  onChange([o.value]);
                  onClose();
                }
              }}
            >
              <span className="ui-row-text">
                <span className="ui-row-title">{o.label}</span>
              </span>
              {on && <IconCheck size={20} className="ui-sheet-icon" aria-hidden />}
            </UnstyledButton>
          );
        })}
      </div>
      {multiple && (
        <UnstyledButton className="ui-sheet-close" onClick={onClose}>
          Gotowe
        </UnstyledButton>
      )}
    </Drawer>
  );
}

/* Wysokość dolnego menu (razem z paskiem iPhone'a) jako --apt-nav-h – formularze na telefonie kończą się tuż nad menu. */
export function useNavHeightVar(dep?: unknown) {
  useLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>(".mantine-AppShell-footer");
    if (!nav) return;
    const set = () => document.documentElement.style.setProperty("--apt-nav-h", `${nav.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [dep]);
}

/* ——— panel filtrów od dołu: „Filtry”, pola, Wyczyść + Pokaż N (wzorzec listy pracowników) ——— */
export function FilterSheet({
  opened,
  onClose,
  onClear,
  showLabel = "Pokaż",
  title = "Filtry",
  children,
}: {
  opened: boolean;
  onClose: () => void;
  onClear: () => void;
  showLabel?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label={title}>
      <SheetHandle onClose={onClose}>
        <div className="ui-sheet-head">
          <div className="ui-sheet-title">{title}</div>
        </div>
      </SheetHandle>
      <div className="ui-filter-fields">{children}</div>
      <div className="ui-filter-foot">
        <Button size="lg" variant="default" radius="md" style={{ flex: 1 }} onClick={onClear}>
          Wyczyść
        </Button>
        <Button size="lg" radius="md" style={{ flex: 2 }} onClick={onClose}>
          {showLabel}
        </Button>
      </div>
    </Drawer>
  );
}

/* ——— przyciski stron listy: wcześniejsze / następne ——— */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="ui-pager-btns">
      <Button variant="default" size="md" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Poprzednie
      </Button>
      <span className="ui-row-desc">
        {page} z {pages}
      </span>
      <Button variant="default" size="md" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Następne
      </Button>
    </div>
  );
}

/*
 * Formularz na pełnym ekranie (telefon): tytuł i podtytuł w górnym pasku (strzałka = Anuluj), treść przewijana,
 * pasek akcji tuż nad dolnym menu – Anuluj po lewej, główny przycisk po prawej. Po zamknięciu pasek górny wraca
 * do stanu sprzed otwarcia formularza.
 */
export function FormScreen({
  title,
  subtitle,
  onClose,
  children,
  primary,
  cancel = "Anuluj",
  onCancel,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** lewy przycisk i strzałka w pasku (np. cofnięcie kroku); domyślnie onClose */
  onCancel?: () => void;
  children: ReactNode;
  primary: { label: string; onClick?: () => void; disabled?: boolean; loading?: boolean; color?: string; formId?: string };
  /** etykieta przycisku po lewej; false = bez niego (np. ekran „Gotowe”) */
  cancel?: string | false;
}) {
  const { header, set } = useContext(HeaderCtx);
  const prev = useRef(header);
  const cb = useRef(onClose);
  cb.current = onCancel ?? onClose;
  useNavHeightVar();
  useEffect(() => {
    set({ title, subtitle, onBack: () => cb.current() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => set(prev.current), []);
  return createPortal(
    <div className="ui-inpage" role="dialog" aria-label={title}>
      <div className="ui-chat-body ui-form-body">{children}</div>
      <div className="ui-chat-compose">
        {cancel !== false && (
          <Button size="lg" radius="md" variant="default" onClick={onCancel ?? onClose} style={{ flex: "none", minWidth: 110 }}>
            {cancel}
          </Button>
        )}
        <Button size="lg" radius="md" fullWidth color={primary.color} disabled={primary.disabled} loading={primary.loading} onClick={primary.onClick} {...(primary.formId ? { type: "submit" as const, form: primary.formId } : {})}>
          {primary.label}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Ekran podglądu na telefonie (dokument, załącznik): tytuł i strzałka „Wróć” w górnym pasku aplikacji
 * (pod paskiem stanu iPhone'a), treść przewijana, opcjonalny pasek akcji nad dolnym menu.
 */
export function ViewScreen({
  title,
  subtitle,
  onClose,
  children,
  bar,
  label,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  bar?: ReactNode;
  label?: string;
}) {
  const { header, set } = useContext(HeaderCtx);
  const prev = useRef(header);
  const cb = useRef(onClose);
  cb.current = onClose;
  useNavHeightVar();
  useEffect(() => {
    set({ title, subtitle, onBack: () => cb.current(), close: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => set(prev.current), []);
  return createPortal(
    <div className="ui-inpage ui-view" role="dialog" aria-label={label ?? title}>
      <div className="ui-chat-body">{children}</div>
      {bar && <div className="ui-chat-compose">{bar}</div>}
    </div>,
    document.body,
  );
}

/**
 * Formularz w oknie: na komputerze okno na środku z przyciskami Anuluj / główny, na telefonie formularz na pełnym
 * ekranie (FormScreen) – tytuł w górnym pasku, pasek akcji nad dolnym menu. Treść (pola) jest ta sama.
 */
export function FormDialog({
  opened,
  onClose,
  title,
  subtitle,
  primary,
  size,
  children,
  cancel = "Anuluj",
  onCancel,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  primary: { label: string; onClick?: () => void; disabled?: boolean; loading?: boolean; color?: string; formId?: string };
  size?: string;
  children: ReactNode;
  cancel?: string | false;
  onCancel?: () => void;
}) {
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  if (mobile)
    return opened ? (
      <FormScreen title={title} subtitle={subtitle} onClose={onClose} primary={primary} cancel={cancel} onCancel={onCancel}>
        {children}
      </FormScreen>
    ) : null;
  return (
    <Modal opened={opened} onClose={onClose} title={title} size={size}>
      {children}
      <Group justify="flex-end" mt="md">
        {cancel !== false && (
          <Button variant="default" onClick={onCancel ?? onClose}>
            {cancel}
          </Button>
        )}
        <Button color={primary.color} onClick={primary.onClick} loading={primary.loading} disabled={primary.disabled} {...(primary.formId ? { type: "submit" as const, form: primary.formId } : {})}>
          {primary.label}
        </Button>
      </Group>
    </Modal>
  );
}

/**
 * Przesunięcie palcem w bok w dowolnym miejscu ekranu (jak przy zakładkach Segments swipe) – np. przełącznik
 * dwóch opcji w formularzu. Pomija pola tekstowe, panele i elementy przewijane w bok.
 */
export function useSwipeAnywhere(enabled: boolean, onLeft: () => void, onRight: () => void) {
  const cb = useRef({ onLeft, onRight });
  cb.current = { onLeft, onRight };
  useEffect(() => {
    if (!enabled) return;
    const st = { x: 0, y: 0, skip: false };
    const start = (e: globalThis.TouchEvent) => {
      const t = e.target as HTMLElement;
      st.skip = typeof t?.closest === "function" && !!t.closest("input:not([type=file]), textarea, select, [data-no-swipe], .mantine-Drawer-root, .mantine-Modal-root, .mantine-ScrollArea-root, .tabbar, nav");
      st.x = e.touches[0].clientX;
      st.y = e.touches[0].clientY;
    };
    const end = (e: globalThis.TouchEvent) => {
      if (st.skip) return;
      const dx = e.changedTouches[0].clientX - st.x;
      const dy = e.changedTouches[0].clientY - st.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) cb.current.onLeft();
      else cb.current.onRight();
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
    };
  }, [enabled]);
}
