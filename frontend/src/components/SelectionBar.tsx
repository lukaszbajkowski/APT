import type { ReactNode } from "react";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";

import { useT } from "../lib/i18n";

/**
 * Pasek zaznaczenia (komputer): przyklejony do dołu listy, pojawia się po zaznaczeniu pierwszego wiersza.
 * Pokazuje liczbę („Zaznaczono 6 z 247”), proponuje zaznaczenie wszystkich pasujących z podaniem liczby
 * i trzyma akcje grupowe – każda z liczbą osób, których dotyczy.
 */
export function SelectionBar({
  count,
  total,
  onSelectAll,
  selectingAll,
  onClear,
  children,
}: {
  count: number;
  /** liczba wszystkich pasujących wyników (na wszystkich stronach) */
  total?: number;
  onSelectAll?: () => void;
  selectingAll?: boolean;
  onClear: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  if (!count) return null;
  return (
    <div className="ui-bulkbar" role="region" aria-label={t("Zaznaczone wiersze")}>
      <Tooltip label={t("Wyczyść zaznaczenie")} withArrow>
        <ActionIcon variant="subtle" color="gray" size={36} onClick={onClear} aria-label={t("Wyczyść zaznaczenie")}>
          <IconX size={18} />
        </ActionIcon>
      </Tooltip>
      <span className="ui-bulkbar-count" role="status" aria-live="polite">
        {t("Zaznaczono")} <b>{count}</b>
        {total !== undefined && total > count && (
          <span className="ui-bulkbar-of">
            {" "}
            {t("z")} {total}
          </span>
        )}
      </span>
      {onSelectAll && total !== undefined && total > count && (
        <Button variant="subtle" size="compact-sm" className="ui-bulkbar-all" loading={selectingAll} onClick={onSelectAll}>
          {t("Zaznacz wszystkie")} {total}
        </Button>
      )}
      <span className="ui-bulkbar-actions">{children}</span>
    </div>
  );
}

/**
 * Zaznaczanie z Shift: kliknięcie z wciśniętym Shift ustawia cały zakres od ostatnio klikniętego wiersza
 * (na bieżącej stronie) na ten sam stan co kliknięty wiersz.
 */
export function rangeToggle<T>(ids: T[], last: T | null, id: T, shift: boolean, selected: Set<T>): Set<T> {
  const next = new Set(selected);
  const on = !selected.has(id);
  const a = last === null ? -1 : ids.indexOf(last);
  const b = ids.indexOf(id);
  if (shift && a >= 0 && b >= 0) {
    for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(x) : next.delete(x);
  } else on ? next.add(id) : next.delete(id);
  return next;
}
