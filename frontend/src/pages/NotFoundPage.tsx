import { useNavigate } from "react-router-dom";
import { IconMapPinOff } from "@tabler/icons-react";

import { EmptyState } from "../components/States";
import { useDocTitle } from "../lib/docTitle";
import { useT } from "../lib/i18n";

/** Nieistniejący adres (np. stary albo przepisany z błędem link) – zamiast cichego przekierowania mówimy, co się stało. */
export function NotFoundPage() {
  const t = useT();
  const navigate = useNavigate();
  useDocTitle(t("Nie ma takiej strony"));
  return (
    <EmptyState
      icon={<IconMapPinOff size={26} />}
      title={t("Nie ma takiej strony")}
      text={t("Adres jest niepoprawny albo strona została przeniesiona. Sprawdź link albo wróć na stronę główną.")}
      action={{ label: t("Strona główna"), onClick: () => navigate("/") }}
      secondary={window.history.length > 1 ? { label: t("Wstecz"), onClick: () => navigate(-1) } : undefined}
    />
  );
}
