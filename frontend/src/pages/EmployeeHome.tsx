import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronRight, IconSpeakerphone, IconCamera, IconFileCheck, IconFingerprint, IconMessage, IconPhone, IconSignature } from "@tabler/icons-react";

import { api, formatDate } from "../api";
import { MyDataCards, type MyEmployee } from "../components/MyDataCards";
import { Messenger } from "../components/HrThreads";
import { useT } from "../lib/i18n";

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
        <Tile icon={IconFingerprint} title={t("Klucze i powiadomienia")} hint={t("Powiadomienia, drugie urządzenie")} to="/moje-konto/klucze" />
      </SimpleGrid>
      <MyDataCards />
    </Stack>
  );
}
