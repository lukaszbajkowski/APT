import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, FileButton, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDownload,
  IconUpload,
} from "@tabler/icons-react";

import { FieldsEditor } from "../components/FieldsEditor";
import { TemplateEditDesktop, TemplateEditSkeleton, type TemplateDraft } from "../components/TemplateEditDesktop";
import { api, DOWNLOAD_FORMAT_LABELS, errorText, type DocTemplate, type DownloadFormats, type TemplateField, withAcct } from "../api";
import { LANGUAGE_OPTIONS } from "./TemplatesPage";
import { useMediaQuery } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { FormScreen, ListRow, Section, StatusBadge, PageLoading } from "../components/Mobile";

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

  if (template.isLoading) return mobile ? <PageLoading title="Szablon" /> : <TemplateEditSkeleton />;
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


  // liczba niezapisanych zmian: ustawienia + każde zmienione pole (także kolejność)
  const orig = { name: t.name, description: t.description ?? "", language: t.language, active: t.is_active, allowManager: t.allow_manager, strictPdf: t.strict_pdf, formats: t.download_formats };
  const now = { name, description, language, active, allowManager, strictPdf, formats };
  const dirty =
    (Object.keys(orig) as (keyof typeof orig)[]).filter((k) => orig[k] !== now[k]).length +
    Math.max(fields.length, t.fields.length) -
    fields.filter((f, i) => JSON.stringify(f) === JSON.stringify(t.fields[i])).length;
  const draft: TemplateDraft = { name, description, language, active, allowManager, strictPdf, formats, fields };
  const set = (p: Partial<TemplateDraft>) => {
    if (p.name !== undefined) setName(p.name);
    if (p.description !== undefined) setDescription(p.description);
    if (p.language !== undefined) setLanguage(p.language);
    if (p.active !== undefined) setActive(p.active);
    if (p.allowManager !== undefined) setAllowManager(p.allowManager);
    if (p.strictPdf !== undefined) setStrictPdf(p.strictPdf);
    if (p.formats !== undefined) setFormats(p.formats);
    if (p.fields !== undefined) setFields(p.fields);
  };
  return (
    <>
      {error && (
        <Alert color="red" withCloseButton onClose={() => setError(null)} mb="md">
          {error}
        </Alert>
      )}
      <TemplateEditDesktop
        t={t}
        draft={draft}
        set={set}
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onReplace={(f) => replace.mutate(f)}
        replacing={replace.isPending}
        builtins={builtins.data ?? []}
      />
    </>
  );
}
