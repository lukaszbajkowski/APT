import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFileText, IconPlus, IconStethoscope, IconTrash } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, errorText, formatDate, type Employee, type MedicalExam, withAcct } from "../api";

const STATE: Record<MedicalExam["state"], { label: string; color: string }> = {
  valid: { label: "ważne", color: "teal" },
  expiring: { label: "kończą się", color: "orange" },
  expired: { label: "nieważne", color: "red" },
  none: { label: "bez terminu", color: "gray" },
};

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function AddExam({ employee, opened, onClose }: { employee: Employee; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<string>("wstepne");
  const [date, setDate] = useState(today);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
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
      notifications.show({ color: "green", message: "Dodano badanie." });
      setFile(null);
      setNotes("");
      setValidUntil("");
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Dodaj badanie lekarskie" size="md">
      <form
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
              { value: "wstepne", label: "wstępne" },
              { value: "okresowe", label: "okresowe" },
              { value: "kontrolne", label: "kontrolne" },
            ]}
            value={kind}
            onChange={(v) => v && setKind(v)}
          />
          <SimpleGrid cols={2}>
            <TextInput label="Data badania" type="date" required max={today} value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            <TextInput label="Ważne do" type="date" min={date} value={validUntil} onChange={(e) => setValidUntil(e.currentTarget.value)} />
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
          <FileInput
            label="Orzeczenie (skan)"
            placeholder="PDF, JPG lub PNG"
            accept="application/pdf,image/jpeg,image/png"
            clearable
            value={file}
            onChange={setFile}
          />
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

export function MedicalExamsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canAdd = hasRole("admin", "hr", "agency");
  const q = useQuery({
    queryKey: ["medical-exams", employee.id],
    queryFn: () => api<MedicalExam[]>(`/employees/${employee.id}/medical-exams`),
  });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: number) => api(`/medical-exams/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medical-exams", employee.id] });
      notifications.show({ color: "green", message: "Usunięto badanie." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const latest = q.data?.[0];
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconStethoscope size={18} color="var(--mantine-color-gray-6)" />
          <Title order={5}>Badania lekarskie</Title>
          {latest && (
            <Badge variant="light" color={STATE[latest.state].color}>
              {latest.valid_until ? `${STATE[latest.state].label} do ${formatDate(latest.valid_until)}` : STATE[latest.state].label}
            </Badge>
          )}
        </Group>
        {canAdd && (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setOpen(true)}>
            Dodaj badanie
          </Button>
        )}
      </Group>
      {q.isLoading && <Loader size="sm" />}
      {q.data && q.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak badań.
        </Text>
      )}
      {q.data && q.data.length > 0 && (
        <Table verticalSpacing={6} fz="sm">
          <Table.Tbody>
            {q.data.map((x, i) => (
              <Table.Tr key={x.id} opacity={i === 0 ? 1 : 0.7}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {x.kind_label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    dodał(a) {x.created_by_name ?? "—"}
                    {x.notes ? ` · ${x.notes}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>{formatDate(x.exam_date)}</Table.Td>
                <Table.Td>
                  {x.valid_until ? (
                    <Text size="sm" c={i === 0 ? STATE[x.state].color : undefined}>
                      do {formatDate(x.valid_until)}
                    </Text>
                  ) : (
                    "—"
                  )}
                </Table.Td>
                <Table.Td ta="right">
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    {x.has_file && (
                      <Anchor href={withAcct(`/api/medical-exams/${x.id}/file`)} target="_blank" size="sm">
                        <Group gap={4} wrap="nowrap">
                          <IconFileText size={14} /> orzeczenie
                        </Group>
                      </Anchor>
                    )}
                    {x.can_delete && (
                      <Tooltip label="Usuń badanie">
                        <ActionIcon variant="subtle" color="red" size="sm" aria-label="Usuń badanie" loading={del.isPending} onClick={() => del.mutate(x.id)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {canAdd && <AddExam employee={employee} opened={open} onClose={() => setOpen(false)} />}
    </Card>
  );
}
