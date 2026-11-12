import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { flushSync } from "react-dom";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Autocomplete, Button, Checkbox, CopyButton, Group, Paper, SegmentedControl, Skeleton, Switch, Tabs, Text, TextInput, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconCheck, IconChevronRight, IconCopy, IconGripVertical, IconPlus } from "@tabler/icons-react";

import { DOWNLOAD_FORMAT_LABELS, withAcct, type DocTemplate, type DownloadFormats, type FieldType, type TemplateField } from "../api";
import { Select } from "./AptSelect";
import { FieldInput, GroupedFields, legacyToGroups, useFieldFormats, type Values } from "./DocumentsCard";
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
  const [moved, setMoved] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [groupDlg, setGroupDlg] = useState<{ editing?: string; keys?: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formats = useFieldFormats();
  const fields = draft.fields;
  const cur = fields[Math.min(sel, fields.length - 1)];
  const setField = (i: number, f: TemplateField) => set({ fields: fields.map((x, j) => (j === i ? f : x)) });
  // odłożenie w to samo miejsce (ta sama pozycja i grupa) niczego nie zmienia: bez zaznaczenia, mignięcia i „niezapisanych zmian”
  const isNoop = (from: number, to: number, group?: string | null) =>
    from === to && (group === undefined || (group ?? null) === (fields[from]?.group ?? null));
  const move = (from: number, to: number, group?: string | null) => {
    if (to < 0 || to >= fields.length || isNoop(from, to, group)) return false;
    const next = [...fields];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, group === undefined ? x : { ...x, group });
    set({ fields: next });
    setSel(to);
    return true;
  };
  const listRef = useRef<HTMLDivElement>(null);
  const rename = () => {
    if (!renaming) return;
    const to = renaming.value.trim();
    setRenaming(null);
    if (!to || to === renaming.from) return;
    if (fields.some((x) => x.group === to)) {
      notifications.show({ color: "red", message: `Grupa „${to}” już jest – wybierz inną nazwę.` });
      return;
    }
    set({ fields: fields.map((x) => (x.group === renaming.from ? { ...x, group: to } : x)) });
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
          <Tabs.Tab value="fields">Formularz {fields.length}</Tabs.Tab>
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
              {/* przeciąganie jak na telefonie: chwyt za ⋮⋮, pole/grupa przyciąga się do szczeliny, przewijanie przy krawędzi */}
              <div ref={listRef} className="ui-tpe-plist" aria-label="Pola formularza">
                <TouchSortList
                  fields={fields}
                  selected={sel}
                  onOpen={(i) => setSel(i)}
                  onMove={(from, to, group) => {
                    const next = [...fields];
                    const [x] = next.splice(from, 1);
                    next.splice(to, 0, { ...x, group });
                    set({ fields: next });
                    setSel(to);
                    setMoved(x.key);
                    window.setTimeout(() => setMoved(null), 900);
                  }}
                  onMoveGroup={(from, to) => {
                    const bs: TemplateField[][] = [];
                    for (const f of fields) {
                      const last = bs[bs.length - 1];
                      if (f.group && last && last[0].group === f.group) last.push(f);
                      else bs.push([f]);
                    }
                    const [x] = bs.splice(from, 1);
                    bs.splice(to, 0, x);
                    set({ fields: bs.flat() });
                  }}
                  describe={() => ""}
                  renderBody={(f) => (
                    <CanvasField f={f} moved={moved === f.key} formatLabel={f.format ? (formats.data?.find((x) => x.value === f.format)?.label ?? "własna maska") : undefined} />
                  )}
                  groupName={(g) =>
                    renaming?.from === g ? (
                      <input
                        className="ui-tpe-gname-input"
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        size={Math.max(8, renaming.value.length + 1)}
                        aria-label="Nazwa grupy"
                        value={renaming.value}
                        onChange={(e) => setRenaming({ from: renaming.from, value: e.currentTarget.value })}
                        onBlur={rename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="ui-tsl-ghead-btn" onDoubleClick={() => setRenaming({ from: g, value: g })} title="Kliknij dwukrotnie, aby zmienić nazwę. Przeciągnij za ⋮⋮, aby przenieść całą grupę.">
                        <span className="ui-tpl-name">{g}</span>
                        <span className="ui-tpl-meta">{fields.filter((x) => x.group === g).length} · dwuklik zmienia nazwę</span>
                      </span>
                    )
                  }
                  groupActions={(g) => (
                    <RowMenu
                      label={`Grupa ${g}`}
                      items={[
                        { label: "Przesuń grupę wyżej", icon: <IconArrowUp size={16} />, onClick: () => { set({ fields: moveGroupBy(fields, g, -1) }); announce(`Grupa ${g} przeniesiona wyżej`); } },
                        { label: "Przesuń grupę niżej", icon: <IconArrowDown size={16} />, onClick: () => { set({ fields: moveGroupBy(fields, g, 1) }); announce(`Grupa ${g} przeniesiona niżej`); } },
                        { label: "Zmień nazwę", onClick: () => setRenaming({ from: g, value: g }) },
                        { label: "Edytuj grupę", onClick: () => setGroupDlg({ editing: g }) },
                      ]}
                      danger={{ label: "Rozgrupuj", onClick: () => set({ fields: fields.map((x) => (x.group === g ? { ...x, group: null } : x)) }) }}
                    />
                  )}
                />
              </div>

              {/* panel boczny nie przerysowuje się przy każdym ruchu przeciągania (zależy tylko od tych wartości) */}
              <Frozen deps={[sel, cur, fields, draft.name, groupNames.join("\u0000")]}>
              <div className="ui-tpe-side">
              {cur && (
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
              </Frozen>
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
    <GroupedFields
      fields={list}
      cols={1}
      render={(f) => (
        <div className="ui-pv-field" data-active={f.key === active || undefined} onClickCapture={() => onPick?.(f.key)} title="Kliknij, aby wybrać to pole (edycja: „Edycja pola” u góry)">
          <FieldInput field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        </div>
      )}
    />;
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

/** Pole na „płótnie” edycji szablonu: wygląda jak w formularzu „Nowy dokument” (etykieta + pole), z drobnymi znacznikami typu. */
export function CanvasField({ f, formatLabel, moved }: { f: TemplateField; formatLabel?: string; moved?: boolean }) {
  const kind = f.type === "select" ? `Lista · ${f.options.length}` : f.type === "date" ? "Data" : f.type === "textarea" ? "Długi tekst" : f.type === "number" ? "Liczba" : f.type === "checkbox" ? "Tak / nie" : null;
  return (
    <span className="ui-cv-field" data-moved={moved || undefined}>
      <span className="ui-cv-label">
        <span className="ui-cv-name">{f.label || "Bez etykiety"}</span>
        {f.required && <span className="ui-cv-req" aria-label="Wymagane">*</span>}
        {kind && <span className="ui-cv-chip">{kind}</span>}
        {formatLabel && <span className="ui-cv-chip">{formatLabel}</span>}
        {f.collapsed && !f.required && <span className="ui-cv-chip">W „Więcej pól”</span>}
      </span>
      <span className="ui-cv-input" data-type={f.type} data-tall={f.type === "textarea" || undefined} aria-hidden />
    </span>
  );
}

/** Jeden wspólny komunikat statusu dla czytnika ekranu (aria-live), np. po zmianie kolejności pól. */
export function announce(msg: string) {
  let el = document.getElementById("apt-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "apt-live";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.className = "ui-sr-only";
    document.body.appendChild(el);
  }
  el.textContent = "";
  const node = el;
  requestAnimationFrame(() => (node.textContent = msg));
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
  blocks,
  replaceBody,
  groupName,
  groupActions,
  onMoveGroup,
  renderBody,
  selected,
}: {
  fields: TemplateField[];
  onMove: (from: number, to: number, group: string | null) => void;
  onOpen: (i: number) => void;
  describe: (f: TemplateField) => string;
  /** układanie całych bloków (grup) – bez przypisywania grup przy upuszczeniu */
  blocks?: boolean;
  /** zamiast wiersza z nazwą – własny element (np. pole do zmiany nazwy grupy) */
  replaceBody?: (f: TemplateField, i: number) => ReactNode | null;
  /** nagłówki grup w liście: nazwa (np. z podwójnym dotknięciem), akcje po prawej; przeciągnięcie przenosi całą grupę */
  groupName?: (g: string) => ReactNode;
  groupActions?: (g: string) => ReactNode;
  onMoveGroup?: (fromBlock: number, toBlock: number) => void;
  /** komputer: własna treść wiersza (kolumny), zaznaczony wiersz */
  renderBody?: (f: TemplateField, i: number) => ReactNode;
  selected?: number;
}) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const st = useRef<{ from: number; startY: number; scroll0: number; tops: number[]; hs: number[]; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; out?: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);
  // ekran edycji na telefonie przewija własny kontener, nie okno – szukamy najbliższego przewijanego przodka
  const scroller = useRef<HTMLElement | null>(null);
  const inner = useRef<number[]>([]);
  const mbs = useRef<number[]>([]); // dolne marginesy wierszy w chwili chwycenia
  const scrollTop = () => (scroller.current ? scroller.current.scrollTop : window.scrollY);
  const scrollBy = (v: number) => (scroller.current ? scroller.current.scrollBy(0, v) : window.scrollBy(0, v));

  // strefy przewijania przy krawędziach: od góry obszaru listy i od góry paska przycisków (działa też w poziomie, na niskim ekranie)
  const edges = () => {
    const h = window.innerHeight;
    const edge = Math.min(72, Math.round(h * 0.15));
    const top = scroller.current ? scroller.current.getBoundingClientRect().top : 0;
    const bar = document.querySelector<HTMLElement>(".ui-inpage .ui-chat-compose") ?? document.querySelector<HTMLElement>(".ui-tpe-save");
    const limit = bar ? bar.getBoundingClientRect().top : h;
    return { edge: top + edge, bottom: limit - edge };
  };
  // ruch palca: najwyżej jedno przeliczenie na klatkę ekranu (zdarzeń bywa 2–4× więcej niż klatek)
  const frame = useRef<{ y: number; id: number | null }>({ y: 0, id: null });
  const onFrame = (y: number, fn: (y: number) => void) => {
    frame.current.y = y;
    if (frame.current.id !== null) return;
    frame.current.id = requestAnimationFrame(() => {
      frame.current.id = null;
      fn(frame.current.y);
    });
  };
  // —— klawiatura na uchwycie: ↑/↓ o jedno miejsce; na granicy grupy pole do niej wchodzi albo z niej wychodzi ——
  const refocus = (key: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-handle="${CSS.escape(key)}"]`)?.focus());
  const keyStep = (i: number, dir: -1 | 1) => {
    const f = fields[i];
    const nb = fields[i + dir];
    if (!f) return;
    const g = f.group ?? null;
    const ng = nb?.group ?? null;
    let to = i;
    let group: string | null = g;
    if (g && ng !== g) group = null; // wyjście z grupy (pole jest na jej brzegu)
    else if (!nb) return;
    else if (!g && ng) group = ng; // wejście do grupy obok
    else to = i + dir;
    onMove(i, to, group);
    refocus(f.key);
    announce(`${f.label || "Pole"}: pozycja ${to + 1} z ${fields.length}, ${group ? `grupa ${group}` : "bez grupy"}`);
  };
  const gKeyStep = (g: string, dir: -1 | 1) => {
    const blocks: { g: string | null }[] = [];
    fields.forEach((f) => {
      const last = blocks[blocks.length - 1];
      if (!(f.group && last && last.g === f.group)) blocks.push({ g: f.group ?? null });
    });
    const from = blocks.findIndex((b) => b.g === g);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= blocks.length) return;
    onMoveGroup?.(from, to);
    refocus(`g:${g}`);
    announce(`Grupa ${g} przeniesiona ${dir < 0 ? "wyżej" : "niżej"}`);
  };
  // —— przeciąganie całej grupy za nagłówek ——
  const heads = useRef<Record<string, HTMLDivElement | null>>({});
  const withHeads = !!groupName && !blocks;
  // bloki listy: grupa (nagłówek + jej pola) albo pojedyncze pole bez grupy
  const blockList = (() => {
    const out: { g: string | null; start: number; end: number }[] = [];
    fields.forEach((f, i) => {
      const last = out[out.length - 1];
      if (f.group && last && last.g === f.group) last.end = i;
      else out.push({ g: f.group ?? null, start: i, end: i });
    });
    return out;
  })();
  const blockOf = (i: number) => blockList.findIndex((b) => i >= b.start && i <= b.end);
  const gst = useRef<{ from: number; startY: number; scroll0: number; tops: number[]; hs: number[]; y: number } | null>(null);
  const [gd, setGd] = useState<{ from: number; to: number; dy: number } | null>(null);
  const gTarget = (dy: number) => {
    const s = gst.current!;
    const center = s.tops[s.from] + s.hs[s.from] / 2 + dy;
    return s.tops.filter((top, i) => i !== s.from && top + s.hs[i] / 2 < center).length;
  };
  const gUpdate = (y: number) => {
    const s = gst.current;
    if (!s) return;
    s.y = y;
    const dy = y + scrollTop() - (s.startY + s.scroll0);
    setGd({ from: s.from, to: gTarget(dy), dy });
  };
  const gAuto = () => {
    const s = gst.current;
    if (!s) return;
    const { edge, bottom } = edges();
    const moved = s.y - s.startY;
    const v =
      s.y < edge && moved < -12 ? -Math.min(20, 4 + Math.round((edge - s.y) / 4)) : s.y > bottom && moved > 12 ? Math.min(20, 4 + Math.round((s.y - bottom) / 4)) : 0;
    // w trakcie przewijania bez animacji przesuwania – inaczej przeciągane pole goni szczelinę i zostaje w tyle
    const list = scroller.current?.querySelector<HTMLElement>(".ui-tsl") ?? document.querySelector<HTMLElement>(".ui-tsl");
    if (list) list.toggleAttribute("data-scrolling", !!v);
    if (v) {
      scrollBy(v);
      // przeliczenie w tej samej klatce co przewinięcie – szczelina nie zostaje o klatkę w tyle za listą
      flushSync(() => gUpdate(s.y));
    }
    raf.current = requestAnimationFrame(gAuto);
  };
  const gStart = (g: string, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let el = (e.currentTarget as HTMLElement).parentElement;
    while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
    scroller.current = el;
    rows.current.length = fields.length;
    // blok od górnego marginesu pierwszego elementu do dolnego marginesu ostatniego (lista jest kolumną flex – marginesy się nie nakładają)
    const tops: number[] = [];
    const hs: number[] = [];
    blockList.forEach((b) => {
      const first = (b.g ? heads.current[b.g] : rows.current[b.start]) ?? rows.current[b.start];
      const last = rows.current[b.end];
      if (!first || !last) {
        tops.push(0);
        hs.push(64);
        return;
      }
      const top = first.offsetTop - parseFloat(getComputedStyle(first).marginTop);
      const bottom = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom);
      tops.push(top);
      hs.push(bottom - top);
    });
    inner.current = rows.current.map((r) => r?.offsetHeight ?? 64);
    mbs.current = rows.current.map((r) => (r ? parseFloat(getComputedStyle(r).marginBottom) : 0));
    const from = blockList.findIndex((b) => b.g === g);
    gst.current = { from, startY: e.clientY, scroll0: scrollTop(), tops, hs, y: e.clientY };
    setGd({ from, to: from, dy: 0 });
    navigator.vibrate?.(10);
    raf.current = requestAnimationFrame(gAuto);
  };
  const gEnd = () => {
    document.querySelector(".ui-tsl")?.removeAttribute("data-scrolling");
    // uchwyt ⋮⋮ nie zostaje z fokusem (obwódką) po puszczeniu
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("ui-tsl-handle")) document.activeElement.blur();
    if (raf.current) cancelAnimationFrame(raf.current);
    if (frame.current.id !== null) {
      cancelAnimationFrame(frame.current.id);
      frame.current.id = null;
    }
    const d = gd;
    gst.current = null;
    setGd(null);
    if (d && d.to !== d.from) {
      onMoveGroup?.(d.from, d.to);
      const g = blockList[d.from]?.g;
      if (g) announce(`Grupa ${g} przeniesiona`);
    }
  };
  // przesunięcie bloku b w trakcie przeciągania grupy (przeciągana grupa stoi w szczelinie)
  const gShift = (b: number) => {
    const s = gst.current;
    if (!gd || !s) return 0;
    const { from, to } = gd;
    if (b === from) return (to > from ? s.tops[to] + s.hs[to] - s.hs[from] : s.tops[to]) - s.tops[from];
    const sp = to !== from ? spread(b, from, to) : 0;
    if (from < to && b > from && b <= to) return -s.hs[from] + sp;
    if (from > to && b < from && b >= to) return s.hs[from] + sp;
    return sp;
  };
  // grupa, przed którą (na końcu – za którą) stanie przeciągana grupa
  const gNeighbour = gd && gd.to !== gd.from ? blockList[gd.to < gd.from ? gd.to : gd.to + 1] ?? blockList[blockList.length - 1] : null;

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
    const dy = y + scrollTop() - (s.startY + s.scroll0);
    const to = targetFor(dy);
    // palec poniżej ostatniego wiersza, nad polem „poza grupą”
    const endTop = endRef.current ? endRef.current.getBoundingClientRect().top : Infinity;
    const out = to === fields.length - 1 && y > endTop;
    setDrag({ from: s.from, to, dy, out });
  };
  const autoscroll = () => {
    const s = st.current;
    if (!s) return;
    const { edge, bottom } = edges();
    // przewijamy dopiero, gdy palec ruszył w stronę krawędzi – samo chwycenie wiersza przy dole ekranu niczego nie przesuwa
    const moved = s.y - s.startY;
    // im bliżej krawędzi, tym szybciej (4–20 px na klatkę)
    const v =
      s.y < edge && moved < -12 ? -Math.min(20, 4 + Math.round((edge - s.y) / 4)) : s.y > bottom && moved > 12 ? Math.min(20, 4 + Math.round((s.y - bottom) / 4)) : 0;
    // w trakcie przewijania bez animacji przesuwania – inaczej przeciągane pole goni szczelinę i zostaje w tyle
    const list = scroller.current?.querySelector<HTMLElement>(".ui-tsl") ?? document.querySelector<HTMLElement>(".ui-tsl");
    if (list) list.toggleAttribute("data-scrolling", !!v);
    if (v) {
      scrollBy(v);
      // przeliczenie w tej samej klatce co przewinięcie – szczelina nie zostaje o klatkę w tyle za listą
      flushSync(() => update(s.y));
    }
    raf.current = requestAnimationFrame(autoscroll);
  };
  const start = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let el = (e.currentTarget as HTMLElement).parentElement;
    while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
    scroller.current = el;
    rows.current.length = fields.length; // po zmianie listy (np. tryb „całe grupy”) zostają odwołania do starych wierszy
    // pozycja w liście (offsetTop) – bez wpływu przewijania i transformacji; ruch palca liczymy osobno (z poprawką na przewinięcie)
    const tops = rows.current.map((r) => (r ? r.offsetTop : 0));
    // wysokość razem z marginesami (bloki grup mają odstępy) – inaczej po przesunięciu zostaje pasek tła
    const outer = (r: HTMLDivElement | null) => {
      if (!r) return 64;
      const cs = getComputedStyle(r);
      return r.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    };
    const hs = rows.current.map(outer);
    inner.current = rows.current.map((r) => r?.offsetHeight ?? 64);
    mbs.current = rows.current.map((r) => (r ? parseFloat(getComputedStyle(r).marginBottom) : 0));
    st.current = { from: i, startY: e.clientY, scroll0: scrollTop(), tops, hs, y: e.clientY };
    setDrag({ from: i, to: i, dy: 0 });
    navigator.vibrate?.(10);
    raf.current = requestAnimationFrame(autoscroll);
  };
  const end = () => {
    document.querySelector(".ui-tsl")?.removeAttribute("data-scrolling");
    // uchwyt ⋮⋮ nie zostaje z fokusem (obwódką) po puszczeniu
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("ui-tsl-handle")) document.activeElement.blur();
    if (raf.current) cancelAnimationFrame(raf.current);
    if (frame.current.id !== null) {
      cancelAnimationFrame(frame.current.id);
      frame.current.id = null;
    }
    const d = drag;
    st.current = null;
    setDrag(null);
    if (d) {
      if (blocks) {
        if (d.to !== d.from) onMove(d.from, d.to, null);
        return;
      }
      const g = d.out ? null : groupAt(d.from, d.to);
      if (d.to !== d.from || g !== (fields[d.from].group ?? null)) {
        onMove(d.from, d.to, g);
        announce(`${fields[d.from].label || "Pole"}: pozycja ${d.to + 1} z ${fields.length}, ${g ? `grupa ${g}` : "bez grupy"}`);
      }
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
  // grupa, do której trafi przeciągane pole (jeśli inna niż jego obecna) – podświetlamy jej wiersze
  const target = drag && !blocks ? (drag.out ? null : groupAt(drag.from, drag.to)) : null;
  const joining = target && target !== (fields[drag?.from ?? -1]?.group ?? null) ? target : null;
  // przeciągane pole stoi w szczelinie, w którą trafi (nie pod palcem) – nic nie zasłania i nie zostaje pasek tła
  const slotDy = () => {
    const st0 = st.current;
    if (!drag || !st0 || drag.out) return drag?.dy ?? 0;
    const { from, to } = drag;
    // dokładnie nad górną krawędzią wiersza pod szczeliną (po jego przesunięciu) – szczelina ma wysokość pola + 2×SPREAD
    const after = to < from ? to : to + 1;
    if (to !== from && after < fields.length && after !== from)
      return st0.tops[after] + shift(after) - (inner.current[from] + 2 * SPREAD) - st0.tops[from];
    // koniec listy (nie ma wiersza pod szczeliną): tuż pod ostatnim wierszem, po jego przesunięciu
    const last = to > from && after >= fields.length ? fields.length - 1 : -1;
    if (last >= 0 && last !== from) return st0.tops[last] + shift(last) + inner.current[last] + (mbs.current[last] ?? 0) - st0.tops[from];
    const top = to > from ? st0.tops[to] + st0.hs[to] - st0.hs[from] : st0.tops[to];
    return top - st0.tops[from];
  };
  // tryb „całe grupy”: między którymi blokami stanie przeciągana grupa
  const blockSpot = (from: number, to: number) => {
    const rest = fields.filter((_, j) => j !== from);
    const name = (f?: TemplateField) => (f ? (f.key.startsWith("g:") ? `grupą „${f.label}”` : `„${f.label}”`) : null);
    const a = name(rest[to - 1]);
    const b = name(rest[to]);
    // krótko – opis musi zmieścić się w wysokości wiersza
    return b ? `Trafi przed ${b}` : a ? `Trafi na koniec, za ${a}` : "";
  };
  // tryb „całe grupy”: grupa, przed którą (albo na końcu – za którą) stanie przeciągany blok
  const blockTarget = (() => {
    if (!drag || !blocks || drag.to === drag.from) return -1;
    const { from, to } = drag;
    const next = to < from ? to : to + 1; // indeks w pierwotnej liście
    return next < fields.length ? next : to < from ? to - 1 : fields.length - 1 === from ? -1 : fields.length - 1;
  })();
  // pole przeciągane na sam koniec listy (za ostatnie pole bez grupy)
  const fieldAtEnd = !!drag && !blocks && !drag.out && drag.to !== drag.from && drag.to === fields.length - 1;
  const blockAtEnd = !!drag && !!blocks && drag.to !== drag.from && drag.to === fields.length - 1;
  // sąsiedzi szczeliny odsuwają się dodatkowo o 4 px – pole wchodzi w lekko rozszerzoną przestrzeń
  const SPREAD = 4;
  // wszystko pod szczeliną zsuwa się o 2×SPREAD (szczelina rośnie w dół, nic nie nachodzi na sąsiadów)
  const spread = (i: number, from: number, to: number) => ((i < from ? i : i - 1) >= to ? 2 * SPREAD : 0);
  // przeciągana grupa: jej ostatnie pole rośnie o 2×SPREAD i wypełnia poszerzoną szczelinę
  const gGrow = (i: number) => !!gd && !!gst.current && gd.to !== gd.from && blockList[gd.from]?.end === i && !!fields[i].group;
  const spreading = !!drag && drag.to !== drag.from && !drag.out;
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    const h = st.current?.hs[drag.from] ?? 64;
    const sp = drag.to !== drag.from && !drag.out ? spread(i, drag.from, drag.to) : 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h + sp;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return h + sp;
    return sp;
  };

  return (
    <div className="ui-group ui-tsl" data-dragging={drag || gd ? true : undefined}>
      {fields.map((f, i) => (
        <Fragment key={f.key}>
        {withHeads && f.group && fields[i - 1]?.group !== f.group && (
          <div
            ref={(el) => {
              heads.current[f.group!] = el;
            }}
            className="ui-tsl-ghead"
            data-lifted={(gd && blockList[gd.from]?.g === f.group) || undefined}
            data-target={(gNeighbour?.g === f.group && blockList[gd!.from]?.g !== f.group) || (joining === f.group) || undefined}
            style={{ transform: gd ? `translateY(${gShift(blockOf(i))}px)` : drag ? `translateY(${drag.from > drag.to && drag.to === i ? 0 : shift(i)}px)` : undefined }}
          >
            <span
              className="ui-tsl-handle"
              role="button"
              tabIndex={0}
              aria-label={`Grupa ${f.group}: przeciągnij albo użyj strzałek w górę i w dół`}
              title="Przeciągnij albo użyj strzałek ↑ ↓"
              data-handle={`g:${f.group}`}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                gKeyStep(f.group!, e.key === "ArrowUp" ? -1 : 1);
              }}
              onPointerDown={(e) => gStart(f.group!, e)}
              onPointerMove={(e) => gst.current && onFrame(e.clientY, gUpdate)}
              onPointerUp={gEnd}
              onPointerCancel={gEnd}
            >
              <IconGripVertical size={20} aria-hidden />
            </span>
            <div className="ui-tsl-ghead-name">
              {/* w trakcie przeciągania nagłówek się nie zmienia (inny tekst = inna wysokość = grupa wjeżdża na sąsiada); cel pokazuje podświetlenie */}
              {groupName!(f.group)}
            </div>
            {groupActions?.(f.group)}
          </div>
        )}
        <div
          key={f.key}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className="ui-tsl-row"
          data-ingroup={!!f.group || undefined}
          data-block={(blocks && f.key.startsWith("g:")) || undefined}
          data-target={(joining && f.group === joining && drag?.from !== i) || (blockTarget === i && (f.key.startsWith("g:") || blockAtEnd)) || (fieldAtEnd && i === fields.length - 1 && !f.group) || (!!gNeighbour && blockOf(i) === blockList.indexOf(gNeighbour) && gd!.from !== blockOf(i)) || undefined}
          data-joining={(joining && drag?.from === i) || undefined}
          data-gfirst={(f.group && fields[i - 1]?.group !== f.group) || undefined}
          data-glast={(f.group && fields[i + 1]?.group !== f.group) || undefined}
          data-lifted={drag?.from === i || undefined}
          data-selected={(selected === i && !drag && !gd) || undefined}
          data-glifted={(gd && gd.from === blockOf(i) && !!f.group) || undefined}
          data-headed={(withHeads && !!f.group) || undefined}
          style={{
            transform: gd ? `translateY(${gShift(blockOf(i))}px)` : drag ? `translateY(${drag.from === i ? slotDy() : shift(i)}px)` : undefined,
            // przeciągany wiersz zachowuje swoją wysokość, a w poszerzonej szczelinie wypełnia ją całą (ramka grupy się nie przerywa)
            height:
              drag?.from === i && st.current
                ? inner.current[i] + (spreading ? 2 * SPREAD : 0)
                : gGrow(i)
                  ? inner.current[i] + 2 * SPREAD
                  : undefined,
            // powiększenie nie może przesuwać reszty listy w układzie strony (przesunięcia liczymy sami)
            // powiększenie o 2×SPREAD nie przesuwa reszty listy: od pierwotnego dolnego marginesu odejmujemy tyle samo
            marginBottom: (drag?.from === i && st.current && spreading) || gGrow(i) ? (mbs.current[i] ?? 0) - 2 * SPREAD : undefined,
          }}
        >
          <span
            className="ui-tsl-handle"
            role="button"
            tabIndex={0}
            aria-label={`${f.label || "Pole"}: przeciągnij albo użyj strzałek w górę i w dół`}
            title="Przeciągnij albo użyj strzałek ↑ ↓"
            data-handle={f.key}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              keyStep(i, e.key === "ArrowUp" ? -1 : 1);
            }}
            onPointerDown={(e) => start(i, e)}
            onPointerMove={(e) => st.current && onFrame(e.clientY, update)}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <IconGripVertical size={20} aria-hidden />
          </span>
          {replaceBody?.(f, i) ?? (
          <UnstyledButton className="ui-tsl-body" onClick={() => !drag && onOpen(i)} aria-current={selected === i || undefined}>
            {renderBody && drag?.from !== i ? renderBody(f, i) : <span className="ui-tpl-name">{f.label || "Bez etykiety"}</span>}
            {/* w trakcie przeciągania opis zastępuje grupa docelowa – wysokość wiersza się nie zmienia, więc pasuje do szczeliny */}
            {drag?.from === i && blocks ? (
              <span className="ui-tpl-meta ui-tsl-target">{blockSpot(drag.from, drag.to)}</span>
            ) : drag?.from === i && !blocks ? (
              <span className="ui-tpl-meta ui-tsl-target">{fieldAtEnd && !groupAt(drag.from, drag.to) ? `Trafi na koniec, za „${fields[fields.length - 1]?.label}”` : `Trafi do: ${(drag.out ? null : groupAt(drag.from, drag.to)) ?? "bez grupy"}`}</span>
            ) : renderBody ? null : (
              <span className="ui-tpl-meta">{describe(f)}</span>
            )}
          </UnstyledButton>
          )}
          <IconChevronRight size={18} className="ui-tpe-grip" aria-hidden />
        </div>
        </Fragment>
      ))}
      {drag && !blocks && fields[fields.length - 1]?.group && (
        <div ref={endRef} className="ui-tpe-endzone" data-drop={drag.out ? "out" : undefined}>
          Przeciągnij tutaj, aby odłożyć pole na koniec, poza grupą
        </div>
      )}
    </div>
  );
}

/** Zwraca dzieci z poprzedniego rysowania, dopóki `deps` się nie zmienią (płynność przeciągania – ciężki panel boczny stoi). */
const Frozen = memo(
  ({ children }: { deps: unknown[]; children: ReactNode }) => <>{children}</>,
  (a, b) => a.deps.length === b.deps.length && a.deps.every((d, i) => Object.is(d, b.deps[i])),
);

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

/** Przesuwa całą grupę o jeden blok w górę lub w dół (blok = inna grupa albo pojedyncze pole bez grupy). */
export function moveGroupBy(fields: TemplateField[], g: string, dir: -1 | 1): TemplateField[] {
  const blocks: TemplateField[][] = [];
  for (const f of fields) {
    const last = blocks[blocks.length - 1];
    if (f.group && last && last[0].group === f.group) last.push(f);
    else blocks.push([f]);
  }
  const i = blocks.findIndex((b) => b[0].group === g);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return fields;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return blocks.flat();
}
