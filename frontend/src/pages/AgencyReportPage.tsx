import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconMail } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, errorText, formatDate, formatDateTime, type DictionaryItem, withAcct } from "../api";
import { ErrorState, EmptyState, Loading } from "../components/States";

interface Row {
  employee_id: number;
  number: string;
  last_name: string;
  first_name: string;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  termination_date: string | null;
  period_from: string;
  period_to: string;
  days: number;
  change: string;
}
interface Report {
  agency_id: number;
  agency: string;
  month: string;
  label: string;
  recipients: string[];
  last_sent_at: string | null;
  last_sent_to: string[];
  people: number;
  came: number;
  left: number;
  rows: Row[];
}

const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

function monthOptions(): { value: string; label: string }[] {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 24; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}${i === 0 ? " (bieżący)" : ""}` });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function AgencyReportPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const qc = useQueryClient();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[1].value); // domyślnie poprzedni miesiąc
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies"), enabled: staff });
  const [agencyId, setAgencyId] = useState<string | null>(null);
  useEffect(() => {
    if (staff && !agencyId && agencies.data?.length) setAgencyId(String(agencies.data[0].id));
  }, [staff, agencyId, agencies.data]);

  const params = new URLSearchParams({ month, ...(agencyId ? { agency_id: agencyId } : {}) }).toString();
  const report = useQuery({
    queryKey: ["agency-report", agencyId, month],
    queryFn: () => api<Report>(`/agency-report?${params}`),
    enabled: !staff || !!agencyId,
  });
  const send = useMutation({
    mutationFn: () => api<{ sent_to: string[] }>("/agency-report/send", { method: "POST", body: { agency_id: Number(agencyId), month } }),
    onSuccess: (r) => {
      notifications.show({ color: "green", message: `Wysłano na: ${r.sent_to.join(", ")}` });
      qc.invalidateQueries({ queryKey: ["agency-report"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const r = report.data;
  return (
    <Stack>
      <div>
        <Title order={2}>Zestawienie dla agencji</Title>
        <Text c="dimmed" size="sm">
          Osoby, które w danym miesiącu choć jeden dzień pracowały w APT, z okresem zatrudnienia w tym miesiącu.
          {staff && " 1. dnia miesiąca zestawienie za poprzedni miesiąc wychodzi automatycznie na adres e-mail APT (kopia do kadr)."}
        </Text>
      </div>

      <Group align="flex-end" gap="sm" wrap="wrap">
        {staff && (
          <Select
            label="APT"
            w={260}
            searchable
            allowDeselect={false}
            data={(agencies.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
            value={agencyId}
            onChange={setAgencyId}
          />
        )}
        <Select label="Miesiąc" w={220} allowDeselect={false} data={months} value={month} onChange={(v) => v && setMonth(v)} />
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          component="a"
          href={withAcct(`/api/agency-report/xlsx?${params}`)}
          disabled={!r}
        >
          Pobierz Excel
        </Button>
        {staff && (
          <Button leftSection={<IconMail size={16} />} onClick={() => send.mutate()} loading={send.isPending} disabled={!r || !r.recipients.length}>
            Wyślij do agencji
          </Button>
        )}
      </Group>

      {staff && agencies.data?.length === 0 && <Alert color="blue">Dodaj APT w Słownikach, żeby przygotować zestawienie.</Alert>}
      {report.isLoading && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
      {r && (
        <>
          {staff && (
            <Text size="sm" c={r.recipients.length ? "dimmed" : "orange"}>
              {r.recipients.length ? (
                <>Adres agencji: {r.recipients.join(", ")}</>
              ) : (
                <>
                  APT nie ma adresu e-mail – zestawienie nie zostanie wysłane automatycznie. Uzupełnij go w{" "}
                  <Anchor component={Link} to="/slowniki" size="sm">
                    Słownikach
                  </Anchor>
                  .
                </>
              )}
              {r.last_sent_at && ` · za ${r.label} wysłano ${formatDateTime(r.last_sent_at)}`}
            </Text>
          )}
          <SimpleGrid cols={{ base: 3 }} maw={480}>
            <Card withBorder padding="sm">
              <Text size="xs" c="dimmed">Osób</Text>
              <Text fw={700} size="xl">{r.people}</Text>
            </Card>
            <Card withBorder padding="sm">
              <Text size="xs" c="dimmed">Przyjętych</Text>
              <Text fw={700} size="xl" c="teal">{r.came}</Text>
            </Card>
            <Card withBorder padding="sm">
              <Text size="xs" c="dimmed">Odchodzących</Text>
              <Text fw={700} size="xl" c="orange">{r.left}</Text>
            </Card>
          </SimpleGrid>
          {r.rows.length === 0 ? (
            <EmptyState compact title={`Brak osób w: ${r.label}`} text="W tym okresie nikt nie spełnia tego warunku." />
          ) : (
            <Card withBorder padding={0}>
              <Table.ScrollContainer minWidth={820}>
                <Table striped verticalSpacing={6} fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Nr</Table.Th>
                      <Table.Th>Nazwisko i imię</Table.Th>
                      <Table.Th>Wydział / stanowisko</Table.Th>
                      <Table.Th>Zatrudnienie</Table.Th>
                      <Table.Th>W miesiącu</Table.Th>
                      <Table.Th ta="right">Dni</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {r.rows.map((x) => (
                      <Table.Tr key={`${x.employee_id}-${x.period_from}`}>
                        <Table.Td ff="monospace">{x.number}</Table.Td>
                        <Table.Td>
                          <Anchor component={Link} to={`/pracownicy/${x.employee_id}`} size="sm">
                            {x.last_name} {x.first_name}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{x.department ?? "—"}</Text>
                          <Text size="xs" c="dimmed">{x.position ?? ""}</Text>
                        </Table.Td>
                        <Table.Td>
                          {formatDate(x.hire_date)} – {x.termination_date ? formatDate(x.termination_date) : "…"}
                        </Table.Td>
                        <Table.Td>
                          {formatDate(x.period_from)} – {formatDate(x.period_to)}
                        </Table.Td>
                        <Table.Td ta="right">{x.days}</Table.Td>
                        <Table.Td>
                          {x.change && (
                            <Badge size="sm" variant="light" color={x.change === "przyjęty" ? "teal" : x.change === "odszedł" ? "orange" : "grape"}>
                              {x.change}
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          )}
        </>
      )}
    </Stack>
  );
}
