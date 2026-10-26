import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconClockHour4,
  IconLoader,
  IconPencil,
  IconStarFilled,
  IconX,
} from "@tabler/icons-react";

import { api, errorText, formatDate, type DictionaryItem, type TrainingType } from "../api";
import { useAuth } from "../auth";

export type ReqState = "ok" | "expiring" | "in_progress" | "expired" | "missing";

export const REQ_STATE: Record<ReqState, { label: string; color: string }> = {
  ok: { label: "ma", color: "teal" },
  expiring: { label: "kończy się", color: "orange" },
  in_progress: { label: "w trakcie", color: "blue" },
  expired: { label: "wygasło", color: "red" },
  missing: { label: "brak", color: "red" },
};

// ---------- wymagania stanowisk ----------

interface Req {
  id: number;
  type_id: number;
  program_id: number | null;
  label: string;
  type_name: string;
}

interface PositionReqs {
  position_id: number;
  position: string;
  department: string | null;
  is_active: boolean;
  requirements: Req[];
}

const reqValue = (type_id: number, program_id: number | null) => (program_id ? `p:${type_id}:${program_id}` : `t:${type_id}`);

function PositionRow({ p, types, staff }: { p: PositionReqs; types: TrainingType[]; staff: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string[]>([]);
  const data = types.map((t) => ({
    group: t.name,
    items: [
      { value: `t:${t.id}`, label: t.kind === "position" ? `${t.name} (dowolne)` : t.name },
      ...t.programs.map((pr) => ({
        value: `p:${t.id}:${pr.id}`,
        label: pr.department ? `${pr.name} · ${pr.department}` : pr.name,
      })),
    ],
  }));
  const save = useMutation({
    mutationFn: () =>
      api(`/positions/${p.position_id}/requirements`, {
        method: "PUT",
        body: {
          items: value.map((v) => {
            const [kind, t, pr] = v.split(":");
            return { type_id: Number(t), program_id: kind === "p" ? Number(pr) : null };
          }),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["position-requirements"] });
      qc.invalidateQueries({ queryKey: ["training-matrix"] });
      qc.invalidateQueries({ queryKey: ["employee-requirements"] });
      notifications.show({ color: "green", message: `Zapisano wymagania: ${p.position}.` });
      setEditing(false);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6}>
            <Text fw={600}>{p.position}</Text>
            {p.department && (
              <Text size="sm" c="dimmed">
                {p.department}
              </Text>
            )}
          </Group>
          {editing ? (
            <Stack gap="xs" mt="xs">
              <MultiSelect
                aria-label={`Wymagane szkolenia: ${p.position}`}
                placeholder="Wybierz szkolenia"
                searchable
                clearable
                data={data}
                value={value}
                onChange={setValue}
              />
              <Group gap="xs">
                <Button size="xs" onClick={() => save.mutate()} loading={save.isPending}>
                  Zapisz
                </Button>
                <Button size="xs" variant="default" onClick={() => setEditing(false)}>
                  Anuluj
                </Button>
              </Group>
            </Stack>
          ) : p.requirements.length ? (
            <Group gap={6} mt={6}>
              {p.requirements.map((r) => (
                <Badge key={r.id} variant="light" radius="sm" style={{ textTransform: "none", fontWeight: 500 }}>
                  {r.label}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              Brak wymagań.
            </Text>
          )}
        </div>
        {staff && !editing && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPencil size={14} />}
            onClick={() => {
              setValue(p.requirements.map((r) => reqValue(r.type_id, r.program_id)));
              setEditing(true);
            }}
          >
            Zmień
          </Button>
        )}
      </Group>
    </Paper>
  );
}

export function PositionRequirements() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const list = useQuery({ queryKey: ["position-requirements"], queryFn: () => api<PositionReqs[]>("/position-requirements") });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  if (list.isLoading || types.isLoading) return <Loader />;
  if (list.error) return <Alert color="red">{errorText(list.error)}</Alert>;
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Szkolenia obowiązkowe na stanowisku. Braki widać w kartotece, w matrycy, w „Brakach w danych” i w poniedziałkowym e-mailu.
        Stanowiska dodaje się w Słownikach.
      </Text>
      {list.data?.length === 0 && <Text c="dimmed">Brak stanowisk w słowniku.</Text>}
      {list.data?.map((p) => (
        <PositionRow key={p.position_id} p={p} types={(types.data ?? []).filter((t) => t.is_active)} staff={staff} />
      ))}
    </Stack>
  );
}

// ---------- wymagania w kartotece ----------

interface EmployeeReq {
  label: string;
  state: ReqState;
  valid_until: string | null;
}

export function EmployeeRequirements({ employeeId }: { employeeId: number }) {
  const q = useQuery({
    queryKey: ["employee-requirements", employeeId],
    queryFn: () => api<EmployeeReq[]>(`/employees/${employeeId}/requirements`),
  });
  if (!q.data || q.data.length === 0) return null;
  const problems = q.data.filter((r) => r.state === "missing" || r.state === "expired").length;
  return (
    <Paper withBorder p="sm" radius="md" mb="sm" bg={problems ? "var(--mantine-color-red-light)" : undefined}>
      <Group gap={6} mb={6}>
        {problems ? <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" /> : <IconCheck size={16} color="var(--mantine-color-teal-6)" />}
        <Text size="sm" fw={600}>
          Wymagane na stanowisku{problems ? ` – braki: ${problems}` : " – komplet"}
        </Text>
      </Group>
      <Group gap={6}>
        {q.data.map((r) => (
          <Badge key={r.label} color={REQ_STATE[r.state].color} variant="light" radius="sm" style={{ textTransform: "none", fontWeight: 500 }}>
            {r.label}: {REQ_STATE[r.state].label}
            {r.valid_until && r.state !== "missing" ? ` (do ${formatDate(r.valid_until)})` : ""}
          </Badge>
        ))}
      </Group>
    </Paper>
  );
}

// ---------- matryca ----------

interface MatrixColumn {
  key: string;
  label: string;
  group: string;
  type_id: number;
  program_id: number | null;
}
interface MatrixCell {
  state: ReqState;
  required: boolean;
  mentor: boolean;
  valid_until: string | null;
}
interface MatrixRow {
  employee_id: number;
  number: string;
  name: string;
  department: string | null;
  position: string | null;
  cells: Record<string, MatrixCell>;
  problems: number;
}
interface Matrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  truncated: boolean;
}

const ICON = { size: 14, stroke: 2.2 };

function CellView({ c, col, row }: { c: MatrixCell; col: MatrixColumn; row: MatrixRow }) {
  const st = REQ_STATE[c.state];
  const icon =
    c.state === "ok" ? (
      <IconCheck {...ICON} />
    ) : c.state === "expiring" ? (
      <IconClockHour4 {...ICON} />
    ) : c.state === "in_progress" ? (
      <IconLoader {...ICON} />
    ) : c.state === "expired" ? (
      <IconX {...ICON} />
    ) : c.required ? (
      <IconAlertTriangle {...ICON} />
    ) : null;
  const tip = [
    `${row.name} – ${col.label}`,
    c.state === "missing" ? (c.required ? "brak (wymagane)" : "brak") : st.label,
    c.valid_until ? `ważne do ${formatDate(c.valid_until)}` : null,
    c.required ? "wymagane na stanowisku" : null,
    c.mentor ? "może prowadzić" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const color = c.state === "missing" && !c.required ? "gray" : st.color;
  return (
    <Tooltip label={tip} withArrow openDelay={200}>
      <div
        style={{
          position: "relative",
          width: 28,
          height: 28,
          margin: "0 auto",
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          color: `var(--mantine-color-${color}-7)`,
          background: icon ? `var(--mantine-color-${color}-light)` : undefined,
          outline: c.required ? `1.5px solid var(--mantine-color-${color === "gray" ? "red" : color}-4)` : undefined,
        }}
      >
        {icon ?? <Text c="dimmed">·</Text>}
        {c.mentor && (
          <IconStarFilled size={9} style={{ position: "absolute", top: -3, right: -3, color: "var(--mantine-color-yellow-6)" }} />
        )}
      </div>
    </Tooltip>
  );
}

export function CompetenceMatrix() {
  const [dep, setDep] = useState<string | null>(null);
  const [pos, setPos] = useState<string | null>(null);
  const [general, setGeneral] = useState(false);
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: () => api<(DictionaryItem & { department_id: number | null })[]>("/positions"),
  });
  const params = new URLSearchParams();
  if (dep) params.set("department_id", dep);
  if (pos) params.set("position_id", pos);
  if (general) params.set("general", "true");
  const m = useQuery({
    queryKey: ["training-matrix", params.toString()],
    queryFn: () => api<Matrix>(`/trainings/matrix?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const data = m.data;
  return (
    <Stack>
      <Group align="flex-end" gap="sm">
        <Select
          label="Wydział"
          placeholder="Wszystkie"
          clearable
          searchable
          w={220}
          data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
          value={dep}
          onChange={(v) => {
            setDep(v);
            setPos(null);
          }}
        />
        <Select
          label="Stanowisko"
          placeholder="Wszystkie"
          clearable
          searchable
          w={220}
          data={(positions.data ?? [])
            .filter((p) => !dep || p.department_id === null || String(p.department_id) === dep)
            .map((p) => ({ value: String(p.id), label: p.name }))}
          value={pos}
          onChange={setPos}
        />
        <Switch label="Pokaż też zwykłe szkolenia (BHP, badania…)" checked={general} onChange={(e) => setGeneral(e.currentTarget.checked)} mb={8} />
      </Group>
      <Group gap="md">
        {(["ok", "expiring", "in_progress", "expired"] as ReqState[]).map((s) => (
          <Group key={s} gap={4}>
            <Badge color={REQ_STATE[s].color} variant="light" size="sm">
              {REQ_STATE[s].label}
            </Badge>
          </Group>
        ))}
        <Text size="xs" c="dimmed">
          Obramowanie = wymagane na stanowisku · <IconStarFilled size={10} color="var(--mantine-color-yellow-6)" /> = może
          prowadzić
        </Text>
      </Group>
      {m.error && <Alert color="red">{errorText(m.error)}</Alert>}
      {!data && m.isLoading && <Loader />}
      {data && data.columns.length === 0 && (
        <Text c="dimmed">
          Brak szkoleń do pokazania. Dodaj pozycje do katalogu szkoleń stanowiskowych albo włącz zwykłe szkolenia.
        </Text>
      )}
      {data && data.columns.length > 0 && (
        <Card withBorder padding={0} style={{ overflowX: "auto", width: "fit-content", maxWidth: "100%" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13, width: "max-content" }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--mantine-color-body)",
                    textAlign: "left",
                    verticalAlign: "bottom",
                    padding: "8px 12px",
                    minWidth: 200,
                    borderBottom: "1px solid var(--mantine-color-default-border)",
                  }}
                >
                  Pracownik ({data.rows.length})
                </th>
                {data.columns.map((c) => (
                  <th
                    key={c.key}
                    title={`${c.group}: ${c.label}`}
                    style={{
                      height: 190,
                      width: 40,
                      minWidth: 40,
                      verticalAlign: "bottom",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--mantine-color-default-border)",
                    }}
                  >
                    <div
                      style={{
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxHeight: 180,
                        margin: "0 auto",
                        fontWeight: 500,
                      }}
                    >
                      {c.label}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employee_id}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: "var(--mantine-color-body)",
                      padding: "4px 12px",
                      borderBottom: "1px solid var(--mantine-color-default-border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Group gap={6} wrap="nowrap">
                      <Anchor component={Link} to={`/pracownicy/${r.employee_id}`} size="sm">
                        {r.name}
                      </Anchor>
                      {r.problems > 0 && (
                        <Badge color="red" variant="light" size="xs">
                          braki: {r.problems}
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {[r.position, dep ? null : r.department].filter(Boolean).join(" · ") || `nr ${r.number}`}
                    </Text>
                  </td>
                  {data.columns.map((c) => (
                    <td key={c.key} style={{ padding: 4, borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                      <CellView c={r.cells[c.key]} col={c} row={r} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data?.truncated && (
        <Text size="xs" c="dimmed">
          Pokazano pierwsze 400 osób – zawęź wydziałem lub stanowiskiem.
        </Text>
      )}
    </Stack>
  );
}
