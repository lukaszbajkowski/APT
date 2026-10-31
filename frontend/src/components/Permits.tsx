import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconId, IconPlus, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDate, type Employee, type Permit } from "../api";
import { Loading } from "./States";

export const PERMIT_KINDS = [
  { value: "karta_pobytu", label: "karta pobytu" },
  { value: "zezwolenie_na_prace", label: "zezwolenie na pracę" },
  { value: "wiza", label: "wiza" },
  { value: "oswiadczenie", label: "oświadczenie o powierzeniu pracy" },
  { value: "inne", label: "inny dokument" },
];

export const PERMIT_STATE: Record<Permit["state"], { label: string; color: string }> = {
  valid: { label: "ważny", color: "teal" },
  expiring: { label: "kończy się", color: "orange" },
  expired: { label: "nieważny", color: "red" },
};

function AddPermit({ employee, opened, onClose }: { employee: Employee; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState("karta_pobytu");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Permit>(`/employees/${employee.id}/permits`, {
        method: "POST",
        body: { kind, valid_from: from || null, valid_until: until, notes: notes.trim() || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permits", employee.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
      notifications.show({ color: "green", message: "Dodano dokument." });
      setFrom("");
      setUntil("");
      setNotes("");
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Dodaj dokument pobytowy lub zezwolenie" size="md">
      <form
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
            <TextInput label="Ważne od" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
            <TextInput label="Ważne do" type="date" required min={from || undefined} value={until} onChange={(e) => setUntil(e.currentTarget.value)} />
          </SimpleGrid>
          <TextInput label="Uwagi" maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" loading={save.isPending}>
              Zapisz
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function PermitsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["permits", employee.id], queryFn: () => api<Permit[]>(`/employees/${employee.id}/permits`) });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: number) => api(`/permits/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permits", employee.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
      notifications.show({ color: "green", message: "Usunięto dokument." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const latest = q.data?.[0];
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconId size={18} color="var(--mantine-color-gray-6)" />
          <Title order={5}>Dokumenty pobytowe i zezwolenia</Title>
          {latest && (
            <Badge variant="light" color={PERMIT_STATE[latest.state].color}>
              {PERMIT_STATE[latest.state].label} do {formatDate(latest.valid_until)}
            </Badge>
          )}
        </Group>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setOpen(true)}>
          Dodaj dokument
        </Button>
      </Group>
      {q.isLoading && <Loading />}
      {q.data && q.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak dokumentów (dotyczy cudzoziemców).
        </Text>
      )}
      {q.data && q.data.length > 0 && (
        <Table verticalSpacing={6} fz="sm">
          <Table.Tbody>
            {q.data.map((x) => (
              <Table.Tr key={x.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {x.kind_label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {x.valid_from ? `od ${formatDate(x.valid_from)}` : ""}
                    {x.notes ? ` ${x.notes}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={PERMIT_STATE[x.state].color}>
                    do {formatDate(x.valid_until)}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Tooltip label="Usuń dokument">
                    <ActionIcon variant="subtle" color="red" size="sm" aria-label="Usuń dokument" loading={del.isPending} onClick={() => del.mutate(x.id)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <AddPermit employee={employee} opened={open} onClose={() => setOpen(false)} />
    </Card>
  );
}
