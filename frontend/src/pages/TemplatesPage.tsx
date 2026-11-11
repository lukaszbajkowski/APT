import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, FileInput, Paper, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { IconFileTypeDocx, IconPlus, IconUpload } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";

import { api, DOWNLOAD_FORMAT_LABELS, errorText, formatDate, LANGUAGES, type DocTemplate } from "../api";
import { ErrorState, Loading, RowsSkeleton } from "../components/States";
import { CompactEmpty, ListRow, PageHead, StatusBadge, FormDialog, PageTitle } from "../components/Mobile";

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }));

export function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ["templates", "all"], queryFn: () => api<DocTemplate[]>("/templates") });
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pl");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("file", file!);
      f.append("name", name);
      f.append("language", language);
      if (description.trim()) f.append("description", description);
      return api<DocTemplate>("/templates", { method: "POST", form: f });
    },
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setOpen(false);
      navigate(`/szablony/${t.id}`);
    },
    onError: (e) => setError(errorText(e)),
  });

  const openNew = () => {
    setName("");
    setDescription("");
    setFile(null);
    setLanguage("pl");
    setError(null);
    setOpen(true);
  };

  return (
    <Stack>
      {mobile && <PageHead title="Szablony" subtitle="Dokumenty Word ze znacznikami" action={{ label: "Dodaj szablon", icon: <IconPlus size={22} />, onClick: openNew }} />}
      {!mobile && (
          <PageTitle
            title="Szablony dokumentów"
            meta={templates.data ? `${templates.data.length} ${templates.data.length === 1 ? "szablon" : templates.data.length < 5 ? "szablony" : "szablonów"}` : undefined}
            description={
              <>
                Dokumenty Word (.docx) ze znacznikami {"{{ … }}"}. Dane z kartoteki wstawiają się same, o resztę
                aplikacja zapyta przy generowaniu.
              </>
            }
          actions={
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setName("");
                setDescription("");
                setFile(null);
                setLanguage("pl");
                setError(null);
                setOpen(true);
              }}
            >
              Dodaj szablon
            </Button>
          }
        />
      )}

      {mobile && templates.isLoading && <Loading />}
      {templates.error && <ErrorState error={templates.error} onRetry={() => templates.refetch()} />}
      {mobile && templates.data && templates.data.length === 0 && (
        <div className="ui-group">
          <CompactEmpty title="Brak szablonów" text="Dodaj pierwszy plik Word ze znacznikami {{ … }}." action={{ label: "Dodaj szablon", onClick: openNew }} />
        </div>
      )}
      {mobile && templates.data && templates.data.length > 0 && (
        <div className="ui-group">
          {templates.data.map((t) => (
            <ListRow
              key={t.id}
              to={`/szablony/${t.id}`}
              muted={!t.is_active}
              leading={<IconFileTypeDocx size={26} color="var(--mantine-primary-color-filled)" aria-hidden />}
              title={t.name}
              description={`${LANGUAGES[t.language] ?? t.language} · wersja ${t.version} · pól: ${t.fields.length}`}
              trailing={!t.is_active ? <StatusBadge tone="neutral">Wyłączony</StatusBadge> : undefined}
            />
          ))}
        </div>
      )}
      {!mobile && templates.isLoading && <RowsSkeleton rows={3} />}
      {!mobile && templates.data && templates.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak szablonów. Dodaj pierwszy plik Word ze znacznikami {"{{ … }}"}.
        </Text>
      )}
      {!mobile && templates.data && templates.data.length > 0 && (
        // tabela jak lista pracowników: nazwa, język, wersja i jedna najważniejsza cecha; klik w wiersz otwiera szablon
        <Paper withBorder radius="md" className="ui-cases">
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md" className="ui-tpl-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Szablon</Table.Th>
                <Table.Th>Język</Table.Th>
                <Table.Th>Wersja</Table.Th>
                <Table.Th>Uwagi</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {templates.data.map((t) => (
                <Table.Tr key={t.id} className="ui-row-link" data-muted={!t.is_active || undefined} onClick={() => navigate(`/szablony/${t.id}`)}>
                  <Table.Td>
                    <Link to={`/szablony/${t.id}`} className="ui-case-link" onClick={(e) => e.stopPropagation()}>
                      {t.name}
                    </Link>
                    <Text size="xs" c="dimmed">
                      {t.fields.length === 1 ? "1 pole" : t.fields.length > 1 && t.fields.length < 5 ? `${t.fields.length} pola` : `${t.fields.length} pól`} · pobieranie: {DOWNLOAD_FORMAT_LABELS[t.download_formats]}
                    </Text>
                  </Table.Td>
                  <Table.Td>{LANGUAGES[t.language] ?? t.language}</Table.Td>
                  <Table.Td>
                    {t.version} <Text span size="xs" c="dimmed">· {formatDate(t.updated_at.slice(0, 10))}</Text>
                  </Table.Td>
                  <Table.Td>
                    {!t.is_active ? (
                      <StatusBadge tone="neutral">Wyłączony</StatusBadge>
                    ) : t.sensitive ? (
                      <StatusBadge tone="warn">Zawiera PESEL</StatusBadge>
                    ) : (
                      <Text size="sm" c="dimmed">
                        {t.allow_manager ? "Dostępny dla kierownika" : "Tylko kadry"}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <FormDialog opened={open} onClose={() => setOpen(false)} title="Nowy szablon" primary={{ label: "Wgraj i sprawdź", formId: "fd-template", loading: create.isPending, disabled: !file || !name.trim() }}>
        <form id="fd-template"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <FileInput
              label="Plik Word (.docx)"
              required
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              leftSection={<IconUpload size={16} />}
              value={file}
              onChange={(f) => {
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.docx$/i, "").replace(/[_-]+/g, " "));
              }}
              placeholder="Wybierz plik"
            />
            <TextInput label="Nazwa" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Select
              label="Język dokumentu"
              data={LANGUAGE_OPTIONS}
              allowDeselect={false}
              value={language}
              onChange={(v) => v && setLanguage(v)}
            />
            <Textarea
              label="Opis (opcjonalnie)"
              autosize
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </Stack>
        </form>
      </FormDialog>
    </Stack>
  );
}
