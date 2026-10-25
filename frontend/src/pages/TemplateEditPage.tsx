import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Card,
  Code,
  CopyButton,
  FileButton,
  Grid,
  Group,
  Loader,
  SegmentedControl,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
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

import { useFieldFormats } from "../components/DocumentsCard";
import { api, DOWNLOAD_FORMAT_LABELS, errorText, type DocTemplate, type DownloadFormats, type FieldType, type TemplateField } from "../api";
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

export function TemplateEditPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const template = useQuery({ queryKey: ["template", id], queryFn: () => api<DocTemplate>(`/templates/${id}`) });
  const fieldFormats = useFieldFormats();
  const builtins = useQuery({ queryKey: ["template-builtins"], queryFn: () => api<{ key: string; label: string }[]>("/templates/builtins") });

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("pl");
  const [active, setActive] = useState(true);
  const [allowManager, setAllowManager] = useState(true);
  const [formats, setFormats] = useState<DownloadFormats>("both");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = template.data;
    if (t) {
      setFields(t.fields);
      setName(t.name);
      setDescription(t.description ?? "");
      setLanguage(t.language);
      setActive(t.is_active);
      setAllowManager(t.allow_manager);
      setFormats(t.download_formats);
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
        body: { name, description: description || null, language, is_active: active, allow_manager: allowManager, download_formats: formats, fields },
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
                <Switch
                  label={t.sensitive ? "Dostępny dla kierownika (bez PESEL i daty urodzenia)" : "Dostępny dla kierownika"}
                  description={
                    t.sensitive
                      ? "Kierownik wygeneruje dokument, ale pola PESEL i data urodzenia zostaną w nim puste."
                      : undefined
                  }
                  checked={allowManager}
                  onChange={(e) => setAllowManager(e.currentTarget.checked)}
                />
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Pobieranie
                  </Text>
                  <SegmentedControl
                    value={formats}
                    onChange={(v) => setFormats(v as DownloadFormats)}
                    data={(Object.keys(DOWNLOAD_FORMAT_LABELS) as DownloadFormats[]).map((value) => ({
                      value,
                      label: DOWNLOAD_FORMAT_LABELS[value],
                    }))}
                  />
                  <Text size="xs" c="dimmed" mt={4}>
                    Podgląd online (PDF) jest dostępny zawsze.
                  </Text>
                </div>
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
                <Stack gap="xs">
                  {fields.map((f, i) => (
                    <Paper key={f.key} withBorder p="sm" radius="md">
                      <Group justify="space-between" wrap="nowrap" mb={8}>
                        <Code>{f.key}</Code>
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
                <Text size="xs" c="orange" mt="sm">
                  Zawiera PESEL / datę urodzenia. Kierownik ich nie zobaczy – dokumenty z tymi danymi może tylko
                  wygenerować bez nich (jeśli szablon jest dla niego dostępny).
                </Text>
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
