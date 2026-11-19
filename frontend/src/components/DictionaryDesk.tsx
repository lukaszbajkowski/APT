import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Button, Drawer, Group, Menu, SegmentedControl, Skeleton, Switch, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { Select } from "./AptSelect";
import { CompactEmpty, PageTitle } from "./Mobile";
import { ErrorState } from "./States";
import { useConfirm } from "../lib/confirm";
import { countListChanges } from "../lib/changes";
import { TouchSortList } from "./TemplateEditDesktop";
import type { TemplateField } from "../api";

export interface DictItem {
  id: number;
  name: string;
  is_active: boolean;
  code?: string | null;
  iso_code?: string | null;
  department_id?: number | null;
  email?: string | null;
}
export type DictKind = "agencies" | "departments" | "positions" | "countries";
export const DICT: Record<DictKind, { title: string; noun: string; many: [string, string, string]; codeLabel?: string; codeKey?: "code" | "iso_code" }> = {
  agencies: { title: "APT", noun: "APT", many: ["agencja", "agencje", "agencji"], codeLabel: "Skrót", codeKey: "code" },
  departments: { title: "Wydziały", noun: "wydział", many: ["wydział", "wydziały", "wydziałów"], codeLabel: "Skrót", codeKey: "code" },
  positions: { title: "Stanowiska", noun: "stanowisko", many: ["stanowisko", "stanowiska", "stanowisk"] },
  countries: { title: "Kraje", noun: "kraj", many: ["kraj", "kraje", "krajów"], codeLabel: "Kod ISO", codeKey: "iso_code" },
};
const plural = (n: number, [one, few, many]: [string, string, string]) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
const people = (n: number) => (n === 0 ? "Brak osób" : `${n} ${plural(n, ["osoba", "osoby", "osób"])}`);

// nowe pozycje (jeszcze niezapisane) mają ujemne id
let seq = -1;

/**
 * Słowniki na komputerze (wariant A z makiety): jak Checklisty i edycja szablonu – kartka z grupami
 * (stanowiska wg wydziału, pozostałe: „Aktywne” / „Nieużywane”), edycja wybranej pozycji w panelu obok
 * (w wąskim oknie – szuflada z prawej), zmiany zbierane i zapisywane paskiem „Odrzuć / Zapisz”.
 */
