import { ActionIcon, Button, Code, Group, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";

import { type FieldType, type TemplateField } from "../api";
import { useFieldFormats } from "./DocumentsCard";

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Tekst" },
  { value: "textarea", label: "Tekst wielowierszowy" },
  { value: "date", label: "Data" },
  { value: "select", label: "Lista wyboru" },
  { value: "checkbox", label: "Pole wyboru (tak/nie)" },
  { value: "number", label: "Liczba" },
];

export function OptionsEditor({ field, onChange }: { field: TemplateField; onChange: (f: TemplateField) => void }) {
  const set = (i: number, key: "value" | "label", v: string) =>
    onChange({ ...field, options: field.options.map((o, j) => (j === i ? { ...o, [key]: v } : o)) });
  return (
    <Stack gap="xs" mt="sm">
      <SimpleGrid cols={2} spacing="xs">
        <Text size="xs" fw={500}>
          Wartość w szablonie
        </Text>
        <Text size="xs" fw={500}>
          Tekst na liście w formularzu
        </Text>
      </SimpleGrid>
      {field.options.map((o, i) => (
        <SimpleGrid key={i} cols={2} spacing="xs">
          <TextInput
            size="xs"
            placeholder="np. przystapienie"
            aria-label="Wartość w szablonie"
            value={o.value}
            onChange={(e) => set(i, "value", e.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          />
          <TextInput
            size="xs"
            placeholder="np. przystąpienie"
            aria-label="Tekst na liście w formularzu"
            value={o.label}
            onChange={(e) => set(i, "label", e.currentTarget.value)}
            rightSection={
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                aria-label="Usuń opcję"
                onClick={() => onChange({ ...field, options: field.options.filter((_, j) => j !== i) })}
              >
                <IconTrash size={14} />
              </ActionIcon>
            }
          />
        </SimpleGrid>
      ))}
      <Button
        size="compact-sm"
        variant="light"
        leftSection={<IconPlus size={14} />}
        w="fit-content"
        onClick={() => onChange({ ...field, options: [...field.options, { value: "", label: "" }] })}
      >
        Dodaj opcję
      </Button>
    </Stack>
  );
}

/** Edytor pól formularza (szablony dokumentów, rodzaje szkoleń). */
export function FieldsEditor({
  fields,
  onChange,
  editableKeys = false,
}: {
  fields: TemplateField[];
  onChange: (f: TemplateField[]) => void;
  editableKeys?: boolean;
}) {
  const fieldFormats = useFieldFormats();
  const update = (i: number, f: TemplateField) => onChange(fields.map((x, j) => (j === i ? f : x)));
  const remove = (i: number) => onChange(fields.filter((_, j) => j !== i));
  const move = (i: number, d: number) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([
      ...fields,
      { key: `pole_${fields.length + 1}`, label: "Nowe pole", type: "text", required: false, options: [], help: null },
    ]);

  return (
    <Stack gap="xs">
      <Stack gap="xs">
        {fields.map((f, i) => (
          <Paper key={editableKeys ? i : f.key} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap" mb={8}>
              {editableKeys ? (
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <ActionIcon variant="subtle" color="red" onClick={() => remove(i)} aria-label="Usuń pole">
                  <IconTrash size={14} />
                </ActionIcon>
                <TextInput
                  size="xs"
                  aria-label="Klucz pola"
                  placeholder="klucz_pola"
                  value={f.key}
                  onChange={(e) => update(i, { ...f, key: e.currentTarget.value.replace(/[^A-Za-z0-9_]/g, "_") })}
                  styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                />
              </Group>
            ) : (
              <Code>{f.key}</Code>
            )}
              <Group gap="md" wrap="nowrap">
                <Switch
                  size="sm"
                  label="Wymagane"
                  checked={f.required}
                  onChange={(e) => update(i, { ...f, required: e.currentTarget.checked })}
                  aria-label={`Wymagane: ${f.label}`}
                />
                <Group gap={0} wrap="nowrap">
                  <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="W górę">
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="W dół"
                  >
                    <IconArrowDown size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
              <TextInput
                size="xs"
                label="Etykieta w formularzu"
                value={f.label}
                onChange={(e) => update(i, { ...f, label: e.currentTarget.value })}
              />
              <Select
                size="xs"
                label="Typ"
                data={TYPES}
                allowDeselect={false}
                value={f.type}
                onChange={(v) =>
                  v && update(i, { ...f, type: v as FieldType, ...(v !== "text" ? { format: null, pattern: null } : {}) })
                }
              />
              {f.type === "text" && (
                <Select
                  size="xs"
                  label="Format"
                  aria-label={`Format: ${f.label}`}
                  placeholder="bez formatu"
                  clearable
                  data={[
                    ...(fieldFormats.data ?? []).map((p) => ({ value: p.value, label: p.label })),
                    { value: "custom", label: "Własna maska…" },
                  ]}
                  value={f.format ?? null}
                  onChange={(v) => update(i, { ...f, format: v, pattern: v === "custom" ? f.pattern ?? "" : null })}
                />
              )}
              {f.type === "text" && f.format === "custom" && (
                <TextInput
                  size="xs"
                  label="Maska"
                  aria-label={`Maska: ${f.label}`}
                  placeholder="np. 99-999"
                  description="9 = cyfra, A = litera, * = dowolny znak"
                  value={f.pattern ?? ""}
                  onChange={(e) => update(i, { ...f, pattern: e.currentTarget.value })}
                  styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                />
              )}
            </SimpleGrid>
            {f.type === "select" && <OptionsEditor field={f} onChange={(nf) => update(i, nf)} />}
          </Paper>
        ))}
      </Stack>
      {editableKeys && (
        <Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} />} w="fit-content" onClick={add}>
          Dodaj pole
        </Button>
      )}
      {fields.length === 0 && !editableKeys && (
        <Text c="dimmed" size="sm">
          Brak pól.
        </Text>
      )}
    </Stack>
  );
}
