import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
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
import { IconCheck, IconCircleCheck, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import {
  api,
  errorText,
  formatDate,
  TRAINING_STATUS,
  type DocTemplate,
  type ExpiringTraining,
  type InProgressTraining,
  type DictionaryItem,
  type TrainingProgram,
  type TrainingKind,
  type TrainingType,
} from "../api";
import { useAuth } from "../auth";

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

function ProgramRow({
  typeId,
  program,
  departments,
  onDone,
}: {
  typeId: number;
  program: TrainingProgram | null;
  departments: DictionaryItem[];
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(program?.name ?? "");
  const [dep, setDep] = useState<string | null>(program?.department_id ? String(program.department_id) : null);
  const [days, setDays] = useState<number | string>(program?.standard_days ?? "");
  const dirty =
    !program ||
    name !== program.name ||
    dep !== (program.department_id ? String(program.department_id) : null) ||
    days !== (program.standard_days ?? "");
  const onError = (e: unknown) => notifications.show({ color: "red", message: errorText(e) });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, department_id: dep ? Number(dep) : null, standard_days: days === "" ? null : Number(days), is_active: true };
      return program
        ? api(`/training-programs/${program.id}`, { method: "PUT", body })
        : api(`/training-types/${typeId}/programs`, { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      if (!program) {
        setName("");
        setDep(null);
        setDays("");
      }
      onDone?.();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/training-programs/${program!.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-types"] }),
    onError,
  });
  return (
    <Group gap="xs" wrap="nowrap" align="flex-end">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" style={{ flex: 1 }}>
        <TextInput size="xs" aria-label="Nazwa szkolenia" placeholder="Nazwa szkolenia" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select
          size="xs"
          aria-label="Wydział"
          placeholder="Wydział (dowolny)"
          clearable
          searchable
          data={departments.map((d) => ({ value: String(d.id), label: d.name }))}
          value={dep}
          onChange={setDep}
        />
        <NumberInput
          size="xs"
          aria-label="Standard (dni)"
          placeholder="Standard (dni)"
          min={0}
          max={3650}
          allowDecimal={false}
          suffix=" dni"
          value={days}
          onChange={setDays}
        />
      </SimpleGrid>
      <ActionIcon
        variant={program ? "subtle" : "filled"}
        aria-label={program ? "Zapisz pozycję" : "Dodaj do katalogu"}
        disabled={!name.trim() || !dirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {program ? <IconCheck size={14} /> : <IconPlus size={14} />}
      </ActionIcon>
      {!program && <div style={{ width: 28, flexShrink: 0 }} />}
      {program && (
        <ActionIcon
          variant="subtle"
          color="red"
          aria-label="Usuń z katalogu"
          onClick={() => window.confirm(`Usunąć „${program.name}” z katalogu? Wpisane szkolenia zostaną.`) && remove.mutate()}
        >
          <IconTrash size={14} />
        </ActionIcon>
      )}
    </Group>
  );
}

function ProgramsEditor({ type }: { type: TrainingType }) {
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const programs = types.data?.find((t) => t.id === type.id)?.programs ?? type.programs;
  const deps = departments.data ?? [];
  return (
    <div>
      <Text size="sm" fw={500}>
        Katalog szkoleń stanowiskowych
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        Przy dodawaniu szkolenia wybierasz pozycję z katalogu – nazwa, wydział i standard czasu nauki wpiszą się same.
      </Text>
      <Stack gap="xs">
        {programs.map((p) => (
          <ProgramRow key={p.id} typeId={type.id} program={p} departments={deps} />
        ))}
        <ProgramRow typeId={type.id} program={null} departments={deps} />
      </Stack>
    </div>
  );
}

function InProgress() {
  const q = useQuery({ queryKey: ["trainings-in-progress"], queryFn: () => api<InProgressTraining[]>("/trainings/in-progress") });
  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Alert color="gray" icon={<IconCircleCheck />}>
        Nikt nie jest teraz w trakcie szkolenia stanowiskowego.
      </Alert>
    );
  return (
    <Card withBorder padding={0}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pracownik</Table.Th>
            <Table.Th>Szkolenie</Table.Th>
            <Table.Th ta="right">Postęp</Table.Th>
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
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.name ?? r.type_name}</Text>
                  <Text size="xs" c="dimmed">
                    {[`od ${formatDate(r.start_date)}`, r.exam_date ? `egzamin ${formatDate(r.exam_date)}` : null, r.department, r.mentor_name ? `opiekun: ${r.mentor_name}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Badge color={st.color} variant="light" size="sm">
                    {st.label}
                  </Badge>
                  {r.status !== "planned" && (
                    <Text size="xs" c={r.status === "overdue" ? "red" : "dimmed"}>
                      dzień {r.days}
                      {r.standard_days !== null ? ` z ${r.standard_days}` : ""}
                    </Text>
                  )}
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
}

function TypeModal({ editing, opened, onClose }: { editing: TrainingType | null; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<DocTemplate[]>("/templates"), enabled: opened });
  const [f, setF] = useState<TypeForm>({ name: "", kind: "general", validity_months: "", template_id: null, is_active: true });
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.data?.find((t) => String(t.id) === f.template_id);

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
          }
        : { name: "", kind: "general", validity_months: "", template_id: null, is_active: true },
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
          description="Opcjonalnie – przy szkoleniu pojawi się „Generuj dokument”. W szablonie użyj znaczników szkolenie_* (ściąga w edytorze szablonu)."
          clearable
          data={(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
          value={f.template_id}
          onChange={(v) => setF({ ...f, template_id: v })}
        />
        <Switch label="Aktywny (do wyboru przy dodawaniu szkolenia)" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.currentTarget.checked })} />
        <div>
          <Text size="sm" fw={500}>
            Pola formularza
          </Text>
          {selectedTemplate ? (
            <>
              <Text size="xs" c="dimmed" mb="xs">
                Pochodzą z szablonu „{selectedTemplate.name}” – zmieniasz je w edytorze szablonu (etykiety, typy, formaty,
                wymagane).{" "}
                <Anchor component={Link} to={`/szablony/${selectedTemplate.id}`} size="xs">
                  Otwórz edytor szablonu
                </Anchor>
              </Text>
              {selectedTemplate.fields.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Szablon używa tylko danych z kartoteki i szkolenia.
                </Text>
              ) : (
                <Group gap={6}>
                  {selectedTemplate.fields.map((x) => (
                    <Badge key={x.key} variant="light" color={x.required ? "blue" : "gray"}>
                      {x.label}
                      {x.required ? " *" : ""}
                    </Badge>
                  ))}
                </Group>
              )}
            </>
          ) : (
            <Text size="xs" c="dimmed">
              Wybierz szablon dokumentu – jego pola formularza pojawią się przy dodawaniu szkolenia.
            </Text>
          )}
        </div>
        {f.kind === "position" &&
          (editing ? (
            <ProgramsEditor type={editing} />
          ) : (
            <Text size="xs" c="dimmed">
              Katalog szkoleń stanowiskowych (nazwa, wydział, standard) uzupełnisz po zapisaniu rodzaju.
            </Text>
          ))}
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
                    t.kind === "position" ? `katalog: ${t.programs.length}` : null,
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
          <Tabs.Tab value="progress">W trakcie</Tabs.Tab>
          {staff && <Tabs.Tab value="types">Rodzaje szkoleń</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="expiring">
          <Expiring />
        </Tabs.Panel>
        <Tabs.Panel value="progress">
          <InProgress />
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
