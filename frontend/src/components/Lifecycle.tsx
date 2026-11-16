import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ActionSheet, CompactEmpty, ListRow, Section, StatusBadge, FormDialog, Segments, SwipePager, SectionHead, PageTitle, SheetHandle, SHEET_MAX_VH, SHEET_MIN_VH, useSheetResize, cap } from "./Mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Button, Checkbox, Drawer, Group, Input, Menu,  MultiSelect, NumberInput, Paper, Progress, SimpleGrid, Stack, SegmentedControl, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconAlertTriangle,
  IconDots,
  IconDotsVertical,
  IconCalendarEvent,
  IconCheck,
  IconChevronDown,
  IconMinus,
    IconPlayerSkipForward,
  IconPlus,
} from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, type DictionaryItem, type Employee } from "../api";
import { useAuth } from "../auth";
import { Loading, RowsSkeleton } from "./States";
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
const tasksWord = (n: number) => (n === 1 ? "zadanie" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "zadania" : "zadań");
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
  const n = Math.abs(days);
  const d = `${n} ${n === 1 ? "dzień" : "dni"}`;
  return days > 0 ? `${d} po ${ev.replace("ia", "iu")}` : `${d} przed ${ev.replace("ia", "iem")}`;
}

function scopeText(it: TemplateItem, ag: Map<number, string>, dep: Map<number, string>) {
  const a = it.agency_ids.length ? it.agency_ids.map((x) => ag.get(x) ?? "?").join(", ") : "wszystkie APT";
  const d = it.department_ids.length ? it.department_ids.map((x) => dep.get(x) ?? "?").join(", ") : "wszystkie wydziały";
  return `${a} · ${d}`;
}

// tylko zawężenia (bez „wszystkie …”): „Adecco” / „Produkcja, Magazyn” / „Adecco · Produkcja”
function limitText(it: TemplateItem, ag: Map<number, string>, dep: Map<number, string>) {
  return [it.agency_ids.map((x) => ag.get(x) ?? "?").join(", "), it.department_ids.map((x) => dep.get(x) ?? "?").join(", ")].filter(Boolean).join(" · ");
}

