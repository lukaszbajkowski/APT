import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Card, Group, Progress, SimpleGrid, Stack, Text, Title } from "@mantine/core";

import { api, errorText, formatDateTime } from "../api";
import { Loading } from "../components/States";

interface Run {
  at: string;
  ok: boolean;
  info: string;
}
interface Status {
  version: string;
  migration: string | null;
  backup: { local: Run | null; offsite: Run | null } | null;
  restore_test: Run | null;
  disk: { total_gb: number; free_gb: number; used_percent: number } | null;
  translation: { enabled: boolean; used: number; limit: number };
  retention_due: number;
  unusual: string[];
  mail_enabled: boolean;
}

function RunLine({ label, run, staleHours }: { label: string; run: Run | null | undefined; staleHours: number }) {
  const stale = run ? Date.now() - new Date(run.at).getTime() > staleHours * 3600_000 : false;
  const color = !run ? "gray" : !run.ok ? "red" : stale ? "orange" : "teal";
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Text size="sm">{label}</Text>
      <div style={{ textAlign: "right" }}>
        <Badge variant="light" color={color}>
          {!run ? "brak danych" : !run.ok ? "błąd" : stale ? "dawno" : "OK"}
        </Badge>
        {run && (
          <Text size="xs" c="dimmed">
            {formatDateTime(run.at)}
            {run.info ? ` · ${run.info}` : ""}
          </Text>
        )}
      </div>
    </Group>
  );
}

export function SystemStatusPage() {
  const q = useQuery({ queryKey: ["system-status"], queryFn: () => api<Status>("/system/status"), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const s = q.data!;
  const tPct = s.translation.limit > 0 ? Math.min(100, Math.round((100 * s.translation.used) / s.translation.limit)) : 0;
  return (
    <Stack>
      <div>
        <Title order={2}>Stan systemu</Title>
        <Text c="dimmed" size="sm">
          Wersja {s.version}, migracja {s.migration ?? "?"}. Odświeża się co minutę.
        </Text>
      </div>
      {s.unusual.length > 0 && (
        <Alert color="red" title="Nietypowa aktywność (ostatnie 24 godz.)">
          {s.unusual.map((x) => (
            <div key={x}>{x}</div>
          ))}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="lg">
          <Title order={5} mb="sm">
            Kopie zapasowe
          </Title>
          <Stack gap="sm">
            <RunLine label="Kopia lokalna" run={s.backup?.local} staleHours={36} />
            <RunLine label="Kopia poza serwerem" run={s.backup?.offsite} staleHours={36} />
            <RunLine label="Test odtwarzania (co tydzień)" run={s.restore_test} staleHours={15 * 24} />
          </Stack>
        </Card>
        <Card withBorder padding="lg">
          <Title order={5} mb="sm">
            Dysk
          </Title>
          {s.disk ? (
            <>
              <Progress value={s.disk.used_percent} color={s.disk.used_percent > 85 ? "red" : s.disk.used_percent > 70 ? "orange" : "teal"} />
              <Text size="sm" mt="xs">
                Zajęte {s.disk.used_percent}% · wolne {s.disk.free_gb} GB z {s.disk.total_gb} GB
              </Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              Brak danych.
            </Text>
          )}
        </Card>
        <Card withBorder padding="lg">
          <Title order={5} mb="sm">
            Tłumaczenia (limit miesięczny)
          </Title>
          {s.translation.enabled ? (
            <>
              <Progress value={tPct} color={tPct > 90 ? "red" : tPct > 70 ? "orange" : "teal"} />
              <Text size="sm" mt="xs">
                {s.translation.used.toLocaleString("pl-PL")} z {s.translation.limit.toLocaleString("pl-PL")} znaków ({tPct}%)
              </Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              Tłumaczenia są wyłączone (brak klucza).
            </Text>
          )}
        </Card>
        <Card withBorder padding="lg">
          <Title order={5} mb="sm">
            Pozostałe
          </Title>
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="sm">Wysyłka e-mail</Text>
              <Badge variant="light" color={s.mail_enabled ? "teal" : "orange"}>
                {s.mail_enabled ? "włączona" : "wyłączona"}
              </Badge>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Dane po okresie przechowywania</Text>
              <Badge variant="light" color={s.retention_due ? "orange" : "teal"}>
                {s.retention_due}
              </Badge>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
