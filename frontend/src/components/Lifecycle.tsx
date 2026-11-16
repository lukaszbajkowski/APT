import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ActionSheet, CompactEmpty, ListRow, Section, StatusBadge, FormDialog, Segments, SwipePager, SectionHead, cap } from "./Mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Grid, Group, Menu,  MultiSelect, NumberInput, Paper, Progress, SimpleGrid, Stack, SegmentedControl, Text, TextInput, Title } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconAlertTriangle,
  IconDots,
  IconDotsVertical,
  IconCalendarEvent,
  IconGripVertical,
  IconPlayerSkipForward,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, type DictionaryItem, type Employee } from "../api";
import { useAuth } from "../auth";
import { EmptyState, Loading, RowsSkeleton } from "./States";
import { DateField } from "./DateField";
import { useConfirm } from "../lib/confirm";
import { useIsPhone } from "../lib/device";

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

function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const place = (x: { agency: string | null; department: string | null; position: string | null }) =>
  [x.department, x.position, x.agency].filter(Boolean).join(" · ") || "—";

interface Planned {
  id: number;
  effective_date: string;
  agency: string | null;
  department: string | null;
  position: string | null;
  created_by_name: string | null;
}

function PlannedList({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const q = useQuery({
    queryKey: ["planned-changes", employee.id],
    queryFn: () => api<Planned[]>(`/employees/${employee.id}/planned-changes`),
  });
  const ask = useConfirm();
  const cancel = useMutation({
    mutationFn: (pid: number) => api(`/planned-changes/${pid}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planned-changes", employee.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
      notifications.show({ color: "green", message: "Anulowano zaplanowaną zmianę." });
    },
  });
  if (!q.data?.length) return null;
  return (
    <Stack gap={6} mb="md">
      {q.data.map((p) => (
        <Paper key={p.id} withBorder p="xs" radius="md" bg="var(--mantine-color-blue-light)">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm" fw={500}>
                Zaplanowane od {formatDate(p.effective_date)}:{" "}
                {[p.department && `wydział ${p.department}`, p.position && `stanowisko ${p.position}`, p.agency && `APT ${p.agency}`]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
              <Text size="xs" c="dimmed">
                Wprowadzi się samo w tym dniu{p.created_by_name ? ` · zaplanował(a) ${p.created_by_name}` : ""}
              </Text>
            </div>
            {hasRole("admin", "hr", "manager") && (
              <Button size="xs" variant="default" color="red" onClick={() => ask({ title: "Anulować zaplanowaną zmianę?", message: "Zaplanowana zmiana nie zostanie wykonana.", confirmLabel: "Anuluj zmianę", danger: true }).then((ok) => ok && cancel.mutate(p.id))} loading={cancel.isPending}>
                Anuluj
              </Button>
            )}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

export function TimelineCard({ employee }: { employee: Employee }) {
  const mobile = useIsPhone();
  const q = useQuery({
    queryKey: ["employee-timeline", employee.id],
    queryFn: () => api<{ periods: Period[]; assignments: AssignmentRow[] }>(`/employees/${employee.id}/timeline`),
  });
  if (!q.data) return q.isLoading && !mobile ? <section className="ui-dsec"><SectionHead title="Przebieg zatrudnienia" /><RowsSkeleton rows={2} /></section> : null;
  const { periods, assignments } = q.data;
  if (mobile)
    return (
      <Stack gap="lg">
        <PlannedList employee={employee} />
        <Section title="Okresy zatrudnienia">
          {periods.map((p, i) => (
            <ListRow
              key={i}
              title={`${formatDate(p.hire_date)} – ${p.termination_date ? formatDate(p.termination_date) : "obecnie"}`}
              description={place(p)}
              trailing={p.current && !p.termination_date ? <StatusBadge tone="ok">Aktualny</StatusBadge> : undefined}
            />
          ))}
        </Section>
        <Section title="Wydział, stanowisko, APT">
          {assignments.length === 0 ? (
            <CompactEmpty title="Brak zmian" />
          ) : (
            assignments.map((a, i) => (
              <ListRow
                key={i}
                title={`od ${formatDate(a.valid_from)}${i > 0 ? ` do ${dayBefore(assignments[i - 1].valid_from)}` : ""}`}
                description={[place(a), a.reason, a.changed_by].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </Section>
      </Stack>
    );
  return (
    <section className="ui-dsec">
      <SectionHead title="Przebieg zatrudnienia" />
      <PlannedList employee={employee} />
      <div className="ui-dlist">
        {timelineEvents(periods, assignments).map((ev, i) => (
          <div key={i} className="ui-drow ui-trow">
            <span className="ui-trow-date">
              {ev.from} – {ev.to}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ui-drow-title" style={ev.current ? undefined : { fontWeight: 500 }}>
                {ev.title || "—"}
              </div>
              {ev.meta && <div className="ui-drow-meta">{ev.meta}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Okresy przydziału (najnowszy na górze): od kiedy do kiedy obowiązywał dany wydział, stanowisko i APT.
 * Przydział kończy się dzień przed następnym albo w dniu zwolnienia; bieżący – „obecnie”.
 */
function timelineEvents(periods: Period[], assignments: AssignmentRow[]) {
  const iso = (d: string) => formatDate(d);
  const prevDay = (d: string) => {
    const x = new Date(d + "T00:00:00");
    x.setDate(x.getDate() - 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  if (assignments.length === 0)
    return periods
      .filter((p) => p.hire_date)
      .map((p) => ({ from: iso(p.hire_date!), to: p.termination_date ? iso(p.termination_date) : "obecnie", current: !p.termination_date, title: place(p), meta: "" }));
  const sorted = [...assignments].sort((x, y) => (x.valid_from < y.valid_from ? 1 : -1));
  return sorted.map((a, i) => {
    const period = periods.find((p) => p.hire_date && p.hire_date <= a.valid_from && (!p.termination_date || a.valid_from <= p.termination_date));
    const nextStart = i > 0 ? prevDay(sorted[i - 1].valid_from) : null;
    const end = [nextStart, period?.termination_date ?? null].filter(Boolean).sort()[0] as string | undefined;
    return {
      from: iso(a.valid_from),
      to: end ? iso(end) : "obecnie",
      current: !end,
      title: place(a),
      meta: [a.reason, a.changed_by].filter(Boolean).join(" · "),
    };
  });
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
    <FormDialog opened={opened} onClose={onClose} title={`Ponowne zatrudnienie: ${employee.last_name} ${employee.first_name}`} size="lg" primary={{ label: "Zatrudnij ponownie", onClick: () => save.mutate(), loading: save.isPending }}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <Text size="sm" c="dimmed">
          Poprzedni okres ({formatDate(employee.hire_date)} – {formatDate(employee.termination_date)}) trafi do historii. Numer
          ewidencyjny, PESEL, zdjęcie, szkolenia i dokumenty zostają.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <DateField  label="Data zatrudnienia" value={hire} onChange={(e) => setHire(e.currentTarget.value)} />
          <Select label="APT (agencja pracy)" clearable searchable data={opts(agencies.data)} value={agency} onChange={setAgency} />
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
      </Stack>
    </FormDialog>
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
  auto_label?: string | null;
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
  });
  const done = it.state === "done" || it.state === "auto";
  const [dueOpen, setDueOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const mobile = useIsPhone();
  const [due, setDue] = useState(it.due_date ?? "");
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" py={mobile ? 6 : undefined} px={mobile ? 12 : undefined} mih={mobile ? 60 : undefined} className={mobile ? undefined : "ui-drow"}>
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
          <Text size="xs" c={it.state === "overdue" ? undefined : "dimmed"} className={it.state === "overdue" ? "ui-warn" : undefined}>
            {[
              RESPONSIBLE[it.responsible],
              it.state === "done" && it.done_by_name ? `${it.done_by_name}, ${formatDateTime(it.done_at)}` : null,
              it.state === "auto" ? `odhaczone samo – ${it.auto_label ?? "warunek spełniony"}` : null,
              it.auto && it.state !== "auto" && !done && it.state !== "skipped" ? `odhaczy się samo: ${it.auto_label ?? "po spełnieniu warunku"}` : null,
              it.state === "skipped" ? "pominięte" : null,
              !done && it.state !== "skipped" && it.due_date ? `termin ${formatDate(it.due_date)}` : null,
              it.state === "overdue" ? "po terminie" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </div>
      </Group>
      {mobile && ((staff && !done && it.state !== "skipped") || (it.auto && it.state !== "auto") || (it.can_edit && !done)) ? (
        <>
          <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Akcje: ${it.label}`} style={{ flexShrink: 0 }} onClick={() => setSheet(true)}>
            <IconDotsVertical size={20} />
          </ActionIcon>
          <ActionSheet
            opened={sheet}
            onClose={() => setSheet(false)}
            title={it.label}
            subtitle={it.auto && it.state !== "auto" ? "Odhaczy się samo, gdy warunek zostanie spełniony." : undefined}
            actions={[
              ...(staff && !done && it.state !== "skipped" ? [{ label: "Zmień termin", icon: <IconCalendarEvent size={20} />, onClick: () => setDueOpen(true) }] : []),
              ...(it.can_edit && !done
                ? [{ label: it.state === "skipped" ? "Przywróć zadanie" : "Pomiń (nie dotyczy)", icon: <IconPlayerSkipForward size={20} />, onClick: () => patch.mutate({ skipped: it.state !== "skipped" }) }]
                : []),
            ]}
          />
        </>
      ) : !mobile && ((staff && !done && it.state !== "skipped") || (it.can_edit && !done)) ? (
        <Menu position="bottom-end" width={260} withinPortal>
          <Menu.Target>
            <ActionIcon variant="default" size={30} aria-label={`Więcej: ${it.label}`} style={{ flexShrink: 0 }}>
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {staff && !done && it.state !== "skipped" && (
              <Menu.Item leftSection={<IconCalendarEvent size={16} />} onClick={() => setDueOpen(true)}>
                Zmień termin
              </Menu.Item>
            )}
            {it.can_edit && !done && (
              <Menu.Item leftSection={<IconPlayerSkipForward size={16} />} onClick={() => patch.mutate({ skipped: it.state !== "skipped" })}>
                {it.state === "skipped" ? "Przywróć zadanie" : "Pomiń (nie dotyczy)"}
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      ) : null}
      <FormDialog opened={dueOpen} onClose={() => setDueOpen(false)} title={`Termin: ${it.label}`} size="sm" primary={{ label: "Zapisz termin", onClick: () => patch.mutate({ due_date: due }, { onSuccess: () => setDueOpen(false) }), loading: patch.isPending, disabled: !due || due === it.due_date }}>
        <Stack>
          <DateField label="Nowy termin" value={due} onChange={(e) => setDue(e.currentTarget.value)} />
        </Stack>
      </FormDialog>
    </Group>
  );
}

export function ChecklistsCard({ employee }: { employee: Employee }) {
  const mobile = useIsPhone();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});
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
  });
  if (!q.data) return q.isLoading && !mobile ? <section className="ui-dsec"><SectionHead title="Checklisty" /><RowsSkeleton rows={2} /></section> : null;
  const kinds = (["offboarding", "onboarding"] as const).filter((k) => q.data[k].length > 0);
  const missing = employee.status === "terminated" ? "offboarding" : "onboarding";
  if (kinds.length === 0 && !staff) return null;

  if (mobile) {
    return (
      <Stack gap="lg">
        {kinds.length === 0 && (
          <Section title="Checklisty" action={staff ? { label: `Utwórz: ${KIND_LABEL[missing].toLowerCase()}`, icon: <IconPlus size={16} />, onClick: () => create.mutate(missing) } : undefined}>
            <CompactEmpty title="Brak checklist" text="Wdrożenie tworzy się samo przy dodaniu osoby, odejście – przy zwolnieniu." />
          </Section>
        )}
        {kinds.map((k) => {
          const items = q.data[k];
          const doneN = items.filter((i) => ["done", "auto", "skipped"].includes(i.state)).length;
          const overdue = items.filter((i) => i.state === "overdue").length;
          return (
            <Stack key={k} gap={8}>
              <Group justify="space-between" align="baseline">
                <Title order={2} size="h4">
                  {KIND_LABEL[k]}
                </Title>
                {doneN === items.length ? (
                  // zakończona: jedna linia, lista po „Pokaż” (ślad zostaje)
                  <Button variant="subtle" size="sm" h={44} px={8} aria-expanded={!!openDone[k]} onClick={() => setOpenDone((o) => ({ ...o, [k]: !o[k] }))}>
                    wszystko zrobione · {openDone[k] ? "Zwiń" : "Pokaż"}
                  </Button>
                ) : (
                  <Text size="sm" c="dimmed">
                    {doneN} z {items.length} zrobione
                  </Text>
                )}
              </Group>
              {doneN < items.length && (
                <Progress value={(doneN / items.length) * 100} size="md" aria-label={`Postęp: ${doneN} z ${items.length}`} />
              )}
              {overdue > 0 && (
                <Group gap={6} c="orange">
                  <IconAlertTriangle size={16} aria-hidden />
                  <Text size="sm" fw={600} c="orange">
                    {overdue} po terminie
                  </Text>
                </Group>
              )}
              {(doneN < items.length || openDone[k]) && (
                <div className="ui-group">
                  {items.map((it) => (
                    <ItemRow key={it.id} it={it} onChange={refresh} />
                  ))}
                </div>
              )}
            </Stack>
          );
        })}
      </Stack>
    );
  }

  return (
    <section className="ui-dsec" id="checklisty">
      <SectionHead
        title="Checklisty"
        action={staff && !kinds.includes(missing) ? { label: `Utwórz checklistę: ${KIND_LABEL[missing].toLowerCase()}`, onClick: () => create.mutate(missing), loading: create.isPending } : undefined}
      />
      {kinds.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak checklist. Wdrożenie tworzy się samo przy dodaniu nowej osoby, a odejście – przy zwolnieniu.
        </Text>
      )}
      {kinds.map((k) => {
        const items = q.data[k];
        const doneN = items.filter((i) => ["done", "auto", "skipped"].includes(i.state)).length;
        const overdue = items.filter((i) => i.state === "overdue").length;
        return (
          <Stack key={k} gap={8}>
            <Group gap={8} wrap="wrap">
              <Text size="sm">
                <Text span fw={600}>
                  {KIND_LABEL[k]}
                </Text>
                <Text span c="dimmed">
                  {" "}
                  · {doneN === items.length ? "wszystko zrobione" : `${doneN} z ${items.length} zrobione`}
                </Text>
                {overdue > 0 && <span className="ui-warn"> · po terminie: {overdue}</span>}
              </Text>
              {/* zakończona checklista zostaje jako ślad (kto i kiedy), ale zwinięta do jednej linii */}
              {doneN === items.length && (
                <Anchor component="button" type="button" size="sm" fw={600} aria-expanded={!!openDone[k]} onClick={() => setOpenDone((o) => ({ ...o, [k]: !o[k] }))}>
                  {openDone[k] ? "Zwiń" : "Pokaż"}
                </Anchor>
              )}
            </Group>
            {(doneN < items.length || openDone[k]) && (
              <div className="ui-dlist">
                {items.map((it) => (
                  <ItemRow key={it.id} it={it} onChange={refresh} />
                ))}
              </div>
            )}
          </Stack>
        );
      })}
    </section>
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
// stały klucz wiersza – nowe zadania nie mają id, a przeciąganie podmienia obiekt (inny termin)
const rowKeys = new WeakMap<TemplateItem, string>();
let rowSeq = 0;
const rowKey = (it: TemplateItem) => {
  if (it.id != null) return `i${it.id}`;
  let k = rowKeys.get(it);
  if (!k) rowKeys.set(it, (k = `n${++rowSeq}`));
  return k;
};
const carryKey = (from: TemplateItem, to: TemplateItem) => {
  if (from.id == null) rowKeys.set(to, rowKey(from));
  return to;
};
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

