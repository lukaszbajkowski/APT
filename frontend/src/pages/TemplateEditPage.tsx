import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Card, Code, CopyButton, FileButton, Grid, Group, SegmentedControl, Stack, Switch, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconUpload,
} from "@tabler/icons-react";

import { FieldsEditor } from "../components/FieldsEditor";
import { api, DOWNLOAD_FORMAT_LABELS, errorText, type DocTemplate, type DownloadFormats, type TemplateField, withAcct } from "../api";
import { LANGUAGE_OPTIONS } from "./TemplatesPage";
import { Loading } from "../components/States";
import { useMediaQuery } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { FormScreen, ListRow, Section, StatusBadge } from "../components/Mobile";

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
  const [allowManager, setAllowManager] = useState(true);
  const [strictPdf, setStrictPdf] = useState(false);
  const [formats, setFormats] = useState<DownloadFormats>("both");
  const [error, setError] = useState<string | null>(null);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const navigate = useNavigate();

  useEffect(() => {
    const t = template.data;
    if (t) {
      setFields(t.fields);
      setName(t.name);
      setDescription(t.description ?? "");
      setLanguage(t.language);
      setActive(t.is_active);
      setAllowManager(t.allow_manager);
      setStrictPdf(t.strict_pdf);
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
        body: { name, description: description || null, language, is_active: active, allow_manager: allowManager, strict_pdf: strictPdf, download_formats: formats, fields },
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

  if (template.isLoading) return <Loading />;
  if (!template.data) return <Alert color="red">Nie znaleziono szablonu.</Alert>;
  const t = template.data;
  const builtinLabel = (k: string) => builtins.data?.find((b) => b.key === k)?.label ?? k;

  if (mobile) {
    const sw = (label: string, description: string | undefined, checked: boolean, on: (v: boolean) => void) => (
      <ListRow title={label} description={description} trailing={<Switch size="md" checked={checked} onChange={(e) => on(e.currentTarget.checked)} aria-label={label} />} />
    );
    const copy = (text: string) =>
      navigator.clipboard?.writeText(text).then(
        () => notifications.show({ message: `Skopiowano ${text}` }),
        () => notifications.show({ color: "red", message: "Nie udało się skopiować." }),
      );
    return (
      <FormScreen
        title="Szablon"
        subtitle={t.name}
        onClose={() => navigate("/szablony")}
        primary={{ label: "Zapisz szablon", onClick: () => save.mutate(), loading: save.isPending, disabled: !name.trim() }}
      >
        {error && (
          <Alert color="red" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <Section title="Plik">
          <ListRow title={t.original_filename} description={`Wersja ${t.version}`} trailing={t.sensitive ? <StatusBadge tone="warn">PESEL</StatusBadge> : undefined} />
          <ListRow leading={<span className="ui-row-icon" aria-hidden><IconDownload size={20} /></span>} title="Pobierz .docx" onClick={() => window.location.assign(withAcct(`/api/templates/${t.id}/file`))} />
          <FileButton accept=".docx" onChange={(f) => f && replace.mutate(f)}>
            {(props) => (
              <ListRow
                leading={<span className="ui-row-icon" aria-hidden><IconUpload size={20} /></span>}
                title={replace.isPending ? "Wgrywanie…" : "Wgraj nową wersję"}
                description="Ustawienia pól zostaną zachowane"
                onClick={props.onClick}
              />
            )}
          </FileButton>
        </Section>

        <div className="ui-form-group">
          <h2 className="ui-section-title">Ustawienia</h2>
          <TextInput size="md" label="Nazwa" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Select size="md" label="Język" data={LANGUAGE_OPTIONS} allowDeselect={false} value={language} onChange={(v) => v && setLanguage(v)} />
          <Textarea size="md" label="Opis" autosize minRows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          <div className="ui-form-field">
            <span className="ui-form-label">Pobieranie</span>
            <div className="ui-seg2" role="radiogroup" aria-label="Pobieranie" style={{ gridTemplateColumns: `repeat(${Object.keys(DOWNLOAD_FORMAT_LABELS).length}, minmax(0, 1fr))` }}>
              {(Object.keys(DOWNLOAD_FORMAT_LABELS) as DownloadFormats[]).map((v) => (
                <UnstyledButton key={v} role="radio" aria-checked={formats === v} data-on={formats === v || undefined} onClick={() => setFormats(v)}>
                  {DOWNLOAD_FORMAT_LABELS[v]}
                </UnstyledButton>
              ))}
            </div>
            <Text size="sm" c="dimmed" mt={6}>Podgląd online (PDF) jest dostępny zawsze.</Text>
          </div>
        </div>
        <div className="ui-group">
          {sw("Aktywny", "Dostępny przy generowaniu dokumentów", active, setActive)}
          {sw("Dostępny dla kierownika", t.sensitive ? "Pola PESEL i data urodzenia zostaną puste" : undefined, allowManager, setAllowManager)}
          {sw("Ścisła kontrola podpisu", "Podpisany plik musi zawierać pobrany dokument bez zmian", strictPdf, setStrictPdf)}
        </div>

        <div className="ui-form-group">
          <h2 className="ui-section-title">Pola formularza · {fields.length}</h2>
          <Text size="sm" c="dimmed">O te dane aplikacja zapyta przed wygenerowaniem dokumentu.</Text>
          {fields.length === 0 ? <Text size="sm">Ten szablon używa tylko danych z kartoteki.</Text> : <FieldsEditor fields={fields} onChange={setFields} />}
        </div>

        <Section title={`Dane z kartoteki · ${t.builtins.length}`}>
          {t.builtins.length === 0 ? (
            <ListRow title="Brak" description="Szablon nie używa danych z kartoteki." />
          ) : (
            t.builtins.map((b) => <ListRow key={b} title={builtinLabel(b)} description={<span className="ui-mono">{`{{ ${b} }}`}</span>} />)
          )}
        </Section>

        <Section title="Ściąga znaczników – dotknij, aby skopiować">
          {builtins.data?.map((b) => (
            <ListRow key={b.key} title={b.label} description={<span className="ui-mono">{`{{ ${b.key} }}`}</span>} trailing={<IconCopy size={18} color="var(--mantine-color-dimmed)" aria-hidden />} onClick={() => copy(`{{ ${b.key} }}`)} />
          ))}
        </Section>
      </FormScreen>
    );
  }


  return (
    <Stack maw={1200}>
      <Anchor component={Link} to="/szablony" size="sm" visibleFrom="sm">
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
          <Button variant="default" component="a" href={withAcct(`/api/templates/${t.id}/file`)} leftSection={<IconDownload size={16} />}>
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
                <Switch
                  label="Ścisła kontrola podpisanego pliku (podpis zaufany i kwalifikowany)"
                  description="Wgrany plik musi zawierać pobrany dokument bez zmian, z podpisem dopisanym na końcu. Pliki zapisane ponownie w innym programie będą odrzucane. Włączaj tylko dla dokumentów, które tego wymagają."
                  checked={strictPdf}
                  onChange={(e) => setStrictPdf(e.currentTarget.checked)}
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
                <FieldsEditor fields={fields} onChange={setFields} />
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
                          <IconCopy size={12} color="var(--mantine-color-dimmed)" />
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
