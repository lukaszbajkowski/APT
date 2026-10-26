import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Popover,
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
  IconCalendarEvent,
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
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
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
        {staff && !done && it.state !== "skipped" && (
          <Popover position="bottom-end" withArrow shadow="md">
            <Popover.Target>
              <Tooltip label="Zmień termin" withArrow>
                <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Termin: ${it.label}`}>
                  <IconCalendarEvent size={14} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              <TextInput
                size="xs"
                type="date"
                label="Termin"
                defaultValue={it.due_date ?? ""}
                onBlur={(e) => {
                  const v = e.currentTarget.value;
                  if (v && v !== it.due_date) patch.mutate({ due_date: v });
                }}
              />
            </Popover.Dropdown>
          </Popover>
        )}
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

// ---------- panel ustawień checklist ----------

interface TemplateItem {
  id?: number;
  label: string;
  responsible: "hr" | "manager";
  due_days: number;
  auto: string | null;
  agency_ids: number[];
  department_ids: number[];
}
interface Templates {
  onboarding: TemplateItem[];
  offboarding: TemplateItem[];
  auto_options: { value: string; label: string }[];
}
type Kind = "onboarding" | "offboarding";

function dueText(days: number, kind: Kind) {
  const ev = kind === "onboarding" ? "zatrudnienia" : "zwolnienia";
  if (days === 0) return `w dniu ${ev}`;
  return days > 0 ? `${days} dni po ${ev.replace("ia", "iu")}` : `${-days} dni przed ${ev.replace("ia", "iem")}`;
}

function scopeText(it: TemplateItem, ag: Map<number, string>, dep: Map<number, string>) {
  const a = it.agency_ids.length ? it.agency_ids.map((x) => ag.get(x) ?? "?").join(", ") : "wszystkie APT";
  const d = it.department_ids.length ? it.department_ids.map((x) => dep.get(x) ?? "?").join(", ") : "wszystkie wydziały";
  return `${a} · ${d}`;
}

function TemplatePanel({ kind, data }: { kind: Kind; data: Templates }) {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const [items, setItems] = useState<TemplateItem[]>(data[kind]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pAg, setPAg] = useState<string | null>(null);
  const [pDep, setPDep] = useState<string | null>(null);
  useEffect(() => {
    setItems(data[kind]);
    setDirty(false);
  }, [data, kind]);

  const agMap = new Map((agencies.data ?? []).map((x) => [x.id, x.name]));
  const depMap = new Map((departments.data ?? []).map((x) => [x.id, x.name]));
  const agOpts = (agencies.data ?? []).filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: x.name }));
  const depOpts = (departments.data ?? []).filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: x.name }));

  const save = useMutation({
    mutationFn: () => api<Templates>(`/checklist-templates/${kind}`, { method: "PUT", body: { items } }),
    onSuccess: (t) => {
      qc.setQueryData(["checklist-templates"], t);
      setDirty(false);
      setSaved(true);
      notifications.show({ color: "green", message: "Zapisano. Nowe checklisty będą tworzone według tych ustawień." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const apply = useMutation({
    mutationFn: () => api<{ people: number; added: number; removed: number }>(`/checklist-templates/${kind}/apply`, { method: "POST" }),
    onSuccess: (r) => {
      setSaved(false);
      ["employee-checklists", "tasks", "dashboard-upcoming"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      notifications.show({
        color: "green",
        message: `Zaktualizowano checklisty ${r.people} os. (dodane pozycje: ${r.added}, usunięte: ${r.removed}).`,
      });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const upd = (i: number, v: Partial<TemplateItem>) => {
    setDirty(true);
    setItems((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));
  };
  const move = (i: number, d: number) => {
    setDirty(true);
    setItems((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  };
  const ids = (v: string[]) => v.map(Number);

  const preview = items.filter(
    (it) =>
      (!it.agency_ids.length || (pAg !== null && it.agency_ids.includes(Number(pAg)))) &&
      (!it.department_ids.length || (pDep !== null && it.department_ids.includes(Number(pDep)))),
  );
  const base = kind === "onboarding" ? "zatrudnienia" : "zwolnienia";

  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="xs">
          {items.map((it, i) => (
            <Paper key={it.id ?? `n${i}`} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap" mb="xs">
                <Text size="xs" c="dimmed">
                  {i + 1}. {scopeText(it, agMap, depMap)} · {dueText(it.due_days, kind)}
                </Text>
                <Group gap={0} wrap="nowrap">
                  <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="W górę">
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="W dół">
                    <IconArrowDown size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      setDirty(true);
                      setItems((l) => l.filter((_, j) => j !== i));
                    }}
                    aria-label="Usuń"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
                <TextInput size="xs" label="Zadanie" value={it.label} onChange={(e) => upd(i, { label: e.currentTarget.value })} />
                <SimpleGrid cols={2} spacing="xs">
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
                </SimpleGrid>
                <MultiSelect
                  size="xs"
                  label="Dotyczy APT"
                  placeholder={it.agency_ids.length ? undefined : "wszystkie APT"}
                  searchable
                  clearable
                  data={agOpts}
                  value={it.agency_ids.map(String)}
                  onChange={(v) => upd(i, { agency_ids: ids(v) })}
                />
                <MultiSelect
                  size="xs"
                  label="Dotyczy wydziałów"
                  placeholder={it.department_ids.length ? undefined : "wszystkie wydziały"}
                  searchable
                  clearable
                  data={depOpts}
                  value={it.department_ids.map(String)}
                  onChange={(v) => upd(i, { department_ids: ids(v) })}
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
            </Paper>
          ))}
          <Group justify="space-between">
            <Button
              size="compact-sm"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                setDirty(true);
                setItems((l) => [...l, { label: "", responsible: "hr", due_days: 0, auto: null, agency_ids: [], department_ids: [] }]);
              }}
            >
              Dodaj zadanie
            </Button>
            <Group gap="xs">
              {saved && !dirty && (
                <Button size="xs" variant="light" onClick={() => apply.mutate()} loading={apply.isPending}>
                  Zastosuj do trwających checklist
                </Button>
              )}
              <Button size="xs" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || items.some((x) => !x.label.trim())}>
                Zapisz ustawienia
              </Button>
            </Group>
          </Group>
          {saved && !dirty && (
            <Text size="xs" c="dimmed" ta="right">
              „Zastosuj” dopasuje otwarte checklisty: doda nowe zadania, przeliczy terminy nieodhaczonych, usunie nietknięte, które
              przestały dotyczyć osoby.
            </Text>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Card withBorder padding="md" style={{ position: "sticky", top: 70 }}>
          <Title order={6} mb="xs">
            Podgląd: co dostanie osoba
          </Title>
          <SimpleGrid cols={2} spacing="xs" mb="sm">
            <Select size="xs" label="APT" placeholder="dowolne" clearable searchable data={agOpts} value={pAg} onChange={setPAg} />
            <Select size="xs" label="Wydział" placeholder="dowolny" clearable searchable data={depOpts} value={pDep} onChange={setPDep} />
          </SimpleGrid>
          {preview.length === 0 ? (
            <Text size="sm" c="dimmed">
              Brak zadań.
            </Text>
          ) : (
            <Stack gap={6}>
              {[...preview]
                .sort((a, b) => a.due_days - b.due_days)
                .map((it, i) => (
                  <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                    <Badge size="sm" variant="light" w={70} style={{ flexShrink: 0 }}>
                      {it.due_days === 0 ? "dzień 0" : it.due_days > 0 ? `+${it.due_days} dni` : `${it.due_days} dni`}
                    </Badge>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm">{it.label || "(bez nazwy)"}</Text>
                      <Text size="xs" c="dimmed">
                        {RESPONSIBLE[it.responsible]}
                        {it.auto ? " · automatycznie" : ""}
                      </Text>
                    </div>
                  </Group>
                ))}
            </Stack>
          )}
          <Text size="xs" c="dimmed" mt="sm">
            Dzień 0 = data {base}. Wartości ujemne – przed tą datą.
          </Text>
        </Card>
      </Grid.Col>
    </Grid>
  );
}

export function ChecklistTemplates() {
  const q = useQuery({ queryKey: ["checklist-templates"], queryFn: () => api<Templates>("/checklist-templates") });
  const [kind, setKind] = useState<Kind>("onboarding");
  if (q.isLoading) return <Loader />;
  if (!q.data) return <Alert color="red">{errorText(q.error)}</Alert>;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Zadania z checklist, ich terminy i zakres: każde zadanie może dotyczyć wszystkich albo tylko wybranych APT i wydziałów.
        Zmiana wydziału lub APT u pracownika w trakcie wdrożenia sama dopasuje jego checklistę.
      </Text>
      <SegmentedControl
        w="fit-content"
        value={kind}
        onChange={(v) => setKind(v as Kind)}
        data={[
          { value: "onboarding", label: `Wdrożenie (${q.data.onboarding.length})` },
          { value: "offboarding", label: `Odejście (${q.data.offboarding.length})` },
        ]}
      />
      <TemplatePanel key={kind} kind={kind} data={q.data} />
    </Stack>
  );
}
