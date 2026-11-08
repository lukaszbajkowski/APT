import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, ListRow, Section, StatusBadge, type SheetAction, cap, FormDialog, SectionHead, RowMenu } from "./Mobile";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, FileInput, Group, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import { IconFileText, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, errorText, formatDate, type Employee, type MedicalExam, withAcct } from "../api";
import { Loading } from "./States";
import { DateField } from "./DateField";
import { useConfirm } from "../lib/confirm";

const STATE: Record<MedicalExam["state"], { label: string; color: string }> = {
  valid: { label: "Ważne", color: "teal" },
  expiring: { label: "Kończą się", color: "orange" },
  expired: { label: "Nieważne", color: "red" },
  none: { label: "Bez terminu", color: "gray" },
};

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function AddExam({ employee, opened, onClose, editing }: { employee: Employee; opened: boolean; onClose: () => void; editing?: MedicalExam | null }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<string>(editing?.kind ?? "wstepne");
  const [date, setDate] = useState(editing?.exam_date ?? today);
  const [validUntil, setValidUntil] = useState(editing?.valid_until ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (editing)
        return api<MedicalExam>(`/medical-exams/${editing.id}`, {
          method: "PATCH",
          body: { kind, exam_date: date, valid_until: validUntil || null, notes: notes.trim() || null },
        });
      const f = new FormData();
      f.append("kind", kind);
      f.append("exam_date", date);
      if (validUntil) f.append("valid_until", validUntil);
      if (notes.trim()) f.append("notes", notes.trim());
      if (file) f.append("file", file);
      return api<MedicalExam>(`/employees/${employee.id}/medical-exams`, { method: "POST", form: f });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medical-exams", employee.id] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      notifications.show({ color: "green", message: editing ? "Zapisano zmiany." : "Dodano badanie." });
      setFile(null);
      setNotes("");
      setValidUntil("");
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <FormDialog opened={opened} onClose={onClose} title={editing ? "Popraw badanie lekarskie" : "Dodaj badanie lekarskie"} size="md" primary={{ label: "Zapisz", formId: "fd-medical", loading: save.isPending }}>
      <form id="fd-medical"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Select
            label="Rodzaj"
            allowDeselect={false}
            data={[
              { value: "wstepne", label: "Wstępne" },
              { value: "okresowe", label: "Okresowe" },
              { value: "kontrolne", label: "Kontrolne" },
            ]}
            value={kind}
            onChange={(v) => v && setKind(v)}
          />
          <SimpleGrid cols={2}>
            <DateField label="Data badania" required max={today} value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            <DateField label="Ważne do"  min={date} value={validUntil} onChange={(e) => setValidUntil(e.currentTarget.value)} />
          </SimpleGrid>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              Szybko:
            </Text>
            {[12, 24, 36].map((m) => (
              <Button key={m} size="compact-xs" variant="default" onClick={() => setValidUntil(addMonths(date, m))}>
                {m / 12} {m === 12 ? "rok" : "lata"}
              </Button>
            ))}
          </Group>
          {!editing && <FileInput
            label="Orzeczenie (skan)"
            placeholder="PDF, JPG lub PNG"
            accept="application/pdf,image/jpeg,image/png"
            clearable
            value={file}
            onChange={setFile}
          />}
          <TextInput label="Uwagi" maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        </Stack>
      </form>
    </FormDialog>
  );
}

