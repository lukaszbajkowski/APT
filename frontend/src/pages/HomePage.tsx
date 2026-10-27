import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Card, Grid, Group, Loader, SimpleGrid, Stack, Table, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import {
  IconArchive,
  IconCalendarEvent,
  IconAlertTriangle,
  IconCamera,
  IconChevronDown,
  IconChevronUp,
  IconCertificate,
  IconChecklist,
  IconCircleCheck,
  IconClockShield,
  IconFileSpreadsheet,
  IconId,
  IconIdBadge2,
  IconPrinter,
  IconScan,
  IconSearch,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, type BackupStatus, type Dashboard } from "../api";
import { ActionButton } from "../components/ActionButton";
import { useAuth } from "../auth";
import { EmployeePhoto } from "../components/EmployeePhoto";

interface UpcomingEvent {
  date: string;
  kind: "exam" | "start" | "standard_end" | "valid_until" | "hire" | "transfer" | "task" | "task_overdue";
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
          <IconCalendarEvent size={20} />
          <Title order={4}>Najbliższe 14 dni</Title>
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
        <Loader size="sm" />
      ) : events.length === 0 ? (
        <Text size="sm" c="dimmed">
          Brak zaplanowanych egzaminów, końców ważności ani nowych osób.
        </Text>
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

function Stat({
  label,
  value,
  icon,
  color,
  to,
  hint,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  color: string;
  to?: string;
  hint?: string;
}) {
  const body = (
    <Card withBorder padding="md" h="100%">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text fz={28} fw={700} lh={1.2}>
            {value.toLocaleString("pl-PL")}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </div>
        <ThemeIcon variant="light" color={color} size={38} radius="md">
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
  if (!to) return body;
  return (
    <UnstyledButton component={Link} to={to} aria-label={label} style={{ display: "block" }}>
      {body}
    </UnstyledButton>
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

export function HomePage() {
  const { me, hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const data = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const firstName = me?.user.full_name.split(" ")[0];

  return (
    <Stack maw={1200}>
      <div>
        <Title order={2}>Dzień dobry{firstName ? `, ${firstName}` : ""}</Title>
        <Text c="dimmed" size="sm">
          {hasRole("manager") ? "Podsumowanie Twoich wydziałów." : "Podsumowanie kartoteki pracowników."}
        </Text>
      </div>

      {data.isLoading && <Loader />}
      {data.error && <Alert color="red">{errorText(data.error)}</Alert>}

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

          <SimpleGrid cols={{ base: 2, md: 3, lg: staff ? 6 : 5 }}>
            <Stat label="Aktywni" value={data.data.active} icon={<IconUsers size={20} />} color="navy" to="/pracownicy" />
            <Stat
              label="Nowi"
              value={data.data.added_30_days}
              icon={<IconUserPlus size={20} />}
              color="teal"
              to="/pracownicy?sort=-number"
              hint="ostatnie 30 dni"
            />
            <Stat
              label="Bez zdjęcia"
              value={data.data.without_photo}
              icon={<IconCamera size={20} />}
              color={data.data.without_photo ? "orange" : "gray"}
              to="/pracownicy?missing=photo"
              hint="aktywni"
            />
            {data.data.without_pesel !== null && (
              <Stat
                label="Bez PESEL"
                value={data.data.without_pesel}
                icon={<IconId size={20} />}
                color={data.data.without_pesel ? "orange" : "gray"}
                to="/pracownicy?missing=pesel"
                hint="aktywni"
              />
            )}
            <Stat
              label="Karty"
              value={data.data.cards_printed_30_days}
              icon={<IconPrinter size={20} />}
              color="grape"
              hint="wydrukowane w 30 dni"
            />
            <Stat
              label="Archiwum"
              value={data.data.terminated}
              icon={<IconArchive size={20} />}
              color="gray"
              to="/pracownicy?status=terminated"
            />
          </SimpleGrid>

          <UpcomingCard />

          <Grid>
            <Grid.Col span={{ base: 12, md: 8 }}>
            <Card withBorder padding="lg" h="100%">
              <Group justify="space-between" mb="sm">
                <Title order={4}>Ostatnio dodani</Title>
                <ActionButton to="/pracownicy" icon={<IconUsers size={16} />}>
                  Wszyscy pracownicy
                </ActionButton>
              </Group>
              {data.data.recent.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Kartoteka jest pusta.
                </Text>
              ) : (
                <Table highlightOnHover verticalSpacing={6}>
                  <Table.Tbody>
                    {data.data.recent.map((e) => (
                      <Table.Tr key={e.id}>
                        <Table.Td w={44}>
                          <EmployeePhoto employee={e} width={32} />
                        </Table.Td>
                        <Table.Td>
                          <Text component={Link} to={`/pracownicy/${e.id}`} size="sm" fw={500} className="brand-link">
                            {e.last_name} {e.first_name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {e.number_display} · {[e.agency?.name, e.department?.name].filter(Boolean).join(" · ") || "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td visibleFrom="sm" align="right">
                          <Text size="xs" c="dimmed">
                            {e.hire_date ? `zatrudniony ${formatDate(e.hire_date)}` : ""}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack h="100%">
            <Card withBorder padding="lg" style={{ flex: 1 }}>
              <Title order={4} mb="sm">
                Szybkie akcje
              </Title>
              <Stack gap="xs">
                <ActionButton to="/pracownicy" justify="flex-start" icon={<IconSearch size={16} />}>
                  Szukaj pracownika
                </ActionButton>
                <ActionButton to="/skaner" justify="flex-start" icon={<IconScan size={16} />}>
                  Skanuj kartę
                </ActionButton>
                {staff && (
                  <>
                    <ActionButton to="/pracownicy/nowy" justify="flex-start" icon={<IconUserPlus size={16} />}>
                      Dodaj pracownika
                    </ActionButton>
                    <ActionButton to="/pracownicy/import" justify="flex-start" icon={<IconFileSpreadsheet size={16} />}>
                      Importuj z arkusza
                    </ActionButton>
                  </>
                )}
                {hasRole("admin", "hr", "manager") && (
                  <ActionButton to="/pracownicy" justify="flex-start" icon={<IconIdBadge2 size={16} />}>
                    Drukuj karty
                  </ActionButton>
                )}
              </Stack>
            </Card>
            {hasRole("admin") && <BackupCard status={data.data.backup} />}
            </Stack>
            </Grid.Col>
          </Grid>
        </>
      )}
    </Stack>
  );
}
