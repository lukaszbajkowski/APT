import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  SegmentedControl,
  Text,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconBriefcase,
  IconChecklist,
  IconPlayerSkipForward,
  IconPlus,
  IconTrash,
  IconUserCheck,
} from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, type DictionaryItem, type Employee } from "../api";
import { useAuth } from "../auth";

// ---------- przebieg zatrudnienia ----------

interface Period {
  hire_date: string | null;
  termination_date: string | null;
  agency: string | null;
  department: string | null;
  position: string | null;
  current: boolean;
}
interface AssignmentRow {
  valid_from: string;
  agency: string | null;
  department: string | null;
  position: string | null;
  reason: string | null;
  changed_by: string | null;
}

const place = (x: { agency: string | null; department: string | null; position: string | null }) =>
  [x.department, x.position, x.agency].filter(Boolean).join(" · ") || "—";

export function TimelineCard({ employee }: { employee: Employee }) {
  const q = useQuery({
    queryKey: ["employee-timeline", employee.id],
    queryFn: () => api<{ periods: Period[]; assignments: AssignmentRow[] }>(`/employees/${employee.id}/timeline`),
  });
  if (!q.data) return null;
  const { periods, assignments } = q.data;
  return (
    <Card withBorder padding="lg">
      <Title order={5} mb="md">
        Przebieg zatrudnienia
      </Title>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
        <div>
          <Text size="sm" fw={600} mb="xs">
            Okresy zatrudnienia
          </Text>
          <Stack gap={6}>
            {periods.map((p, i) => (
              <Paper key={i} withBorder p="xs" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {formatDate(p.hire_date)} – {p.termination_date ? formatDate(p.termination_date) : "obecnie"}
                  </Text>
                  {p.current && !p.termination_date && (
                    <Badge size="sm" variant="light" color="teal">
                      aktualny
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {place(p)}
                </Text>
              </Paper>
            ))}
          </Stack>
        </div>
        <div>
          <Text size="sm" fw={600} mb="xs">
            Wydział, stanowisko, APT – zmiany
          </Text>
          {assignments.length === 0 ? (
            <Text size="sm" c="dimmed">
              Brak wpisów.
            </Text>
          ) : (
            <Timeline bulletSize={14} lineWidth={2} active={0}>
              {assignments.map((a, i) => (
                <Timeline.Item key={i} title={<Text size="sm" fw={500}>od {formatDate(a.valid_from)}</Text>}>
                  <Text size="sm">{place(a)}</Text>
                  <Text size="xs" c="dimmed">
                    {[a.reason, a.changed_by].filter(Boolean).join(" · ")}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </div>
      </SimpleGrid>
    </Card>
  );
}

// ---------- ponowne zatrudnienie ----------

export function RehireModal({ employee, opened, onClose }: { employee: Employee; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies"), enabled: opened });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments"), enabled: opened });
  const positions = useQuery({
    queryKey: ["positions"],
    queryFn: () => api<(DictionaryItem & { department_id: number | null })[]>("/positions"),
    enabled: opened,
  });
  const [hire, setHire] = useState(new Date().toISOString().slice(0, 10));
  const [agency, setAgency] = useState<string | null>(null);
  const [dep, setDep] = useState<string | null>(null);
  const [pos, setPos] = useState<string | null>(null);
  const [checklist, setChecklist] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setHire(new Date().toISOString().slice(0, 10));
      setAgency(employee.agency ? String(employee.agency.id) : null);
      setDep(employee.department ? String(employee.department.id) : null);
      setPos(employee.position ? String(employee.position.id) : null);
      setChecklist(true);
      setError(null);
    }
  }, [opened, employee]);

  const save = useMutation({
    mutationFn: () =>
      api<Employee>(`/employees/${employee.id}/rehire`, {
        method: "POST",
        body: {
          hire_date: hire,
          agency_id: agency ? Number(agency) : null,
          department_id: dep ? Number(dep) : null,
          position_id: pos ? Number(pos) : null,
          checklist,
        },
      }),
    onSuccess: (e) => {
      qc.setQueryData(["employee", String(employee.id)], e);
      ["employees", "employee-history", "employee-timeline", "employee-checklists", "tasks"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      notifications.show({ color: "green", message: "Pracownik zatrudniony ponownie – kartoteka i historia zachowane." });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const opts = (d?: DictionaryItem[]) => (d ?? []).filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: x.name }));
  return (
    <Modal opened={opened} onClose={onClose} title={`Ponowne zatrudnienie: ${employee.last_name} ${employee.first_name}`} size="lg">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <Text size="sm" c="dimmed">
          Poprzedni okres ({formatDate(employee.hire_date)} – {formatDate(employee.termination_date)}) trafi do historii. Numer
          ewidencyjny, PESEL, zdjęcie, szkolenia i dokumenty zostają.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput type="date" label="Data zatrudnienia" value={hire} onChange={(e) => setHire(e.currentTarget.value)} />
          <Select label="APT" clearable searchable data={opts(agencies.data)} value={agency} onChange={setAgency} />
          <Select
            label="Wydział"
            clearable
            searchable
            data={opts(departments.data)}
            value={dep}
            onChange={(v) => {
              setDep(v);
              setPos(null);
            }}
          />
          <Select
            label="Stanowisko"
            clearable
            searchable
            data={(positions.data ?? [])
              .filter((p) => p.is_active && (!dep || p.department_id === null || String(p.department_id) === dep))
              .map((p) => ({ value: String(p.id), label: p.name }))}
            value={pos}
            onChange={setPos}
          />
        </SimpleGrid>
        <Checkbox label="Utwórz checklistę wdrożenia" checked={checklist} onChange={(e) => setChecklist(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button leftSection={<IconUserCheck size={16} />} onClick={() => save.mutate()} loading={save.isPending}>
            Zatrudnij ponownie
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------- checklisty ----------

export type ItemState = "done" | "auto" | "skipped" | "overdue" | "open";

export interface ChecklistItem {
  id: number;
  kind: "onboarding" | "offboarding";
  label: string;
  responsible: "hr" | "manager";
  due_date: string | null;
  auto: string | null;
  state: ItemState;
  done_at: string | null;
  done_by_name: string | null;
  note: string | null;
  can_edit: boolean;
}

export const RESPONSIBLE: Record<string, string> = { hr: "HR", manager: "kierownik" };
const KIND_LABEL = { onboarding: "Wdrożenie", offboarding: "Odejście" };

function ItemRow({ it, onChange }: { it: ChecklistItem; onChange: () => void }) {
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/checklist-items/${it.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      onChange();
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const done = it.state === "done" || it.state === "auto";
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <Checkbox
          checked={done}
          disabled={!it.can_edit || it.state === "auto" || patch.isPending}
          onChange={(e) => patch.mutate({ done: e.currentTarget.checked })}
          aria-label={it.label}
        />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" td={it.state === "skipped" ? "line-through" : undefined} c={done || it.state === "skipped" ? "dimmed" : undefined}>
            {it.label}
          </Text>
          <Text size="xs" c={it.state === "overdue" ? "red" : "dimmed"}>
            {[
              RESPONSIBLE[it.responsible],
              it.state === "done" && it.done_by_name ? `${it.done_by_name}, ${formatDateTime(it.done_at)}` : null,
              it.state === "auto" ? "spełnione automatycznie" : null,
              it.state === "skipped" ? "pominięte" : null,
              !done && it.state !== "skipped" && it.due_date ? `termin ${formatDate(it.due_date)}` : null,
              it.state === "overdue" ? "po terminie" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </div>
      </Group>
      <Group gap={4} wrap="nowrap">
        {it.auto && it.state !== "auto" && (
          <Tooltip label="Odhaczy się samo, gdy warunek zostanie spełniony" withArrow>
            <IconBolt size={14} color="var(--mantine-color-gray-5)" />
          </Tooltip>
        )}
        {it.can_edit && !done && (
          <Tooltip label={it.state === "skipped" ? "Przywróć" : "Pomiń (nie dotyczy)"} withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => patch.mutate({ skipped: it.state !== "skipped" })}>
              <IconPlayerSkipForward size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}

export function ChecklistsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const q = useQuery({
    queryKey: ["employee-checklists", employee.id],
    queryFn: () => api<{ onboarding: ChecklistItem[]; offboarding: ChecklistItem[] }>(`/employees/${employee.id}/checklists`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["employee-checklists", employee.id] });
  const create = useMutation({
    mutationFn: (kind: string) => api(`/employees/${employee.id}/checklists/${kind}`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  if (!q.data) return null;
  const kinds = (["offboarding", "onboarding"] as const).filter((k) => q.data[k].length > 0);
  const missing = employee.status === "terminated" ? "offboarding" : "onboarding";
  if (kinds.length === 0 && !staff) return null;

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconChecklist size={18} />
          <Title order={5}>Checklisty</Title>
        </Group>
        {staff && !kinds.includes(missing) && (
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => create.mutate(missing)} loading={create.isPending}>
            Utwórz checklistę: {KIND_LABEL[missing].toLowerCase()}
          </Button>
        )}
      </Group>
      {kinds.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak checklist. Wdrożenie tworzy się samo przy dodaniu nowej osoby, odejście – przy zwolnieniu.
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, md: kinds.length > 1 ? 2 : 1 }} spacing="lg">
        {kinds.map((k) => {
          const items = q.data[k];
          const doneN = items.filter((i) => ["done", "auto", "skipped"].includes(i.state)).length;
          const overdue = items.filter((i) => i.state === "overdue").length;
          return (
            <div key={k}>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>
                  {KIND_LABEL[k]}
                </Text>
                <Text size="xs" c={overdue ? "red" : "dimmed"}>
                  {doneN} z {items.length}
                  {overdue ? ` · po terminie: ${overdue}` : ""}
                </Text>
              </Group>
              <Progress value={(doneN / items.length) * 100} color={doneN === items.length ? "teal" : overdue ? "red" : "blue"} size="sm" mb="xs" />
              {items.map((it) => (
                <ItemRow key={it.id} it={it} onChange={refresh} />
              ))}
            </div>
          );
        })}
      </SimpleGrid>
    </Card>
  );
}

// ---------- szablony checklist (Słowniki) ----------

interface TemplateItem {
  id?: number;
  label: string;
  responsible: "hr" | "manager";
  due_days: number;
  auto: string | null;
}
interface Templates {
  onboarding: TemplateItem[];
  offboarding: TemplateItem[];
  auto_options: { value: string; label: string }[];
}

function TemplateList({ kind, data }: { kind: "onboarding" | "offboarding"; data: Templates }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<TemplateItem[]>(data[kind]);
  useEffect(() => setItems(data[kind]), [data, kind]);
  const save = useMutation({
    mutationFn: () => api<Templates>(`/checklist-templates/${kind}`, { method: "PUT", body: { items } }),
    onSuccess: (t) => {
      qc.setQueryData(["checklist-templates"], t);
      notifications.show({ color: "green", message: "Zapisano szablon. Zmiany dotyczą nowych checklist." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const upd = (i: number, v: Partial<TemplateItem>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const move = (i: number, d: number) =>
    setItems((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const base = kind === "onboarding" ? "zatrudnienia" : "zwolnienia";
  return (
    <Stack gap="xs">
      {items.map((it, i) => (
        <Paper key={i} withBorder p="sm" radius="md">
          <Group wrap="nowrap" align="flex-end" gap="xs">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xs" style={{ flex: 1 }}>
              <TextInput size="xs" label="Zadanie" value={it.label} onChange={(e) => upd(i, { label: e.currentTarget.value })} />
              <Select
                size="xs"
                label="Odpowiada"
                allowDeselect={false}
                data={[
                  { value: "hr", label: "HR" },
                  { value: "manager", label: "Kierownik" },
                ]}
                value={it.responsible}
                onChange={(v) => v && upd(i, { responsible: v as TemplateItem["responsible"] })}
              />
              <NumberInput
                size="xs"
                label={`Termin (dni od ${base})`}
                min={-365}
                max={365}
                allowDecimal={false}
                value={it.due_days}
                onChange={(v) => upd(i, { due_days: Number(v) || 0 })}
              />
              <Select
                size="xs"
                label="Odhacz automatycznie, gdy"
                placeholder="ręcznie"
                clearable
                searchable
                data={data.auto_options}
                value={it.auto}
                onChange={(v) => upd(i, { auto: v })}
              />
            </SimpleGrid>
            <Group gap={0} wrap="nowrap" mb={2}>
              <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="W górę">
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="W dół">
                <IconArrowDown size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="Usuń">
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
        </Paper>
      ))}
      <Group justify="space-between">
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setItems((l) => [...l, { label: "", responsible: "hr", due_days: 0, auto: null }])}
        >
          Dodaj zadanie
        </Button>
        <Button size="xs" onClick={() => save.mutate()} loading={save.isPending} disabled={items.some((x) => !x.label.trim())}>
          Zapisz szablon
        </Button>
      </Group>
    </Stack>
  );
}

export function ChecklistTemplates() {
  const q = useQuery({ queryKey: ["checklist-templates"], queryFn: () => api<Templates>("/checklist-templates") });
  const [kind, setKind] = useState<"onboarding" | "offboarding">("onboarding");
  if (q.isLoading) return <Loader />;
  if (!q.data) return <Alert color="red">{errorText(q.error)}</Alert>;
  return (
    <Stack mt="md">
      <Text size="sm" c="dimmed">
        Zadania, które aplikacja dodaje każdej nowej osobie (wdrożenie) i przy zwolnieniu (odejście). Zmiany dotyczą nowych checklist –
        istniejące zostają bez zmian.
      </Text>
      <SegmentedControl
        w="fit-content"
        value={kind}
        onChange={(v) => setKind(v as "onboarding" | "offboarding")}
        data={[
          { value: "onboarding", label: "Wdrożenie" },
          { value: "offboarding", label: "Odejście" },
        ]}
      />
      <TemplateList key={kind} kind={kind} data={q.data} />
      <Group gap={6}>
        <IconBriefcase size={14} color="var(--mantine-color-gray-6)" />
        <Text size="xs" c="dimmed">
          Termin ujemny = przed datą (np. -3 dla badań przed pierwszym dniem).
        </Text>
      </Group>
    </Stack>
  );
}
