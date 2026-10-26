import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFileSpreadsheet, IconFileTypePdf, IconFilterOff } from "@tabler/icons-react";

import {
  api,
  apiDownload,
  errorText,
  formatDate,
  TRAINING_STATUS,
  type DictionaryItem,
  type TrainingStatus,
  type TrainingType,
} from "../api";

interface Row {
  training_id: number;
  employee_id: number;
  number: string;
  last_name: string;
  first_name: string;
  employee_department: string | null;
  type_name: string;
  name: string | null;
  department: string | null;
  mentor_name: string | null;
  start_date: string | null;
  exam_date: string | null;
  end_date: string | null;
  completed_on: string | null;
  valid_until: string | null;
  standard_days: number | null;
  days: number | null;
  status: TrainingStatus;
  has_scan: boolean;
}

interface Report {
  total: number;
  by_status: Partial<Record<TrainingStatus, number>>;
  rows: Row[];
}

interface Filters {
  type_id: string | null;
  program_id: string | null;
  department_id: string | null;
  mentor_id: string | null;
  status: string[];
  date_from: string;
  date_to: string;
  employees: "active" | "all";
}

const EMPTY: Filters = {
  type_id: null,
  program_id: null,
  department_id: null,
  mentor_id: null,
  status: [],
  date_from: "",
  date_to: "",
  employees: "active",
};

const STATUS_ORDER: TrainingStatus[] = ["overdue", "in_progress", "planned", "expired", "expiring", "valid", "completed", "none"];

function toQuery(f: Filters): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of ["type_id", "program_id", "department_id", "mentor_id", "date_from", "date_to"] as const) {
    if (f[k]) q.set(k, String(f[k]));
  }
  f.status.forEach((s) => q.append("status", s));
  q.set("employees", f.employees);
  return q;
}

function rowDates(r: Row): string {
  if (r.start_date && !r.completed_on) return `od ${formatDate(r.start_date)}`;
  if (r.start_date && r.completed_on) return `${formatDate(r.start_date)} – ${formatDate(r.completed_on)}`;
  if (r.completed_on) return `ukończone ${formatDate(r.completed_on)}`;
  return "—";
}

