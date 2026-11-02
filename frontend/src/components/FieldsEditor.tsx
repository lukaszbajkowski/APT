import { ActionIcon, Button, Code, Group, Paper, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import { Select } from "./AptSelect";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";

import { type FieldType, type TemplateField } from "../api";
import { useFieldFormats } from "./DocumentsCard";
import { EmptyState } from "./States";
import { useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { IconDots } from "@tabler/icons-react";
import { UnstyledButton } from "@mantine/core";
import { ActionSheet, ListRow } from "./Mobile";
import { useConfirm } from "../lib/confirm";

const useMobile = () => useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });

/* telefon: opcje listy jedna pod drugą – tekst na liście i wartość w szablonie na pełną szerokość */
function OptionsMobile({ field, onChange }: { field: TemplateField; onChange: (f: TemplateField) => void }) {
  const set = (i: number, key: "value" | "label", v: string) =>
    onChange({ ...field, options: field.options.map((o, j) => (j === i ? { ...o, [key]: v } : o)) });
  return (
    <div className="ui-form-group">
      <h3 className="ui-section-title">Opcje listy · {field.options.length}</h3>
      {field.options.map((o, i) => (
        <div key={i} className="ui-opt-card">
          <div className="ui-opt-card-head">
            <span className="ui-row-title">Opcja {i + 1}</span>
            <Button variant="subtle" color="red" size="sm" onClick={() => onChange({ ...field, options: field.options.filter((_, j) => j !== i) })}>
              Usuń
            </Button>
          </div>
          <TextInput size="md" label="Tekst na liście" placeholder="np. przystąpienie" value={o.label} onChange={(e) => set(i, "label", e.currentTarget.value)} />
          <TextInput
            size="md"
            label="Wartość w szablonie"
            description="Trafia do dokumentu w miejsce znacznika"
            placeholder="np. przystapienie"
            value={o.value}
            onChange={(e) => set(i, "value", e.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          />
        </div>
      ))}
      <Button variant="default" size="md" leftSection={<IconPlus size={18} />} onClick={() => onChange({ ...field, options: [...field.options, { value: "", label: "" }] })}>
        Dodaj opcję
      </Button>
    </div>
  );
}

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Tekst" },
  { value: "textarea", label: "Tekst wielowierszowy" },
  { value: "date", label: "Data" },
  { value: "select", label: "Lista wyboru" },
  { value: "checkbox", label: "Pole wyboru (tak/nie)" },
  { value: "number", label: "Liczba" },
];

export function OptionsEditor({ field, onChange }: { field: TemplateField; onChange: (f: TemplateField) => void }) {
  const mobile = useMobile();
  if (mobile) return <OptionsMobile field={field} onChange={onChange} />;
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

  const mobile = useMobile();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<number | null>(null);
  const formatData = [...(fieldFormats.data ?? []).map((p) => ({ value: p.value, label: p.label })), { value: "custom", label: "Własna maska…" }];

  if (mobile) {
    const m = menu !== null ? fields[menu] : null;
    return (
      <Stack gap={24}>
        {fields.map((f, i) => (
          <section key={editableKeys ? i : f.key} className="ui-form-group">
            <div className="ui-group">
              <ListRow
                title={f.label || "Bez etykiety"}
                description={<span className="ui-mono">{`{{${f.key}}}`}</span>}
                trailing={
                  <UnstyledButton className="ui-chat-btn" aria-label={`Akcje pola: ${f.label}`} onClick={() => setMenu(i)}>
                    <IconDots size={20} stroke={2.4} />
                  </UnstyledButton>
                }
              />
              <div className="ui-field-body">
                {editableKeys && (
                  <TextInput
                    size="md"
                    label="Klucz pola"
                    description="Litery, cyfry i podkreślnik – tak jak w znaczniku"
                    value={f.key}
                    onChange={(e) => update(i, { ...f, key: e.currentTarget.value.replace(/[^A-Za-z0-9_]/g, "_") })}
                    styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                  />
                )}
                <TextInput size="md" label="Etykieta w formularzu" value={f.label} onChange={(e) => update(i, { ...f, label: e.currentTarget.value })} />
                <Select
                  size="md"
                  label="Typ"
                  data={TYPES}
                  allowDeselect={false}
                  value={f.type}
                  onChange={(v) => v && update(i, { ...f, type: v as FieldType, ...(v !== "text" ? { format: null, pattern: null } : {}) })}
                />
                {f.type === "text" && (
                  <Select size="md" label="Format" placeholder="Bez formatu" clearable data={formatData} value={f.format ?? null} onChange={(v) => update(i, { ...f, format: v, pattern: v === "custom" ? f.pattern ?? "" : null })} />
                )}
                {f.type === "text" && f.format === "custom" && (
                  <TextInput
                    size="md"
                    label="Maska"
                    placeholder="np. 99-999"
                    description="9 = cyfra, A = litera, * = dowolny znak"
                    value={f.pattern ?? ""}
                    onChange={(e) => update(i, { ...f, pattern: e.currentTarget.value })}
                    styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                  />
                )}
              </div>
              <ListRow
                title="Wymagane"
                description="Bez tego pola dokument się nie wygeneruje"
                trailing={<Switch size="md" checked={f.required} onChange={(e) => update(i, { ...f, required: e.currentTarget.checked })} aria-label={`Wymagane: ${f.label}`} />}
              />
              <ListRow
                title="Zwinięte"
                muted={f.required}
                description={f.required ? "Pola wymagane są zawsze widoczne" : "Schowane pod „Więcej pól” przy generowaniu"}
                trailing={<Switch size="md" disabled={f.required} checked={!!f.collapsed && !f.required} onChange={(e) => update(i, { ...f, collapsed: e.currentTarget.checked })} aria-label={`Zwinięte przy generowaniu: ${f.label}`} />}
              />
            </div>
            {f.type === "select" && <OptionsMobile field={f} onChange={(nf) => update(i, nf)} />}
          </section>
        ))}
        {editableKeys && (
          <Button variant="default" size="md" leftSection={<IconPlus size={18} />} onClick={add}>
            Dodaj pole
          </Button>
        )}
        {fields.length === 0 && !editableKeys && <EmptyState compact title="Brak pól" text="Szablon nie ma znaczników do uzupełnienia." />}
        <ActionSheet
          opened={m !== null}
          onClose={() => setMenu(null)}
          title={m?.label ?? ""}
          subtitle={m ? `{{${m.key}}}` : undefined}
          actions={
            menu === null
              ? []
              : [
                  { label: "Przesuń w górę", icon: <IconArrowUp size={20} />, disabled: menu === 0, onClick: () => move(menu, -1) },
                  { label: "Przesuń w dół", icon: <IconArrowDown size={20} />, disabled: menu === fields.length - 1, onClick: () => move(menu, 1) },
                  ...(editableKeys
                    ? [{ label: "Usuń pole", icon: <IconTrash size={20} />, danger: true, onClick: () => { const i = menu; confirm({ title: "Usunąć pole?", message: `Pole „${fields[i].label}” zniknie z formularza.`, confirmLabel: "Usuń", danger: true }).then((ok) => ok && remove(i)); } }]
                    : []),
                ]
          }
        />
      </Stack>
    );
  }

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
                <Switch
                  size="sm"
                  label="Zwinięte"
                  disabled={f.required}
                  checked={!!f.collapsed && !f.required}
                  onChange={(e) => update(i, { ...f, collapsed: e.currentTarget.checked })}
                  aria-label={`Zwinięte przy generowaniu: ${f.label}`}
                  title="Przy generowaniu pole będzie schowane pod „Więcej pól”. Pola wymagane są zawsze widoczne."
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
        <EmptyState compact title="Brak pól"
          text="Dodaj pole, aby zacząć." />
      )}
    </Stack>
  );
}