export function DictionaryDesk({ queries }: { queries: Record<DictKind, UseQueryResult<DictItem[]>> }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [kind, setKind] = useState<DictKind>("agencies");
  const [search, setSearch] = useState("");
  const q = queries[kind];
  const saved = useMemo(() => q.data ?? [], [q.data]);
  const [items, setItems] = useState<DictItem[]>(saved);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // lista na nowo przy zmianie słownika lub po zapisie (dane z serwera)
  useEffect(() => {
    setItems(saved);
    setSel((s) => (s !== null && saved.some((x) => x.id === s) ? s : (saved[0]?.id ?? null)));
  }, [saved]);
  const usage = useQuery({ queryKey: ["dictionaries-usage"], queryFn: () => api<Record<DictKind, Record<string, number>>>("/dictionaries/usage") });
  const uses = (id: number) => usage.data?.[kind]?.[String(id)] ?? 0;
  const changes = countListChanges(items, saved, (x) => (x.id > 0 ? x.id : null));
  const dirty = changes > 0;
  const cfg = DICT[kind];
  const cur = items.find((x) => x.id === sel) ?? null;
  const upd = (id: number, p: Partial<DictItem>) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const departments = queries.departments.data ?? [];
  const deptName = (id?: number | null) => (id ? (departments.find((d) => d.id === id)?.name ?? "Inny wydział") : "Wszystkie wydziały");

  // wąsko: panel w szufladzie z prawej (jak Checklisty)
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 880));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pickKind = async (k: DictKind) => {
    if (k === kind) return;
    if (dirty && !(await confirm({ title: "Niezapisane zmiany", message: `Zmiany w słowniku „${cfg.title}” przepadną.`, confirmLabel: "Przełącz bez zapisu", cancelLabel: "Zostań" }))) return;
    setKind(k);
    setSearch("");
    setError(null);
  };
  const pick = (id: number) => {
    setSel(id);
    if (narrow) setPanelOpen(true);
  };
  const add = () => {
    const it: DictItem = { id: seq--, name: "", is_active: true, code: null, iso_code: null, email: null, department_id: null };
    setItems((l) => [it, ...l]);
    pick(it.id);
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const it of items) {
        const body: Record<string, unknown> = { name: it.name.trim() };
        if (cfg.codeKey) body[cfg.codeKey] = it[cfg.codeKey]?.trim() ? it[cfg.codeKey]!.trim().toUpperCase() : null;
        if (kind === "agencies") body.email = it.email?.trim() || null;
        if (kind === "positions") body.department_id = it.department_id ?? null;
        if (it.id < 0) await api(`/${kind}`, { method: "POST", body });
        else {
          const was = saved.find((x) => x.id === it.id);
          if (was && JSON.stringify(was) !== JSON.stringify(it)) await api(`/${kind}/${it.id}`, { method: "PATCH", body: { ...body, is_active: it.is_active } });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["dictionaries-usage"] });
      setError(null);
      notifications.show({ color: "green", message: "Zapisano." });
    },
    onError: (err) => setError(errorText(err)),
  });
  const emptyName = items.some((x) => !x.name.trim());

  // grupy: stanowiska wg wydziału, pozostałe słowniki – „Aktywne” i „Nieużywane”
  const term = search.trim().toLowerCase();
  const shown = items.filter((x) => x.id < 0 || x.name.toLowerCase().includes(term));
  const groups: { key: string; label: string; hint?: string; rows: DictItem[] }[] = [];
  if (kind === "positions") {
    const by = new Map<string, DictItem[]>();
    for (const x of shown.filter((x) => x.is_active)) {
      const k = deptName(x.department_id);
      by.set(k, [...(by.get(k) ?? []), x]);
    }
    for (const [k, rows] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b, "pl"))) groups.push({ key: k, label: k, rows });
  } else {
    const act = shown.filter((x) => x.is_active);
    if (act.length) groups.push({ key: "on", label: "Aktywne", rows: act });
  }
  const off = shown.filter((x) => !x.is_active);
  if (off.length) groups.push({ key: "off", label: "Nieużywane", hint: "Wyłączone – nie pokazują się przy dodawaniu osób", rows: off });

  const meta = (x: DictItem) =>
    [
      cfg.codeKey && x[cfg.codeKey] ? `${cfg.codeLabel} ${x[cfg.codeKey]}` : null,
      kind === "agencies" ? (x.email ? x.email : "Brak e-maila do zestawień") : null,
      x.id < 0 ? "Nowa pozycja" : people(uses(x.id)),
    ]
      .filter(Boolean)
      .join(" · ");

  // stanowiska: przeciąganie jak pola w edycji szablonu (ten sam komponent) – grupa = wydział;
  // przeniesienie do innej grupy zmienia wydział, poza grupami – stanowisko dla wszystkich wydziałów
  const deptByName = new Map(departments.map((d) => [d.name, d.id]));
  const posOrder = [...shown].sort((a, b) => {
    const da = a.department_id ? deptName(a.department_id) : "";
    const db = b.department_id ? deptName(b.department_id) : "";
    return da.localeCompare(db, "pl") || a.name.localeCompare(b.name, "pl");
  });
  const asFields = posOrder.map((x) => ({ key: String(x.id), label: x.name, group: x.department_id ? deptName(x.department_id) : null, type: "text", required: false }) as unknown as TemplateField);
  const posList = (
    <div className="ui-tpe-plist ui-tpe-paper ui-dict-plist">
      <TouchSortList
        fields={asFields}
        canvas
        selected={sel !== null ? posOrder.findIndex((x) => x.id === sel) : undefined}
        onOpen={(i) => pick(posOrder[i].id)}
        onMove={(from, _to, group) => {
          const x = posOrder[from];
          const dep = group ? (deptByName.get(group) ?? null) : null;
          if (x && (x.department_id ?? null) !== dep) upd(x.id, { department_id: dep });
          if (x) setSel(x.id);
        }}
        describe={() => ""}
        groupName={(g) => (
          <span className="ui-tsl-ghead-btn">
            <span className="ui-tpl-name">{g}</span>
            <span className="ui-tpl-meta">
              {((n) => `${n} ${plural(n, cfg.many)}`)(posOrder.filter((x) => x.department_id && deptName(x.department_id) === g).length)}
            </span>
          </span>
        )}
        renderBody={(f) => {
          const x = posOrder.find((p) => String(p.id) === f.key)!;
          return (
            <div className="ui-dict-prow" data-dim={!x.is_active || undefined}>
              <span className="ui-cl-text">
                <span className="ui-cl-name">{x.name.trim() || "Nowa pozycja"}</span>
                <span className="ui-cl-meta">{x.is_active ? meta(x) : `Wyłączone · ${meta(x)}`}</span>
              </span>
              {x.id > 0 && <span className="ui-cl-chip">{uses(x.id)}</span>}
            </div>
          );
        }}
      />
    </div>
  );
  const list = (
    <div className="ui-cl-list" role="group" aria-label={`Pozycje: ${cfg.title}`}>
      {groups.flatMap((g) => [
        <div key={`g:${g.key}`} className="ui-cl-glabel">
          {g.label}
          <small>{g.hint ?? `${g.rows.length} ${plural(g.rows.length, cfg.many)}`}</small>
        </div>,
        ...g.rows.map((x, i) => (
          <div key={x.id} className="ui-cl-row" data-on={sel === x.id || undefined} data-dim={!x.is_active || undefined} data-glast={i === g.rows.length - 1 || undefined}>
            <button type="button" className="ui-cl-pick ui-dict-pick" onClick={() => pick(x.id)} aria-pressed={sel === x.id}>
              <span className="ui-cl-text">
                <span className="ui-cl-name">{x.name.trim() || "Nowa pozycja"}</span>
                <span className="ui-cl-meta" data-warn={(kind === "agencies" && !x.email && x.id > 0) || undefined}>
                  {meta(x)}
                </span>
              </span>
              {x.id > 0 && <span className="ui-cl-chip">{uses(x.id)}</span>}
            </button>
          </div>
        )),
      ])}
    </div>
  );

  const editor = cur ? (
    <section className="ui-cl-pbody" aria-label="Wybrana pozycja">
      {!narrow && <h2 className="ui-dsec-title">{cur.name.trim() || `Nowe: ${cfg.noun}`}</h2>}
      <TextInput label="Nazwa" required value={cur.name} error={!cur.name.trim() ? "Wpisz nazwę" : undefined} onChange={(e) => upd(cur.id, { name: e.currentTarget.value })} data-autofocus />
      {cfg.codeKey && (
        <TextInput
          label={cfg.codeLabel}
          description="Opcjonalnie"
          maxLength={kind === "countries" ? 2 : 32}
          value={cur[cfg.codeKey] ?? ""}
          onChange={(e) => upd(cur.id, { [cfg.codeKey!]: e.currentTarget.value })}
        />
      )}
      {kind === "agencies" && (
        <TextInput
          label="E-mail do zestawień"
          description="Kilka adresów oddziel przecinkiem. Bez adresu zestawienia dla tej agencji nie wyjdą."
          placeholder="Np. kadry@agencja.pl"
          value={cur.email ?? ""}
          onChange={(e) => upd(cur.id, { email: e.currentTarget.value })}
        />
      )}
      {kind === "positions" && (
        <Select
          label="Wydział"
          placeholder="Wszystkie wydziały"
          clearable
          data={departments.filter((d) => d.is_active || d.id === cur.department_id).map((d) => ({ value: String(d.id), label: d.name }))}
          value={cur.department_id ? String(cur.department_id) : null}
          onChange={(v) => upd(cur.id, { department_id: v ? Number(v) : null })}
        />
      )}
      {cur.id > 0 && (
        <Switch
          label="Aktywne"
          description="Wyłączone nie pokazują się przy dodawaniu osób; przypisane osoby je zachowują."
          checked={cur.is_active}
          onChange={(e) => upd(cur.id, { is_active: e.currentTarget.checked })}
        />
      )}
      {cur.id > 0 ? (
        <Text size="sm" c="dimmed" className="ui-dict-use">
          {uses(cur.id) ? `Używa ${people(uses(cur.id)).toLowerCase()}. Pozycji nie usuwa się – wyłącz ją, gdy przestanie być potrzebna.` : "Nikt jej nie używa. Pozycji nie usuwa się – wyłącz ją, gdy przestanie być potrzebna."}
        </Text>
      ) : (
        <Button
          variant="light"
          color="red"
          leftSection={<IconTrash size={16} />}
          w="fit-content"
          onClick={() => {
            setItems((l) => l.filter((x) => x.id !== cur.id));
            setSel(saved[0]?.id ?? null);
            setPanelOpen(false);
          }}
        >
          Usuń nową pozycję
        </Button>
      )}
    </section>
  ) : (
    <Text size="sm" c="dimmed">
      Wybierz pozycję z listy, aby ją zmienić.
    </Text>
  );

  return (
    <div className="ui-cl ui-emp ui-dict" ref={rootRef}>
      <PageTitle
        title="Słowniki"
        meta={q.data ? `${cfg.title} · ${q.data.length}` : undefined}
        actions={
          <>
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={add}>
              Dodaj {cfg.noun}
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" px={0} w={36} aria-label="Więcej">
                  <IconDots size={18} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setItems((l) => l.map((x) => (x.id > 0 && !uses(x.id) && x.is_active ? { ...x, is_active: false } : x)))}>Wyłącz nieużywane pozycje</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />
      {/* jak w Pracownikach: wyszukiwarka i przełącznik słownika (z liczbami) w jednym wierszu */}
      <Group align="center" gap={10} wrap="nowrap" className="ui-emp-search-row">
        <TextInput aria-label="Szukaj w słowniku" placeholder={`Szukaj: ${cfg.title.toLowerCase()}`} leftSection={<IconSearch size={16} aria-hidden />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} style={{ flex: 1, minWidth: 0 }} />
        <SegmentedControl
          value={kind}
          onChange={(v) => void pickKind(v as DictKind)}
          aria-label="Słownik"
          data={(Object.keys(DICT) as DictKind[]).map((k) => ({ value: k, label: `${DICT[k].title}${queries[k].data ? ` ${queries[k].data!.length}` : ""}` }))}
        />
      </Group>
      {error && <Text className="ui-ef-pending">{error}</Text>}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="ui-cl-grid" data-narrow={narrow || undefined}>
          <div className="ui-cl-paper">
            {q.isLoading ? (
              [0, 1].map((g) => (
                <div key={g} style={{ marginBottom: 12 }}>
                  <Skeleton height={44} radius="md" mb={4} />
                  <Skeleton height={48} mb={4} />
                  <Skeleton height={48} />
                </div>
              ))
            ) : kind === "positions" && shown.length ? (
              posList
            ) : groups.length ? (
              list
            ) : (
              <CompactEmpty title={term ? `Brak wyników dla „${search.trim()}”` : "Słownik jest pusty"} text={term ? "Sprawdź pisownię albo zajrzyj do innego słownika." : `Dodaj pierwszą pozycję przyciskiem „Dodaj ${cfg.noun}”.`} />
            )}
          </div>
          {!narrow && <aside className="ui-cl-side ui-cl-panel">{editor}</aside>}
        </div>
      )}
      <Drawer opened={narrow && panelOpen && !!cur} onClose={() => setPanelOpen(false)} position="right" size={420} title={cur?.name.trim() || `Nowe: ${cfg.noun}`} overlayProps={{ backgroundOpacity: 0.12 }}>
        {editor}
      </Drawer>
      <div className="ui-tpe-save ui-cl-save">
        <Text size="sm" className={dirty ? "ui-ef-pending" : undefined} c={dirty ? undefined : "dimmed"}>
          {dirty ? (emptyName ? "Uzupełnij nazwy, żeby zapisać." : `Niezapisane zmiany: ${changes}`) : "Wszystko zapisane."}
        </Text>
        <Group gap="xs" wrap="nowrap">
          {dirty && (
            <Button variant="default" onClick={() => setItems(saved)}>
              Odrzuć
            </Button>
          )}
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || emptyName}>
            Zapisz
          </Button>
        </Group>
      </div>
    </div>
  );
}
