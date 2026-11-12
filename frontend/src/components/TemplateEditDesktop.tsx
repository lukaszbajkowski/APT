import { Fragment, useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Button, CopyButton, Group, Paper, SegmentedControl, Skeleton, Switch, Tabs, Text, TextInput, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconCheck, IconChevronRight, IconCopy, IconGripVertical } from "@tabler/icons-react";

import { DOWNLOAD_FORMAT_LABELS, withAcct, type DocTemplate, type DownloadFormats, type FieldType, type TemplateField } from "../api";
import { Select } from "./AptSelect";
import { FieldInput, grouped, useFieldFormats, type Values } from "./DocumentsCard";
import { FIELD_TYPES, OptionsEditor } from "./FieldsEditor";
import { PageTitle, RowMenu, SectionHead } from "./Mobile";
import { LANGUAGE_OPTIONS } from "../pages/TemplatesPage";

export interface TemplateDraft {
  name: string;
  description: string;
  language: string;
  active: boolean;
  allowManager: boolean;
  strictPdf: boolean;
  formats: DownloadFormats;
  fields: TemplateField[];
}

const typeLabel = (t: FieldType) => FIELD_TYPES.find((x) => x.value === t)?.label ?? t;

/**
 * Edycja szablonu na komputerze (wariant A): zakładki Pola / Ustawienia / Znaczniki; pola jako krótka lista
 * (przeciąganie zmienia kolejność), edycja wybranego pola w panelu obok; pasek „Zapisz” zawsze widoczny.
 */
