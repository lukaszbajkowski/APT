import { Fragment, useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Autocomplete, Button, Checkbox, CopyButton, Group, Paper, SegmentedControl, Skeleton, Switch, Tabs, Text, TextInput, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconCheck, IconChevronRight, IconCopy, IconGripVertical, IconPlus } from "@tabler/icons-react";

import { DOWNLOAD_FORMAT_LABELS, withAcct, type DocTemplate, type DownloadFormats, type FieldType, type TemplateField } from "../api";
import { Select } from "./AptSelect";
import { FieldInput, grouped, legacyToGroups, useFieldFormats, type Values } from "./DocumentsCard";
import { FIELD_TYPES, OptionsEditor } from "./FieldsEditor";
import { FormDialog, PageTitle, RowMenu, SectionHead } from "./Mobile";
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
  const [over, setOver] = useState<{ i: number; after: boolean; hdr?: "in" | "out" } | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [groupDlg, setGroupDlg] = useState<{ editing?: string; keys?: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formats = useFieldFormats();
  const fields = draft.fields;
  const cur = fields[Math.min(sel, fields.length - 1)];
  const setField = (i: number, f: TemplateField) => set({ fields: fields.map((x, j) => (j === i ? f : x)) });
  const move = (from: number, to: number, group?: string | null) => {
    if (to < 0 || to >= fields.length || (from === to && group === undefined)) return;
    const next = [...fields];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, group === undefined ? x : { ...x, group });
    set({ fields: next });
    setSel(to);
  };
  const builtinLabel = (k: string) => builtins.find((b) => b.key === k)?.label ?? k;
  const groupNames = [...new Set(fields.map((f) => f.group).filter(Boolean) as string[])];
  const legacy = fields.some((f) => !f.group && f.label.includes(" – "));

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
            <>
            {legacy && (
              <div className="ui-tpe-hint">
                <Text size="sm">Część etykiet ma grupę w nazwie („Adres zamieszkania – Miasto”). Zamienić na grupy pól?</Text>
                <Button size="xs" variant="default" onClick={() => set({ fields: legacyToGroups(fields) })}>
                  Zamień na grupy
                </Button>
              </div>
            )}
            <div className="ui-tpe-tools">
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setGroupDlg({})}>
                Nowa grupa
              </Button>
            </div>
            <GroupDialog opened={!!groupDlg} onClose={() => setGroupDlg(null)} fields={fields} editing={groupDlg?.editing} initialKeys={groupDlg?.keys} onApply={(nf) => set({ fields: nf })} />
            <div className="ui-tpe-grid">
              <Paper withBorder radius="md" className="ui-cases ui-tpe-list" role="listbox" aria-label="Pola formularza" data-dragging={drag !== null || undefined}>
                {fields.map((f, i) => (
                  <Fragment key={f.key}>
                  {f.group && f.group !== fields[i - 1]?.group && (
                    // nagłówek grupy: górna połowa = upuść nad grupą (poza nią), dolna = na początek grupy
                    <div
                      className="ui-tpe-ghead"
                      data-drop={over && over.hdr && over.i === i && drag !== null ? over.hdr : undefined}
                      onDragOver={(e: DragEvent) => {
                        e.preventDefault();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const hdr = e.clientY > r.top + r.height / 2 ? "in" : "out";
                        if (!over || over.i !== i || over.hdr !== hdr) setOver({ i, after: false, hdr });
                      }}
                      onDrop={() => {
                        if (drag !== null && over) {
                          let to = over.i;
                          if (drag < to) to -= 1;
                          move(drag, to, over.hdr === "in" ? f.group! : null);
                          setMoved(fields[drag].key);
                          window.setTimeout(() => setMoved(null), 900);
                        }
                        setDrag(null);
                        setOver(null);
                      }}
                    >
                      <span>{f.group}</span>
                      <span className="ui-tpe-ghead-end">
                        {fields.filter((x) => x.group === f.group).length}
                        <RowMenu
                          label={`Grupa ${f.group}`}
                          items={[{ label: "Edytuj grupę", onClick: () => setGroupDlg({ editing: f.group! }) }]}
                          danger={{ label: "Rozgrupuj", onClick: () => set({ fields: fields.map((x) => (x.group === f.group ? { ...x, group: null } : x)) }) }}
                        />
                      </span>
                    </div>
                  )}
                  <UnstyledButton
                    className="ui-tpe-row"
                    role="option"
                    aria-selected={i === sel}
                    data-selected={i === sel || undefined}
                    data-drag={drag === i || undefined}
                    data-moved={moved === f.key || undefined}
                    // linia pokazuje, gdzie pole wyląduje po upuszczeniu
                    data-ingroup={!!f.group || undefined}
                    data-drop={over && !over.hdr && over.i === i && drag !== null && drag !== i ? (over.after ? "after" : "before") : undefined}
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
                      if (!over || over.i !== i || over.after !== after || over.hdr) setOver({ i, after });
                    }}
                    onDrop={() => {
                      if (drag !== null && over && !over.hdr) {
                        let to = over.i + (over.after ? 1 : 0);
                        if (drag < to) to -= 1;
                        // pole przejmuje grupę wiersza, przy którym je upuszczono
                        move(drag, to, f.group ?? null);
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
                      <span className="ui-tpl-meta">
                        <span className="ui-mono">{f.key}</span>
                      </span>
                    </span>
                    <span className="ui-tpl-meta">
                      {typeLabel(f.type)}
                      {f.type === "select" ? ` · ${f.options.length} opcje` : ""}
                      {f.format ? ` · ${formats.data?.find((p) => p.value === f.format)?.label ?? "własna maska"}` : ""}
                    </span>
                    <span>{f.required && <span className="ui-case-chip">Wymagane</span>}</span>
                    <IconChevronRight size={16} className="ui-tpe-grip" aria-hidden />
                  </UnstyledButton>
                  </Fragment>
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
                  <FieldForm field={cur} onChange={(nf) => setField(sel, nf)} groups={groupNames} />
                </Paper>
              )}
              </div>
            </div>
            </>
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
export function FormPreview({ title, fields, active, onPick, plain }: { title: string; fields: TemplateField[]; active?: string; onPick?: (key: string) => void; plain?: boolean }) {
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
        <div className="ui-pv-field" data-active={f.key === active || undefined} onClickCapture={() => onPick?.(f.key)} title="Kliknij, aby wybrać to pole (edycja: „Edycja pola” u góry)">
          <FieldInput field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        </div>
      </Fragment>
    ));
  return (
    <Paper withBorder={!plain} radius="md" className={plain ? "ui-pv-plain" : "ui-tpe-panel ui-pv"} ref={box}>
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

/** Formularz jednego pola (komputer: panel obok listy, telefon: panel od dołu). */
export function FieldForm({ field, onChange, size, groups = [] }: { field: TemplateField; onChange: (f: TemplateField) => void; size?: "md"; groups?: string[] }) {
  const formats = useFieldFormats();
  return (
    <>
      <TextInput size={size} label="Etykieta w formularzu" value={field.label} onChange={(e) => onChange({ ...field, label: e.currentTarget.value })} />
      <Autocomplete
        size={size}
        label="Grupa"
        description="Pola z tą samą grupą pokażą się pod wspólnym nagłówkiem (np. „Adres zamieszkania”). Ustaw je kolejno po sobie."
        placeholder="Bez grupy"
        data={groups}
        value={field.group ?? ""}
        onChange={(v) => onChange({ ...field, group: v || null })}
      />
      <Select
        size={size}
        label="Typ"
        data={FIELD_TYPES}
        allowDeselect={false}
        value={field.type}
        onChange={(v) => v && onChange({ ...field, type: v as FieldType, ...(v !== "text" ? { format: null, pattern: null } : {}) })}
      />
      {field.type === "text" && (
        <Select
          size={size}
          label="Format"
          placeholder="Bez formatu"
          clearable
          data={[...(formats.data ?? []).map((p) => ({ value: p.value, label: p.label })), { value: "custom", label: "Własna maska…" }]}
          value={field.format ?? null}
          onChange={(v) => onChange({ ...field, format: v, pattern: v === "custom" ? field.pattern ?? "" : null })}
        />
      )}
      {field.type === "text" && field.format === "custom" && (
        <TextInput
          size={size}
          label="Maska"
          placeholder="np. 99-999"
          description="9 = cyfra, A = litera, * = dowolny znak"
          value={field.pattern ?? ""}
          onChange={(e) => onChange({ ...field, pattern: e.currentTarget.value })}
          className="ui-mono"
        />
      )}
      {field.type === "select" && <OptionsEditor field={field} onChange={(nf) => onChange(nf)} />}
      <Switch
 label="Wymagane" checked={field.required} onChange={(e) => onChange({ ...field, required: e.currentTarget.checked })} />
      <Switch
        size={size}
        label="Zwinięte przy generowaniu"
        description="Schowane pod „Więcej pól”. Pola wymagane są zawsze widoczne."
        disabled={field.required}
        checked={!!field.collapsed && !field.required}
        onChange={(e) => onChange({ ...field, collapsed: e.currentTarget.checked })}
      />
    </>
  );
}

/**
 * Lista pól na telefonie z przeciąganiem palcem za uchwyt ⋮⋮ (zdarzenia wskaźnika – działa na dotyk i myszą).
 * Przeciągany wiersz unosi się, pozostałe płynnie się rozsuwają; przy krawędzi ekranu lista sama się przewija.
 */
export function TouchSortList({
  fields,
  onMove,
  onOpen,
  describe,
}: {
  fields: TemplateField[];
  onMove: (from: number, to: number, group: string | null) => void;
  onOpen: (i: number) => void;
  describe: (f: TemplateField) => string;
}) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const st = useRef<{ from: number; startY: number; scroll0: number; tops: number[]; hs: number[]; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const raf = useRef<number | null>(null);

  // nowe miejsce = liczba pozostałych wierszy, których środek leży nad środkiem przeciąganego (wiersze mają różne wysokości)
  const targetFor = (dy: number) => {
    const s = st.current!;
    const center = s.tops[s.from] + s.hs[s.from] / 2 + dy;
    return s.tops.filter((top, i) => i !== s.from && top + s.hs[i] / 2 < center).length;
  };
  const update = (y: number) => {
    const s = st.current;
    if (!s) return;
    s.y = y;
    const dy = y + window.scrollY - (s.startY + s.scroll0);
    setDrag({ from: s.from, to: targetFor(dy), dy });
  };
  const autoscroll = () => {
    const s = st.current;
    if (!s) return;
    const edge = 72;
    const v = s.y < edge ? -8 : s.y > window.innerHeight - edge - 140 ? 8 : 0; // 140: pasek zapisu i nawigacja
    if (v) {
      window.scrollBy(0, v);
      update(s.y);
    }
    raf.current = requestAnimationFrame(autoscroll);
  };
  const start = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tops = rows.current.map((r) => (r ? r.getBoundingClientRect().top + window.scrollY : 0));
    const hs = rows.current.map((r) => r?.getBoundingClientRect().height ?? 64);
    st.current = { from: i, startY: e.clientY, scroll0: window.scrollY, tops, hs, y: e.clientY };
    setDrag({ from: i, to: i, dy: 0 });
    navigator.vibrate?.(10);
    raf.current = requestAnimationFrame(autoscroll);
  };
  const end = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const d = drag;
    st.current = null;
    setDrag(null);
    if (d) {
      const g = groupAt(d.from, d.to);
      if (d.to !== d.from || g !== (fields[d.from].group ?? null)) onMove(d.from, d.to, g);
    }
  };
  // grupa po upuszczeniu: jeśli sąsiedzi są w tej samej grupie – ta grupa; na granicy – grupa, w którą się wjeżdża
  const groupAt = (from: number, to: number) => {
    const rest = fields.filter((_, j) => j !== from);
    const prev = rest[to - 1]?.group ?? null;
    const nx = rest[to]?.group ?? null;
    if (prev === nx) return prev;
    if (to === from) return fields[from].group ?? null;
    return to > from ? prev : nx;
  };
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    const h = st.current?.hs[drag.from] ?? 64;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return h;
    return 0;
  };

  return (
    <div className="ui-group ui-tsl" data-dragging={drag ? true : undefined}>
      {fields.map((f, i) => (
        <div
          key={f.key}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className="ui-tsl-row"
          data-ingroup={!!f.group || undefined}
          data-lifted={drag?.from === i || undefined}
          style={{ transform: drag ? `translateY(${drag.from === i ? drag.dy : shift(i)}px)` : undefined }}
        >
          <span
            className="ui-tsl-handle"
            role="button"
            tabIndex={0}
            aria-label={`Przeciągnij, aby zmienić kolejność: ${f.label}`}
            onPointerDown={(e) => start(i, e)}
            onPointerMove={(e) => st.current && update(e.clientY)}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <IconGripVertical size={20} aria-hidden />
          </span>
          <UnstyledButton className="ui-tsl-body" onClick={() => !drag && onOpen(i)}>
            <span className="ui-tpl-name">{f.label || "Bez etykiety"}</span>
            <span className="ui-tpl-meta">{describe(f)}</span>
            {drag?.from === i && <span className="ui-tpe-group ui-tsl-target">{groupAt(drag.from, drag.to) ?? "Bez grupy"}</span>}
          </UnstyledButton>
          <IconChevronRight size={18} className="ui-tpe-grip" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/** Przypisuje polom `keys` grupę `name` (pola, które były w grupie `old`, a nie są zaznaczone – bez grupy) i ustawia członków grupy kolejno, w miejscu pierwszego z nich. */
export function applyGroup(fields: TemplateField[], name: string, keys: string[], old?: string | null): TemplateField[] {
  const set = new Set(keys);
  const next = fields.map((f) => (set.has(f.key) ? { ...f, group: name } : old && f.group === old ? { ...f, group: null } : f));
  const first = next.findIndex((f) => set.has(f.key));
  if (first < 0) return next;
  const members = next.filter((f) => set.has(f.key));
  const rest = next.filter((f) => !set.has(f.key));
  const at = next.slice(0, first).filter((f) => !set.has(f.key)).length;
  return [...rest.slice(0, at), ...members, ...rest.slice(at)];
}

/** Okienko „Nowa grupa” / „Edytuj grupę”: nazwa + zaznaczenie pól, które do niej należą. */
export function GroupDialog({
  opened,
  onClose,
  fields,
  editing,
  initialKeys,
  onApply,
}: {
  opened: boolean;
  onClose: () => void;
  fields: TemplateField[];
  editing?: string | null;
  initialKeys?: string[];
  onApply: (fields: TemplateField[]) => void;
}) {
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!opened) return;
    setName(editing ?? "");
    setKeys(editing ? fields.filter((f) => f.group === editing).map((f) => f.key) : (initialKeys ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const clash = !!name.trim() && name.trim() !== editing && fields.some((f) => f.group === name.trim());
  return (
    <FormDialog
      opened={opened}
      onClose={onClose}
      title={editing ? "Edytuj grupę" : "Nowa grupa"}
      subtitle="Wspólny nagłówek w formularzu"
      dirty={false}
      primary={{
        label: editing ? "Zapisz grupę" : "Utwórz grupę",
        disabled: !name.trim() || keys.length === 0 || clash,
        onClick: () => {
          onApply(applyGroup(fields, name.trim(), keys, editing));
          onClose();
        },
      }}
    >
      <TextInput label="Nazwa grupy" placeholder="np. Adres zamieszkania" value={name} onChange={(e) => setName(e.currentTarget.value)} error={clash ? "Taka grupa już jest – wybierz ją w polu „Grupa” albo użyj innej nazwy." : undefined} data-autofocus />
      <Checkbox.Group label="Pola w grupie" description="Zaznaczone pola zostaną ustawione kolejno, w miejscu pierwszego z nich." value={keys} onChange={setKeys} mt="md">
        <div className="ui-group-pick">
          {fields.map((f) => (
            <Checkbox key={f.key} value={f.key} label={f.label || f.key} description={f.group && f.group !== editing ? `Teraz: ${f.group}` : undefined} />
          ))}
        </div>
      </Checkbox.Group>
    </FormDialog>
  );
}
