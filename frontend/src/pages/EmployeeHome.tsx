import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { IconCamera, IconFingerprint, IconMessage, IconPhone, IconSignature } from "@tabler/icons-react";

import { api } from "../api";
import { MyDataCards, type MyEmployee } from "../components/MyDataCards";
import { Messenger } from "../components/HrThreads";

export function EmployeeMessagesPage() {
  return <Messenger staff={false} />;
}

function Tile({ icon: Icon, title, hint, badge, to, onClick }: { icon: typeof IconMessage; title: string; hint: string; badge?: string | number; to?: string; onClick?: () => void }) {
  const body = (
    <Card withBorder padding="md" h="100%">
      <Stack gap={4} align="flex-start">
        <Icon size={26} />
        <Text fw={600}>
          {title} {badge ? <Badge color="red">{badge}</Badge> : null}
        </Text>
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      </Stack>
    </Card>
  );
  return to ? (
    <UnstyledButton component={Link} to={to}>
      {body}
    </UnstyledButton>
  ) : (
    <UnstyledButton onClick={onClick}>{body}</UnstyledButton>
  );
}

/** Ekran główny pracownika: szybkie akcje i jego dane. */
export function EmployeeHome() {
  const [, setParams] = useSearchParams();
  const mine = useQuery({ queryKey: ["my-employee"], queryFn: () => api<MyEmployee>("/me/employee"), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const unread = useQuery({ queryKey: ["my-msg-count"], queryFn: () => api<{ unread: number }>("/me/messages/count"), refetchInterval: 8000, refetchOnWindowFocus: true });
  const toSign = useQuery({ queryKey: ["my-sig-count"], queryFn: () => api<{ pending: number }>("/me/signatures/count"), refetchInterval: 8000, refetchOnWindowFocus: true });
  const d = mine.data;
  const noContact = d && !(d.phone_verified || d.email_verified);
  return (
    <Stack maw={760}>
      <Title order={2}>{d ? `Dzień dobry, ${d.first_name}` : "Moje konto"}</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
        <Tile icon={IconSignature} title="Do podpisu" hint="Dokumenty czekające na Twój podpis" to="/moje-konto/do-podpisu" badge={toSign.data?.pending || undefined} />
        <Tile icon={IconMessage} title="Napisz do kadr" hint="Zadaj pytanie lub zgłoś sprawę" to="/moje-konto/wiadomosci" badge={unread.data?.unread || undefined} />
        <Tile icon={IconCamera} title={d?.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie"} hint="Do karty identyfikacyjnej" onClick={() => setParams({ zdjecie: "1" })} />
        <Tile
          icon={IconPhone}
          title="Telefon i e-mail"
          hint="Potwierdź kodem"
          badge={noContact ? "uzupełnij" : undefined}
          onClick={() => document.getElementById("kontakt")?.scrollIntoView({ behavior: "smooth" })}
        />
        <Tile icon={IconFingerprint} title="Klucze i powiadomienia" hint="Powiadomienia, drugie urządzenie" to="/moje-konto/klucze" />
      </SimpleGrid>
      <MyDataCards />
    </Stack>
  );
}
