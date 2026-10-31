import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Grid, Group, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import {
  IconCalendarEvent,
  IconCamera,
  IconId,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCertificate,
  IconChecklist,
  IconCircleCheck,
  IconClockShield,
  IconSearch,
  IconUserPlus,
} from "@tabler/icons-react";

import { api, formatDateTime, type BackupStatus, type Dashboard } from "../api";
import { ActionButton } from "../components/ActionButton";
import { useAuth } from "../auth";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { ErrorState, EmptyState, Loading } from "../components/States";
import { GettingStarted } from "../components/GettingStarted";

interface UpcomingEvent {
  date: string;
  kind: "exam" | "start" | "standard_end" | "valid_until" | "hire" | "transfer" | "task" | "task_overdue" | "permit" | "permit_expired";
  title: string;
  employee_id: number;
  employee: string;
}

const EVENT_COLOR: Record<UpcomingEvent["kind"], string> = {
  exam: "violet",
  start: "blue",
  standard_end: "orange",
  valid_until: "red",
  hire: "teal",
  transfer: "indigo",
  task: "gray",
  task_overdue: "red",
  permit: "orange",
  permit_expired: "red",
};
const EVENT_LABEL: Record<UpcomingEvent["kind"], string> = {
  exam: "egzamin",
  start: "start",
  standard_end: "standard",
  valid_until: "ważność",
  hire: "nowa osoba",
  transfer: "przeniesienie",
  task: "zadanie",
  task_overdue: "zaległe",
  permit: "dokument pobytu",
  permit_expired: "nieważny dokument",
};

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "dziś";
  if (diff === 1) return "jutro";
  return d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
}

function UpcomingCard() {
  const { hasRole } = useAuth();
  const q = useQuery({ queryKey: ["dashboard-upcoming"], queryFn: () => api<UpcomingEvent[]>("/dashboard/upcoming") });
  const events = q.data ?? [];
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 8);
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconCalendarEvent size={20} aria-hidden />
          <Title order={3} size="h4">Najbliższe 14 dni</Title>
        </Group>
        {!hasRole("agency") && <Group gap="xs">
          <ActionButton to="/zadania" icon={<IconChecklist size={16} />}>
            Zadania
          </ActionButton>
          <ActionButton to="/szkolenia" icon={<IconCertificate size={16} />}>
            Szkolenia
          </ActionButton>
        </Group>}
      </Group>
      {q.isLoading ? (
        <Loading />
      ) : events.length === 0 ? (
        <EmptyState compact title="Nic nie jest zaplanowane"
          text="Brak egzaminów, końców ważności i nowych osób w najbliższym czasie." />
      ) : (
        <Stack gap={6}>
          {shown.map((e, i) => (
            <Group key={i} gap="sm" wrap="nowrap">
              <Text size="sm" fw={600} w={92} style={{ flexShrink: 0 }}>
                {dayLabel(e.date)}
              </Text>
              <Badge color={EVENT_COLOR[e.kind]} variant="light" size="sm" w={92} style={{ flexShrink: 0 }}>
                {EVENT_LABEL[e.kind]}
              </Badge>
              <Text size="sm" style={{ minWidth: 0 }} truncate>
                <Text component={Link} to={`/pracownicy/${e.employee_id}`} fw={500} className="brand-link" span>
                  {e.employee}
                </Text>{" "}
                <Text span c="dimmed">
                  · {e.title}
                </Text>
              </Text>
            </Group>
          ))}
          {events.length > 8 && (
            <ActionButton
              w="fit-content"
              mt="md"
              icon={all ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
              onClick={() => setAll((a) => !a)}
            >
              {all ? "Pokaż mniej" : `Pokaż wszystkie (${events.length})`}
            </ActionButton>
          )}
        </Stack>
      )}
    </Card>
  );
}

interface QueueItem {
  title: string;
  detail: string | null;
  url: string;
}
interface QueueGroup {
  key: string;
  label: string;
  count: number;
  url: string;
  items: QueueItem[];
}

