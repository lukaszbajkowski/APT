import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCircleCheck, IconPencil, IconPlus } from "@tabler/icons-react";

import {
  api,
  errorText,
  formatDate,
  TRAINING_STATUS,
  type DocTemplate,
  type ExpiringTraining,
  type TemplateField,
  type TrainingKind,
  type TrainingType,
} from "../api";
import { useAuth } from "../auth";
import { FieldsEditor } from "../components/FieldsEditor";

function Expiring() {
  const q = useQuery({ queryKey: ["trainings-expiring"], queryFn: () => api<ExpiringTraining[]>("/trainings/expiring") });
  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Alert color="green" icon={<IconCircleCheck />}>
        W ciągu najbliższych 30 dni nie kończy się żadne szkolenie ani uprawnienie.
      </Alert>
    );
  return (
    <Card withBorder padding={0}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pracownik</Table.Th>
            <Table.Th>Szkolenie</Table.Th>
            <Table.Th ta="right">Ważne do</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const st = TRAINING_STATUS[r.status];
            return (
              <Table.Tr key={r.training_id}>
                <Table.Td>
                  <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                    {r.last_name} {r.first_name}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    nr {r.number}
                    {r.department ? ` · ${r.department}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.name ?? r.type_name}</Text>
                  {r.name && (
                    <Text size="xs" c="dimmed">
                      {r.type_name}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{formatDate(r.valid_until)}</Text>
                  <Badge color={st.color} variant="light" size="sm">
                    {st.label}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

interface TypeForm {
  name: string;
  kind: TrainingKind;
  validity_months: number | string;
  template_id: string | null;
  is_active: boolean;
  fields: TemplateField[];
}

function TypeModal({ editing, opened, onClose }: { editing: TrainingType | null; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<DocTemplate[]>("/templates"), enabled: opened });
  const [f, setF] = useState<TypeForm>({ name: "", kind: "general", validity_months: "", template_id: null, is_active: true, fields: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setF(
      editing
        ? {
            name: editing.name,
            kind: editing.kind,
            validity_months: editing.validity_months ?? "",
            template_id: editing.template_id ? String(editing.template_id) : null,
            is_active: editing.is_active,
            fields: editing.fields,
          }
        : { name: "", kind: "general", validity_months: "", template_id: null, is_active: true, fields: [] },
    );
  }, [opened, editing]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        kind: f.kind,
        validity_months: f.validity_months === "" ? null : Number(f.validity_months),
        template_id: f.template_id ? Number(f.template_id) : null,
        is_active: f.is_active,
        fields: f.fields,
      };
      return editing
        ? api<TrainingType>(`/training-types/${editing.id}`, { method: "PUT", body })
        : api<TrainingType>("/training-types", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      notifications.show({ color: "green", message: "Zapisano rodzaj szkolenia." });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? "Rodzaj szkolenia" : "Nowy rodzaj szkolenia"} size="xl">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput label="Nazwa" value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
          <NumberInput
            label="Okres ważności (miesiące)"
            placeholder="bezterminowe / wpisywane ręcznie"
            min={1}
            max={600}
            allowDecimal={false}
            value={f.validity_months}
            onChange={(v) => setF({ ...f, validity_months: v })}
          />
        </SimpleGrid>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Typ
          </Text>
          <SegmentedControl
            value={f.kind}
            onChange={(v) => setF({ ...f, kind: v as TrainingKind })}
            data={[
              { value: "general", label: "Szkolenie / uprawnienie" },
              { value: "position", label: "Szkolenie stanowiskowe" },
            ]}
          />
          {f.kind === "position" && (
            <Text size="xs" c="dimmed" mt={4}>
              Dodatkowo: nazwa, wydział, daty rozpoczęcia, egzaminu i zakończenia, opiekun, czas nauki wg standardu.
            </Text>
          )}
        </div>
        <Select
          label="Szablon dokumentu"
          description="Opcjonalnie – przy szkoleniu pojawi się „Generuj dokument”. W szablonie użyj znaczników szkolenie_* i kluczy pól poniżej."
          clearable
          data={(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
          value={f.template_id}
          onChange={(v) => setF({ ...f, template_id: v })}
        />
        <Switch label="Aktywny (do wyboru przy dodawaniu szkolenia)" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.currentTarget.checked })} />
        <div>
          <Text size="sm" fw={500}>
            Dodatkowe pola
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Wypełniane przy szkoleniu (np. nr zaświadczenia, kategoria uprawnień). Klucz pola = znacznik w szablonie, np.{" "}
            <code>{"{{ nr_zaswiadczenia }}"}</code>.
          </Text>
          <FieldsEditor fields={f.fields} onChange={(fields) => setF({ ...f, fields })} editableKeys />
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Zapisz
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Types() {
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const [modal, setModal] = useState<{ open: boolean; editing: TrainingType | null }>({ open: false, editing: null });
  if (types.isLoading) return <Loader />;
  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, editing: null })}>
          Dodaj rodzaj
        </Button>
      </Group>
      <Stack gap="xs">
        {types.data?.map((t) => (
          <Paper key={t.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text fw={600}>{t.name}</Text>
                  {!t.is_active && (
                    <Badge color="gray" variant="light" size="sm">
                      wyłączony
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {[
                    t.kind === "position" ? "stanowiskowe" : "szkolenie / uprawnienie",
                    t.validity_months ? `ważność ${t.validity_months} mies.` : "bez okresu ważności",
                    t.fields.length ? `pola: ${t.fields.length}` : null,
                    t.template_name ? `szablon: ${t.template_name}` : null,
                    `wpisów: ${t.in_use}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </div>
              <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setModal({ open: true, editing: t })}>
                Edytuj
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
      <TypeModal editing={modal.editing} opened={modal.open} onClose={() => setModal({ open: false, editing: null })} />
    </Stack>
  );
}

export function TrainingsPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  return (
    <Stack>
      <div>
        <Title order={2}>Szkolenia</Title>
        <Text c="dimmed" size="sm">
          Szkolenia wpisuje się w kartotece pracownika. Przypomnienie e-mail o kończących się wychodzi w poniedziałki.
        </Text>
      </div>
      <Tabs defaultValue="expiring" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="expiring">Kończące się (30 dni)</Tabs.Tab>
          {staff && <Tabs.Tab value="types">Rodzaje szkoleń</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="expiring">
          <Expiring />
        </Tabs.Panel>
        {staff && (
          <Tabs.Panel value="types">
            <Types />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
