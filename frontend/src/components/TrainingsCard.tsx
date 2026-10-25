import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconCertificate,
  IconDots,
  IconFileText,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";

import {
  api,
  errorText,
  formatDate,
  TRAINING_STATUS,
  type DictionaryItem,
  type Employee,
  type Page,
  type Training,
  type TrainingType,
} from "../api";
import { useAuth } from "../auth";
import { FieldInput, type Values } from "./DocumentsCard";

interface Form {
  type_id: string | null;
  name: string;
  department_id: string | null;
  start_date: string;
  exam_date: string;
  end_date: string;
  completed_on: string;
  valid_until: string;
  mentor_id: string | null;
  standard_days: number | string;
  values: Values;
  notes: string;
}

const EMPTY: Form = {
  type_id: null,
  name: "",
  department_id: null,
  start_date: "",
  exam_date: "",
  end_date: "",
  completed_on: "",
  valid_until: "",
  mentor_id: null,
  standard_days: "",
  values: {},
  notes: "",
};

function toForm(t: Training): Form {
  return {
    type_id: String(t.type_id),
    name: t.name ?? "",
    department_id: t.department_id ? String(t.department_id) : null,
    start_date: t.start_date ?? "",
    exam_date: t.exam_date ?? "",
    end_date: t.end_date ?? "",
    completed_on: t.completed_on ?? "",
    valid_until: t.valid_until ?? "",
    mentor_id: t.mentor_id ? String(t.mentor_id) : null,
    standard_days: t.standard_days ?? "",
    values: t.values ?? {},
    notes: t.notes ?? "",
  };
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function MentorSelect({
  employeeId,
  value,
  initialLabel,
  onChange,
}: {
  employeeId: number;
  value: string | null;
  initialLabel: string | null;
  onChange: (v: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 250);
  const res = useQuery({
    queryKey: ["mentor-search", q],
    queryFn: () => api<Page<Employee>>(`/employees?limit=20&q=${encodeURIComponent(q)}`),
  });
  const data = useMemo(() => {
    const opts = (res.data?.items ?? [])
      .filter((e) => e.id !== employeeId)
      .map((e) => ({ value: String(e.id), label: `${e.last_name} ${e.first_name}` }));
    if (value && initialLabel && !opts.some((o) => o.value === value)) opts.unshift({ value, label: initialLabel });
    return opts;
  }, [res.data, employeeId, value, initialLabel]);
  return (
    <Select
      label="Opiekun"
      placeholder="Szukaj pracownika"
      searchable
      clearable
      data={data}
      value={value}
      onChange={onChange}
      searchValue={search}
      onSearchChange={setSearch}
      nothingFoundMessage={res.isFetching ? "Szukam…" : "Brak wyników"}
      filter={({ options }) => options}
    />
  );
}

function TrainingModal({
  employee,
  editing,
  opened,
  onClose,
}: {
  employee: Employee;
  editing: Training | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [validTouched, setValidTouched] = useState(false);

  useEffect(() => {
    if (opened) {
      setForm(editing ? toForm(editing) : EMPTY);
      setError(null);
      setValidTouched(!!editing?.valid_until);
    }
  }, [opened, editing]);

  const type = types.data?.find((t) => String(t.id) === form.type_id);
  const position = type?.kind === "position";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // podpowiedź „ważne do” z okresu ważności rodzaju
  const completed = form.completed_on || (position ? form.end_date : "");
  const suggested = type?.validity_months && completed ? addMonths(completed, type.validity_months) : "";
  useEffect(() => {
    if (!validTouched) setForm((f) => ({ ...f, valid_until: suggested }));
  }, [suggested, validTouched]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type_id: Number(form.type_id),
        name: form.name || null,
        department_id: form.department_id ? Number(form.department_id) : null,
        start_date: form.start_date || null,
        exam_date: form.exam_date || null,
        end_date: form.end_date || null,
        completed_on: form.completed_on || null,
        valid_until: form.valid_until || null,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null,
        standard_days: form.standard_days === "" ? null : Number(form.standard_days),
        values: form.values,
        notes: form.notes || null,
      };
      return editing
        ? api<Training>(`/trainings/${editing.id}`, { method: "PUT", body })
        : api<Training>(`/employees/${employee.id}/trainings`, { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trainings", employee.id] });
      qc.invalidateQueries({ queryKey: ["trainings-expiring"] });
      notifications.show({ color: "green", message: editing ? "Zapisano szkolenie." : "Dodano szkolenie." });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const typeOptions = (types.data ?? [])
    .filter((t) => t.is_active || String(t.id) === form.type_id)
    .map((t) => ({ value: String(t.id), label: t.name }));

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? "Edycja szkolenia" : "Nowe szkolenie"} size="lg">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <Select
          label="Rodzaj"
          placeholder="Wybierz"
          data={typeOptions}
          value={form.type_id}
          allowDeselect={false}
          searchable
          onChange={(v) => set("type_id", v)}
        />
        {type && position && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label="Nazwa szkolenia"
                placeholder="np. Operator prasy"
                value={form.name}
                onChange={(e) => set("name", e.currentTarget.value)}
              />
              <Select
                label="Wydział"
                clearable
                searchable
                data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
                value={form.department_id}
                onChange={(v) => set("department_id", v)}
              />
              <TextInput type="date" label="Data rozpoczęcia" value={form.start_date} onChange={(e) => set("start_date", e.currentTarget.value)} />
              <TextInput type="date" label="Data egzaminu" value={form.exam_date} onChange={(e) => set("exam_date", e.currentTarget.value)} />
              <TextInput type="date" label="Data zakończenia" value={form.end_date} onChange={(e) => set("end_date", e.currentTarget.value)} />
              <NumberInput
                label="Czas nauki wg standardu (dni)"
                min={0}
                max={3650}
                allowDecimal={false}
                value={form.standard_days}
                onChange={(v) => set("standard_days", v)}
              />
            </SimpleGrid>
            <MentorSelect
              employeeId={employee.id}
              value={form.mentor_id}
              initialLabel={editing?.mentor_name ?? null}
              onChange={(v) => set("mentor_id", v)}
            />
          </>
        )}
        {type && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {!position && (
              <TextInput
                type="date"
                label="Data ukończenia"
                value={form.completed_on}
                onChange={(e) => set("completed_on", e.currentTarget.value)}
              />
            )}
            <TextInput
              type="date"
              label="Ważne do"
              description={
                type.validity_months
                  ? `Wyliczane: ${type.validity_months} mies. od ${position ? "zakończenia" : "ukończenia"}`
                  : "Puste = bezterminowe"
              }
              value={form.valid_until}
              onChange={(e) => {
                setValidTouched(true);
                set("valid_until", e.currentTarget.value);
              }}
            />
          </SimpleGrid>
        )}
        {type && type.fields.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {type.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={form.values[f.key] ?? null}
                onChange={(v) => set("values", { ...form.values, [f.key]: v })}
              />
            ))}
          </SimpleGrid>
        )}
        {type && (
          <Textarea label="Uwagi" autosize minRows={2} value={form.notes} onChange={(e) => set("notes", e.currentTarget.value)} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!type}>
            Zapisz
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function summary(t: Training): string {
  const parts: string[] = [];
  if (t.kind === "position") {
    if (t.start_date || t.end_date) parts.push(`${formatDate(t.start_date)} – ${formatDate(t.end_date)}`);
    if (t.exam_date) parts.push(`egzamin ${formatDate(t.exam_date)}`);
    if (t.department) parts.push(t.department);
    if (t.mentor_name) parts.push(`opiekun: ${t.mentor_name}`);
    if (t.standard_days !== null) parts.push(`standard: ${t.standard_days} dni`);
  } else if (t.completed_on) {
    parts.push(`ukończone ${formatDate(t.completed_on)}`);
  }
  return parts.join(" · ");
}

export function TrainingsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const list = useQuery({
    queryKey: ["trainings", employee.id],
    queryFn: () => api<Training[]>(`/employees/${employee.id}/trainings`),
  });
  const [modal, setModal] = useState<{ open: boolean; editing: Training | null }>({ open: false, editing: null });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const fieldLabel = (typeId: number, key: string) =>
    types.data?.find((x) => x.id === typeId)?.fields.find((f) => f.key === key)?.label ?? key;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["trainings", employee.id] });
    qc.invalidateQueries({ queryKey: ["trainings-expiring"] });
    qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
  };
  const onError = (e: unknown) => notifications.show({ color: "red", message: errorText(e) });

  const upload = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const f = new FormData();
      f.append("file", file);
      return api<Training>(`/trainings/${id}/scan`, { method: "POST", form: f });
    },
    onSuccess: () => {
      refresh();
      notifications.show({ color: "green", message: "Dodano skan zaświadczenia." });
    },
    onError,
  });
  const removeScan = useMutation({
    mutationFn: (id: number) => api<Training>(`/trainings/${id}/scan`, { method: "DELETE" }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/trainings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      notifications.show({ color: "green", message: "Usunięto szkolenie." });
    },
    onError,
  });
  const generate = useMutation({
    mutationFn: (id: number) => api<{ id: string }>(`/trainings/${id}/document`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", employee.id] });
      refresh();
      notifications.show({ color: "green", message: "Dokument jest gotowy – znajdziesz go w sekcji Dokumenty." });
    },
    onError,
  });

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Title order={5}>Szkolenia i uprawnienia</Title>
        {staff && (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setModal({ open: true, editing: null })}>
            Dodaj szkolenie
          </Button>
        )}
      </Group>
      {list.isLoading && <Loader size="sm" />}
      {list.data && list.data.length === 0 && <Text c="dimmed">Brak wpisów.</Text>}
      <Stack gap="xs">
        {list.data?.map((t) => {
          const st = TRAINING_STATUS[t.status];
          return (
            <Paper key={t.id} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                  <IconCertificate size={20} style={{ flexShrink: 0, marginTop: 2 }} color="var(--mantine-color-gray-6)" />
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text fw={600}>{t.name ?? t.type_name}</Text>
                      {t.name && (
                        <Text size="sm" c="dimmed">
                          {t.type_name}
                        </Text>
                      )}
                    </Group>
                    {summary(t) && <Text size="sm">{summary(t)}</Text>}
                    {Object.keys(t.values).length > 0 && (
                      <Text size="sm" c="dimmed">
                        {Object.entries(t.values)
                          .map(([k, v]) => `${fieldLabel(t.type_id, k)}: ${v === true ? "tak" : v}`)
                          .join(" · ")}
                      </Text>
                    )}
                    {t.notes && (
                      <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                        {t.notes}
                      </Text>
                    )}
                    {t.has_scan && (
                      <Anchor href={`/api/trainings/${t.id}/scan`} target="_blank" size="sm">
                        <Group gap={4} wrap="nowrap">
                          <IconPaperclip size={14} /> {t.scan_name ?? "Skan zaświadczenia"}
                        </Group>
                      </Anchor>
                    )}
                  </div>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Stack gap={0} align="flex-end">
                    <Badge color={st.color} variant="light">
                      {st.label}
                    </Badge>
                    {t.valid_until && (
                      <Text size="xs" c="dimmed">
                        do {formatDate(t.valid_until)}
                      </Text>
                    )}
                  </Stack>
                  {staff && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" aria-label="Akcje szkolenia">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setModal({ open: true, editing: t })}>
                          Edytuj
                        </Menu.Item>
                        {t.can_generate && (
                          <Menu.Item leftSection={<IconFileText size={14} />} onClick={() => generate.mutate(t.id)}>
                            Generuj dokument
                          </Menu.Item>
                        )}
                        <FileButton accept="application/pdf,image/jpeg,image/png" onChange={(f) => f && upload.mutate({ id: t.id, file: f })}>
                          {(props) => (
                            <Menu.Item {...props} closeMenuOnClick={false} leftSection={<IconUpload size={14} />}>
                              {t.has_scan ? "Zmień skan zaświadczenia" : "Dodaj skan zaświadczenia"}
                            </Menu.Item>
                          )}
                        </FileButton>
                        {t.has_scan && (
                          <Menu.Item leftSection={<IconPaperclip size={14} />} onClick={() => removeScan.mutate(t.id)}>
                            Usuń skan
                          </Menu.Item>
                        )}
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => {
                            if (window.confirm(`Usunąć szkolenie „${t.name ?? t.type_name}”?`)) remove.mutate(t.id);
                          }}
                        >
                          Usuń
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
      {(generate.isPending || upload.isPending) && (
        <Text size="xs" c="dimmed" mt="xs">
          {generate.isPending ? "Generowanie dokumentu…" : "Wysyłanie pliku…"}
        </Text>
      )}
      <TrainingModal
        employee={employee}
        editing={modal.editing}
        opened={modal.open}
        onClose={() => setModal({ open: false, editing: null })}
      />
    </Card>
  );
}
