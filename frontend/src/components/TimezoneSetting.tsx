import { useState } from "react";
import { Select, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconWorld } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { useT } from "../lib/i18n";
import { allTimezones, deviceTz, HOME_TZ, tzLabel } from "../lib/time";
import { FormDialog, ListRow, Section } from "./Mobile";

/**
 * Strefa czasowa konta: domyślnie wykrywana z urządzenia (i zapisywana na koncie, żeby e-maile i powiadomienia
 * podawały godziny u odbiorcy), albo wybrana ręcznie, gdy wykrycie się myli (np. telefon ustawiony na inny kraj).
 */
export function TimezoneSetting({ rows }: { rows?: boolean }) {
  const t = useT();
  const { me, setMe } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const manual = !!me.user.timezone_manual;
  const current = manual && me.user.timezone ? me.user.timezone : deviceTz();
  const value = manual ? current : "auto";
  const data = [
    { value: "auto", label: `${t("Automatycznie")} – ${tzLabel(deviceTz())}` },
    ...allTimezones().map((z) => ({ value: z, label: tzLabel(z) })),
  ];
  const choose = async (v: string | null) => {
    if (!v || v === value) return;
    setSaving(true);
    try {
      const auto = v === "auto";
      await api("/i18n/timezone", { method: "PUT", body: { timezone: auto ? null : v, manual: true } });
      setMe({ ...me, user: { ...me.user, timezone: auto ? me.user.timezone : v, timezone_manual: !auto } });
      notifications.show({ color: "teal", message: t("Zapisano strefę czasową") });
      setOpen(false);
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setSaving(false);
    }
  };
  const hint = t("Godziny w aplikacji, e-mailach i powiadomieniach są w tej strefie. Terminy firmy podajemy też w czasie polskim.");
  const picker = (
    <Select
      label={rows ? t("Strefa czasowa") : undefined}
      aria-label={t("Strefa czasowa")}
      description={rows ? hint : undefined}
      data={data}
      value={value}
      onChange={(v) => void choose(v)}
      searchable
      // długa lista: na telefonie też z wpisywaniem (wyszukiwanie strefy)
      data-allow-typing
      allowDeselect={false}
      disabled={saving}
      comboboxProps={{ withinPortal: true }}
      nothingFoundMessage={t("Brak takiej strefy")}
    />
  );

  if (rows)
    return (
      <Section title={t("Strefa czasowa")}>
        <ListRow
          leading={
            <span className="ui-row-icon" aria-hidden>
              <IconWorld size={22} />
            </span>
          }
          title={manual ? tzLabel(current) : t("Automatycznie")}
          description={manual ? t("Ustawiona ręcznie") : `${tzLabel(current)}${current === HOME_TZ ? "" : ` · ${t("wykryta z urządzenia")}`}`}
          onClick={() => setOpen(true)}
        />
        <FormDialog opened={open} onClose={() => setOpen(false)} title={t("Strefa czasowa")} primary={{ label: t("Gotowe"), onClick: () => setOpen(false) }} cancel={false}>
          {picker}
        </FormDialog>
      </Section>
    );
  return (
    <section className="ui-acc-sec">
      <h2 className="ui-dsec-title">{t("Strefa czasowa")}</h2>
      <Text size="sm" c="dimmed">
        {hint}
        {!manual && ` ${t("Wykrywana automatycznie z tego urządzenia.")}`}
      </Text>
      {picker}
    </section>
  );
}
