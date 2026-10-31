/*
 * Wspólne klocki ekranów (zaprojektowane najpierw pod telefon, działają też na komputerze).
 * Zasady: jedna wypełniona akcja na ekran, akcje sekcji jako tekst, wiersz listy = tytuł + jedna
 * linia opisu + strzałka, akcje wiersza w arkuszu od dołu z podpisami, pusta sekcja = jeden wiersz,
 * akcje nieodwracalne osobno w ramce z opisem skutku, stan zawsze z ikoną i słowem.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Drawer, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconArchive, IconCheck, IconChevronRight, IconClock, IconX } from "@tabler/icons-react";

/* ——— tytuł i powrót w pasku górnym telefonu ——— */
export interface MobileHeader {
  title?: string;
  subtitle?: string;
  back?: string;
}
const HeaderCtx = createContext<{ header: MobileHeader; set: (h: MobileHeader | null) => void }>({ header: {}, set: () => undefined });

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<MobileHeader>({});
  return <HeaderCtx.Provider value={{ header, set: (h) => setHeader(h ?? {}) }}>{children}</HeaderCtx.Provider>;
}

/** Ekran ustawia własny tytuł (np. imię i nazwisko) i adres powrotu w pasku górnym telefonu. */
export function useMobileHeader(h: MobileHeader | null) {
  const { set } = useContext(HeaderCtx);
  const key = JSON.stringify(h);
  useEffect(() => {
    set(h);
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

/* ——— arkusz akcji od dołu, każda akcja z podpisem ——— */
export interface SheetAction {
  label: string;
  description?: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
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
      <span className="ui-sheet-grip" aria-hidden />
      <div className="ui-sheet-head">
        <div className="ui-sheet-title">{title}</div>
        {subtitle && <div className="ui-row-desc">{subtitle}</div>}
      </div>
      {actions.map((a) => (
        <UnstyledButton
          key={a.label}
          className="ui-sheet-action"
          data-danger={a.danger || undefined}
          disabled={a.disabled}
          onClick={() => {
            onClose();
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
        Zamknij
      </UnstyledButton>
    </Drawer>
  );
}

/* ——— akcje nieodwracalne ——— */
export function DangerZone({ title = "Zmiany, których nie da się cofnąć", children }: { title?: string; children: ReactNode }) {
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
      {children}
    </span>
  );
}
