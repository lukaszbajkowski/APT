import { Link, useSearchParams } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconSpeakerphone, IconCamera, IconFileCheck, IconFingerprint, IconMessage, IconPhone, IconSignature } from "@tabler/icons-react";

import { api, formatDate } from "../api";
import { MyDataCards, type MyEmployee } from "../components/MyDataCards";
import { Messenger } from "../components/HrThreads";
import { useT } from "../lib/i18n";
import { ListRow, PageHead, Section, CompactEmpty, StatusBadge } from "../components/Mobile";

export function EmployeeMessagesPage() {
  return <Messenger staff={false} />;
}

function Tile({ icon: Icon, title, hint, badge, to, onClick }: { icon: typeof IconMessage; title: string; hint: string; badge?: string | number; to?: string; onClick?: () => void }) {
  const warn = typeof badge === "string";
  const body = (
    <Card withBorder padding="md" h="100%" className="tile-card">
      <Group gap="md" wrap="nowrap" align="center">
        <ThemeIcon variant="light" size={44} radius="md" color={warn ? "orange" : undefined} aria-hidden>
          <Icon size={22} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap={8} wrap="wrap" align="center">
            <Text fw={700}>{title}</Text>
            {badge ? (
              warn ? (
                <Badge variant="light" color="orange" leftSection={<IconAlertTriangle size={12} aria-hidden />} style={{ textTransform: "none" }}>
                  {badge}
                </Badge>
              ) : (
                <Badge aria-label={`${badge} nowe`}>{badge}</Badge>
              )
            ) : null}
          </Group>
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
        </div>
        <IconChevronRight size={18} color="var(--mantine-color-dimmed)" aria-hidden />
      </Group>
    </Card>
  );
  return to ? (
    <UnstyledButton component={Link} to={to} h="100%">
      {body}
    </UnstyledButton>
  ) : (
    <UnstyledButton onClick={onClick} h="100%">{body}</UnstyledButton>
  );
}