export function TrainingsReport() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const query = toQuery(f).toString();
  const report = useQuery({
    queryKey: ["trainings-report", query],
    queryFn: () => api<Report>(`/reports/trainings?${query}&limit=300`),
    placeholderData: keepPreviousData,
  });

  const type = types.data?.find((t) => String(t.id) === f.type_id);
  const programs = (type ? [type] : types.data ?? []).flatMap((t) => t.programs);
  const mentors = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of types.data ?? []) for (const p of t.programs) for (const m of p.mentors) map.set(m.id, m.name);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "pl")).map(([id, name]) => ({ value: String(id), label: name }));
  }, [types.data]);

  async function download(format: "xlsx" | "pdf") {
    setBusy(format);
    try {
      const q = toQuery(f);
      if (format === "pdf") q.set("format", "pdf");
      await apiDownload(`/reports/trainings.xlsx?${q.toString()}`, undefined, `szkolenia.${format}`);
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const data = report.data;
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          <Select
            label="Rodzaj"
            placeholder="Wszystkie"
            clearable
            data={(types.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
            value={f.type_id}
            onChange={(v) => setF((x) => ({ ...x, type_id: v, program_id: null }))}
          />
          <Select
            label="Szkolenie z katalogu"
            placeholder="Wszystkie"
            clearable
            searchable
            disabled={programs.length === 0}
            data={programs.map((p) => ({ value: String(p.id), label: p.department ? `${p.name} · ${p.department}` : p.name }))}
            value={f.program_id}
            onChange={(v) => set("program_id", v)}
          />
          <Select
            label="Wydział"
            placeholder="Wszystkie"
            clearable
            searchable
            data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
            value={f.department_id}
            onChange={(v) => set("department_id", v)}
          />
          <Select
            label="Opiekun"
            placeholder="Wszyscy"
            clearable
            searchable
            data={mentors}
            value={f.mentor_id}
            onChange={(v) => set("mentor_id", v)}
          />
          <MultiSelect
            label="Status"
            placeholder={f.status.length ? undefined : "Wszystkie"}
            clearable
            data={STATUS_ORDER.map((s) => ({ value: s, label: TRAINING_STATUS[s].label }))}
            value={f.status}
            onChange={(v) => set("status", v)}
          />
          <TextInput
            type="date"
            label="Od"
            value={f.date_from}
            onChange={(e) => set("date_from", e.currentTarget.value)}
          />
          <TextInput type="date" label="Do" value={f.date_to} onChange={(e) => set("date_to", e.currentTarget.value)} />
          <div>
            <Text size="sm" fw={500} mb={2}>
              Pracownicy
            </Text>
            <SegmentedControl
              fullWidth
              value={f.employees}
              onChange={(v) => set("employees", v as Filters["employees"])}
              data={[
                { value: "active", label: "Aktywni" },
                { value: "all", label: "Wszyscy" },
              ]}
            />
          </div>
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="xs">
          Wydział: wydział szkolenia (stanowiskowe) albo pracownika. Daty Od–Do: data ukończenia, a dla szkoleń w trakcie –
          rozpoczęcia.
        </Text>
        <Group justify="space-between" mt="sm">
          <Button variant="subtle" size="xs" leftSection={<IconFilterOff size={14} />} disabled={!filtered} onClick={() => setF(EMPTY)}>
            Wyczyść filtry
          </Button>
          <Group gap="xs">
            <Button size="xs" leftSection={<IconFileSpreadsheet size={14} />} loading={busy === "xlsx"} onClick={() => download("xlsx")}>
              Excel
            </Button>
            <Button size="xs" variant="default" leftSection={<IconFileTypePdf size={14} />} loading={busy === "pdf"} onClick={() => download("pdf")}>
              PDF
            </Button>
          </Group>
        </Group>
      </Paper>

      {report.error && <Alert color="red">{errorText(report.error)}</Alert>}
      {!data && report.isLoading && <Loader />}
      {data && (
        <>
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Wyników: {data.total}
            </Text>
            {STATUS_ORDER.filter((s) => data.by_status[s]).map((s) => (
              <Badge
                key={s}
                variant={f.status.includes(s) ? "filled" : "light"}
                color={TRAINING_STATUS[s].color}
                style={{ cursor: "pointer" }}
                onClick={() => set("status", f.status.includes(s) ? f.status.filter((x) => x !== s) : [...f.status, s])}
              >
                {TRAINING_STATUS[s].label}: {data.by_status[s]}
              </Badge>
            ))}
          </Group>
          {data.total === 0 ? (
            <Text c="dimmed">Brak szkoleń dla wybranych filtrów.</Text>
          ) : (
            <Card withBorder padding={0}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Pracownik</Table.Th>
                    <Table.Th>Szkolenie</Table.Th>
                    <Table.Th ta="right">Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.rows.map((r) => {
                    const st = TRAINING_STATUS[r.status];
                    return (
                      <Table.Tr key={r.training_id}>
                        <Table.Td>
                          <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                            {r.last_name} {r.first_name}
                          </Anchor>
                          <Text size="xs" c="dimmed">
                            nr {r.number}
                            {r.employee_department ? ` · ${r.employee_department}` : ""}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{r.name ?? r.type_name}</Text>
                          <Text size="xs" c="dimmed">
                            {[r.name ? r.type_name : null, rowDates(r), r.department, r.mentor_name ? `opiekun: ${r.mentor_name}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Badge color={st.color} variant="light" size="sm">
                            {st.label}
                          </Badge>
                          <Text size="xs" c={r.status === "overdue" ? "red" : "dimmed"}>
                            {r.days !== null && !r.completed_on
                              ? `dzień ${r.days}${r.standard_days !== null ? ` z ${r.standard_days}` : ""}`
                              : r.valid_until
                                ? `do ${formatDate(r.valid_until)}`
                                : ""}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Card>
          )}
          {data.total > data.rows.length && (
            <Text size="xs" c="dimmed">
              Pokazano {data.rows.length} z {data.total}. Pełna lista w eksporcie Excel.
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
