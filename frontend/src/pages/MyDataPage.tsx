import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Group, Stack, Tabs, Text, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconMail, IconMessage, IconPhone } from "@tabler/icons-react";

import { api, errorText, formatDate, withAcct } from "../api";
import { MyDataCards, MyPhotoEditor, type MyEmployee } from "../components/MyDataCards";
import { CompactEmpty, DangerAction, DangerZone, FormScreen, InfoRow, ListRow, Section, StatusBadge, SwipePager } from "../components/Mobile";
import { Loading } from "../components/States";
import { useConfirm } from "../lib/confirm";
import { useT } from "../lib/i18n";

interface History {
  periods: { hire_date: string | null; termination_date: string | null; agency: string | null; department: string | null; position: string | null; current: boolean }[];
  assignments: { valid_from: string; agency: string | null; department: string | null; position: string | null }[];
}

/** Zmiana telefonu lub e-maila na telefonie: pełny ekran, krok 1 – nowa wartość, krok 2 – kod. */
function ContactScreen({ kind, d, onClose }: { kind: "phone" | "email"; d: MyEmployee; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ask = useConfirm();
  const mail = kind === "email";
  const current = mail ? d.email : d.phone;
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (data: unknown) => {
    qc.setQueryData(["my-employee"], data);
    onClose();
  };
  const start = useMutation({
    mutationFn: () => api<{ sent_to: string }>(`/me/contact/${kind}/start`, { method: "POST", body: { value: value.trim() } }),
    onSuccess: (r) => {
      setError(null);
      setSentTo(r.sent_to);
    },
    onError: (e) => setError(errorText(e)),
  });
  const confirm = useMutation({
    mutationFn: () => api<unknown>(`/me/contact/${kind}/confirm`, { method: "POST", body: { code: code.trim() } }),
    onSuccess: (r) => {
      notifications.show({ color: "teal", message: mail ? t("Zapisano adres e-mail.") : t("Zapisano numer telefonu.") });
      done(r);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api<unknown>(`/me/contact/${kind}`, { method: "DELETE" }),
    onSuccess: (r) => {
      notifications.show({ color: "teal", message: t("Usunięto") });
      done(r);
    },
    onError: (e) => setError(errorText(e)),
  });
  const title = mail ? t("Adres e-mail") : t("Numer telefonu");
  return (
    <FormScreen
      title={title}
      subtitle={sentTo ? t("Krok 2 z 2 · Kod") : t("Krok 1 z 2 · Nowy {what}", { what: mail ? t("adres") : t("numer") })}
      onClose={onClose}
      onCancel={sentTo ? () => (setSentTo(null), setCode(""), setError(null)) : undefined}
      cancel={sentTo ? t("Wstecz") : t("Anuluj")}
      primary={
        sentTo
          ? { label: t("Potwierdź"), onClick: () => confirm.mutate(), loading: confirm.isPending, disabled: code.trim().length < 4 }
          : { label: t("Wyślij kod"), onClick: () => start.mutate(), loading: start.isPending, disabled: value.trim().length < 3 }
      }
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}
        {sentTo ? (
          <>
            <Text size="sm">{t("Wysłaliśmy kod na {to}. Wpisz go poniżej.", { to: sentTo })}</Text>
            <TextInput
              label={t("Kod")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              autoFocus
            />
          </>
        ) : (
          <>
            {current && (
              <InfoRow label={t("Obecnie")}>{current}</InfoRow>
            )}
            <TextInput
              label={current ? (mail ? t("Nowy adres e-mail") : t("Nowy numer telefonu")) : title}
              type={mail ? "email" : "tel"}
              inputMode={mail ? "email" : "tel"}
              autoComplete={mail ? "email" : "tel"}
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              autoFocus
            />
            <Text size="sm" c="dimmed">
              {mail
                ? t("Wyślemy kod na ten adres. Zmiana zapisze się dopiero po wpisaniu kodu.")
                : t("Wyślemy kod SMS na ten numer. Zmiana zapisze się dopiero po wpisaniu kodu.")}
            </Text>
            {current && (
              <DangerZone title={t("Usuwanie")}>
                <DangerAction
                  label={mail ? t("Usuń adres e-mail") : t("Usuń numer telefonu")}
                  description={t("Kadry nie będą mogły się z Tobą tak skontaktować.")}
                  loading={remove.isPending}
                  onClick={() =>
                    ask({ title: t("Usunąć dane?"), message: t("Usunąć ten wpis z Twoich danych?"), confirmLabel: t("Usuń"), danger: true }).then((ok) => ok && remove.mutate())
                  }
                />
              </DangerZone>
            )}
          </>
        )}
      </Stack>
    </FormScreen>
  );
}

/** „Moje dane” pracownika – na telefonie jak karta pracownika: zdjęcie, imię, zakładki przesuwane w bok. */
export function MyDataPage() {
  const t = useT();
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [params, setParams] = useSearchParams();
  const mine = useQuery({ queryKey: ["my-employee"], queryFn: () => api<MyEmployee>("/me/employee"), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const history = useQuery({ queryKey: ["my-history"], queryFn: () => api<History>("/me/history"), refetchInterval: 60_000 });
  const [editing, setEditing] = useState<"phone" | "email" | null>(null);
  const tabs = [
    { v: "dane", l: t("Dane") },
    { v: "kontakt", l: t("Kontakt") },
    { v: "zatrudnienie", l: t("Zatrudnienie") },
  ];
  const tab = tabs.some((x) => x.v === params.get("tab")) ? (params.get("tab") as string) : "dane";
  const setTab = (v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("tab", v);
        return n;
      },
      { replace: true },
    );
  const setPhotoOpen = (v: boolean) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set("zdjecie", "1");
      else n.delete("zdjecie");
      return n;
    });

  if (!mobile) return <Stack maw={760}><Title order={2}>{t("Moje dane")}</Title><MyDataCards /></Stack>;
  const d = mine.data;
  if (mine.isLoading || !d) return <Loading rows={4} />;
  const idx = tabs.findIndex((x) => x.v === tab);
  const contactBadge = (value: string | null, verified: boolean) =>
    !value ? <StatusBadge tone="warn">{t("Brak")}</StatusBadge> : verified ? <StatusBadge tone="ok">{t("Potwierdzony")}</StatusBadge> : <StatusBadge tone="wait">{t("Niepotwierdzony")}</StatusBadge>;
  const icon = (I: typeof IconPhone) => (
    <span className="ui-row-icon" aria-hidden>
      <I size={22} />
    </span>
  );
  const periods = history.data?.periods ?? [];
  const assignments = history.data?.assignments ?? [];

  return (
    <Stack gap="md">
      <Group gap="md" wrap="nowrap" align="center">
        <div style={{ position: "relative", flex: "none" }}>
          {d.has_photo ? (
            <img src={withAcct(`/api/me/photo?v=${d.photo_version}`)} alt={t("Twoje zdjęcie")} width={64} height={85} style={{ borderRadius: 6, objectFit: "cover", display: "block" }} />
          ) : (
            <div className="photo-placeholder" style={{ width: 64, height: 85, borderRadius: 6, display: "grid", placeItems: "center" }} aria-label={t("Brak zdjęcia")}>
              <span aria-hidden style={{ fontSize: 23, fontWeight: 700, color: "var(--mantine-color-dimmed)" }}>
                {d.first_name[0]}
                {d.last_name[0]}
              </span>
            </div>
          )}
          <ActionIcon
            aria-label={d.has_photo ? t("Zmień zdjęcie") : t("Dodaj zdjęcie")}
            className="ui-hit"
            radius="xl"
            size={32}
            variant="default"
            onClick={() => setPhotoOpen(true)}
            style={{ position: "absolute", right: -10, bottom: -8, border: "2px solid var(--apt-ground)" }}
          >
            <IconCamera size={16} />
          </ActionIcon>
        </div>
        <Stack gap={6} style={{ minWidth: 0 }}>
          <Title order={1} size="h3" lh={1.2}>
            {d.first_name} {d.last_name}
          </Title>
          <Group gap={8} wrap="wrap">
            <Text size="sm" c="dimmed" ff="monospace">
              {t("nr {n}", { n: d.number })}
            </Text>
            {!d.has_photo && <StatusBadge tone="warn">{t("Bez zdjęcia")}</StatusBadge>}
          </Group>
        </Stack>
      </Group>

      <Tabs value={tab} onChange={(v) => setTab(v ?? "dane")} className="profile-tabs">
        <Tabs.List>
          {tabs.map((x) => (
            <Tabs.Tab
              key={x.v}
              value={x.v}
              rightSection={x.v === "kontakt" && !(d.phone_verified || d.email_verified) ? <span className="tab-count" data-warn aria-label={t("Wymaga uwagi")}>!</span> : undefined}
            >
              {x.l}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <SwipePager index={idx} onIndex={(i) => setTab(tabs[i].v)}>
          <div style={{ paddingTop: 16 }}>
            <Stack gap="lg">
              <Section title={t("Dane osobowe")}>
                <InfoRow label={t("Numer ewidencyjny")}>{d.number}</InfoRow>
                <InfoRow label={t("Data urodzenia")}>{d.birth_date ? formatDate(d.birth_date) : "—"}</InfoRow>
                <InfoRow label={t("PESEL")}>{d.pesel_masked ?? "—"}</InfoRow>
                <InfoRow label={t("Obywatelstwo")}>{d.country ?? "—"}</InfoRow>
              </Section>
              <Section title={t("Praca")}>
                <InfoRow label={t("Agencja")}>{d.agency ?? "—"}</InfoRow>
                <InfoRow label={t("Wydział")}>{d.department ?? "—"}</InfoRow>
                <InfoRow label={t("Stanowisko")}>{d.position ?? "—"}</InfoRow>
                <InfoRow label={t("Zatrudniony od")}>{d.hire_date ? formatDate(d.hire_date) : "—"}</InfoRow>
              </Section>
              <Section title={t("Błąd w danych?")}>
                <ListRow
                  leading={icon(IconMessage)}
                  title={t("Napisz do kadr")}
                  description={t("Imię, nazwisko, obywatelstwo i PESEL poprawiają kadry")}
                  to="/moje-konto/wiadomosci"
                />
              </Section>
            </Stack>
          </div>
          <div style={{ paddingTop: 16 }}>
            <Stack gap="lg">
              <Section title={t("Telefon i e-mail")}>
                <ListRow leading={icon(IconPhone)} title={t("Telefon")} description={d.phone ?? t("Nie podano")} trailing={contactBadge(d.phone, d.phone_verified)} onClick={() => setEditing("phone")} />
                <ListRow leading={icon(IconMail)} title={t("E-mail")} description={d.email ?? t("Nie podano")} trailing={contactBadge(d.email, d.email_verified)} onClick={() => setEditing("email")} />
              </Section>
              <Text size="sm" c="dimmed" px={4}>
                {t("Widzą je tylko kadry i administrator. Zmianę potwierdzasz kodem wysłanym na nowy numer lub adres.")}
              </Text>
            </Stack>
          </div>
          <div style={{ paddingTop: 16 }}>
            <Stack gap="lg">
              <Section title={t("Okresy zatrudnienia")}>
                {history.isLoading ? (
                  <Loading rows={1} />
                ) : periods.length ? (
                  periods.map((p, i) => (
                    <ListRow
                      key={i}
                      title={`${p.hire_date ? formatDate(p.hire_date) : "?"} – ${p.termination_date ? formatDate(p.termination_date) : t("obecnie")}`}
                      description={[p.agency, p.department, p.position].filter(Boolean).join(" · ") || "—"}
                      trailing={p.current ? <StatusBadge tone="ok">{t("Obecny")}</StatusBadge> : undefined}
                    />
                  ))
                ) : (
                  <CompactEmpty title={t("Brak wpisów")} />
                )}
              </Section>
              {assignments.length > 0 && (
                <Section title={t("Zmiany wydziału i stanowiska")}>
                  {assignments.map((a, i) => (
                    <ListRow key={i} title={t("od {date}", { date: formatDate(a.valid_from) })} description={[a.department, a.position].filter(Boolean).join(" · ") || "—"} />
                  ))}
                </Section>
              )}
            </Stack>
          </div>
        </SwipePager>
      </Tabs>

      {editing && <ContactScreen kind={editing} d={d} onClose={() => setEditing(null)} />}
      <MyPhotoEditor />
    </Stack>
  );
}