export function MedicalExamsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canAdd = hasRole("admin", "hr", "agency");
  const q = useQuery({
    queryKey: ["medical-exams", employee.id],
    queryFn: () => api<MedicalExam[]>(`/employees/${employee.id}/medical-exams`),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalExam | null>(null);
  const ask = useConfirm();
  const askDel = (x: MedicalExam) => ask({ title: "Usunąć badanie?", message: "Badanie zostanie usunięte z kartoteki.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && del.mutate(x.id));
  const del = useMutation({
    mutationFn: (id: number) => api(`/medical-exams/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medical-exams", employee.id] });
      notifications.show({ color: "green", message: "Usunięto badanie." });
    },
  });
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [sheet, setSheet] = useState<MedicalExam | null>(null);
  if (mobile) {
    const acts: SheetAction[] = [];
    if (sheet?.has_file) acts.push({ label: "Pokaż orzeczenie", icon: <IconFileText size={20} />, onClick: () => window.open(withAcct(`/api/medical-exams/${sheet.id}/file`), "_blank") });
    if (sheet?.can_delete) acts.push({ label: "Popraw dane", icon: <IconPencil size={20} />, onClick: () => setEditing(sheet) });
    if (sheet?.can_delete) acts.push({ label: "Usuń badanie", icon: <IconTrash size={20} />, danger: true, onClick: () => ask({ title: "Usunąć badanie?", message: "Badanie zostanie usunięte z kartoteki.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && del.mutate(sheet.id)) });
    return (
      <>
        <Section title="Badania lekarskie" action={canAdd ? { label: "Dodaj", icon: <IconPlus size={16} />, onClick: () => setOpen(true) } : undefined}>
          {q.isLoading && <Loading rows={1} />}
          {q.data?.length === 0 && <CompactEmpty title="Brak badań" text="Dodaj badanie, aby śledzić termin ważności." />}
          {q.data?.map((x, i) => (
            <ListRow
              key={x.id}
              title={cap(x.kind_label)}
              muted={i > 0}
              description={
                <>
                  {i === 0 && <StatusBadge tone={x.state === "valid" ? "ok" : x.state === "expired" ? "error" : x.state === "none" ? "neutral" : "warn"}>{STATE[x.state].label}</StatusBadge>}{" "}
                  od {formatDate(x.exam_date)}
                  {x.valid_until ? ` do ${formatDate(x.valid_until)}` : ""}
                </>
              }
              onClick={x.has_file || x.can_delete ? () => setSheet(x) : undefined}
            />
          ))}
        </Section>
        <ActionSheet opened={!!sheet} onClose={() => setSheet(null)} title={cap(sheet?.kind_label)} actions={acts} />
      {canAdd && open && <AddExam key="new" employee={employee} opened onClose={() => setOpen(false)} />}
      {editing && <AddExam key={editing.id} employee={employee} editing={editing} opened onClose={() => setEditing(null)} />}
      </>
    );
  }
  return (
    <section className="ui-dsec">
      <SectionHead title="Badania lekarskie" action={canAdd ? { label: "Dodaj badanie", onClick: () => setOpen(true) } : undefined} />
      {q.isLoading && <Loading />}
      {q.data && q.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak badań. Dodaj badanie, aby śledzić termin ważności.
        </Text>
      )}
      {q.data && q.data.length > 0 && (
        <div className="ui-dlist">
          {q.data.map((x, i) => (
            <div key={x.id} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title">Badanie {x.kind_label.toLowerCase()}</div>
                <div className="ui-drow-meta">
                  z {formatDate(x.exam_date)} · dodał(a) {x.created_by_name ?? "—"}
                  {x.notes ? ` · ${x.notes}` : ""}
                </div>
              </div>
              <Group gap={8} wrap="nowrap" style={{ flex: "none" }}>
                {i === 0 ? (
                  <Text size="sm" className={x.state === "valid" || x.state === "none" ? undefined : "ui-warn"}>
                    {x.valid_until ? `${STATE[x.state].label} do ${formatDate(x.valid_until)}` : STATE[x.state].label}
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    {x.valid_until ? `do ${formatDate(x.valid_until)} · poprzednie` : "poprzednie"}
                  </Text>
                )}
                {x.has_file && (
                  <Button size="xs" variant="default" component="a" href={withAcct(`/api/medical-exams/${x.id}/file`)} target="_blank">
                    Orzeczenie
                  </Button>
                )}
                {x.can_delete && (
                  <RowMenu
                    label={`badanie z ${formatDate(x.exam_date)}`}
                    items={[{ label: "Popraw dane", icon: <IconPencil size={16} />, onClick: () => setEditing(x) }]}
                    danger={{ label: "Usuń badanie", icon: <IconTrash size={16} />, onClick: () => askDel(x) }}
                  />
                )}
              </Group>
            </div>
          ))}
        </div>
      )}
      {canAdd && open && <AddExam key="new" employee={employee} opened onClose={() => setOpen(false)} />}
      {editing && <AddExam key={editing.id} employee={employee} editing={editing} opened onClose={() => setEditing(null)} />}
    </section>
  );
}
