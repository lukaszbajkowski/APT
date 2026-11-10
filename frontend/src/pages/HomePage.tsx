import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Grid, Group, Paper, Stack, Text, TextInput, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import {
  IconCalendarEvent,
  IconChevronRight,
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
import { ErrorState, EmptyState, Loading, RowsSkeleton } from "../components/States";
import { GettingStarted } from "../components/GettingStarted";
import { CompactEmpty, ListRow, PageTitle, Section, SectionHead, StatusBadge, cap } from "../components/Mobile";
import { TodayInbox, useCases } from "../components/TodayInbox";

const useMobile = () => useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
/** ton plakietki zdarzenia: zaległe i nieważne – bursztyn, terminy – oczekiwanie, reszta – neutralnie */
const EVENT_TONE: Record<UpcomingEvent["kind"], "warn" | "wait" | "neutral" | "ok"> = {
  exam: "wait",
  start: "wait",
  standard_end: "warn",
  valid_until: "warn",
  hire: "ok",
  transfer: "neutral",
  task: "neutral",
  task_overdue: "warn",
  permit: "warn",
  permit_expired: "warn",
  medical: "warn",
  medical_expired: "warn",
};

interface UpcomingEvent {
  date: string;
  kind: "exam" | "start" | "standard_end" | "valid_until" | "hire" | "transfer" | "task" | "task_overdue" | "permit" | "permit_expired" | "medical" | "medical_expired";
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
  medical: "orange",
  medical_expired: "red",
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
  medical: "badania",
  medical_expired: "nieważne badania",
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
  const mobile = useMobile();
  if (mobile) {
    // grupy: zaległe na górze, potem kolejne dni
    const overdue = (e: UpcomingEvent) => e.kind === "task_overdue" || e.kind === "permit_expired" || e.kind === "medical_expired";
    const groups: { key: string; label: string; warn?: boolean; items: UpcomingEvent[] }[] = [];
    for (const e of shown) {
      const key = overdue(e) ? "overdue" : e.date;
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: key === "overdue" ? "Zaległe" : cap(dayLabel(e.date)), warn: key === "overdue", items: [] };
        if (key === "overdue") groups.unshift(g);
        else groups.push(g);
      }
      g.items.push(e);
    }
    return (
      <Section title="Najbliższe 14 dni" action={hasRole("agency") ? undefined : { label: "Zadania", to: "/zadania" }}>
        {q.isLoading ? (
          <Loading rows={3} />
        ) : events.length === 0 ? (
          <CompactEmpty title="Nic nie jest zaplanowane" text="Brak egzaminów, końców ważności i nowych osób w najbliższym czasie." />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.key} className="ui-day-group">
                <div className="ui-day-label" data-warn={g.warn || undefined}>
                  {g.warn && <IconAlertTriangle size={14} stroke={2.6} aria-hidden />}
                  {g.label} · {g.items.length}
                </div>
                {g.items.map((e, i) => (
                  <ListRow
                    key={i}
                    title={cap(e.title)}
                    description={g.warn && e.date ? `${e.employee} · termin ${dayLabel(e.date)}` : e.employee}
                    trailing={<StatusBadge tone={EVENT_TONE[e.kind] ?? "neutral"}>{EVENT_LABEL[e.kind] ?? "termin"}</StatusBadge>}
                    to={`/pracownicy/${e.employee_id}`}
                  />
                ))}
              </div>
            ))}
            {events.length > 8 && <ListRow title={all ? "Pokaż mniej" : `Pokaż wszystkie (${events.length})`} onClick={() => setAll((a) => !a)} />}
            {!hasRole("agency") && <ListRow title="Terminy szkoleń" description="Kończące się i trwające szkolenia" to="/szkolenia" />}
          </>
        )}
      </Section>
    );
  }
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
              <Badge color={EVENT_COLOR[e.kind] ?? "gray"} variant="light" size="sm" w={92} style={{ flexShrink: 0 }}>
                {EVENT_LABEL[e.kind] ?? "termin"}
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
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
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
  if (mobile)
    return (
      <Section title="Do zrobienia" action={full ? { label: "Pełna lista", to: "/do-zrobienia" } : undefined}>
        {full && q.isLoading ? (
          <Loading rows={3} />
        ) : rows.length === 0 ? (
          <ListRow leading={<span className="ui-row-icon" aria-hidden><IconCircleCheck size={22} /></span>} title="Wszystko zrobione" description="Nic nie czeka na kadry. Najbliższe terminy zobaczysz niżej." />
        ) : (
          rows.map((r) => (
            <ListRow
              key={r.key}
              leading={<span className="ui-row-icon" data-tone="warn" aria-hidden><r.icon size={22} /></span>}
              title={cap(r.label)}
              description={r.hint ?? (r.sample ? `np. ${r.sample}` : undefined)}
              trailing={<span className="ui-thread-count" aria-label={`Liczba: ${r.count}`}>{r.count}</span>}
              to={r.url}
            />
          ))
        )}
      </Section>
    );
  return (
    <Card withBorder padding={0}>
      <Group justify="space-between" px="lg" py="md" style={{ borderBottom: "1px solid var(--apt-line)" }}>
        <Title order={3} size="h4">
          Do zrobienia
        </Title>
        {full && (
          <Text component={Link} to="/do-zrobienia" size="sm" fw={600} c="var(--mantine-primary-color-text)" className="brand-link ui-hit">
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
              px={mobile ? "md" : "lg"}
              py="sm"
              {...(mobile ? { component: Link, to: r.url, className: "list-row-plain" } : {})}
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
              {mobile ? (
                <IconChevronRight size={18} color="var(--mantine-color-dimmed)" aria-hidden style={{ flexShrink: 0 }} />
              ) : (
                <Button component={Link} to={r.url} variant="default" size="sm" style={{ flexShrink: 0 }}>
                  {r.action}
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

/**
 * Komputer, kadry: pod skrzynką spraw tylko to, czego w niej nie ma – terminy na najbliższe dni
 * (bez zaległości, te są wyżej), ostatnio dodani i stan kopii. Sekcje na tle, ramka tylko wokół listy.
 */
function InboxExtras({ d, admin }: { d: Dashboard; admin: boolean }) {
  const navTo = useNavigate();
  const q = useQuery({ queryKey: ["dashboard-upcoming"], queryFn: () => api<UpcomingEvent[]>("/dashboard/upcoming") });
  const late = new Set(["task_overdue", "permit_expired", "medical_expired"]);
  const events = (q.data ?? []).filter((e) => !late.has(e.kind));
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 8);
  const problems = admin ? backupProblems(d.backup) : [];
  return (
    <div className="ui-home-extras">
      <section>
        <SectionHead
          title="Najbliższe 14 dni"
          extra={events.length > 0 ? <Text c="dimmed">{events.length}</Text> : undefined}
          action={events.length > 8 ? { label: all ? "Pokaż mniej" : `Pokaż wszystkie ${events.length}`, onClick: () => setAll((a) => !a) } : undefined}
        />
        {q.isLoading ? (
          <RowsSkeleton />
        ) : events.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nic nie jest zaplanowane: brak egzaminów, końców ważności i nowych osób.
          </Text>
        ) : (
          <Paper withBorder radius="md" className="ui-cases">
            {shown.map((e, i) => (
              <div key={i} className="ui-up-row">
                <span className="ui-up-day">{cap(dayLabel(e.date))}</span>
                <span style={{ minWidth: 0 }}>
                  <Link to={`/pracownicy/${e.employee_id}`} className="ui-case-link">
                    {e.employee}
                  </Link>
                  <Text span c="dimmed">
                    {" "}
                    · {e.title}
                  </Text>
                </span>
                <StatusBadge tone={EVENT_TONE[e.kind] ?? "neutral"}>{EVENT_LABEL[e.kind] ?? "termin"}</StatusBadge>
              </div>
            ))}
          </Paper>
        )}
      </section>
      <section>
        <SectionHead title="Ostatnio dodani" action={{ label: "Wszyscy", onClick: () => navTo("/pracownicy") }} />
        {d.recent.length === 0 ? (
          <Text size="sm" c="dimmed">
            Kartoteka jest pusta.
          </Text>
        ) : (
          <Paper withBorder radius="md" className="ui-cases">
            {d.recent.map((e) => (
              <UnstyledButton key={e.id} component={Link} to={`/pracownicy/${e.id}`} className="list-row ui-up-person">
                <EmployeePhoto employee={e} width={28} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={600} truncate>
                    {e.last_name} {e.first_name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {[e.department?.name, e.agency?.name].filter(Boolean).join(" · ") || "—"}
                  </Text>
                </div>
                <Text size="xs" c="dimmed" className="ui-mono">
                  {e.number_display}
                </Text>
              </UnstyledButton>
            ))}
          </Paper>
        )}
        {admin && (
          <Text size="xs" c={problems.length ? undefined : "dimmed"} className={problems.length ? "ui-warn" : undefined} mt="sm">
            {problems.length
              ? problems.join(" ")
              : `Kopie zapasowe w porządku: na serwerze ${d.backup?.local ? formatDateTime(d.backup.local.at) : "—"}, poza serwerem ${d.backup?.offsite ? formatDateTime(d.backup.offsite.at) : "nie skonfigurowano"}.`}
          </Text>
        )}
      </section>
    </div>
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

/**
 * Stan kartoteki jednym zdaniem zamiast rzędu kafelków z dużymi liczbami: każda liczba to link do listy,
 * a kolor dostaje tylko to, co wymaga działania (osoby bez zdjęcia).
 */
function Summary({ d, manager }: { d: Dashboard; manager: boolean }) {
  const parts: { text: string; to: string; warn?: boolean }[] = [
    { text: `${d.active} ${manager ? "aktywnych w Twoich wydziałach" : "aktywnych pracowników"}`, to: "/pracownicy" },
    { text: `${d.added_30_days} przyjętych w ostatnich 30 dniach`, to: "/pracownicy?sort=-hire_date" },
    ...(d.without_photo ? [{ text: `${d.without_photo} bez zdjęcia – ich karty się nie wydrukują`, to: "/pracownicy?missing=photo", warn: true }] : []),
    { text: `${d.terminated} w archiwum`, to: "/pracownicy?status=terminated" },
  ];
  return (
    <Text className="summary-line">
      {parts.map((p, i) => (
        <span key={p.to}>
          {i > 0 && <span aria-hidden> · </span>}
          <Link to={p.to} className="summary-link" data-warn={p.warn || undefined}>
            {p.text}
          </Link>
        </span>
      ))}
    </Text>
  );
}

function RecentCard({ d }: { d: Dashboard }) {
  const mobile = useMobile();
  if (mobile)
    return (
      <Section title="Ostatnio dodani" action={{ label: "Wszyscy", to: "/pracownicy" }}>
        {d.recent.length === 0 ? (
          <CompactEmpty title="Kartoteka jest pusta" text="Dodaj pierwszego pracownika przyciskiem „+” na liście." />
        ) : (
          d.recent.map((e) => (
            <ListRow
              key={e.id}
              leading={<EmployeePhoto employee={e} width={40} />}
              title={`${e.last_name} ${e.first_name}`}
              description={[e.department?.name, e.agency?.name].filter(Boolean).join(" · ") || "—"}
              trailing={<span className="ui-count-cell ui-mono">{e.number_display}</span>}
              to={`/pracownicy/${e.id}`}
            />
          ))
        )}
      </Section>
    );
  return (
    <Card withBorder padding={0}>
      <Group justify="space-between" px="lg" py="md">
        <Title order={3} size="h4">
          Ostatnio dodani
        </Title>
        <Text component={Link} to="/pracownicy" size="sm" fw={600} c="var(--mantine-primary-color-text)" className="brand-link ui-hit">
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
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const staff = hasRole("admin", "hr");
  const data = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const [q, setQ] = useState("");
  const mobile = useMobile();
  // komputer, kadry: „Dziś” to jedna skrzynka spraw (zastępuje Do zrobienia, Zadania i Braki w danych)
  const inbox = !mobile; // komputer: ten sam układ „Dziś” dla każdej roli personelu
  const cases = useCases();

  return (
    <Stack gap="lg">
      {mobile ? (
        <Group justify="space-between" align="flex-end" gap="md">
          <Title order={1} size="h2">
            {todayLabel()}
          </Title>
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
              <Button component={Link} to="/pracownicy/nowy" size="md" leftSection={<IconUserPlus size={18} />} visibleFrom="sm">
                Dodaj pracownika
              </Button>
            )}
          </Group>
        </Group>
      ) : (
        <PageTitle
          title={inbox ? "Dziś" : todayLabel()}
          meta={inbox ? `${todayLabel()}${cases.data ? ` · ${cases.data.total ? `${cases.data.total} ${cases.data.total === 1 ? "sprawa czeka" : cases.data.total % 10 >= 2 && cases.data.total % 10 <= 4 && (cases.data.total % 100 < 12 || cases.data.total % 100 > 14) ? "sprawy czekają" : "spraw czeka"}` : "nic nie czeka"}` : ""}` : undefined}
          actions={
            <form
            role="search"
            style={{ width: 320 }}
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
            />
          </form>
          }
        />
      )}

      {data.isLoading && <Loading />}
      {data.error && <ErrorState error={data.error} onRetry={() => data.refetch()} />}

      {data.data && !inbox && !(staff && data.data.active === 0 && data.data.recent.length === 0) && (
        <Summary d={data.data} manager={hasRole("manager")} />
      )}
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
              {inbox && (
                <>
                  <TodayInbox />
                  <InboxExtras d={data.data} admin={hasRole("admin")} />
                </>
              )}
              {!inbox && <Grid gutter="lg" align="flex-start">
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
              </Grid>}
            </>
          )}
        </>
      )}
    </Stack>
  );
}
