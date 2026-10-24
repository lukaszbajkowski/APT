import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  FileButton,
  Grid,
  Group,
  Loader,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconDownload,
  IconPlus,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";

import { api, errorText, type DocTemplate, type FieldType, type TemplateField } from "../api";
import { LANGUAGE_OPTIONS } from "./TemplatesPage";

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Tekst" },
  { value: "textarea", label: "Tekst wielowierszowy" },
  { value: "date", label: "Data" },
  { value: "select", label: "Lista wyboru" },
  { value: "checkbox", label: "Pole wyboru (tak/nie)" },
  { value: "number", label: "Liczba" },
];

function OptionsEditor({ field, onChange }: { field: TemplateField; onChange: (f: TemplateField) => void }) {
  const set = (i: number, key: "value" | "label", v: string) =>
    onChange({ ...field, options: field.options.map((o, j) => (j === i ? { ...o, [key]: v } : o)) });
  return (
    <Stack gap={4} mt={6}>
      {field.options.map((o, i) => (
        <Group key={i} gap={4} wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="wartość w szablonie"
            aria-label="Wartość w szablonie"
            value={o.value}
            onChange={(e) => set(i, "value", e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0 }}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          />
          <TextInput
            size="xs"
            placeholder="opis w formularzu"
            aria-label="Opis w formularzu"
            value={o.label}
            onChange={(e) => set(i, "label", e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label="Usuń opcję"
            onClick={() => onChange({ ...field, options: field.options.filter((_, j) => j !== i) })}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        size="compact-xs"
        variant="subtle"
        leftSection={<IconPlus size={12} />}
        w="fit-content"
        onClick={() => onChange({ ...field, options: [...field.options, { value: "", label: "" }] })}
      >
        Dodaj opcję
      </Button>
    </Stack>
  );
}

export function TemplateEditPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const template = useQuery({ queryKey: ["template", id], queryFn: () => api<DocTemplate>(`/templates/${id}`) });
  const builtins = useQuery({ queryKey: ["template-builtins"], queryFn: () => api<{ key: string; label: string }[]>("/templates/builtins") });

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("pl");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = template.data;
    if (t) {
      setFields(t.fields);
      setName(t.name);
      setDescription(t.description ?? "");
      setLanguage(t.language);
      setActive(t.is_active);
    }
  }, [template.data]);

  const refresh = (t: DocTemplate) => {
    qc.setQueryData(["template", id], t);
    qc.invalidateQueries({ queryKey: ["templates"] });
  };

  const save = useMutation({
    mutationFn: () =>
      api<DocTemplate>(`/templates/${id}`, {
        method: "PATCH",
        body: { name, description: description || null, language, is_active: active, fields },
      }),
    onSuccess: (t) => {
      refresh(t);
      setError(null);
      notifications.show({ color: "green", message: "Zapisano szablon." });
    },
    onError: (e) => setError(errorText(e)),
  });

  const replace = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append("file", file);
      return api<DocTemplate>(`/templates/${id}/file`, { method: "PUT", form: f });
    },
    onSuccess: (t) => {
      refresh(t);
      notifications.show({ color: "green", message: `Wgrano wersję ${t.version}. Ustawienia pól zostały zachowane.` });
    },
    onError: (e) => setError(errorText(e)),
  });

  if (template.isLoading) return <Loader />;
  if (!template.data) return <Alert color="red">Nie znaleziono szablonu.</Alert>;
  const t = template.data;
  const builtinLabel = (k: string) => builtins.data?.find((b) => b.key === k)?.label ?? k;

  const update = (i: number, f: TemplateField) => setFields((list) => list.map((x, j) => (j === i ? f : x)));
  const move = (i: number, d: number) =>
    setFields((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  return (
    <Stack maw={1200}>
      <Anchor component={Link} to="/szablony" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Szablony
        </Group>
      </Anchor>
      <Group justify="space-between">
        <div>
          <Title order={2}>{t.name}</Title>
          <Text size="sm" c="dimmed">
            Plik: {t.original_filename} · wersja {t.version}
          </Text>
        </div>
        <Group>
          <Button variant="default" component="a" href={`/api/templates/${t.id}/file`} leftSection={<IconDownload size={16} />}>
            Pobierz .docx
          </Button>
          <FileButton accept=".docx" onChange={(f) => f && replace.mutate(f)}>
            {(props) => (
              <Button {...props} variant="light" leftSection={<IconUpload size={16} />} loading={replace.isPending}>
                Wgraj nową wersję
              </Button>
            )}
          </FileButton>
        </Group>
      </Group>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card withBorder padding="lg">
              <Title order={4} mb="sm">
                Ustawienia
              </Title>
              <Stack>
                <Group grow>
                  <TextInput label="Nazwa" value={name} onChange={(e) => setName(e.currentTarget.value)} />
                  <Select label="Język" data={LANGUAGE_OPTIONS} allowDeselect={false} value={language} onChange={(v) => v && setLanguage(v)} />
                </Group>
                <Textarea label="Opis" autosize minRows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
                <Switch label="Aktywny (dostępny przy generowaniu)" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />
              </Stack>
            </Card>

            <Card withBorder padding="lg">
              <Title order={4}>Pola formularza</Title>
              <Text size="sm" c="dimmed" mb="sm">
                Znaczniki, których nie ma w kartotece – o nie aplikacja zapyta przed wygenerowaniem dokumentu.
              </Text>
              {fields.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Ten szablon używa tylko danych z kartoteki.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={680}>
                  <Table verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Znacznik</Table.Th>
                        <Table.Th miw={240}>Etykieta w formularzu</Table.Th>
                        <Table.Th w={190}>Typ</Table.Th>
                        <Table.Th w={70}>Wymag.</Table.Th>
                        <Table.Th w={64} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {fields.map((f, i) => (
                        <Table.Tr key={f.key} style={{ verticalAlign: "top" }}>
                          <Table.Td pt={14}>
                            <Code>{f.key}</Code>
                          </Table.Td>
                          <Table.Td>
                            <TextInput size="xs" value={f.label} onChange={(e) => update(i, { ...f, label: e.currentTarget.value })} />
                            {f.type === "select" && <OptionsEditor field={f} onChange={(nf) => update(i, nf)} />}
                          </Table.Td>
                          <Table.Td>
                            <Select
                              size="xs"
                              w={170}
                              data={TYPES}
                              allowDeselect={false}
                              value={f.type}
                              onChange={(v) => v && update(i, { ...f, type: v as FieldType })}
                            />
                          </Table.Td>
                          <Table.Td pt={12}>
                            <Switch
                              size="sm"
                              checked={f.required}
                              onChange={(e) => update(i, { ...f, required: e.currentTarget.checked })}
                              aria-label={`Wymagane: ${f.label}`}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Group gap={0} wrap="nowrap">
                              <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="W górę">
                                <IconArrowUp size={14} />
                              </ActionIcon>
                              <ActionIcon variant="subtle" color="gray" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="W dół">
                                <IconArrowDown size={14} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>

            <Group justify="flex-end">
              <Button leftSection={<IconCheck size={16} />} onClick={() => save.mutate()} loading={save.isPending}>
                Zapisz szablon
              </Button>
            </Group>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Card withBorder padding="lg">
              <Title order={5} mb="xs">
                Dane z kartoteki w tym szablonie
              </Title>
              {t.builtins.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Brak.
                </Text>
              ) : (
                <Stack gap={4}>
                  {t.builtins.map((b) => (
                    <Group key={b} gap={6}>
                      <Code>{b}</Code>
                      <Text size="sm">{builtinLabel(b)}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
              {t.sensitive && (
                <Badge color="orange" variant="light" mt="sm">
                  Zawiera PESEL / datę urodzenia – niedostępny dla kierowników
                </Badge>
              )}
            </Card>

            <Card withBorder padding="lg">
              <Title order={5} mb={4}>
                Ściąga znaczników
              </Title>
              <Text size="xs" c="dimmed" mb="xs">
                Wpisz w Wordzie, np. <Code>{"{{ nazwisko_imie }}"}</Code>. Kliknij, aby skopiować.
              </Text>
              <Stack gap={2}>
                {builtins.data?.map((b) => (
                  <CopyButton key={b.key} value={`{{ ${b.key} }}`}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? "Skopiowano" : "Kopiuj"} position="left" withArrow>
                        <Group gap={6} wrap="nowrap" style={{ cursor: "pointer" }} onClick={copy}>
                          <IconCopy size={12} color="var(--mantine-color-gray-6)" />
                          <Code>{`{{ ${b.key} }}`}</Code>
                          <Text size="xs" c="dimmed" truncate>
                            {b.label}
                          </Text>
                        </Group>
                      </Tooltip>
                    )}
                  </CopyButton>
                ))}
              </Stack>
              <Text size="xs" c="dimmed" mt="sm">
                Pole wyboru: <Code>{"{{ '☒' if wariant == 'rodzinny' else '☐' }}"}</Code> – opcje listy wyboru
                aplikacja odczyta sama. Wyłącz w Wordzie autokorektę cudzysłowów („ ” zamiast ').
              </Text>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
