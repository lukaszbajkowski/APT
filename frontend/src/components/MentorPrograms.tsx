import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Group, MultiSelect, Popover, Stack, Text, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconUsers } from "@tabler/icons-react";

import { api, errorText, type Employee, type MentorProgram, type Page, type TrainingProgram, type TrainingType } from "../api";
import { useAuth } from "../auth";

const programLabel = (p: { name: string; department: string | null }) => (p.department ? `${p.name} · ${p.department}` : p.name);

/** Przycisk przy pozycji katalogu: kto może prowadzić to szkolenie. */
export function ProgramMentorsButton({ program }: { program: TrainingProgram }) {
  const qc = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [known, setKnown] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 250);
  const res = useQuery({
    queryKey: ["mentor-search", q],
    queryFn: () => api<Page<Employee>>(`/employees?limit=20&q=${encodeURIComponent(q)}`),
    enabled: opened,
  });
  const data = useMemo(() => {
    const map: Record<string, string> = { ...known };
    for (const e of res.data?.items ?? []) map[String(e.id)] = `${e.last_name} ${e.first_name}`;
    return Object.entries(map).map(([value, label]) => ({ value, label }));
  }, [res.data, known]);

  const save = useMutation({
    mutationFn: () => api(`/training-programs/${program.id}/mentors`, { method: "PUT", body: { ids: selected.map(Number) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      qc.invalidateQueries({ queryKey: ["mentor-programs"] });
      notifications.show({ color: "green", message: `Zapisano opiekunów: ${program.name}.` });
      setOpened(false);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const open = () => {
    setSelected(program.mentors.map((m) => String(m.id)));
    setKnown(Object.fromEntries(program.mentors.map((m) => [String(m.id), m.name])));
    setSearch("");
    setOpened(true);
  };

  return (
    <Popover opened={opened} onChange={setOpened} width={340} position="bottom-end" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconUsers size={14} />}
          onClick={() => (opened ? setOpened(false) : open())}
          aria-label={`Opiekunowie: ${program.name}`}
          style={{ flexShrink: 0 }}
        >
          {program.mentors.length}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Kto może prowadzić „{program.name}”
          </Text>
          <MultiSelect
            placeholder="Szukaj pracownika"
            searchable
            clearable
            data={data}
            value={selected}
            onChange={(v) => {
              setKnown((k) => ({ ...k, ...Object.fromEntries(data.filter((d) => v.includes(d.value)).map((d) => [d.value, d.label])) }));
              setSelected(v);
            }}
            searchValue={search}
            onSearchChange={setSearch}
            filter={({ options }) => options}
            nothingFoundMessage={res.isFetching ? "Szukam…" : "Brak wyników"}
            comboboxProps={{ withinPortal: false }}
          />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Anuluj
            </Button>
            <Button size="xs" onClick={() => save.mutate()} loading={save.isPending}>
              Zapisz
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Sekcja w kartotece: jakie szkolenia stanowiskowe pracownik może prowadzić. */
export function MentorProgramsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mine = useQuery({
    queryKey: ["mentor-programs", employee.id],
    queryFn: () => api<MentorProgram[]>(`/employees/${employee.id}/mentor-programs`),
  });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const allPrograms = (types.data ?? []).flatMap((t) => t.programs.map((p) => ({ ...p, type_name: t.name })));
  const groups = (types.data ?? [])
    .filter((t) => t.programs.length)
    .map((t) => ({
      group: t.name,
      items: t.programs
        .filter((p) => p.is_active || selected.includes(String(p.id)))
        .map((p) => ({ value: String(p.id), label: programLabel(p) })),
    }));

  const save = useMutation({
    mutationFn: () =>
      api<MentorProgram[]>(`/employees/${employee.id}/mentor-programs`, { method: "PUT", body: { ids: selected.map(Number) } }),
    onSuccess: (data) => {
      qc.setQueryData(["mentor-programs", employee.id], data);
      qc.invalidateQueries({ queryKey: ["training-types"] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      notifications.show({ color: "green", message: "Zapisano szkolenia, które pracownik może prowadzić." });
      setEditing(false);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const list = mine.data ?? [];
  // bez katalogu i bez przypisań sekcja nic nie wnosi
  if (!mine.data || (list.length === 0 && allPrograms.length === 0)) return null;
  if (list.length === 0 && !staff) return null;

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Może prowadzić szkolenia</Title>
        {staff && !editing && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPencil size={14} />}
            onClick={() => {
              setSelected(list.map((p) => String(p.id)));
              setEditing(true);
            }}
          >
            Zmień
          </Button>
        )}
      </Group>
      {editing ? (
        <Stack gap="xs">
          <MultiSelect
            aria-label="Szkolenia, które może prowadzić"
            placeholder="Wybierz szkolenia z katalogu"
            searchable
            clearable
            data={groups}
            value={selected}
            onChange={setSelected}
          />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setEditing(false)}>
              Anuluj
            </Button>
            <Button size="xs" onClick={() => save.mutate()} loading={save.isPending}>
              Zapisz
            </Button>
          </Group>
        </Stack>
      ) : list.length === 0 ? (
        <Text c="dimmed" size="sm">
          Brak – pracownik nie jest opiekunem żadnego szkolenia stanowiskowego.
        </Text>
      ) : (
        <Group gap={6}>
          {list.map((p) => (
            <Badge key={p.id} variant="light" size="lg" radius="sm" style={{ textTransform: "none", fontWeight: 500 }}>
              {programLabel(p)}
            </Badge>
          ))}
        </Group>
      )}
    </Card>
  );
}
