import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, FileInput, Stack, TextInput, Textarea } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { IconFileTypeDocx, IconPlus, IconUpload } from "@tabler/icons-react";

import { api, errorText, LANGUAGES, type DocTemplate } from "../api";
import { ErrorState, Loading } from "../components/States";
import { TemplatesBrowser } from "../components/TemplatesBrowser";
import { CompactEmpty, ListRow, PageHead, StatusBadge, FormDialog } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }));

export function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ["templates", "all"], queryFn: () => api<DocTemplate[]>("/templates") });
  const mobile = useIsPhone();
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
      {!mobile && <TemplatesBrowser templates={templates.data} loading={templates.isLoading} onAdd={openNew} />}
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
            <TextInput label="Nazwa" required placeholder="np. Deklaracja Medicover" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Select
              label="Język dokumentu"
              data={LANGUAGE_OPTIONS}
              allowDeselect={false}
              value={language}
              onChange={(v) => v && setLanguage(v)}
            />
            <Textarea
              label="Opis (opcjonalnie)"
              placeholder="np. Do zgłoszenia pracownika do prywatnej opieki medycznej"
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
