import { ActionSheet, CompactEmpty, ListRow, Section, FormDialog, SectionHead, RowMenu } from "./Mobile";
import { useConfirm } from "../lib/confirm";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Button, Group,  MultiSelect, Popover, Stack, Text } from "@mantine/core";
import { Select } from "./AptSelect";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDotsVertical, IconPlus, IconTrash, IconUsers } from "@tabler/icons-react";

import { api, type Employee, type MentorProgram, type Page, type TrainingProgram, type TrainingType } from "../api";
import { useAuth } from "../auth";
import { useIsPhone } from "../lib/device";

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
  const mobile = useIsPhone();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mine = useQuery({
    queryKey: ["mentor-programs", employee.id],
    queryFn: () => api<MentorProgram[]>(`/employees/${employee.id}/mentor-programs`),
  });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<MentorProgram | null>(null);
  const confirm = useConfirm();

  const allPrograms = (types.data ?? []).flatMap((t) => t.programs.map((p) => ({ ...p, type_name: t.name })));
  const groups = (types.data ?? [])
    .filter((t) => t.programs.length)
    .map((t) => ({
      group: t.name,
      items: t.programs
        .filter((p) => p.is_active)
        .map((p) => ({ value: String(p.id), label: programLabel(p) })),
    }));

  const save = useMutation({
    mutationFn: (ids: number[]) =>
      api<MentorProgram[]>(`/employees/${employee.id}/mentor-programs`, { method: "PUT", body: { ids } }),
    onSuccess: (data) => {
      qc.setQueryData(["mentor-programs", employee.id], data);
      qc.invalidateQueries({ queryKey: ["training-types"] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      notifications.show({ color: "green", message: "Zapisano szkolenia, które pracownik może prowadzić." });
      setAddOpen(false);
      setAddId(null);
    },
  });

  const list = mine.data ?? [];
  // bez katalogu i bez przypisań sekcja nic nie wnosi
  if (!mine.data || (list.length === 0 && allPrograms.length === 0)) return null;
  if (list.length === 0 && !staff) return null;

  if (mobile) {
    const ids = list.map((p) => p.id);
    const addable = groups
      .map((g) => ({ group: g.group, items: g.items.filter((i) => !ids.includes(Number(i.value))) }))
      .filter((g) => g.items.length);
    return (
      <>
        <Section
          title="Może prowadzić szkolenia"
          action={staff && addable.length ? { label: "Dodaj", icon: <IconPlus size={16} />, onClick: () => setAddOpen(true) } : undefined}
        >
          {list.length === 0 ? (
            <CompactEmpty title="Brak" text="Nie jest opiekunem żadnego szkolenia stanowiskowego." />
          ) : (
            list.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                description={p.department ?? undefined}
                trailing={
                  staff ? (
                    <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Akcje: ${p.name}`} onClick={() => setSheet(p)}>
                      <IconDotsVertical size={20} />
                    </ActionIcon>
                  ) : undefined
                }
              />
            ))
          )}
        </Section>
        <ActionSheet
          opened={!!sheet}
          onClose={() => setSheet(null)}
          title={sheet ? programLabel(sheet) : ""}
          actions={
            sheet
              ? [{ label: "Usuń z listy", description: "Pracownik przestanie być opiekunem tego szkolenia.", icon: <IconTrash size={20} />, danger: true, onClick: () => save.mutate(ids.filter((x) => x !== sheet.id)) }]
              : []
          }
        />
        <FormDialog opened={addOpen} onClose={() => setAddOpen(false)} title="Może prowadzić szkolenie" primary={{ label: "Dodaj", onClick: () => addId && save.mutate([...ids, Number(addId)]), loading: save.isPending, disabled: !addId }}>
          <Stack>
            <Select label="Szkolenie stanowiskowe" placeholder="Wybierz z katalogu" searchable data={addable} value={addId} onChange={setAddId} size="md" />
          </Stack>
        </FormDialog>
      </>
    );
  }

  // komputer: lista w ramce z „⋯” (usuń z listy), dodawanie w okienku – jak przy badaniach
  const ids = list.map((p) => p.id);
  const addable = groups
    .map((g) => ({ group: g.group, items: g.items.filter((i) => !ids.includes(Number(i.value))) }))
    .filter((g) => g.items.length);
  return (
    <section className="ui-dsec">
      <SectionHead
        title="Może prowadzić szkolenia"
        action={staff && addable.length ? { label: "Dodaj szkolenie", onClick: () => setAddOpen(true) } : undefined}
      />
      {list.length === 0 ? (
        <Text c="dimmed" size="sm">
          Brak – pracownik nie jest opiekunem żadnego szkolenia stanowiskowego.
        </Text>
      ) : (
        <div className="ui-dlist">
          {list.map((p) => (
            <div key={p.id} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title">{p.name}</div>
                {p.department && <div className="ui-drow-meta">{p.department}</div>}
              </div>
              {staff && (
                <RowMenu
                  label={p.name}
                  items={[]}
                  danger={{
                    label: "Usuń z listy",
                    icon: <IconTrash size={16} />,
                    onClick: () =>
                      confirm({ title: "Usunąć z listy?", message: `Pracownik przestanie być opiekunem szkolenia „${p.name}”.`, confirmLabel: "Usuń", danger: true }).then(
                        (ok) => ok && save.mutate(ids.filter((x) => x !== p.id)),
                      ),
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <FormDialog
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        title="Może prowadzić szkolenie"
        primary={{ label: "Dodaj", onClick: () => addId && save.mutate([...ids, Number(addId)]), loading: save.isPending, disabled: !addId }}
      >
        <Stack>
          <Select label="Szkolenie stanowiskowe" placeholder="Wybierz z katalogu" searchable data={addable} value={addId} onChange={setAddId} />
        </Stack>
      </FormDialog>
    </section>
  );
}
