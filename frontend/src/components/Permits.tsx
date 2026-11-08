import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, ListRow, Section, StatusBadge, cap, FormDialog, SectionHead, RowMenu } from "./Mobile";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Group, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDate, type Employee, type Permit } from "../api";
import { Loading, RowsSkeleton } from "./States";
import { DateField } from "./DateField";
import { useConfirm } from "../lib/confirm";

export const PERMIT_KINDS = [
  { value: "karta_pobytu", label: "Karta pobytu" },
  { value: "zezwolenie_na_prace", label: "Zezwolenie na pracę" },
  { value: "wiza", label: "Wiza" },
  { value: "oswiadczenie", label: "Oświadczenie o powierzeniu pracy" },
  { value: "inne", label: "Inny dokument" },
];

export const PERMIT_STATE: Record<Permit["state"], { label: string; color: string }> = {
  valid: { label: "Ważny", color: "teal" },
  expiring: { label: "Kończy się", color: "orange" },
  expired: { label: "Nieważny", color: "red" },
};

function AddPermit({ employee, opened, onClose, editing }: { employee: Employee; opened: boolean; onClose: () => void; editing?: Permit | null }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState(editing?.kind ?? "karta_pobytu");
  const [from, setFrom] = useState(editing?.valid_from ?? "");
  const [until, setUntil] = useState(editing?.valid_until ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Permit>(editing ? `/permits/${editing.id}` : `/employees/${employee.id}/permits`, {
        method: editing ? "PATCH" : "POST",
        body: { kind, valid_from: from || null, valid_until: until, notes: notes.trim() || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permits", employee.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
      notifications.show({ color: "green", message: editing ? "Zapisano zmiany." : "Dodano dokument." });
      setFrom("");
      setUntil("");
      setNotes("");
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <FormDialog opened={opened} onClose={onClose} title={editing ? "Popraw dokument pobytowy" : "Dokument pobytowy"} subtitle="Karta pobytu, wiza lub zezwolenie na pracę" size="md" primary={{ label: "Zapisz", formId: "fd-permit", loading: save.isPending }}>
      <form id="fd-permit"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Select label="Rodzaj" allowDeselect={false} data={PERMIT_KINDS} value={kind} onChange={(v) => v && setKind(v)} />
          <SimpleGrid cols={2}>
            <DateField label="Ważne od"  value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
            <DateField label="Ważne do"  required min={from || undefined} value={until} onChange={(e) => setUntil(e.currentTarget.value)} />
          </SimpleGrid>
          <TextInput label="Uwagi" maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        </Stack>
      </form>
    </FormDialog>
  );
}

export function PermitsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["permits", employee.id], queryFn: () => api<Permit[]>(`/employees/${employee.id}/permits`) });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Permit | null>(null);
  const ask = useConfirm();
  const askDel = (x: Permit) => ask({ title: "Usunąć dokument?", message: "Dokument zostanie usunięty z kartoteki.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && del.mutate(x.id));
  const del = useMutation({
    mutationFn: (id: number) => api(`/permits/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permits", employee.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
      notifications.show({ color: "green", message: "Usunięto dokument." });
    },
  });
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [sheet, setSheet] = useState<Permit | null>(null);
  const polish = /^pol(ska|and)$/i.test(employee.country?.name ?? "");
  if (mobile) {
    return (
      <>
        <Section title="Dokumenty pobytowe" action={polish && !q.data?.length ? undefined : { label: "Dodaj", icon: <IconPlus size={16} />, onClick: () => setOpen(true) }}>
          {q.isLoading && <Loading rows={1} />}
          {q.data?.length === 0 && (
            <CompactEmpty title={polish ? "Nie dotyczy" : "Brak dokumentów"} text={polish ? "Obywatelstwo polskie." : "Karta pobytu, wiza lub zezwolenie."} />
          )}
          {q.data?.map((x) => (
            <ListRow
              key={x.id}
              title={cap(x.kind_label)}
              description={
                <StatusBadge tone={x.state === "valid" ? "ok" : x.state === "expired" ? "error" : "warn"}>
                  {PERMIT_STATE[x.state].label} do {formatDate(x.valid_until)}
                </StatusBadge>
              }
              onClick={() => setSheet(x)}
            />
          ))}
        </Section>
        <ActionSheet
          opened={!!sheet}
          onClose={() => setSheet(null)}
          title={cap(sheet?.kind_label)}
          subtitle={sheet?.notes ?? undefined}
          actions={sheet ? [{ label: "Popraw dane", icon: <IconPencil size={20} />, onClick: () => setEditing(sheet) }, { label: "Usuń dokument", icon: <IconTrash size={20} />, danger: true, onClick: () => ask({ title: "Usunąć dokument?", message: "Dokument zostanie usunięty z kartoteki.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && del.mutate(sheet.id)) }] : []}
        />
      {open && <AddPermit key="new" employee={employee} opened onClose={() => setOpen(false)} />}
      {editing && <AddPermit key={editing.id} employee={employee} editing={editing} opened onClose={() => setEditing(null)} />}
      </>
    );
  }
  return (
    <section className="ui-dsec">
      <SectionHead title="Dokumenty pobytowe i zezwolenia" action={polish && !q.data?.length ? undefined : { label: "Dodaj dokument", onClick: () => setOpen(true) }} />
      {q.isLoading && <RowsSkeleton rows={1} />}
      {q.data && q.data.length === 0 && (
        <Text size="sm" c="dimmed">
          {polish ? "Nie dotyczy – obywatelstwo polskie." : "Brak dokumentów. Dodaj kartę pobytu, wizę lub zezwolenie, aby śledzić ich ważność."}
        </Text>
      )}
      {q.data && q.data.length > 0 && (
        <div className="ui-dlist">
          {q.data.map((x) => (
            <div key={x.id} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title">{cap(x.kind_label)}</div>
                <div className="ui-drow-meta">
                  {[x.valid_from ? `wydany ${formatDate(x.valid_from)}` : null, x.notes].filter(Boolean).join(" · ") || "bez daty wydania"}
                </div>
              </div>
              <Group gap={8} wrap="nowrap" style={{ flex: "none" }}>
                <Text size="sm" className={x.state === "valid" ? undefined : "ui-warn"}>
                  {PERMIT_STATE[x.state].label} do {formatDate(x.valid_until)}
                </Text>
                <RowMenu
                  label={x.kind_label}
                  items={[{ label: "Popraw dane", icon: <IconPencil size={16} />, onClick: () => setEditing(x) }]}
                  danger={{ label: "Usuń dokument", icon: <IconTrash size={16} />, onClick: () => askDel(x) }}
                />
              </Group>
            </div>
          ))}
        </div>
      )}
      {open && <AddPermit key="new" employee={employee} opened onClose={() => setOpen(false)} />}
      {editing && <AddPermit key={editing.id} employee={employee} editing={editing} opened onClose={() => setEditing(null)} />}
    </section>
  );
}
