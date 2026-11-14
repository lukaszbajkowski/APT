import { CompactEmpty, ListRow, Section, StatusBadge, FormDialog, SectionHead, RowMenu } from "./Mobile";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Group,  NumberInput, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { Select } from "./AptSelect";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
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
  type TrainingType, withAcct } from "../api";
import { useAuth } from "../auth";
import { FieldInput, type Values } from "./DocumentsCard";
import { EmployeeRequirements } from "./Competence";
import { Loading, RowsSkeleton } from "./States";
import { DateField } from "./DateField";
import { useConfirm } from "../lib/confirm";
import { useIsPhone } from "../lib/device";

interface Form {
  type_id: string | null;
  program_id: string | null;
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
  program_id: null,
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
    program_id: t.program_id ? String(t.program_id) : null,
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

export function TrainingModal({
  employee,
  employeeIds,
  editing,
  opened,
  onClose,
}: {
  employee?: Employee;
  employeeIds?: number[]; // seryjnie: to samo szkolenie dla wielu osób
  editing: Training | null;
  opened: boolean;
  onClose: () => void;
}) {
  const selfId = employee?.id ?? -1;
  const batch = !employee && !!employeeIds?.length;
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
  const program = type?.programs.find((p) => String(p.id) === form.program_id);
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
        program_id: position && form.program_id ? Number(form.program_id) : null,
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
      if (batch) return api(`/trainings/batch`, { method: "POST", body: { employee_ids: employeeIds, training: body } });
      return editing
        ? api<Training>(`/trainings/${editing.id}`, { method: "PUT", body })
        : api<Training>(`/employees/${selfId}/trainings`, { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trainings"] });
      qc.invalidateQueries({ queryKey: ["trainings-expiring"] });
      qc.invalidateQueries({ queryKey: ["trainings-in-progress"] });
      qc.invalidateQueries({ queryKey: ["trainings-report"] });
      qc.invalidateQueries({ queryKey: ["employee-requirements"] });
      qc.invalidateQueries({ queryKey: ["training-matrix"] });
      notifications.show({
        color: "green",
        message: batch ? `Dodano szkolenie ${employeeIds!.length} os.` : editing ? "Zapisano szkolenie." : "Dodano szkolenie.",
      });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const typeOptions = (types.data ?? [])
    .filter((t) => t.is_active || String(t.id) === form.type_id)
    .map((t) => ({ value: String(t.id), label: t.name }));

  return (
    <FormDialog opened={opened} onClose={onClose} title={batch ? `Nowe szkolenie dla ${employeeIds!.length} os.` : editing ? "Edycja szkolenia" : "Nowe szkolenie"} size="lg" primary={{ label: "Zapisz", onClick: () => save.mutate(), loading: save.isPending, disabled: !type }}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <Select
          label="Rodzaj"
          placeholder="Wybierz"
          data={typeOptions}
          value={form.type_id}
          allowDeselect={false}
          searchable
          onChange={(v) => setForm((f) => ({ ...f, type_id: v, program_id: null }))}
        />
        {type && position && (
          <>
            {type.programs.length > 0 && (
              <Select
                label="Szkolenie z katalogu"
                description="Wpisuje nazwę, wydział i standard – możesz je potem zmienić."
                placeholder="Wybierz albo wpisz dane ręcznie poniżej"
                clearable
                searchable
                data={type.programs
                  .filter((p) => p.is_active || String(p.id) === form.program_id)
                  .map((p) => ({
                    value: String(p.id),
                    label: [p.name, p.department, p.standard_days !== null ? `${p.standard_days} dni` : null].filter(Boolean).join(" · "),
                  }))}
                value={form.program_id}
                onChange={(v) => {
                  const p = type.programs.find((x) => String(x.id) === v);
                  setForm((f) =>
                    p
                      ? {
                          ...f,
                          program_id: v,
                          name: p.name,
                          department_id: p.department_id ? String(p.department_id) : null,
                          standard_days: p.standard_days ?? "",
                          mentor_id: p.mentors.some((m) => String(m.id) === f.mentor_id) ? f.mentor_id : null,
                        }
                      : { ...f, program_id: null },
                  );
                }}
              />
            )}
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
              <DateField  label="Data rozpoczęcia" value={form.start_date} onChange={(e) => set("start_date", e.currentTarget.value)} />
              <DateField  label="Data egzaminu" value={form.exam_date} onChange={(e) => set("exam_date", e.currentTarget.value)} />
              <DateField  label="Data zakończenia" value={form.end_date} onChange={(e) => set("end_date", e.currentTarget.value)} />
              <NumberInput
                label="Czas nauki wg standardu (dni)"
                min={0}
                max={3650}
                allowDecimal={false}
                value={form.standard_days}
                onChange={(v) => set("standard_days", v)}
              />
            </SimpleGrid>
            {program ? (
              <Select
                label="Opiekun"
                description={
                  program.mentors.length
                    ? "Tylko osoby uprawnione do prowadzenia tego szkolenia."
                    : "Nikt nie ma jeszcze uprawnień do tego szkolenia – dodasz je w katalogu albo w kartotece opiekuna."
                }
                placeholder={program.mentors.length ? "Wybierz" : "Brak uprawnionych"}
                clearable
                searchable
                data={[
                  ...program.mentors
                    .filter((m) => m.id !== selfId && !employeeIds?.includes(m.id) && (m.active || String(m.id) === form.mentor_id))
                    .map((m) => ({ value: String(m.id), label: m.name })),
                  ...(form.mentor_id && editing?.mentor_name && !program.mentors.some((m) => String(m.id) === form.mentor_id)
                    ? [{ value: form.mentor_id, label: `${editing.mentor_name} (bez uprawnień)` }]
                    : []),
                ]}
                value={form.mentor_id}
                onChange={(v) => set("mentor_id", v)}
              />
            ) : (
              <MentorSelect
                employeeId={selfId}
                value={form.mentor_id}
                initialLabel={editing?.mentor_name ?? null}
                onChange={(v) => set("mentor_id", v)}
              />
            )}
          </>
        )}
        {type && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {!position && (
              <DateField
                
                label="Data ukończenia"
                value={form.completed_on}
                onChange={(e) => set("completed_on", e.currentTarget.value)}
              />
            )}
            <DateField
              
              label="Ważne do"
              placeholder="bezterminowe"
              value={form.valid_until}
              onChange={(e) => {
                setValidTouched(true);
                set("valid_until", e.currentTarget.value);
              }}
            />
          </SimpleGrid>
        )}
        {type && (
          <Text size="xs" c="dimmed" mt={-8}>
            {type.validity_months
              ? `„Ważne do” wylicza się samo: ${type.validity_months} mies. od ${position ? "zakończenia" : "ukończenia"} (można zmienić).`
              : "Puste „Ważne do” = bezterminowe."}
          </Text>
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
      </Stack>
    </FormDialog>
  );
}

function summary(t: Training): string {
  const parts: string[] = [];
  if (t.kind === "position") {
    if (t.start_date || t.end_date)
      parts.push(t.end_date ? `${formatDate(t.start_date)} – ${formatDate(t.end_date)}` : `od ${formatDate(t.start_date)}`);
    if (t.exam_date) parts.push(`egzamin ${formatDate(t.exam_date)}`);
    if (t.department) parts.push(t.department);
    if (t.mentor_name) parts.push(`opiekun: ${t.mentor_name}`);
    if (t.standard_days !== null)
      parts.push(t.end_date && t.days !== null ? `${t.days} z ${t.standard_days} dni` : `standard: ${t.standard_days} dni`);
  } else if (t.completed_on) {
    parts.push(`ukończone ${formatDate(t.completed_on)}`);
  }
  return parts.join(" · ");
}

export function TrainingsCard({ employee }: { employee: Employee }) {
  const mobile = useIsPhone();
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
    qc.invalidateQueries({ queryKey: ["employee-requirements", employee.id] });
    qc.invalidateQueries({ queryKey: ["trainings", employee.id] });
    qc.invalidateQueries({ queryKey: ["trainings-expiring"] });
    qc.invalidateQueries({ queryKey: ["trainings-in-progress"] });
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
  const confirm = useConfirm();
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

  // jeden ukryty wybór pliku na całą sekcję – „Dodaj/Zmień skan” w menu „⋯” wskazuje, którego szkolenia dotyczy
  const scanFor = useRef<number | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const menuFor = (t: Training) =>
    staff ? (
      <RowMenu
        label={t.name ?? t.type_name}
        items={[
          { label: "Popraw dane", icon: <IconPencil size={16} />, onClick: () => setModal({ open: true, editing: t }) },
          { label: "Generuj dokument", icon: <IconFileText size={16} />, onClick: () => generate.mutate(t.id), hidden: !t.can_generate },
          {
            label: t.has_scan ? "Zmień skan zaświadczenia" : "Dodaj skan zaświadczenia",
            icon: <IconUpload size={16} />,
            onClick: () => {
              scanFor.current = t.id;
              scanInput.current?.click();
            },
          },
          {
            label: "Usuń skan",
            icon: <IconPaperclip size={16} />,
            hidden: !t.has_scan,
            onClick: () => confirm({ title: "Usunąć skan?", message: "Skan zostanie odłączony od szkolenia.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && removeScan.mutate(t.id)),
          },
        ]}
        danger={{
          label: "Usuń szkolenie",
          icon: <IconTrash size={16} />,
          onClick: () => confirm({ title: "Usunąć szkolenie?", message: `Usunąć szkolenie „${t.name ?? t.type_name}”?`, confirmLabel: "Usuń", danger: true }).then((ok) => ok && remove.mutate(t.id)),
        }}
      />
    ) : null;
  const scanPicker = (
    <input
      ref={scanInput}
      type="file"
      hidden
      accept="application/pdf,image/jpeg,image/png"
      onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f && scanFor.current !== null) upload.mutate({ id: scanFor.current, file: f });
        e.currentTarget.value = "";
      }}
    />
  );

  if (mobile) {
    return (
      <Stack gap="md">
        <EmployeeRequirements employeeId={employee.id} />
        <Section title="Szkolenia i uprawnienia" action={staff ? { label: "Dodaj", icon: <IconPlus size={16} />, onClick: () => setModal({ open: true, editing: null }) } : undefined}>
          {list.isLoading && <Loading rows={2} />}
          {list.data?.length === 0 && <CompactEmpty title="Brak szkoleń" />}
          {list.data?.map((t) => {
            const st = TRAINING_STATUS[t.status];
            const tone = t.status === "overdue" || t.status === "expired" ? "warn" : st.color === "teal" || st.color === "green" ? "ok" : t.status === "expiring" ? "warn" : "neutral";
            return (
              <ListRow
                key={t.id}
                title={t.name ?? t.type_name}
                description={
                  <>
                    <StatusBadge tone={tone}>{st.label}</StatusBadge>{" "}
                    {t.status === "planned" ? `od ${formatDate(t.start_date)}` : t.valid_until ? `do ${formatDate(t.valid_until)}` : summary(t)}
                  </>
                }
                trailing={menuFor(t)}
              />
            );
          })}
        </Section>
        <TrainingModal employee={employee} editing={modal.editing} opened={modal.open} onClose={() => setModal({ open: false, editing: null })} />
        {scanPicker}
      </Stack>
    );
  }

  return (
    <section className="ui-dsec" id="szkolenia">
      <SectionHead title="Szkolenia i uprawnienia" action={staff ? { label: "Dodaj szkolenie", onClick: () => setModal({ open: true, editing: null }) } : undefined} />
      {list.isLoading && <RowsSkeleton />}
      {list.data && list.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak szkoleń.{staff ? " „Dodaj szkolenie” zapisze odbyte albo zaplanowane." : ""}
        </Text>
      )}
      {list.data && list.data.length > 0 && (
        <div className="ui-dlist">

          {list.data.map((t) => {
            const st = TRAINING_STATUS[t.status];
            const warn = ["expiring", "expired", "overdue"].includes(t.status);
            const state =
              t.status === "planned"
                ? `${st.label} od ${formatDate(t.start_date)}`
                : t.status === "in_progress" || t.status === "overdue"
                  ? `${st.label} · dzień ${t.days}${t.standard_days !== null ? ` z ${t.standard_days}` : ""}`
                  : t.valid_until
                    ? `${st.label} do ${formatDate(t.valid_until)}`
                    : st.label;
            const meta = [
              t.name ? t.type_name : null,
              summary(t),
              Object.keys(t.values).length > 0
                ? Object.entries(t.values)
                    .map(([k, v]) => `${fieldLabel(t.type_id, k)}: ${v === true ? "tak" : v}`)
                    .join(" · ")
                : null,
              t.notes,
            ].filter(Boolean);
            return (
              <div key={t.id} className="ui-drow">
                <div style={{ minWidth: 0 }}>
                  <div className="ui-drow-title">{t.name ?? t.type_name}</div>
                  {meta.length > 0 && <div className="ui-drow-meta" style={{ whiteSpace: "pre-wrap" }}>{meta.join(" · ")}</div>}
                </div>
                <Group gap={8} wrap="nowrap" style={{ flex: "none" }}>
                  <Text size="sm" className={warn ? "ui-warn" : undefined}>
                    {state}
                  </Text>
                  {t.has_scan && (
                    <Button size="xs" variant="default" component="a" href={withAcct(`/api/trainings/${t.id}/scan`)} target="_blank" title={t.scan_name ?? undefined}>
                      Zaświadczenie
                    </Button>
                  )}
                  {menuFor(t)}
                </Group>
              </div>
            );
          })}
        </div>
      )}
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
      {scanPicker}
    </section>
  );
}
