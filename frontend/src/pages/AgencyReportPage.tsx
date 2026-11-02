import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import { IconDots, IconDownload, IconMail } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, Chips, CompactEmpty, InfoRow, ListRow, PageHead, PickSheet, Section, StatusBadge } from "../components/Mobile";
import { useConfirm } from "../lib/confirm";

import { useAuth } from "../auth";
import { api, formatDate, formatDateTime, type DictionaryItem, withAcct } from "../api";
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
  });

  const r = report.data;
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [pick, setPick] = useState<null | "agency" | "month" | "more">(null);
  const confirm = useConfirm();

  if (mobile) {
    const agencyName = agencies.data?.find((a) => String(a.id) === agencyId)?.name ?? r?.agency;
    const monthLabel = months.find((m) => m.value === month)?.label ?? month;
    const xlsx = withAcct(`/api/agency-report/xlsx?${params}`);
    const askSend = () =>
      confirm({
        title: "Wysłać zestawienie?",
        message: `Zestawienie za ${r?.label ?? monthLabel} trafi na: ${r?.recipients.join(", ")}.`,
        confirmLabel: "Wyślij",
      }).then((ok) => ok && send.mutate());
    return (
      <Stack gap={16}>
        <PageHead
          title="Zestawienie dla agencji"
          subtitle={[agencyName, monthLabel].filter(Boolean).join(" · ")}
          extra={{ label: "Więcej akcji", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setPick("more") }}
        />
        <Chips
          items={[
            ...(staff ? [{ label: agencyName ?? "APT", active: true, menu: true, onClick: () => setPick("agency") }] : []),
            { label: monthLabel, active: true, menu: true, onClick: () => setPick("month") },
          ]}
        />
        {staff && agencies.data?.length === 0 && <CompactEmpty title="Brak APT" text="Dodaj APT w Słownikach, żeby przygotować zestawienie." />}
        {report.isLoading && <Loading />}
        {report.error && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
        {r && (
          <>
            {staff && !r.recipients.length && (
              <div className="ui-hint-warn">
                APT nie ma adresu e-mail – zestawienie nie wyjdzie automatycznie. Uzupełnij go w <Link to="/slowniki">Słownikach</Link>.
              </div>
            )}
            <Section title="Podsumowanie">
              <InfoRow label="Osób">{r.people}</InfoRow>
              <InfoRow label="Przyjętych">{r.came}</InfoRow>
              <InfoRow label="Odchodzących">{r.left}</InfoRow>
              {staff && r.recipients.length > 0 && <InfoRow label="Adres agencji" stacked>{r.recipients.join(", ")}</InfoRow>}
              {r.last_sent_at && <InfoRow label="Wysłano">{formatDateTime(r.last_sent_at)}</InfoRow>}
            </Section>
            <Section title={`Osoby · ${r.rows.length}`}>
              {r.rows.length === 0 ? (
                <CompactEmpty title={`Brak osób w: ${r.label}`} text="W tym okresie nikt nie pracował w tej APT." />
              ) : (
                r.rows.map((x) => (
                  <ListRow
                    key={`${x.employee_id}-${x.period_from}`}
                    title={`${x.last_name} ${x.first_name}`}
                    description={[`nr ${x.number}`, x.department, `${formatDate(x.period_from)} – ${formatDate(x.period_to)}`, `${x.days} dni`].filter(Boolean).join(" · ")}
                    trailing={x.change ? <StatusBadge tone={x.change === "przyjęty" ? "ok" : x.change === "odszedł" ? "warn" : "neutral"}>{x.change}</StatusBadge> : undefined}
                    to={`/pracownicy/${x.employee_id}`}
                  />
                ))
              )}
            </Section>
            {staff ? (
              <Button size="lg" fullWidth leftSection={<IconMail size={20} />} loading={send.isPending} disabled={!r.recipients.length} onClick={askSend}>
                Wyślij do agencji
              </Button>
            ) : (
              <Button size="lg" fullWidth leftSection={<IconDownload size={20} />} component="a" href={xlsx}>
                Pobierz Excel
              </Button>
            )}
          </>
        )}
        <PickSheet
          opened={pick === "agency"}
          onClose={() => setPick(null)}
          title="APT (agencja pracy)"
          options={(agencies.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          value={agencyId ? [agencyId] : []}
          onChange={(v) => v[0] && setAgencyId(v[0])}
        />
        <PickSheet opened={pick === "month"} onClose={() => setPick(null)} title="Miesiąc" options={months} value={[month]} onChange={(v) => v[0] && setMonth(v[0])} />
        <ActionSheet
          opened={pick === "more"}
          onClose={() => setPick(null)}
          title="Zestawienie"
          actions={[
            { label: "Pobierz Excel", description: "Lista osób z okresami zatrudnienia", icon: <IconDownload size={20} />, disabled: !r, onClick: () => window.location.assign(xlsx) },
            ...(staff ? [{ label: "Wyślij do agencji", description: r?.recipients.length ? r.recipients.join(", ") : "APT nie ma adresu e-mail", icon: <IconMail size={20} />, disabled: !r || !r.recipients.length, onClick: askSend }] : []),
          ]}
        />
      </Stack>
    );
  }

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
            label="APT (agencja pracy)"
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