/** „Do zrobienia dzisiaj”: wszystko, co wymaga uwagi kadr, jako lista z przyciskami do list z problemem. */
function TodayCard({ d, full }: { d: Dashboard; full: boolean }) {
  const q = useQuery({ queryKey: ["work-queue"], queryFn: () => api<{ total: number; groups: QueueGroup[] }>("/work-queue"), refetchInterval: 60_000, enabled: full });
  const rows: { key: string; label: string; count: number; url: string; sample?: string; hint?: string; color: string; icon: typeof IconCamera; action: string }[] = [];
  if (d.without_photo)
    rows.push({ key: "photo", label: "bez zdjęcia", count: d.without_photo, url: "/pracownicy?missing=photo", color: "orange", icon: IconCamera, action: "Uzupełnij", hint: "Bez zdjęcia nie wydrukujesz karty identyfikacyjnej." });
  if (d.without_pesel)
    rows.push({ key: "pesel", label: "bez numeru PESEL", count: d.without_pesel, url: "/pracownicy?missing=pesel", color: "orange", icon: IconId, action: "Uzupełnij", hint: "PESEL jest potrzebny w zestawieniach dla agencji." });
  const hasMissingRows = rows.length > 0;
  for (const g of q.data?.groups ?? []) {
    if (hasMissingRows && /^Braki w danych/.test(g.label)) continue; // te same braki już widać wyżej jako zdjęcia i PESEL
    rows.push({ key: g.key, label: g.label, count: g.count, url: g.url, sample: g.items[0] ? `${g.items[0].title}${g.items[0].detail ? " · " + g.items[0].detail : ""}` : undefined, color: "orange", icon: IconAlertTriangle, action: "Przejrzyj" });
  }
  return (
    <Card withBorder padding={0}>
      <Group justify="space-between" px="lg" py="md" style={{ borderBottom: "1px solid var(--apt-line)" }}>
        <Title order={3} size="h4">
          Do zrobienia
        </Title>
        {full && (
          <Text component={Link} to="/do-zrobienia" size="sm" fw={600} c="var(--mantine-primary-color-text)" className="brand-link">
            Pełna lista
          </Text>
        )}
      </Group>
      {full && q.isLoading ? (
        <Loading rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<IconCircleCheck size={26} />}
          title="Wszystko zrobione"
          text="Nic nie czeka na kadry. Najbliższe terminy zobaczysz poniżej."
        />
      ) : (
        <Stack gap={0}>
          {rows.map((r, i) => (
            <Group
              key={r.key}
              wrap="nowrap"
              gap="md"
              px="lg"
              py="sm"
              style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--apt-line)" : undefined }}
            >
              <ThemeIcon variant="light" color={r.color} size={40} radius="md" aria-hidden>
                <r.icon size={20} />
              </ThemeIcon>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text fw={700} size="sm">
                  {r.count} · {r.label}
                </Text>
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {r.hint ?? (r.sample ? `np. ${r.sample}` : "")}
                </Text>
              </div>
              <Button component={Link} to={r.url} variant="default" size="sm" style={{ flexShrink: 0 }}>
                {r.action}
              </Button>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

const STALE_HOURS = 36;

function backupProblems(b: BackupStatus | null): string[] {
  if (!b?.local) return ["Brak informacji o kopiach zapasowych – kopia jeszcze się nie wykonała albo nie działa."];
  const problems: string[] = [];
  const ageH = (Date.now() - new Date(b.local.at).getTime()) / 36e5;
  if (!b.local.ok) problems.push(`Ostatnia kopia nie powiodła się: ${b.local.info}`);
  else if (ageH > STALE_HOURS) problems.push(`Ostatnia kopia jest z ${formatDateTime(b.local.at)} – sprawdź serwer.`);
  if (b.offsite && !b.offsite.ok) problems.push(`Wysyłka kopii poza serwer nie powiodła się: ${b.offsite.info}`);
  return problems;
}

function BackupCard({ status }: { status: BackupStatus | null }) {
  const problems = backupProblems(status);
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Kopie zapasowe</Title>
        <ThemeIcon variant="light" color={problems.length ? "orange" : "green"} size="md">
          {problems.length ? <IconAlertTriangle size={16} /> : <IconCircleCheck size={16} />}
        </ThemeIcon>
      </Group>
      <Stack gap={4}>
        <Text size="sm">
          Na serwerze: <b>{status?.local ? formatDateTime(status.local.at) : "—"}</b>
          {status?.local && !status.local.ok && (
            <Text span c="red" size="sm">
              {" "}
              (błąd)
            </Text>
          )}
        </Text>
        <Text size="sm">
          Poza serwerem:{" "}
          {status?.offsite ? (
            <>
              <b>{formatDateTime(status.offsite.at)}</b>
              {!status.offsite.ok && (
                <Text span c="red" size="sm">
                  {" "}
                  (błąd)
                </Text>
              )}
            </>
          ) : (
            <Text span c="orange" size="sm">
              nie skonfigurowano
            </Text>
          )}
        </Text>
        {problems.map((p) => (
          <Text key={p} size="xs" c="orange">
            {p}
          </Text>
        ))}
      </Stack>
    </Card>
  );
}

function Summary({ d, manager }: { d: Dashboard; manager: boolean }) {
  const tiles: { label: string; value: number; note: string; to: string; warn?: boolean }[] = [
    { label: manager ? "Aktywni w Twoich wydziałach" : "Aktywni pracownicy", value: d.active, note: "w kartotece", to: "/pracownicy" },
    { label: "Przyjęci w 30 dni", value: d.added_30_days, note: "nowe osoby", to: "/pracownicy?sort=-hire_date" },
    { label: "Bez zdjęcia", value: d.without_photo, note: d.without_photo ? "karta się nie wydrukuje" : "wszyscy mają zdjęcie", to: "/pracownicy?missing=photo", warn: d.without_photo > 0 },
    { label: "W archiwum", value: d.terminated, note: "byli pracownicy", to: "/pracownicy?status=terminated" },
  ];
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing={0} className="summary-strip">
      {tiles.map((t) => (
        <UnstyledButton key={t.label} component={Link} to={t.to} className="summary-tile">
          <Text size="sm" fw={600} c="dimmed">
            {t.label}
          </Text>
          <Group gap={8} align="center" wrap="nowrap">
            <Text fz={30} fw={800} lh={1.15} c={t.warn ? "orange" : undefined}>
              {t.value}
            </Text>
            {t.warn && <IconAlertTriangle size={18} color="var(--mantine-color-orange-text)" aria-label="Wymaga uwagi" />}
          </Group>
          <Text size="xs" c="dimmed">
            {t.note}
          </Text>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  );
}

function RecentCard({ d }: { d: Dashboard }) {
  return (
    <Card withBorder padding={0}>
      <Group justify="space-between" px="lg" py="md">
        <Title order={3} size="h4">
          Ostatnio dodani
        </Title>
        <Text component={Link} to="/pracownicy" size="sm" fw={600} c="var(--mantine-primary-color-text)" className="brand-link">
          Wszyscy
        </Text>
      </Group>
      {d.recent.length === 0 ? (
        <Text size="sm" c="dimmed" px="lg" pb="lg">
          Kartoteka jest pusta.
        </Text>
      ) : (
        <Stack gap={0} pb="xs">
          {d.recent.map((e) => (
            <UnstyledButton key={e.id} component={Link} to={`/pracownicy/${e.id}`} className="list-row">
              <EmployeePhoto employee={e} width={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>
                  {e.last_name} {e.first_name}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {[e.department?.name, e.agency?.name].filter(Boolean).join(" · ") || "—"}
                </Text>
              </div>
              <Text size="xs" c="dimmed" ff="monospace">
                {e.number_display}
              </Text>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Card>
  );
}

function todayLabel() {
  const s = new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function HomePage() {
  const { me, hasRole } = useAuth();
  const navigate = useNavigate();
  const staff = hasRole("admin", "hr");
  const data = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const firstName = me?.user.full_name.split(" ")[0];
  const [q, setQ] = useState("");

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="md">
        <div>
          <Text size="sm" c="dimmed" fw={500}>
            {todayLabel()}
          </Text>
          <Title order={1} size="h2">
            Dzień dobry{firstName ? `, ${firstName}` : ""}
          </Title>
        </div>
        <Group gap="sm" wrap="wrap" style={{ flex: "1 1 320px", justifyContent: "flex-end" }}>
          <form
            role="search"
            style={{ flex: "1 1 260px", maxWidth: 380 }}
            onSubmit={(e) => {
              e.preventDefault();
              navigate(q.trim() ? `/pracownicy?q=${encodeURIComponent(q.trim())}` : "/pracownicy");
            }}
          >
            <TextInput
              aria-label="Szukaj pracownika"
              placeholder="Szukaj: nazwisko, nr karty"
              leftSection={<IconSearch size={16} aria-hidden />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              size="md"
            />
          </form>
          {staff && (
            <Button component={Link} to="/pracownicy/nowy" size="md" leftSection={<IconUserPlus size={18} />}>
              Dodaj pracownika
            </Button>
          )}
        </Group>
      </Group>

      {data.isLoading && <Loading />}
      {data.error && <ErrorState error={data.error} onRetry={() => data.refetch()} />}

      {data.data && (
        <>
          {!!data.data.retention_due && (
            <Alert color="orange" variant="light" icon={<IconClockShield size={18} />} title="Dane do usunięcia (RODO)">
              <Group justify="space-between" gap="xs">
                <Text size="sm">
                  {data.data.retention_due} os. ma za sobą okres przechowywania danych. Przejrzyj i usuń je trwale.
                </Text>
                <ActionButton to="/retencja" color="orange" icon={<IconClockShield size={16} />}>
                  Przejdź do retencji
                </ActionButton>
              </Group>
            </Alert>
          )}

          {staff && data.data.active === 0 && data.data.recent.length === 0 ? (
            <GettingStarted employees={data.data.active} />
          ) : (
            <>
              <Summary d={data.data} manager={hasRole("manager")} />
              <Grid gutter="lg" align="flex-start">
                <Grid.Col span={{ base: 12, lg: 7 }}>
                  <Stack gap="lg">
                    <TodayCard d={data.data} full={staff} />
                    <UpcomingCard />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 5 }}>
                  <Stack gap="lg">
                    <RecentCard d={data.data} />
                    {hasRole("admin") && <BackupCard status={data.data.backup} />}
                  </Stack>
                </Grid.Col>
              </Grid>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