export function TemplateEditDesktop({
  t,
  draft,
  set,
  dirty,
  saving,
  onSave,
  onReplace,
  replacing,
  builtins,
}: {
  t: DocTemplate;
  draft: TemplateDraft;
  set: (patch: Partial<TemplateDraft>) => void;
  dirty: number;
  saving: boolean;
  onSave: () => void;
  onReplace: (f: File) => void;
  replacing: boolean;
  builtins: { key: string; label: string }[];
}) {
  const [tab, setTab] = useState<string>("fields");
  const [sel, setSel] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [side, setSide] = useState("edit");
  const [over, setOver] = useState<{ i: number; after: boolean } | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formats = useFieldFormats();
  const fields = draft.fields;
  const cur = fields[Math.min(sel, fields.length - 1)];
  const setField = (i: number, f: TemplateField) => set({ fields: fields.map((x, j) => (j === i ? f : x)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= fields.length || from === to) return;
    const next = [...fields];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    set({ fields: next });
    setSel(to);
  };
  const builtinLabel = (k: string) => builtins.find((b) => b.key === k)?.label ?? k;

  return (
    <div className="ui-tpe">
      <Link to={`/szablony?id=${t.id}`} className="ui-back-link">
        <IconArrowLeft size={14} aria-hidden /> Szablony
      </Link>
      <PageTitle
        title={draft.name || t.name}
        meta={`Wersja ${t.version} · ${fields.length} ${fields.length === 1 ? "pole" : fields.length % 10 >= 2 && fields.length % 10 <= 4 && (fields.length % 100 < 12 || fields.length % 100 > 14) ? "pola" : "pól"}`}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".docx" hidden onChange={(e) => e.currentTarget.files?.[0] && onReplace(e.currentTarget.files[0])} />
            <Button variant="default" loading={replacing} onClick={() => fileRef.current?.click()}>
              Wgraj nową wersję
            </Button>
            <RowMenu label={t.name} items={[{ label: "Pobierz plik .docx", onClick: () => window.open(withAcct(`/api/templates/${t.id}/file`), "_blank") }]} />
          </>
        }
      />

      <Tabs value={tab} onChange={(v) => v && setTab(v)} keepMounted={false} className="ui-tpe-tabs">
        <Tabs.List>
          <Tabs.Tab value="fields">Pola formularza {fields.length}</Tabs.Tab>
          <Tabs.Tab value="settings">Ustawienia</Tabs.Tab>
          <Tabs.Tab value="tags">Znaczniki w pliku</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="fields">
          {fields.length === 0 ? (
            <Text c="dimmed" mt="lg">
              Ten szablon używa tylko danych z kartoteki – aplikacja o nic nie zapyta przy generowaniu.
            </Text>
          ) : (
            <div className="ui-tpe-grid">
              <Paper withBorder radius="md" className="ui-cases ui-tpe-list" role="listbox" aria-label="Pola formularza" data-dragging={drag !== null || undefined}>
                {fields.map((f, i) => (
                  <UnstyledButton
                    key={f.key}
                    className="ui-tpe-row"
                    role="option"
                    aria-selected={i === sel}
                    data-selected={i === sel || undefined}
                    data-drag={drag === i || undefined}
                    data-moved={moved === f.key || undefined}
                    // linia pokazuje, gdzie pole wyląduje po upuszczeniu
                    data-drop={over && over.i === i && drag !== null && drag !== i ? (over.after ? "after" : "before") : undefined}
                    draggable
                    onDragStart={(e: DragEvent) => {
                      setDrag(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", f.key);
                    }}
                    onDragOver={(e: DragEvent) => {
                      e.preventDefault();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      if (!over || over.i !== i || over.after !== after) setOver({ i, after });
                    }}
                    onDrop={() => {
                      if (drag !== null && over) {
                        let to = over.i + (over.after ? 1 : 0);
                        if (drag < to) to -= 1;
                        move(drag, to);
                        setMoved(fields[drag].key);
                        window.setTimeout(() => setMoved(null), 900);
                      }
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onClick={() => setSel(i)}
                  >
                    <IconGripVertical size={16} className="ui-tpe-grip" aria-hidden />
                    <span style={{ minWidth: 0 }}>
                      <span className="ui-tpl-name">{f.label || "Bez etykiety"}</span>
                      <span className="ui-tpl-meta ui-mono">{f.key}</span>
                    </span>
                    <span className="ui-tpl-meta">
                      {typeLabel(f.type)}
                      {f.type === "select" ? ` · ${f.options.length} opcje` : ""}
                      {f.format ? ` · ${formats.data?.find((p) => p.value === f.format)?.label ?? "własna maska"}` : ""}
                    </span>
                    <span>{f.required && <span className="ui-case-chip">Wymagane</span>}</span>
                    <IconChevronRight size={16} className="ui-tpe-grip" aria-hidden />
                  </UnstyledButton>
                ))}
              </Paper>

              <div className="ui-tpe-side">
              <SegmentedControl
                fullWidth
                value={side}
                onChange={setSide}
                data={[
                  { value: "edit", label: "Edycja pola" },
                  { value: "preview", label: "Podgląd formularza" },
                ]}
              />
              {side === "preview" && (
                <FormPreview
                  title={draft.name || t.name}
                  fields={fields}
                  active={cur?.key}
                  onPick={(k) => setSel(fields.findIndex((f) => f.key === k))}
                />
              )}
              {side === "edit" && cur && (
                <Paper withBorder radius="md" className="ui-tpe-panel" key={cur.key}>
                  <div className="ui-tpe-phead">
                    <div style={{ minWidth: 0 }}>
                      <h2 className="ui-dsec-title">{cur.label || "Bez etykiety"}</h2>
                      <Text size="sm" c="dimmed" className="ui-mono">{`{{ ${cur.key} }}`}</Text>
                    </div>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Wyżej na formularzu">
                        <ActionIcon variant="default" size={36} aria-label="Przesuń wyżej" disabled={sel === 0} onClick={() => move(sel, sel - 1)}>
                          <IconArrowUp size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Niżej na formularzu">
                        <ActionIcon variant="default" size={36} aria-label="Przesuń niżej" disabled={sel === fields.length - 1} onClick={() => move(sel, sel + 1)}>
                          <IconArrowDown size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </div>
                  <TextInput label="Etykieta w formularzu" value={cur.label} onChange={(e) => setField(sel, { ...cur, label: e.currentTarget.value })} />
                  <Select
                    label="Typ"
                    data={FIELD_TYPES}
                    allowDeselect={false}
                    value={cur.type}
                    onChange={(v) => v && setField(sel, { ...cur, type: v as FieldType, ...(v !== "text" ? { format: null, pattern: null } : {}) })}
                  />
                  {cur.type === "text" && (
                    <Select
                      label="Format"
                      placeholder="Bez formatu"
                      clearable
                      data={[...(formats.data ?? []).map((p) => ({ value: p.value, label: p.label })), { value: "custom", label: "Własna maska…" }]}
                      value={cur.format ?? null}
                      onChange={(v) => setField(sel, { ...cur, format: v, pattern: v === "custom" ? cur.pattern ?? "" : null })}
                    />
                  )}
                  {cur.type === "text" && cur.format === "custom" && (
                    <TextInput
                      label="Maska"
                      placeholder="np. 99-999"
                      description="9 = cyfra, A = litera, * = dowolny znak"
                      value={cur.pattern ?? ""}
                      onChange={(e) => setField(sel, { ...cur, pattern: e.currentTarget.value })}
                      className="ui-mono"
                    />
                  )}
                  {cur.type === "select" && <OptionsEditor field={cur} onChange={(nf) => setField(sel, nf)} />}
                  <Switch label="Wymagane" checked={cur.required} onChange={(e) => setField(sel, { ...cur, required: e.currentTarget.checked })} />
                  <Switch
                    label="Zwinięte przy generowaniu"
                    description="Schowane pod „Więcej pól”. Pola wymagane są zawsze widoczne."
                    disabled={cur.required}
                    checked={!!cur.collapsed && !cur.required}
                    onChange={(e) => setField(sel, { ...cur, collapsed: e.currentTarget.checked })}
                  />
                </Paper>
              )}
              </div>
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="settings">
          <div className="ui-tpe-settings">
            <section className="ui-dsec">
              <SectionHead title="Ogólne" />
              <Group grow align="flex-start">
                <TextInput label="Nazwa" required value={draft.name} onChange={(e) => set({ name: e.currentTarget.value })} />
                <Select label="Język dokumentu" data={LANGUAGE_OPTIONS} allowDeselect={false} value={draft.language} onChange={(v) => v && set({ language: v })} />
              </Group>
              <Textarea label="Opis" autosize minRows={2} value={draft.description} onChange={(e) => set({ description: e.currentTarget.value })} />
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Pobieranie
                </Text>
                <SegmentedControl
                  value={draft.formats}
                  onChange={(v) => set({ formats: v as DownloadFormats })}
                  data={(Object.keys(DOWNLOAD_FORMAT_LABELS) as DownloadFormats[]).map((value) => ({ value, label: DOWNLOAD_FORMAT_LABELS[value] }))}
                />
                <Text size="xs" c="dimmed" mt={4}>
                  Podgląd online (PDF) jest dostępny zawsze.
                </Text>
              </div>
            </section>
            <section className="ui-dsec">
              <SectionHead title="Dostęp i podpis" />
              <Switch label="Aktywny – dostępny przy generowaniu" checked={draft.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
              <Switch
                label="Dostępny dla kierownika"
                description={t.sensitive ? "Kierownik wygeneruje dokument, ale PESEL i data urodzenia zostaną w nim puste." : undefined}
                checked={draft.allowManager}
                onChange={(e) => set({ allowManager: e.currentTarget.checked })}
              />
              <Switch
                label="Ścisła kontrola podpisanego pliku (podpis zaufany i kwalifikowany)"
                description="Wgrany plik musi zawierać pobrany dokument bez zmian, z podpisem dopisanym na końcu. Włączaj tylko dla dokumentów, które tego wymagają."
                checked={draft.strictPdf}
                onChange={(e) => set({ strictPdf: e.currentTarget.checked })}
              />
            </section>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="tags">
          <div className="ui-two" style={{ marginTop: "var(--s-6)" }}>
            <section className="ui-dsec">
              <SectionHead title="Dane z kartoteki w tym szablonie" extra={<Text c="dimmed">{t.builtins.length}</Text>} />
              {t.builtins.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Szablon nie używa danych z kartoteki.
                </Text>
              ) : (
                <Paper withBorder radius="md" className="ui-cases">
                  {t.builtins.map((b) => (
                    <div key={b} className="ui-cnt-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                      <span>{builtinLabel(b)}</span>
                      <span className="ui-mono ui-cnt-dim">{`{{ ${b} }}`}</span>
                    </div>
                  ))}
                </Paper>
              )}
              {t.sensitive && (
                <Text size="sm" className="ui-warn">
                  Zawiera PESEL lub datę urodzenia – kierownik wygeneruje dokument tylko bez nich.
                </Text>
              )}
            </section>
            <section className="ui-dsec">
              <SectionHead title="Ściąga znaczników" />
              <Text size="sm" c="dimmed" mt={-8}>
                Wpisz znacznik w Wordzie – kliknij, aby skopiować. Pole wyboru: {"{{ '☒' if wariant == 'rodzinny' else '☐' }}"}. Wyłącz w Wordzie
                autokorektę cudzysłowów.
              </Text>
              <Paper withBorder radius="md" className="ui-cases ui-tpe-cheat">
                {builtins.map((b) => (
                  <CopyButton key={b.key} value={`{{ ${b.key} }}`}>
                    {({ copied, copy }) => (
                      <UnstyledButton className="ui-cnt-row ui-tpe-copy" onClick={copy}>
                        <span className="ui-mono">{`{{ ${b.key} }}`}</span>
                        <span className="ui-cnt-dim">{b.label}</span>
                        {copied ? <IconCheck size={16} aria-label="Skopiowano" /> : <IconCopy size={16} aria-hidden className="ui-tpe-grip" />}
                      </UnstyledButton>
                    )}
                  </CopyButton>
                ))}
              </Paper>
            </section>
          </div>
        </Tabs.Panel>
      </Tabs>

      {/* pasek zapisu zawsze widoczny na dole ekranu */}
      <div className="ui-tpe-save" data-dirty={dirty > 0 || undefined}>
        <Text size="sm" c={dirty ? undefined : "dimmed"} fw={dirty ? 600 : undefined}>
          {dirty ? `Niezapisane zmiany: ${dirty}` : "Wszystko zapisane"}
        </Text>
        <Button onClick={onSave} loading={saving} disabled={!dirty || !draft.name.trim()}>
          Zapisz szablon
        </Button>
      </div>
    </div>
  );
}

/** Szkielet edycji szablonu: powrót, tytuł, zakładki, lista pól i panel – ten sam układ co treść. */
export function TemplateEditSkeleton() {
  return (
    <div className="ui-tpe" aria-busy="true" aria-label="Ładowanie">
      <Skeleton height={12} width={80} />
      <Skeleton height={28} width={320} />
      <Skeleton height={32} width={420} radius="sm" />
      <div className="ui-tpe-grid">
        <Paper withBorder radius="md" className="ui-cases">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="ui-tpe-row">
              <Skeleton height={16} width={12} />
              <span>
                <Skeleton height={12} width={`${70 - (i % 3) * 15}%`} mb={8} />
                <Skeleton height={10} width={90} />
              </span>
              <Skeleton height={10} width={80} />
              <span />
              <span />
            </div>
          ))}
        </Paper>
        <Paper withBorder radius="md" className="ui-tpe-panel">
          <Skeleton height={20} width="60%" />
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={20} width="40%" />
        </Paper>
      </div>
    </div>
  );
}

/**
 * Podgląd na żywo: ten sam formularz, który kadra widzi przy „Nowy dokument” (grupy, „Więcej pól”, typy pól),
 * zbudowany z bieżących, niezapisanych ustawień. Wybrane pole podświetlone; klik w pole je wybiera (także na liście).
 */
function FormPreview({ title, fields, active, onPick }: { title: string; fields: TemplateField[]; active?: string; onPick: (key: string) => void }) {
  const [values, setValues] = useState<Values>({});
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // wybrane pole (np. kliknięte na liście) przewija się do widoku w podglądzie
  useEffect(() => {
    if (active && hiddenHas(active)) setMore(true);
    box.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const shown = fields.filter((f) => !f.collapsed || f.required);
  const hidden = fields.filter((f) => f.collapsed && !f.required);
  const hiddenHas = (k: string) => hidden.some((f) => f.key === k);
  const render = (list: TemplateField[]) =>
    grouped(list).map(({ f, head }) => (
      <Fragment key={f.key}>
        {head && <Text className="ui-field-group">{head}</Text>}
        <div className="ui-pv-field" data-active={f.key === active || undefined} onClickCapture={() => onPick(f.key)} title="Kliknij, aby wybrać to pole (edycja: „Edycja pola” u góry)">
          <FieldInput field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        </div>
      </Fragment>
    ));
  return (
    <Paper withBorder radius="md" className="ui-tpe-panel ui-pv" ref={box}>
      <div>
        <Text size="sm" c="dimmed">
          Tak zobaczy to kadra przy „Nowy dokument”
        </Text>
        <h2 className="ui-dsec-title">{title}</h2>
      </div>
      {render(shown)}
      {hidden.length > 0 && (
        <>
          <Button variant="subtle" size="sm" w="fit-content" px={4} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "Ukryj dodatkowe pola" : `Więcej pól (${hidden.length})`}
          </Button>
          {more && render(hidden)}
        </>
      )}
    </Paper>
  );
}