type ChecklistPage = { title: string; description: ReactNode };
type KindPick = { set: (k: Kind) => void; counts: Record<Kind, number> };
type DirtyRef = { current: boolean };
function TemplatePanel({ kind, data, switcher, page, kindPick, dirtyRef }: { kind: Kind; data: Templates; switcher?: ReactNode; page?: ChecklistPage; kindPick?: KindPick; dirtyRef?: DirtyRef }) {
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
  // rodzic pyta przed przełączeniem Wdrożenie / Odejście, gdy są niezapisane zmiany
  if (dirtyRef) dirtyRef.current = dirty;

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

  const applies = (it: TemplateItem) =>
    (!it.agency_ids.length || (pAg !== null && it.agency_ids.includes(Number(pAg)))) &&
    (!it.department_ids.length || (pDep !== null && it.department_ids.includes(Number(pDep))));

  return (
      <DeskTemplates
        phone={mobile}
        kindPick={kindPick}
        switcher={switcher}
        page={page}
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
}

/* Komputer i telefon: lista zadań pogrupowana wg terminu + panel wybranego zadania + „co dostanie osoba” (wariant A z podglądem z C).
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
  page,
  phone = false,
  kindPick,
}: {
  switcher?: ReactNode;
  page?: ChecklistPage;
  /** telefon (wariant B): rodzaj w tytule, „Zadania | Co dostanie osoba” z przesuwaniem, zadanie na pełnym ekranie */
  phone?: boolean;
  kindPick?: KindPick;
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
  const [editing, setEditing] = useState(false);
  // telefon: arkusz zadania jak arkusz pola w edycji szablonu – wysokość ustawiona uchwytem zapamiętana na tym urządzeniu
  const [sheetH, setSheetH] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("apt-cl-sheet-h"));
      return v >= SHEET_MIN_VH && v <= SHEET_MAX_VH ? v : 60;
    } catch {
      return 60;
    }
  });
  const sheet = useSheetResize(
    () => setEditing(false),
    (vh) => {
      setSheetH(vh);
      try {
        localStorage.setItem("apt-cl-sheet-h", String(vh));
      } catch {
        /* tryb prywatny */
      }
    },
  );
  // wybrane zadanie przewija się na górę – arkusz zasłania dolną część ekranu
  useEffect(() => {
    if (!phone || !editing) return;
    requestAnimationFrame(() =>
      document.querySelector(".ui-cl-row[data-editing]")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }),
    );
  }, [editing, sel, phone]);
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
  const drag = useRef<{ item: TemplateItem; key: string; grab: number; y: number; y0: number; ty: number } | null>(null);
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

  const listRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [due0, setDue0] = useState<number | null>(null);
  // przeniesiony wiersz idzie za palcem; miejsce, w które trafi, jest wypełnione tłem (jak w edycji szablonu)
  const positionLifted = () => {
    const d = drag.current;
    const el = d && rowEls.current.get(d.key);
    if (!d || !el) return;
    const natural = el.getBoundingClientRect().top - d.ty;
    d.ty = d.y - d.grab - natural;
    el.style.transform = `translateY(${d.ty}px)`;
    const slot = slotRef.current;
    if (slot) {
      slot.style.top = `${el.offsetTop}px`;
      slot.style.height = `${el.offsetHeight}px`;
    }
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
    // na granicy dwóch grup decyduje nagłówek grupy: środek wiersza pod nagłówkiem = grupa niższa
    const P = others[k - 1];
    const N = others[k];
    let force: number | undefined;
    const g0 = gIdx(d.item.due_days);
    if (P && N && gIdx(P.due_days) !== gIdx(N.due_days)) {
      const lab = listRef.current?.querySelector(`.ui-cl-glabel[data-g="${gIdx(N.due_days)}"]`)?.getBoundingClientRect();
      const to = lab && center > lab.top + lab.height / 2 ? N : P;
      force = gIdx(to.due_days) === g0 ? d.item.due_days : to.due_days;
    }
    const r = placeAt(cur, k, d.item.due_days, force);
    setSelRaw(r.idx);
  };
  // ruch palca: najwyżej jedno przeliczenie na klatkę ekranu
  const frame = useRef<number | null>(null);
  const onFrame = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onDragMove();
    });
  };
  // przewijanie przy krawędziach ekranu (dół: górna krawędź paska „Zapisz”, gdy jest widoczny); dopiero po ruchu w tę stronę
  const auto = useRef<number | null>(null);
  const autoscroll = () => {
    const d = drag.current;
    if (!d) return;
    const h = window.innerHeight;
    const edge = Math.min(72, Math.round(h * 0.15));
    const bt = document.querySelector<HTMLElement>(".ui-cl-save")?.getBoundingClientRect().top ?? h;
    const bottom = (bt < h && bt > 2 * edge ? bt : h) - edge;
    const movedBy = d.y - d.y0;
    const v = d.y < edge && movedBy < -12 ? -Math.min(20, 4 + Math.round((edge - d.y) / 4)) : d.y > bottom && movedBy > 12 ? Math.min(20, 4 + Math.round((d.y - bottom) / 4)) : 0;
    if (v) {
      window.scrollBy(0, v);
      onDragMove();
    }
    auto.current = requestAnimationFrame(autoscroll);
  };
  const noSelect = (on: boolean) => {
    document.documentElement.classList.toggle("ui-noselect", on);
    document.documentElement.classList.toggle("ui-grabbing", on);
    if (on) window.getSelection()?.removeAllRanges();
  };
  useEffect(() => () => noSelect(false), []);
  // telefon (jak edycja szablonu): bez uchwytu – przytrzymanie wiersza 300 ms bez ruchu podnosi go;
  // ruch palca wcześniej to zwykłe przewijanie ekranu
  const hold = useRef<{ i: number; x: number; y: number; timer: number; mouse: boolean } | null>(null);
  const suppressClick = useRef(false);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  // mysz (komputer): przeciąganie zaczyna się po ruszeniu o 5 px – zwykły klik tylko wybiera zadanie
  const rowDown = (i: number, e: ReactPointerEvent) => {
    if (e.button !== 0 || drag.current) return;
    const mouse = e.pointerType === "mouse";
    suppressClick.current = false;
    if (mouse) e.preventDefault(); // bez zaznaczania tekstu
    const h = { i, x: e.clientX, y: e.clientY, timer: 0, mouse };
    if (!mouse)
      h.timer = window.setTimeout(() => {
        if (hold.current !== h) return;
        hold.current = null;
        suppressClick.current = true;
        begin(h.i, h.y);
      }, 300);
    hold.current = h;
    if (mouse) {
      const mv = (ev: PointerEvent) => {
        if (hold.current !== h) return window.removeEventListener("pointermove", mv);
        if (Math.hypot(ev.clientX - h.x, ev.clientY - h.y) > 5) {
          window.removeEventListener("pointermove", mv);
          hold.current = null;
          suppressClick.current = true;
          begin(h.i, h.y);
          if (drag.current) drag.current.y = ev.clientY;
          onFrame();
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up);
        if (hold.current === h) hold.current = null;
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    }
  };
  const rowMove = (e: ReactPointerEvent) => {
    const h = hold.current;
    if (h && !h.mouse && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold();
  };
  // po podniesieniu wiersza palec nie przewija ekranu (zdarzenie touchmove musi być „niepasywne”)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const stop = (ev: TouchEvent) => {
      if (drag.current) ev.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  });
  const begin = (i: number, clientY: number) => {
    const it = itemsRef.current[i];
    const el = it && rowEls.current.get(rowKey(it));
    if (!it || !el) return;
    noSelect(true);
    // przechył jak kartka podniesiona z blatu: krawędź wychyla się o ok. 9 px niezależnie od szerokości listy
    const w = Math.max(1, listRef.current?.clientWidth ?? 600);
    listRef.current?.style.setProperty("--cl-tilt", `${(-Math.min(1.5, (Math.atan(9 / w) * 180) / Math.PI)).toFixed(2)}deg`);
    drag.current = { item: it, key: rowKey(it), grab: clientY - el.getBoundingClientRect().top, y: clientY, y0: clientY, ty: 0 };
    setLifted(rowKey(it));
    setDue0(it.due_days);
    setSelRaw(i);
    setView("task");
    navigator.vibrate?.(10);
    auto.current = requestAnimationFrame(autoscroll);
    const move = (ev: PointerEvent) => {
      if (drag.current) drag.current.y = ev.clientY;
      onFrame();
    };
    const scroll = () => onFrame();
    const end = () => {
      const d = drag.current;
      const elx = d && rowEls.current.get(d.key);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (auto.current !== null) cancelAnimationFrame(auto.current);
      auto.current = null;
      noSelect(false);
      if (elx && d) {
        elx.style.transform = "";
        // odłożenie: wiersz dosuwa się na swoje miejsce i prostuje (bez animacji przy ograniczonym ruchu)
        if (motion && Math.abs(d.ty) > 1) {
          elx.setAttribute("data-dropping", "");
          const a = elx.animate([{ transform: `translateY(${d.ty}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.22,.9,.3,1)" });
          a.onfinish = a.oncancel = () => elx.removeAttribute("data-dropping");
        }
        setMoved(d.key);
      }
      
      drag.current = null;
      setLifted(null);
      setDue0(null);
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
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.22,.9,.3,1)" });
    }
  }, [items]);
  // krótkie podświetlenie po upuszczeniu – widać, gdzie trafiło zadanie
  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), 700);
    return () => clearTimeout(t);
  }, [moved]);

  const addTask = () => {
    setItems((l) => [...l, { label: "", responsible: "hr", due_days: 0, auto: null, agency_ids: [], department_ids: [] }]);
    setSel(items.length);
    if (phone) setEditing(true);
  };
  const addBtn = (
    <Button variant="default" leftSection={<IconPlus size={16} />} onClick={addTask}>
      Dodaj zadanie
    </Button>
  );
  const pick = (i: number) => {
    setSel(i);
    if (phone) setEditing(true);
  };
  const listJSX = (
    <div ref={listRef} className="ui-cl-list" role="group" aria-label="Zadania checklisty" data-dragging={lifted ? "" : undefined}>
      {items.length === 0 && <CompactEmpty title="Brak zadań" text="Dodaj pierwsze zadanie przyciskiem „Dodaj zadanie”." />}
      {/* lista płaska (nagłówki grup i wiersze to rodzeństwo): przeniesiony do innej grupy wiersz zostaje tym samym
          elementem – palec go nie „gubi” i dotyk dalej blokuje przewijanie ekranu */}
      {groups.flatMap((g, gi) => {
        const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => g.test(it.due_days));
        if (!rows.length) return [];
        return [
            <div key={`g:${g.label}`} className="ui-cl-glabel" data-g={gi}>
              {g.label}
              {!phone && (
                <small>
                  {filtering && view === "person"
                    ? `${rows.filter(({ it }) => applies(it)).length} z ${rows.length} ${tasksWord(rows.length)}`
                    : `${rows.length} ${tasksWord(rows.length)}`}
                </small>
              )}
            </div>,
            ...rows.map(({ it, i }, ri) => {
              const k = rowKey(it);
              const dim = filtering && view === "person" && !applies(it);
              return (
                <div
                  key={k}
                  ref={(el) => {
                    if (el) rowEls.current.set(k, el);
                    else rowEls.current.delete(k);
                  }}
                  className="ui-cl-row"
                  data-on={(!phone && sel === i) || (phone && editing && sel === i) || undefined}
                  data-editing={(phone && editing && sel === i) || undefined}
                  data-dim={dim ? "" : undefined}
                  data-lifted={lifted === k || undefined}
                  data-moved={moved === k && !lifted ? "" : undefined}
                  data-glast={ri === rows.length - 1 || undefined}
                  onPointerDown={(e) => rowDown(i, e)}
                  onPointerMove={rowMove}
                  onPointerUp={() => hold.current && !hold.current.mouse && cancelHold()}
                  onPointerCancel={cancelHold}
                  onContextMenu={(e) => drag.current || hold.current ? e.preventDefault() : undefined}
                >
                  <button
                    type="button"
                    className="ui-cl-pick"
                    aria-pressed={sel === i}
                    onClick={() => {
                      // puszczenie palca po przeniesieniu nie otwiera zadania
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      pick(i);
                    }}
                    onKeyDown={(e) => {
                      // klawiatura: Alt + ↑ / ↓ przesuwa zadanie (na granicy grupy – do sąsiedniej)
                      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                      e.preventDefault();
                      step(i, e.key === "ArrowUp" ? -1 : 1);
                      requestAnimationFrame(() => rowEls.current.get(k)?.querySelector<HTMLElement>(".ui-cl-pick")?.focus());
                    }}
                    title={dim ? "Ta osoba nie dostanie tego zadania" : "Przeciągnij, żeby przenieść · Alt + ↑ ↓"}
                  >
                    {lifted === k && due0 !== null && gIdx(it.due_days) !== gIdx(due0) && (
                      <span className="ui-cl-target">
                        Trafi do: {groups[gIdx(it.due_days)]?.label} · {dueChip(it.due_days)}
                      </span>
                    )}
                    {/* komputer: zadanie tak, jak na karcie pracownika – pole wyboru, nazwa, kto i kiedy */}
                    {!phone && <span className="ui-cl-cb" aria-hidden />}
                    <span className="ui-cl-text">
                      <span className="ui-cl-name">{it.label || "(bez nazwy)"}</span>
                      <span className="ui-cl-meta">
                        {phone
                          ? [cap(RESPONSIBLE[it.responsible]), it.agency_ids.length || it.department_ids.length ? scopeText(it, agMap, depMap) : null, it.auto ? "automatycznie" : null].filter(Boolean).join(" · ")
                          : dim
                            ? `Nie dostanie – tylko ${limitText(it, agMap, depMap)}`
                            : [cap(RESPONSIBLE[it.responsible]), dueText(it.due_days, kind), limitText(it, agMap, depMap) || null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {phone ? (
                      <span className="ui-cl-chip" data-zero={it.due_days === 0 || undefined}>
                        {dueChip(it.due_days)}
                      </span>
                    ) : (
                      it.auto && (
                        <span className="ui-cl-chip" data-auto="">
                          automatycznie
                        </span>
                      )
                    )}
                  </button>
                </div>
              );
            }),
        ];
      })}
      {lifted && <div ref={slotRef} className="ui-cl-slot" aria-hidden />}
    </div>
  );
  const editor =
    cur && sel !== null ? (
      <section className="ui-cl-pbody" aria-label="Wybrane zadanie">
        {!phone && (
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
        )}
        <TextInput label="Zadanie" placeholder="Np. Szkolenie BHP wstępne" value={cur.label} error={!cur.label.trim() ? "Wpisz nazwę zadania" : undefined} onChange={(e) => upd(sel, { label: e.currentTarget.value })} data-autofocus />
        <SimpleGrid cols={phone ? 1 : 2} spacing="sm">
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
          <Input.Wrapper label="Termin" description={dueText(cur.due_days, kind)} inputWrapperOrder={["label", "input", "description", "error"]}>
            {/* − wartość + : przyciski obok pola, w polu termin z jednostką („+7 dni”, „dzień 0”) */}
            <div className="ui-cl-step">
              <ActionIcon variant="default" className="ui-cl-step-btn" aria-label="Dzień wcześniej" disabled={cur.due_days <= -365} onClick={() => upd(sel, { due_days: cur.due_days - 1 })}>
                <IconMinus size={16} />
              </ActionIcon>
              <NumberInput
                aria-label="Termin (dni)"
                min={-365}
                max={365}
                allowDecimal={false}
                hideControls
                prefix={cur.due_days > 0 ? "+" : ""}
                suffix={Math.abs(cur.due_days) === 1 ? " dzień" : " dni"}
                classNames={{ root: "ui-cl-step-field", input: "ui-cl-step-input" }}
                value={cur.due_days}
                onChange={(v) => upd(sel, { due_days: Number(v) || 0 })}
              />
              <ActionIcon variant="default" className="ui-cl-step-btn" aria-label="Dzień później" disabled={cur.due_days >= 365} onClick={() => upd(sel, { due_days: cur.due_days + 1 })}>
                <IconPlus size={16} />
              </ActionIcon>
            </div>
          </Input.Wrapper>
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
            setEditing(false);
          }}
        >
          Usuń zadanie
        </Anchor>
      </section>
    ) : null;
  const personView = (
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
        Dzień 0 = dzień {ev}. Wartości ujemne – przed tą datą.{!filtering ? phone ? " Wybierz agencję i wydział powyżej, żeby zobaczyć zadania konkretnej osoby." : " Wybierz agencję i wydział nad listą, żeby zobaczyć zadania konkretnej osoby." : ""}
      </Text>
    </section>
  );
  const saveBar = (
    <div className="ui-tpe-save ui-cl-save">
      {dirty ? (
        <Text size="sm" className="ui-ef-pending">
          {emptyLabels ? "Uzupełnij nazwy zadań, żeby zapisać." : phone ? "Niezapisane zmiany." : "Niezapisane zmiany w checkliście."}
        </Text>
      ) : saved ? (
        <Text size="sm" c="dimmed">
          {phone
          ? "Zapisano. Dopasować otwarte checklisty?"
          : "Zapisano. „Zastosuj” dopasuje otwarte checklisty: doda nowe zadania, przeliczy terminy nieodhaczonych i usunie nietknięte, które przestały dotyczyć osoby."}
        </Text>
      ) : (
        <Text size="sm" c="dimmed">
          Wszystko zapisane.
        </Text>
      )}
      <Group gap="xs" wrap="nowrap">
        {dirty && !phone && (
          <Button variant="default" onClick={onDiscard}>
            Odrzuć
          </Button>
        )}
        {saved && !dirty ? (
          <Button onClick={() => apply.mutate()} loading={apply.isPending}>
            {phone ? "Zastosuj" : "Zastosuj do trwających checklist"}
          </Button>
        ) : (
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || emptyLabels}>
            {phone ? "Zapisz" : "Zapisz checklistę"}
          </Button>
        )}
      </Group>
    </div>
  );

  if (phone) {
    const kinds: Kind[] = ["onboarding", "offboarding"];
    const kindName = (k: Kind) => (k === "onboarding" ? "Wdrożenie" : "Odejście");
    return (
      <div className="ui-cl ui-cl-phone">
        <div className="ui-head">
          <div className="ui-head-text">
            {kindPick ? (
              <Menu position="bottom-start" width={240}>
                <Menu.Target>
                  <UnstyledButton className="ui-cl-kindbtn" aria-label={`Rodzaj checklisty: ${kindName(kind)}`}>
                    <h1 className="ui-head-title">{kindName(kind)}</h1>
                    <IconChevronDown size={22} aria-hidden />
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  {kinds.map((k) => (
                    <Menu.Item key={k} onClick={() => kindPick.set(k)} rightSection={k === kind ? <IconCheck size={18} /> : undefined}>
                      {kindName(k)} · {kindPick.counts[k]}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            ) : (
              <h1 className="ui-head-title">{kindName(kind)}</h1>
            )}
            <span className="ui-head-sub">
              Checklista · {items.length} {tasksWord(items.length)}
            </span>
          </div>
          <UnstyledButton className="ui-head-action" aria-label="Dodaj zadanie" onClick={addTask}>
            <IconPlus size={22} />
          </UnstyledButton>
        </div>
        <Segments
          value={view}
          onChange={(v) => setView(v as "task" | "person")}
          items={[
            { value: "task", label: "Zadania" },
            { value: "person", label: "Co dostanie osoba" },
          ]}
        />
        <SwipePager index={view === "person" ? 1 : 0} onIndex={(i) => setView(i ? "person" : "task")}>
          {[
            <div key="task" className="ui-cl-phperson">
              <Text size="sm" c="dimmed">
                Dotknij zadanie, aby zmienić jego ustawienia. Przytrzymaj zadanie, aby je przenieść – w innej grupie dostanie jej termin.
              </Text>
              {listJSX}
            </div>,
            <div key="person" className="ui-cl-phperson">
              <Group gap="xs" grow wrap="nowrap">
                <Select aria-label="Podgląd dla agencji" placeholder="Agencja" clearable searchable data={agOpts} value={pAg} onChange={setPAg} />
                <Select aria-label="Podgląd dla wydziału" placeholder="Wydział" clearable searchable data={depOpts} value={pDep} onChange={setPDep} />
              </Group>
              <div className="ui-cl-phbox">{personView}</div>
            </div>,
          ]}
        </SwipePager>
        {/* pasek jak przy zaznaczaniu wielu pracowników: cały wiersz nad dolnym menu, duży przycisk */}
        {(dirty || saved) && (
          <div className="ui-selbar ui-savebar">
            <Text size="sm" className={dirty ? "ui-ef-pending" : undefined} c={dirty ? undefined : "dimmed"}>
              {dirty ? (emptyLabels ? "Uzupełnij nazwy zadań" : "Niezapisane zmiany") : "Zapisano. Dopasować otwarte checklisty?"}
            </Text>
            {dirty ? (
              <Button size="lg" radius="md" onClick={() => save.mutate()} loading={save.isPending} disabled={emptyLabels}>
                Zapisz
              </Button>
            ) : (
              <Button size="lg" radius="md" onClick={() => apply.mutate()} loading={apply.isPending}>
                Zastosuj
              </Button>
            )}
          </div>
        )}
        {/* zadanie: arkusz od dołu (jak pole w edycji szablonu) – lista nad nim widać i zmienia się na żywo */}
        <Drawer
          opened={editing && !!cur}
          onClose={() => setEditing(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          overlayProps={{ backgroundOpacity: 0.08 }}
          classNames={{ content: "ui-sheet ui-tpe-fsheet ui-sheet-sized" }}
          styles={{ content: { "--sheet-h": `${sheetH}dvh` } as React.CSSProperties }}
          aria-label={cur?.label || "Zadanie"}
        >
          {cur && sel !== null && (
            <>
              <SheetHandle onClose={() => setEditing(false)} sheet={sheet}>
                <div className="ui-sheet-head ui-tpe-fsheet-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ui-sheet-title">{cur.label || "Nowe zadanie"}</div>
                    <div className="ui-row-desc">
                      {groups[gIdx(cur.due_days)]?.label} · {dueChip(cur.due_days)}
                    </div>
                  </div>
                  <ActionIcon variant="default" size={44} aria-label="Przesuń wyżej" disabled={!canStep(sel, -1)} onClick={() => step(sel, -1)}>
                    <IconArrowUp size={18} />
                  </ActionIcon>
                  <ActionIcon variant="default" size={44} aria-label="Przesuń niżej" disabled={!canStep(sel, 1)} onClick={() => step(sel, 1)}>
                    <IconArrowDown size={18} />
                  </ActionIcon>
                </div>
              </SheetHandle>
              <div className="ui-tpe-fsheet-body" ref={sheet.bodyRef}>
                {editor}
              </div>
              <Button size="md" fullWidth mt="sm" className="ui-tpe-fsheet-done" onClick={() => setEditing(false)}>
                Gotowe
              </Button>
            </>
          )}
        </Drawer>
      </div>
    );
  }

  const kindName = kind === "onboarding" ? "Wdrożenie" : "Odejście";
  return (
    <div className="ui-cl">
      {/* układ edycji szablonu: nagłówek, pod nim rodzaj (jak „Pola / Ustawienia”) i tryb (jak „Edycja / Podgląd”),
          kartka z zadaniami po lewej, panel wybranego zadania po prawej */}
      {page && (
        <PageTitle
          title={page.title}
          meta={`${kindName} · ${items.length} ${tasksWord(items.length)}`}
          actions={
            <Menu position="bottom-end" width={300}>
              <Menu.Target>
                <ActionIcon variant="default" size={36} aria-label="Więcej akcji">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item disabled={dirty || apply.isPending} onClick={() => apply.mutate()}>
                  Zastosuj do trwających checklist
                  <Text size="xs" c="dimmed">
                    {dirty ? "Najpierw zapisz zmiany." : "Doda nowe zadania, przeliczy terminy nieodhaczonych i usunie nietknięte, które przestały dotyczyć osoby."}
                  </Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          }
        />
      )}
      <div className="ui-cl-bar">
        {switcher}
        <Group gap="sm" wrap="nowrap">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "task" | "person")}
            aria-label="Tryb"
            data={[
              { value: "task", label: "Edycja" },
              { value: "person", label: "Co dostanie osoba" },
            ]}
          />
          {addBtn}
        </Group>
      </div>
      <div className="ui-cl-grid">
        <div className="ui-cl-paper">
          <Text size="sm" c="dimmed">
            Tak zobaczy to kadra na karcie nowej osoby
          </Text>
          <Title order={2} className="ui-cl-ptitle">
            Checklista {kind === "onboarding" ? "wdrożenia" : "odejścia"}
            {view === "person" && filtering ? ` · ${shown.length} z ${items.length} ${tasksWord(items.length)}` : ""}
          </Title>
          {view === "task" ? (
            <Text size="xs" c="dimmed">
              Kliknij zadanie, aby je zmienić. Przeciągnij, aby zmienić kolejność – w innej grupie dostanie jej termin.
            </Text>
          ) : (
            <>
              <Group gap="xs" grow wrap="nowrap" mt="xs">
                <Select aria-label="Podgląd dla agencji" placeholder="Agencja" clearable searchable data={agOpts} value={pAg} onChange={pickAg} />
                <Select aria-label="Podgląd dla wydziału" placeholder="Wydział" clearable searchable data={depOpts} value={pDep} onChange={pickDep} />
              </Group>
              {!filtering && (
                <Text size="xs" c="dimmed">
                  Wybierz agencję i wydział – zadania, których ta osoba nie dostanie, przygasną.
                </Text>
              )}
            </>
          )}
          {listJSX}
        </div>
        <aside className="ui-cl-side ui-cl-panel">
          {editor ??
            (items.length > 0 && (
              <Text size="sm" c="dimmed">
                Wybierz zadanie na kartce, żeby je zmienić.
              </Text>
            ))}
        </aside>
      </div>
      {saveBar}
    </div>
  );
}

export function ChecklistTemplates({ page }: { page?: ChecklistPage } = {}) {
  const q = useQuery({ queryKey: ["checklist-templates"], queryFn: () => api<Templates>("/checklist-templates") });
  const [kind, setKind] = useState<Kind>("onboarding");
  const mobile = useIsPhone();
  const ask = useConfirm();
  const dirtyRef = useRef(false);
  const pickKind = async (k: Kind) => {
    if (k === kind) return;
    if (
      dirtyRef.current &&
      !(await ask({
        title: "Niezapisane zmiany",
        message: `W checkliście „${kind === "onboarding" ? "Wdrożenie" : "Odejście"}” są niezapisane zmiany. Po przełączeniu przepadną.`,
        confirmLabel: "Przełącz bez zapisu",
        cancelLabel: "Zostań",
        danger: true,
      }))
    )
      return;
    dirtyRef.current = false;
    setKind(k);
  };
  if (q.isLoading)
    return page && !mobile ? (
      <div className="ui-cl">
        <PageTitle title={page.title} description={page.description} />
        <RowsSkeleton rows={6} />
      </div>
    ) : (
      <Loading />
    );
  if (!q.data) return <Alert color="red">{errorText(q.error)}</Alert>;
  // telefon (wariant B): rodzaj w tytule z rozwijaniem, bez osobnego przełącznika
  if (mobile)
    return <TemplatePanel key={kind} kind={kind} data={q.data} dirtyRef={dirtyRef} kindPick={{ set: pickKind, counts: { onboarding: q.data.onboarding.length, offboarding: q.data.offboarding.length } }} />;
  // komputer: przełącznik rodzaju w jednym pasku z podglądem i „Dodaj zadanie”
  return (
    <TemplatePanel
      key={kind}
      kind={kind}
      data={q.data}
      page={page}
      dirtyRef={dirtyRef}
      switcher={
        <SegmentedControl
          value={kind}
          onChange={(v) => void pickKind(v as Kind)}
          aria-label="Rodzaj checklisty"
          data={[
            { value: "onboarding", label: `Wdrożenie ${q.data.onboarding.length}` },
            { value: "offboarding", label: `Odejście ${q.data.offboarding.length}` },
          ]}
        />
      }
    />
  );
}