function TemplatePanel({ kind, data, switcher }: { kind: Kind; data: Templates; switcher?: ReactNode }) {
  const mobile = useIsPhone();
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

  const applies = (it: TemplateItem) =>
    (!it.agency_ids.length || (pAg !== null && it.agency_ids.includes(Number(pAg)))) &&
    (!it.department_ids.length || (pDep !== null && it.department_ids.includes(Number(pDep))));
  const preview = items.filter(applies);
  const base = kind === "onboarding" ? "zatrudnienia" : "zwolnienia";

  if (!mobile)
    return (
      <DeskTemplates
        switcher={switcher}
        kind={kind}
        data={data}
        items={items}
        setItems={(f) => {
          setDirty(true);
          setItems(f);
        }}
        dirty={dirty}
        saved={saved}
        save={save}
        apply={apply}
        agOpts={agOpts}
        depOpts={depOpts}
        agMap={agMap}
        depMap={depMap}
        pAg={pAg}
        pDep={pDep}
        setPAg={setPAg}
        setPDep={setPDep}
        applies={applies}
        onDiscard={() => {
          setItems(data[kind]);
          setDirty(false);
        }}
      />
    );

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
            <EmptyState compact title="Brak zadań"
          text="Wszystkie punkty są wykonane albo checklista nie ma jeszcze pozycji." />
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

/* Komputer: lista zadań pogrupowana wg terminu + panel wybranego zadania + „co dostanie osoba” (wariant A z podglądem z C).
   Podgląd działa podwójnie: wybór APT i wydziału nad listą przygasza zadania, których osoba nie dostanie,
   a pod panelem jest lista jej zadań w kolejności terminów. */
function DeskTemplates({
  kind,
  data,
  items,
  setItems,
  dirty,
  saved,
  save,
  apply,
  agOpts,
  depOpts,
  agMap,
  depMap,
  pAg,
  pDep,
  setPAg,
  setPDep,
  applies,
  onDiscard,
  switcher,
}: {
  switcher?: ReactNode;
  kind: Kind;
  data: Templates;
  items: TemplateItem[];
  setItems: (f: (l: TemplateItem[]) => TemplateItem[]) => void;
  dirty: boolean;
  saved: boolean;
  save: { mutate: () => void; isPending: boolean };
  apply: { mutate: () => void; isPending: boolean };
  agOpts: { value: string; label: string }[];
  depOpts: { value: string; label: string }[];
  agMap: Map<number, string>;
  depMap: Map<number, string>;
  pAg: string | null;
  pDep: string | null;
  setPAg: (v: string | null) => void;
  setPDep: (v: string | null) => void;
  applies: (it: TemplateItem) => boolean;
  onDiscard: () => void;
}) {
  const [sel, setSelRaw] = useState<number | null>(items.length ? 0 : null);
  // jeden panel z przełącznikiem: wybrane zadanie albo „co dostanie osoba”
  const [view, setView] = useState<"task" | "person">("task");
  const setSel = (i: number | null) => {
    setSelRaw(i);
    setView("task");
  };
  const pickAg = (v: string | null) => {
    setPAg(v);
    setView("person");
  };
  const pickDep = (v: string | null) => {
    setPDep(v);
    setView("person");
  };
  const ev = kind === "onboarding" ? "zatrudnienia" : "odejścia";
  const filtering = pAg !== null || pDep !== null;
  const autoLabel = (v: string | null) => (v ? (data.auto_options.find((o) => o.value === v)?.label ?? v) : null);
  const dueChip = (d: number) => (d === 0 ? "dzień 0" : d > 0 ? `+${d} ${d === 1 ? "dzień" : "dni"}` : `−${-d} ${d === -1 ? "dzień" : "dni"}`);
  // grupy wg terminu: kolejność w grupie = kolejność zapisana (strzałki w panelu)
  const groups: { label: string; test: (d: number) => boolean }[] = [
    { label: kind === "onboarding" ? "Przed zatrudnieniem" : "Przed odejściem", test: (d) => d < 0 },
    { label: kind === "onboarding" ? "Dzień zatrudnienia" : "Dzień odejścia", test: (d) => d === 0 },
    { label: kind === "onboarding" ? "Pierwszy tydzień" : "Tydzień po odejściu", test: (d) => d > 0 && d <= 7 },
    { label: "Później", test: (d) => d > 7 },
  ];
  const upd = (i: number, v: Partial<TemplateItem>) => setItems((l) => l.map((x, j) => (j === i ? carryKey(x, { ...x, ...v }) : x)));
  const cur = sel !== null ? items[sel] : null;
  const emptyLabels = items.some((x) => !x.label.trim());
  const shown = [...items.map((it, i) => ({ it, i }))].filter(({ it }) => applies(it)).sort((a, b) => a.it.due_days - b.it.due_days || a.i - b.i);

  /* Przeciąganie za uchwyt (jak w edycji szablonu): lista przestawia się na żywo, przeniesiony wiersz idzie za kursorem.
     Kolejność w grupie = kolejność zapisana. Upuszczenie w innej grupie terminu przejmuje termin sąsiada
     (np. z „Dnia zatrudnienia” do „Pierwszego tygodnia” → +1 dzień). Druga droga: strzałki ↑ ↓ na uchwycie i w panelu. */
  const gIdx = (d: number) => groups.findIndex((g) => g.test(d));
  const visual = (l: TemplateItem[]) => groups.flatMap((g) => l.filter((it) => g.test(it.due_days)));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rowEls = useRef(new Map<string, HTMLElement>());
  const prevTops = useRef<Map<string, number> | null>(null);
  const drag = useRef<{ item: TemplateItem; key: string; grab: number; y: number; ty: number } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const motion = typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // przestawia zadanie na pozycję k wśród pozostałych (kolejność widoczna); zwraca nowy indeks
  const placeAt = (cur: TemplateItem, k: number, due0: number, force?: number) => {
    const l = itemsRef.current;
    const others = visual(l).filter((x) => x !== cur);
    const P = others[k - 1];
    const N = others[k];
    let due = force ?? due0;
    if (force === undefined && !((P && gIdx(P.due_days) === gIdx(due0)) || (N && gIdx(N.due_days) === gIdx(due0)))) due = P ? P.due_days : N ? N.due_days : due0;
    const base = l.filter((x) => x !== cur);
    const next = due === cur.due_days ? cur : carryKey(cur, { ...cur, due_days: due });
    let at = base.length;
    if (P && gIdx(P.due_days) === gIdx(due)) at = base.indexOf(P) + 1;
    else if (N) at = base.indexOf(N);
    const out = [...base.slice(0, at), next, ...base.slice(at)];
    if (out.every((x, i) => x === l[i])) return { next, idx: l.indexOf(cur) };
    // zapamiętaj położenie pozostałych wierszy – po przestawieniu przesuną się płynnie (FLIP)
    prevTops.current = new Map([...rowEls.current].map(([k2, el]) => [k2, el.getBoundingClientRect().top - (k2 === drag.current?.key ? drag.current.ty : 0)]));
    setItems(() => out);
    return { next, idx: out.indexOf(next) };
  };

  // krok o jedno miejsce (klawiatura, strzałki w panelu); na granicy grupy zadanie przechodzi do sąsiedniej grupy
  const step = (i: number, dir: -1 | 1) => {
    const it = itemsRef.current[i];
    if (!it) return;
    const vis = visual(itemsRef.current);
    const v = vis.indexOf(it);
    const others = vis.filter((x) => x !== it);
    const nb = dir > 0 ? others[v] : others[v - 1];
    if (!nb) return;
    const cross = gIdx(nb.due_days) !== gIdx(it.due_days);
    const r = placeAt(it, cross ? v : v + dir, it.due_days, cross ? nb.due_days : undefined);
    setSelRaw(r.idx);
    setMoved(rowKey(r.next));
  };
  const canStep = (i: number, dir: -1 | 1) => {
    const vis = visual(items);
    const v = vis.indexOf(items[i]);
    return dir < 0 ? v > 0 : v >= 0 && v < vis.length - 1;
  };

  const positionLifted = () => {
    const d = drag.current;
    const el = d && rowEls.current.get(d.key);
    if (!d || !el) return;
    const natural = el.getBoundingClientRect().top - d.ty;
    d.ty = d.y - d.grab - natural;
    el.style.transform = `translateY(${d.ty}px)`;
  };
  const onDragMove = () => {
    const d = drag.current;
    if (!d) return;
    positionLifted();
    const l = itemsRef.current;
    const cur = l.find((x) => rowKey(x) === d.key);
    const el = rowEls.current.get(d.key);
    if (!cur || !el) return;
    const center = d.y - d.grab + el.offsetHeight / 2;
    const others = visual(l).filter((x) => x !== cur);
    let k = 0;
    for (const o of others) {
      const r = rowEls.current.get(rowKey(o))?.getBoundingClientRect();
      if (r && r.top + r.height / 2 < center) k++;
    }
    // na granicy dwóch innych grup decyduje nagłówek grupy: środek wiersza pod nagłówkiem = grupa niższa
    const P = others[k - 1];
    const N = others[k];
    let force: number | undefined;
    const g0 = gIdx(d.item.due_days);
    if (P && N && gIdx(P.due_days) !== gIdx(N.due_days)) {
      const lab = rowEls.current.get(rowKey(N))?.closest(".ui-cl-group")?.querySelector(".ui-cl-glabel")?.getBoundingClientRect();
      const to = lab && center > lab.top + lab.height / 2 ? N : P;
      force = gIdx(to.due_days) === g0 ? d.item.due_days : to.due_days;
    }
    const r = placeAt(cur, k, d.item.due_days, force);
    setSelRaw(r.idx);
  };
  const startDrag = (i: number, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const it = items[i];
    const el = rowEls.current.get(rowKey(it));
    if (!el) return;
    e.preventDefault();
    drag.current = { item: it, key: rowKey(it), grab: e.clientY - el.getBoundingClientRect().top, y: e.clientY, ty: 0 };
    setLifted(rowKey(it));
    setSelRaw(i);
    setView("task");
    const move = (ev: PointerEvent) => {
      if (drag.current) drag.current.y = ev.clientY;
      onDragMove();
    };
    const scroll = () => onDragMove();
    const end = () => {
      const d = drag.current;
      const elx = d && rowEls.current.get(d.key);
      if (elx) elx.style.transform = "";
      if (d) setMoved(d.key);
      drag.current = null;
      setLifted(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("scroll", scroll, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("scroll", scroll, true);
  };
  useLayoutEffect(() => {
    const prev = prevTops.current;
    prevTops.current = null;
    positionLifted();
    if (!prev || !motion) return;
    for (const [k, el] of rowEls.current) {
      if (k === drag.current?.key) continue;
      const p = prev.get(k);
      if (p === undefined) continue;
      const dy = p - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }, [items]);
  // krótkie podświetlenie po upuszczeniu – widać, gdzie trafiło zadanie
  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), 700);
    return () => clearTimeout(t);
  }, [moved]);

  return (
    <div className="ui-cl">
      <div className="ui-cl-bar">
        {switcher}
        <Group gap="xs" wrap="nowrap" align="center" className="ui-cl-preview-for">
          <Text size="sm" c="dimmed">
            Podgląd dla:
          </Text>
          <Select size="sm" w={200} aria-label="Podgląd: APT" placeholder="dowolne APT" clearable searchable data={agOpts} value={pAg} onChange={pickAg} />
          <Select size="sm" w={200} aria-label="Podgląd: wydział" placeholder="dowolny wydział" clearable searchable data={depOpts} value={pDep} onChange={pickDep} />
        </Group>
        <Button
          variant="default"
          className="ui-cl-add"
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setItems((l) => [...l, { label: "", responsible: "hr", due_days: 0, auto: null, agency_ids: [], department_ids: [] }]);
            setSel(items.length);
          }}
        >
          Dodaj zadanie
        </Button>
      </div>
      <div className="ui-cl-grid">
        <div className="ui-cl-list" role="group" aria-label="Zadania checklisty" data-dragging={lifted ? "" : undefined}>
          {items.length === 0 && <CompactEmpty title="Brak zadań" text="Dodaj pierwsze zadanie przyciskiem „Dodaj zadanie”." />}
          {groups.map((g) => {
            const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => g.test(it.due_days));
            if (!rows.length) return null;
            return (
              <div key={g.label} className="ui-cl-group">
                <div className="ui-cl-glabel">{g.label}</div>
                {rows.map(({ it, i }) => {
                  const k = rowKey(it);
                  const dim = filtering && !applies(it);
                  return (
                    <div
                      key={k}
                      ref={(el) => {
                        if (el) rowEls.current.set(k, el);
                        else rowEls.current.delete(k);
                      }}
                      className="ui-cl-row"
                      data-on={sel === i || undefined}
                      data-dim={dim ? "" : undefined}
                      data-lifted={lifted === k || undefined}
                      data-moved={moved === k && !lifted ? "" : undefined}
                    >
                      <span
                        className="ui-cl-grip"
                        role="button"
                        tabIndex={0}
                        aria-label={`Przenieś: ${it.label || "zadanie bez nazwy"}`}
                        title="Przeciągnij albo użyj strzałek ↑ ↓"
                        onPointerDown={(e) => startDrag(i, e)}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                          e.preventDefault();
                          step(i, e.key === "ArrowUp" ? -1 : 1);
                        }}
                      >
                        <IconGripVertical size={20} aria-hidden />
                      </span>
                      <button
                        type="button"
                        className="ui-cl-pick"
                        aria-pressed={sel === i}
                        title={dim ? "Ta osoba nie dostanie tego zadania" : undefined}
                        onClick={() => setSel(i)}
                      >
                        <span className="ui-cl-text">
                          <span className="ui-cl-name">{it.label || "(bez nazwy)"}</span>
                          <span className="ui-cl-meta">
                            {cap(RESPONSIBLE[it.responsible])} · {scopeText(it, agMap, depMap)}
                          </span>
                        </span>
                        <span className="ui-cl-chip" data-zero={it.due_days === 0 || undefined}>
                          {dueChip(it.due_days)}
                        </span>
                        <span className="ui-cl-chip" data-auto={it.auto ? "" : undefined}>
                          {it.auto ? "automatycznie" : "ręcznie"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <aside className="ui-cl-side ui-cl-panel">
          <SegmentedControl
            fullWidth
            value={view}
            onChange={(v) => setView(v as "task" | "person")}
            data={[
              { value: "task", label: "Zadanie" },
              { value: "person", label: `Co dostanie osoba · ${shown.length}` },
            ]}
          />
          {view === "task" && (cur && sel !== null ? (
            <section className="ui-cl-pbody" aria-label="Wybrane zadanie">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Title order={3} className="ui-cl-ptitle">
                  {cur.label || "Nowe zadanie"}
                </Title>
                <Group gap={2} wrap="nowrap">
                  <ActionIcon variant="subtle" color="gray" disabled={!canStep(sel, -1)} onClick={() => step(sel, -1)} aria-label="Przesuń wyżej">
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" disabled={!canStep(sel, 1)} onClick={() => step(sel, 1)} aria-label="Przesuń niżej">
                    <IconArrowDown size={16} />
                  </ActionIcon>
                </Group>
              </Group>
              <TextInput label="Zadanie" placeholder="Np. Szkolenie BHP wstępne" value={cur.label} error={!cur.label.trim() ? "Wpisz nazwę zadania" : undefined} onChange={(e) => upd(sel, { label: e.currentTarget.value })} data-autofocus />
              <SimpleGrid cols={2} spacing="sm">
                <Select
                  label="Odpowiada"
                  allowDeselect={false}
                  data={[
                    { value: "hr", label: "HR" },
                    { value: "manager", label: "Kierownik" },
                  ]}
                  value={cur.responsible}
                  onChange={(v) => v && upd(sel, { responsible: v as TemplateItem["responsible"] })}
                />
                <NumberInput
                  label="Termin (dni)"
                  description={dueText(cur.due_days, kind)}
                  inputWrapperOrder={["label", "input", "description", "error"]}
                  min={-365}
                  max={365}
                  allowDecimal={false}
                  value={cur.due_days}
                  onChange={(v) => upd(sel, { due_days: Number(v) || 0 })}
                />
              </SimpleGrid>
              <MultiSelect label="Dotyczy APT" placeholder={cur.agency_ids.length ? undefined : "wszystkie APT"} searchable clearable data={agOpts} value={cur.agency_ids.map(String)} onChange={(v) => upd(sel, { agency_ids: v.map(Number) })} />
              <MultiSelect label="Dotyczy wydziałów" placeholder={cur.department_ids.length ? undefined : "wszystkie wydziały"} searchable clearable data={depOpts} value={cur.department_ids.map(String)} onChange={(v) => upd(sel, { department_ids: v.map(Number) })} />
              <Select
                label="Odhacz automatycznie, gdy"
                description="Bez tego zadanie odhacza się ręcznie na karcie pracownika."
                placeholder="ręcznie"
                clearable
                searchable
                data={data.auto_options}
                value={cur.auto}
                onChange={(v) => upd(sel, { auto: v })}
              />
              <Anchor
                component="button"
                type="button"
                c="red"
                size="sm"
                fw={600}
                w="fit-content"
                onClick={() => {
                  setItems((l) => l.filter((_, j) => j !== sel));
                  setSel(items.length > 1 ? Math.max(0, sel - 1) : null);
                }}
              >
                Usuń zadanie
              </Anchor>
            </section>
          ) : (
            items.length > 0 && (
              <Text size="sm" c="dimmed">
                Wybierz zadanie na liście, żeby je zmienić.
              </Text>
            )
          ))}
          {view === "person" && (
          <section className="ui-cl-pbody" aria-label="Co dostanie osoba">
            <Text size="sm" c="dimmed">
              Dla: {[pAg ? agMap.get(Number(pAg)) : null, pDep ? depMap.get(Number(pDep)) : null].filter(Boolean).join(" · ") || "dowolne APT i wydział"}
            </Text>
            {shown.length === 0 ? (
              <Text size="sm" c="dimmed">
                Ta osoba nie dostanie żadnego zadania z tej checklisty.
              </Text>
            ) : (
              <ul className="ui-cl-preview">
                {shown.map(({ it, i }) => (
                  <li key={i}>
                    <span className="ui-cl-chip" data-zero={it.due_days === 0 || undefined}>
                      {dueChip(it.due_days)}
                    </span>
                    <span>
                      {it.label || "(bez nazwy)"}
                      <small>
                        {cap(RESPONSIBLE[it.responsible])}
                        {it.auto ? ` · automatycznie: ${autoLabel(it.auto)}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Text size="xs" c="dimmed">
              Dzień 0 = dzień {ev}. Wartości ujemne – przed tą datą.{!filtering ? " Wybierz APT i wydział nad listą, żeby zobaczyć zadania konkretnej osoby." : ""}
            </Text>
          </section>
          )}
        </aside>
      </div>
      <div className="ui-tpe-save ui-cl-save">
        {dirty ? (
          <Text size="sm" className="ui-ef-pending">
            {emptyLabels ? "Uzupełnij nazwy zadań, żeby zapisać." : "Niezapisane zmiany w checkliście."}
          </Text>
        ) : saved ? (
          <Text size="sm" c="dimmed">
            Zapisano. „Zastosuj” dopasuje otwarte checklisty: doda nowe zadania, przeliczy terminy nieodhaczonych i usunie nietknięte, które przestały dotyczyć osoby.
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Wszystko zapisane.
          </Text>
        )}
        <Group gap="xs" wrap="nowrap">
          {dirty && (
            <Button variant="default" onClick={onDiscard}>
              Odrzuć
            </Button>
          )}
          {saved && !dirty ? (
            <Button onClick={() => apply.mutate()} loading={apply.isPending}>
              Zastosuj do trwających checklist
            </Button>
          ) : (
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || emptyLabels}>
              Zapisz checklistę
            </Button>
          )}
        </Group>
      </div>
    </div>
  );
}

export function ChecklistTemplates() {
  const q = useQuery({ queryKey: ["checklist-templates"], queryFn: () => api<Templates>("/checklist-templates") });
  const [kind, setKind] = useState<Kind>("onboarding");
  const mobile = useIsPhone();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Alert color="red">{errorText(q.error)}</Alert>;
  if (mobile) {
    const kinds: Kind[] = ["onboarding", "offboarding"];
    return (
      <Stack gap={16}>
        <Text size="sm" c="dimmed">
          Każde zadanie może dotyczyć wszystkich albo wybranych APT i wydziałów.
        </Text>
        <Segments
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          items={[
            { value: "onboarding", label: `Wdrożenie · ${q.data.onboarding.length}` },
            { value: "offboarding", label: `Odejście · ${q.data.offboarding.length}` },
          ]}
        />
        <SwipePager index={kinds.indexOf(kind)} onIndex={(i) => setKind(kinds[i])}>
          {kinds.map((k) => (
            <TemplatePanel key={k} kind={k} data={q.data!} />
          ))}
        </SwipePager>
      </Stack>
    );
  }
  // komputer: przełącznik rodzaju w jednym pasku z podglądem i „Dodaj zadanie”
  return (
    <TemplatePanel
      key={kind}
      kind={kind}
      data={q.data}
      switcher={
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          aria-label="Rodzaj checklisty"
          data={[
            { value: "onboarding", label: `Wdrożenie · ${q.data.onboarding.length}` },
            { value: "offboarding", label: `Odejście · ${q.data.offboarding.length}` },
          ]}
        />
      }
    />
  );
}