/** Ekran główny pracownika: szybkie akcje i jego dane. */
export function EmployeeHome() {
  const [, setParams] = useSearchParams();
  const mine = useQuery({ queryKey: ["my-employee"], queryFn: () => api<MyEmployee>("/me/employee"), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const unread = useQuery({ queryKey: ["my-msg-count"], queryFn: () => api<{ unread: number }>("/me/messages/count"), refetchInterval: 8000, refetchOnWindowFocus: true });
  const toSign = useQuery({ queryKey: ["my-sig-count"], queryFn: () => api<{ pending: number; last_signed: { id: number; document: string; signed_at: string | null } | null }>("/me/signatures/count"), refetchInterval: 8000, refetchOnWindowFocus: true });
  const bc = useQuery({ queryKey: ["my-bc-count"], queryFn: () => api<{ unread: number }>("/me/broadcasts/count"), refetchInterval: 15000, refetchOnWindowFocus: true });
  const t = useT();
  const d = mine.data;
  const noContact = d && !(d.phone_verified || d.email_verified);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });

  if (mobile) {
    const sign = toSign.data?.pending ?? 0;
    const msg = unread.data?.unread ?? 0;
    const news = bc.data?.unread ?? 0;
    const icon = (I: typeof IconMessage, warn?: boolean) => (
      <span className="ui-row-icon" data-tone={warn ? "warn" : undefined} aria-hidden>
        <I size={22} />
      </span>
    );
    const count = (n: number) => <span className="ui-thread-count">{n}</span>;
    // pilne sprawy na górze, w kolejności: podpis, odpowiedź kadr, komunikaty, braki w danych
    const todo = [
      sign > 0 && <ListRow key="sign" leading={icon(IconSignature, true)} title={t("Podpisz dokumenty")} description={t("Czekają na Twój podpis: {n}", { n: sign })} trailing={count(sign)} to="/moje-konto/do-podpisu" />,
      msg > 0 && <ListRow key="msg" leading={icon(IconMessage)} title={t("Odpowiedź od kadr")} description={t("Nieprzeczytane wiadomości: {n}", { n: msg })} trailing={count(msg)} to="/moje-konto/wiadomosci" />,
      news > 0 && <ListRow key="bc" leading={icon(IconSpeakerphone)} title={t("Nowe komunikaty")} description={t("Nieprzeczytane: {n}", { n: news })} trailing={count(news)} to="/moje-konto/komunikaty" />,
      d && !d.has_photo && <ListRow key="photo" leading={icon(IconCamera, true)} title={t("Dodaj zdjęcie")} description={t("Bez zdjęcia nie dostaniesz karty identyfikacyjnej")} trailing={<StatusBadge tone="warn">{t("Brak")}</StatusBadge>} onClick={() => setParams({ zdjecie: "1" })} />,
      noContact && <ListRow key="contact" leading={icon(IconPhone, true)} title={t("Potwierdź telefon lub e-mail")} description={t("Dostaniesz kod, który wpiszesz w aplikacji")} trailing={<StatusBadge tone="warn">{t("Uzupełnij")}</StatusBadge>} onClick={() => document.getElementById("kontakt")?.scrollIntoView({ behavior: "smooth" })} />,
    ].filter(Boolean);
    return (
      <Stack gap={24}>
        <PageHead title={d ? t("Dzień dobry, {name}", { name: d.first_name }) : t("Moje konto")} />
        <Section title={t("Do załatwienia")}>
          {mine.isLoading ? (
            <CompactEmpty title="…" />
          ) : todo.length ? (
            todo
          ) : (
            <ListRow leading={icon(IconCircleCheck)} title={t("Wszystko załatwione")} description={t("Nic na Ciebie nie czeka. Damy znać, gdy coś się pojawi.")} />
          )}
        </Section>
        <Section title={t("Na skróty")}>
          <ListRow leading={icon(IconMessage)} title={t("Napisz do kadr")} description={t("Zadaj pytanie lub zgłoś sprawę")} to="/moje-konto/wiadomosci" />
          {toSign.data?.last_signed && (
            <ListRow
              leading={icon(IconFileCheck)}
              title={t("Ostatnio podpisany")}
              description={`${toSign.data.last_signed.document}${toSign.data.last_signed.signed_at ? ` · ${formatDate(toSign.data.last_signed.signed_at)}` : ""}`}
              to={`/moje-konto/do-podpisu/podpisane/${toSign.data.last_signed.id}`}
            />
          )}
          {d?.has_photo && <ListRow leading={icon(IconCamera)} title={t("Zmień zdjęcie")} description={t("Do karty identyfikacyjnej")} onClick={() => setParams({ zdjecie: "1" })} />}
          <ListRow leading={icon(IconFingerprint)} title={t("Logowanie i powiadomienia")} description={t("Klucze dostępu, powiadomienia, aplikacja")} to="/moje-konto/klucze" />
        </Section>
        <MyDataCards />
      </Stack>
    );
  }

  return (
    <Stack maw={760}>
      <Title order={2}>{d ? t("Dzień dobry, {name}", { name: d.first_name }) : t("Moje konto")}</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
        <Tile icon={IconSignature} title={t("Do podpisu")} hint={t("Dokumenty czekające na Twój podpis")} to="/moje-konto/do-podpisu" badge={toSign.data?.pending || undefined} />
        {toSign.data?.last_signed && (
          <Tile
            icon={IconFileCheck}
            title={t("Ostatnio podpisany")}
            hint={`${toSign.data.last_signed.document}${toSign.data.last_signed.signed_at ? ` · ${formatDate(toSign.data.last_signed.signed_at)}` : ""}`}
            to={`/moje-konto/do-podpisu/podpisane/${toSign.data.last_signed.id}`}
          />
        )}
        <Tile icon={IconSpeakerphone} title={t("Komunikaty")} hint={t("Ważne informacje od kadr")} to="/moje-konto/komunikaty" badge={bc.data?.unread || undefined} />
        <Tile icon={IconMessage} title={t("Napisz do kadr")} hint={t("Zadaj pytanie lub zgłoś sprawę")} to="/moje-konto/wiadomosci" badge={unread.data?.unread || undefined} />
        <Tile icon={IconCamera} title={d?.has_photo ? t("Zmień zdjęcie") : t("Dodaj zdjęcie")} hint={t("Do karty identyfikacyjnej")} onClick={() => setParams({ zdjecie: "1" })} />
        <Tile
          icon={IconPhone}
          title={t("Telefon i e-mail")}
          hint={t("Potwierdź kodem")}
          badge={noContact ? t("uzupełnij") : undefined}
          onClick={() => document.getElementById("kontakt")?.scrollIntoView({ behavior: "smooth" })}
        />
        <Tile icon={IconFingerprint} title={t("Logowanie i powiadomienia")} hint={t("Klucze dostępu, powiadomienia, aplikacja")} to="/moje-konto/klucze" />
      </SimpleGrid>
      <MyDataCards />
    </Stack>
  );
}
