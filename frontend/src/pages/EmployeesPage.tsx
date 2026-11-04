import { useEffect, useMemo, useRef, useState } from "react";
import { rangeToggle, SelectionBar } from "../components/SelectionBar";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SavedFilters, describeQuery, useSavedFilters } from "../components/SavedFilters";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ActionIcon, Collapse, Badge, Button, Checkbox, Drawer, Modal, Paper, Group, Menu, MultiSelect, Pagination, SegmentedControl, Stack, Table, Text, TextInput, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { IconCertificate, IconChevronDown, IconChevronUp, IconFilter, IconFileSpreadsheet, IconFileText, IconPencil, IconPlus, IconPrinter, IconSearch, IconCheck, IconArchive, IconAlertTriangle, IconChevronRight, IconDots, IconDotsVertical, IconAdjustmentsHorizontal, IconBookmark, IconChecks, IconStar, IconStarOff, IconTrash } from "@tabler/icons-react";

import { api, apiDownload, errorText, formatDate, type Employee, type Page } from "../api";
import { notifications } from "@mantine/notifications";
import { useAuth } from "../auth";
import { options, useAgencies, useDepartments, usePositions } from "../dictionaries";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { PrintCardsModal } from "../components/PrintCardsModal";
import { BatchDocumentsModal } from "../components/BatchDocumentsModal";
import { TrainingModal } from "../components/TrainingsCard";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { ActionSheet, Chips, ListRow, PageHead, PickSheet, Segments, SheetHandle, StatusBadge as Status } from "../components/Mobile";

const PAGE_SIZE = 50;

const MISSING = [
  { value: "photo", label: "Brak zdjęcia" },
  { value: "pesel", label: "Brak PESEL" },
  { value: "birth_date", label: "Brak daty urodzenia" },
  { value: "country", label: "Brak obywatelstwa" },
  { value: "agency", label: "Brak APT" },
  { value: "department", label: "Brak wydziału" },
  { value: "position", label: "Brak stanowiska" },
];

export function EmployeesPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const canPrint = hasRole("admin", "hr", "manager");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "active";
  const agency = params.get("agency");
  const department = params.get("department");
  const position = params.get("position");
  const missing = params.getAll("missing");
  const sort = params.get("sort") ?? "name";
  const page = Number(params.get("page") ?? "1");
  const [debouncedQ] = useDebouncedValue(q, 300);

  const agencies = useAgencies();
  const departments = useDepartments();
  const positions = usePositions();


  function update(changes: Record<string, string | string[] | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value !== null && value !== "") next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({
      status,
      sort,
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    if (agency) p.set("agency_id", agency);
    if (department) p.set("department_id", department);
    if (position) p.set("position_id", position);
    missing.forEach((m) => p.append("missing", m));
    return p.toString();
  }, [status, sort, page, debouncedQ, agency, department, position, missing]);

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    p.delete("limit");
    p.delete("offset");
    return p.toString();
  }, [query]);

  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => !!(params.get("agency") || params.get("department") || params.get("position") || params.getAll("missing").length));
  const activeFilters = [agency, department, position].filter(Boolean).length + (missing.length ? 1 : 0);
  const [docsOpen, setDocsOpen] = useState(false);
  const [pick, setPick] = useState<null | "status" | "agency" | "department" | "missing" | "add" | "more" | "selmore" | "filters" | "saved">(null);
  const [sub, setSub] = useState<null | "agency" | "department" | "position" | "missing">(null);
  const [selMode, setSelMode] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<string | null>(null);
  const saved = useSavedFilters();
  // domyślny widok: otwiera się sam, gdy wchodzisz na listę bez żadnych filtrów
  useEffect(() => {
    if (!params.toString() && saved.defaultView) setParams(new URLSearchParams(saved.defaultView.query), { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [trainingOpen, setTrainingOpen] = useState(false);
  async function exportXlsx(withPesel: boolean, format: "xlsx" | "pdf" = "xlsx") {
    setExporting(true);
    try {
      const q = new URLSearchParams(filterQuery);
      if (withPesel) q.set("include_pesel", "true");
      if (format === "pdf") q.set("format", "pdf");
      await apiDownload(`/reports/employees.xlsx?${q.toString()}`, undefined, `pracownicy.${format}`);
      notifications.show({
        color: withPesel ? "orange" : "green",
        message: withPesel
          ? "Pobrano listę z numerami PESEL – przechowuj plik bezpiecznie i usuń, gdy nie będzie potrzebny."
          : "Pobrano listę pracowników.",
      });
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setExporting(false);
    }
  }

  async function selectAllResults() {
    setSelectingAll(true);
    try {
      const ids = await api<number[]>(`/employees/ids?${filterQuery}`);
      setSelected(new Set(ids));
    } finally {
      setSelectingAll(false);
    }
  }

  const lastPicked = useRef<number | null>(null);
  /** kliknięcie pola wiersza na komputerze: z Shift zaznacza zakres od ostatnio klikniętego */
  function pickRow(id: number, shift: boolean) {
    const ids = list.data?.items.map((e) => e.id) ?? [];
    setSelected((prev) => rangeToggle(ids, lastPicked.current, id, shift, prev));
    lastPicked.current = id;
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const list = useQuery({
    queryKey: ["employees", query],
    queryFn: () => api<Page<Employee>>(`/employees?${query}`),
    placeholderData: keepPreviousData,
  });

  const sortHeader = (key: string, label: string) => {
    const active = sort === key || sort === `-${key}`;
    const desc = sort === `-${key}`;
    return (
      <Table.Th>
        <button
          type="button"
          onClick={() => update({ sort: active && !desc ? `-${key}` : key }, false)}
          style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}
        >
          {label}
          {active ? (desc ? " ↓" : " ↑") : ""}
        </button>
      </Table.Th>
    );
  };

  const exportMenu = list.data ? (
        <Menu position="bottom-end" width={260}>
          <Menu.Target>
            <Button size="xs" variant="default" leftSection={<IconFileSpreadsheet size={14} />} loading={exporting}>
              Eksport ({list.data.total})
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Eksport wyników z bieżącymi filtrami</Menu.Label>
            <Menu.Item onClick={() => exportXlsx(false)}>Pobierz listę (Excel)</Menu.Item>
            <Menu.Item onClick={() => exportXlsx(false, "pdf")}>Pobierz listę (PDF)</Menu.Item>
            {staff && (
              <>
                <Menu.Divider />
                <Menu.Item color="orange" onClick={() => exportXlsx(true)}>
                  Z numerami PESEL (Excel)
                </Menu.Item>
                <Menu.Item color="orange" onClick={() => exportXlsx(true, "pdf")}>
                  Z numerami PESEL (PDF)
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
  ) : null;

  if (mobile) {
    const STATUS = [
      { value: "active", label: "Aktywni" },
      { value: "terminated", label: "Archiwum" },
      { value: "all", label: "Wszyscy" },
    ];
    const name = (list: { id: number; name: string }[] | undefined, id: string | null) => list?.find((x) => String(x.id) === id)?.name;
    const names = {
      agency: (id: string) => name(agencies.data, id),
      department: (id: string) => name(departments.data, id),
      position: (id: string) => name(positions.data, id),
    };
    const total = list.data?.total;
    const missingOpts = staff ? MISSING : MISSING.filter((m) => !["pesel", "birth_date"].includes(m.value));
    const warnOf = (e: Employee) =>
      [!e.has_photo && "zdjęcia", staff && !e.has_pesel && "PESEL"].filter(Boolean).join(", ");
    const cur = new URLSearchParams(params);
    cur.delete("page");
    const curQuery = cur.toString();
    const nFilters = activeFilters + (status !== "active" ? 1 : 0);
    const people = (n: number) => (n === 1 ? "osoba" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "osoby" : "osób");
    const summary = [name(agencies.data, agency), name(departments.data, department), name(positions.data, position), missing.length ? "z brakami" : null].filter(Boolean).join(", ");
    const subtitle =
      total === undefined
        ? undefined
        : summary || q.trim()
        ? `${total} ${people(total)} · ${summary || `„${q.trim()}”`}`
        : `${total} · ${STATUS.find((x) => x.value === status)?.label.toLowerCase()}`;
    const positionOpts = (positions.data ?? []).filter((p) => !department || p.department_id === null || p.department_id === Number(department));
    const exitSel = () => {
      setSelMode(false);
      setSelected(new Set());
    };
    const openSave = (initial = "") => {
      setSaveName(initial);
      setSaveOpen(true);
    };
    const curView = saved.items.find((i) => i.query === curQuery);
    const row = (label: string, value: string | undefined, on: boolean, onClick: () => void) => (
      <UnstyledButton className="ui-filter-row" onClick={onClick}>
        <span className="ui-filter-label">{label}</span>
        <span className="ui-filter-value" data-on={on || undefined}>
          {value}
          <IconChevronRight size={16} aria-hidden />
        </span>
      </UnstyledButton>
    );
    return (
      <Stack gap="md" pb={selMode ? 80 : undefined}>
        {selMode ? (
          <div className="ui-selhead">
            <UnstyledButton className="ui-selhead-btn" onClick={exitSel}>Anuluj</UnstyledButton>
            <span className="ui-selhead-title" role="status" aria-live="polite">Zaznaczono {selected.size}</span>
            <UnstyledButton
              className="ui-selhead-btn"
              disabled={selectingAll}
              onClick={() => (selected.size && list.data && selected.size >= list.data.total ? setSelected(new Set()) : selectAllResults())}
            >
              {list.data && selected.size >= list.data.total && selected.size > 0 ? "Odznacz" : `Wszystkie (${total ?? 0})`}
            </UnstyledButton>
          </div>
        ) : (
          <PageHead
            title="Pracownicy"
            subtitle={subtitle}
            extra={{ label: "Więcej akcji", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setPick("more") }}
            action={staff ? { label: "Dodaj pracownika", icon: <IconPlus size={22} />, onClick: () => setPick("add") } : undefined}
          />
        )}
        {!selMode && (
          <TextInput
            aria-label="Szukaj pracownika"
            placeholder="Nazwisko, imię lub nr karty"
            leftSection={<IconSearch size={18} aria-hidden />}
            size="md"
            value={q}
            onChange={(e) => update({ q: e.currentTarget.value })}
          />
        )}
        <Chips
          items={[
            { label: nFilters ? `Filtry · ${nFilters}` : "Filtry", icon: <IconAdjustmentsHorizontal size={16} stroke={2.2} aria-hidden />, active: nFilters > 0, onClick: () => setPick("filters") },
            { label: curView ? curView.name : "Zapisane", icon: <IconBookmark size={15} stroke={2.2} aria-hidden />, active: !!curView, menu: true, onClick: () => setPick("saved") },
            { label: STATUS.find((x) => x.value === status)?.label ?? "Aktywni", menu: true, onClick: () => setPick("status") },
            { label: missing.length ? `Braki: ${missing.length}` : "Z brakami", warn: true, active: missing.length > 0, menu: true, onClick: () => setPick("missing") },
            { label: name(agencies.data, agency) ?? "Agencja", active: !!agency, menu: true, onClick: () => setPick("agency") },
          ]}
        />
        {list.isLoading && <Loading />}
        {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            search={params.toString() !== ""}
            title={q.trim() ? `Brak wyników dla „${q.trim()}”` : params.toString() ? "Brak pracowników dla tych filtrów" : "Nie ma jeszcze pracowników"}
            text={params.toString() ? "Sprawdź pisownię albo wyczyść filtry." : "Dodaj pierwszego pracownika albo zaimportuj listę z arkusza."}
            action={params.toString() ? { label: "Wyczyść filtry", onClick: () => setParams(new URLSearchParams(), { replace: true }) } : undefined}
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <div className="ui-group">
            {list.data.items.map((e) => {
              const w = warnOf(e);
              const on = selected.has(e.id);
              return (
                <ListRow
                  key={e.id}
                  to={selMode ? undefined : `/pracownicy/${e.id}`}
                  onClick={selMode ? () => toggle(e.id) : undefined}
                  pressed={selMode ? on : undefined}
                  leading={
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {selMode && (
                        <span className="ui-check" data-on={on || undefined} aria-hidden>
                          {on && <IconCheck size={16} stroke={3} aria-hidden />}
                        </span>
                      )}
                      <EmployeePhoto employee={e} width={40} />
                    </span>
                  }
                  title={`${e.last_name} ${e.first_name}`}
                  description={
                    <>
                      {[e.department?.name, e.position?.name, e.agency?.name].filter(Boolean).join(" · ") || "—"}
                      {w && (
                        <span className="ui-warn-line">
                          <IconAlertTriangle size={12} stroke={2.6} aria-hidden /> Brak {w}
                        </span>
                      )}
                      {e.status !== "active" && <Status tone="neutral">Archiwum</Status>}
                    </>
                  }
                  trailing={
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{e.number_display}</span>
                      {!selMode && <IconChevronRight size={16} className="ui-row-chevron" aria-hidden />}
                    </span>
                  }
                />
              );
            })}
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && (
          <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={(p) => update({ page: p === 1 ? null : String(p) }, false)} />
        )}

        {selMode && (
          <div className="ui-selbar">
            <Button size="lg" radius="md" style={{ flex: 1 }} leftSection={<IconPrinter size={18} />} disabled={!selected.size} onClick={() => setPrintOpen(true)}>
              Drukuj karty{selected.size ? ` (${selected.size})` : ""}
            </Button>
            {staff && (
              <ActionIcon size={50} radius="md" variant="default" aria-label="Inne akcje dla zaznaczonych" disabled={!selected.size} onClick={() => setPick("selmore")}>
                <IconDots size={22} stroke={2.4} />
              </ActionIcon>
            )}
          </div>
        )}

        {/* menu ⋯ */}
        <ActionSheet
          opened={pick === "more"}
          onClose={() => setPick(null)}
          title="Pracownicy"
          subtitle={total !== undefined ? `${total} ${people(total)} w bieżącym widoku` : undefined}
          actions={[
            ...(canPrint ? [{ label: "Zaznacz kilka osób", description: staff ? "Druk kart, dokumenty, szkolenie dla grupy" : "Druk kart dla grupy", icon: <IconChecks size={20} />, onClick: () => setSelMode(true) }] : []),
            { label: "Zapisz ten widok", description: describeQuery(curQuery, names), icon: <IconBookmark size={20} />, onClick: () => openSave(curView?.name ?? "") },
            { label: "Pobierz listę – Excel", description: "Z bieżącymi filtrami", icon: <IconFileSpreadsheet size={20} />, disabled: exporting || !total, onClick: () => exportXlsx(false) },
            { label: "Pobierz listę – PDF", icon: <IconFileText size={20} />, disabled: exporting || !total, onClick: () => exportXlsx(false, "pdf") },
            ...(staff
              ? [
                  { label: "Z numerami PESEL – Excel", description: "Dane wrażliwe · pobranie trafia do dziennika", icon: <IconAlertTriangle size={20} />, warn: true, disabled: exporting || !total, onClick: () => exportXlsx(true) },
                  { label: "Z numerami PESEL – PDF", description: "Dane wrażliwe · pobranie trafia do dziennika", icon: <IconAlertTriangle size={20} />, warn: true, disabled: exporting || !total, onClick: () => exportXlsx(true, "pdf") },
                ]
              : []),
          ]}
        />
        <ActionSheet
          opened={pick === "selmore"}
          onClose={() => setPick(null)}
          title={`Zaznaczone: ${selected.size}`}
          actions={[
            { label: "Wystaw dokument", icon: <IconFileText size={20} />, onClick: () => setDocsOpen(true) },
            { label: "Dodaj szkolenie", description: selected.size > 200 ? "Najwyżej 200 osób naraz" : undefined, icon: <IconCertificate size={20} />, disabled: selected.size > 200, onClick: () => setTrainingOpen(true) },
          ]}
        />

        {/* wszystkie filtry */}
        <Drawer opened={pick === "filters"} onClose={() => setPick(null)} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label="Filtry">
          <SheetHandle onClose={() => setPick(null)}>
            <div className="ui-sheet-head">
              <div className="ui-sheet-title">Filtry</div>
            </div>
          </SheetHandle>
          <div style={{ padding: "0 16px 10px" }}>
            <Segments value={status} onChange={(v) => update({ status: v === "active" ? null : v })} items={STATUS} />
          </div>
          {row("Agencja", name(agencies.data, agency) ?? "Wszystkie", !!agency, () => setSub("agency"))}
          {row("Wydział", name(departments.data, department) ?? "Wszystkie", !!department, () => setSub("department"))}
          {row("Stanowisko", name(positions.data, position) ?? "Wszystkie", !!position, () => setSub("position"))}
          {row("Braki danych", missing.length ? (missing.length === 1 ? missingOpts.find((m) => m.value === missing[0])?.label : `${missing.length} rodzaje`) : "Bez filtra", missing.length > 0, () => setSub("missing"))}
          <UnstyledButton className="ui-filter-save" onClick={() => openSave(curView?.name ?? "")}>
            <IconBookmark size={18} aria-hidden /> Zapisz jako widok…
          </UnstyledButton>
          <div className="ui-filter-foot">
            <Button size="lg" variant="default" radius="md" style={{ flex: 1 }} onClick={() => setParams(new URLSearchParams(q ? { q } : {}), { replace: true })}>
              Wyczyść
            </Button>
            <Button size="lg" radius="md" style={{ flex: 2 }} onClick={() => setPick(null)}>
              {total === undefined ? "Pokaż" : total === 0 ? "Brak wyników" : `Pokaż ${total} ${people(total)}`}
            </Button>
          </div>
        </Drawer>

        {/* zapisane widoki */}
        <Drawer opened={pick === "saved"} onClose={() => setPick(null)} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label="Zapisane widoki">
          <SheetHandle onClose={() => setPick(null)}>
            <div className="ui-sheet-head">
              <div className="ui-sheet-title">Zapisane widoki</div>
              <div className="ui-row-desc">{saved.items.length ? "Dotknij, aby zastosować. Widoki są zapisane w tej przeglądarce." : "Nie masz jeszcze zapisanych widoków."}</div>
            </div>
          </SheetHandle>
          {saved.items.map((v) => (
            <div key={v.name} className="ui-view-row">
              <UnstyledButton
                className="ui-view-main"
                onClick={() => {
                  setParams(new URLSearchParams(v.query), { replace: true });
                  setPick(null);
                }}
              >
                <IconBookmark size={20} className="ui-view-icon" data-on={v.query === curQuery || undefined} aria-hidden />
                <span className="ui-row-text">
                  <span className="ui-row-title">
                    {v.name}
                    {v.default && <span className="ui-view-tag"> · domyślny</span>}
                  </span>
                  <span className="ui-row-desc">{describeQuery(v.query, names)}</span>
                </span>
              </UnstyledButton>
              <ActionIcon size={44} variant="subtle" color="gray" aria-label={`Opcje widoku ${v.name}`} onClick={() => setViewMenu(v.name)}>
                <IconDotsVertical size={20} />
              </ActionIcon>
            </div>
          ))}
          <UnstyledButton className="ui-filter-save" onClick={() => openSave(curView?.name ?? "")}>
            <IconPlus size={18} aria-hidden /> Zapisz bieżące filtry
          </UnstyledButton>
        </Drawer>
        <ActionSheet
          opened={viewMenu !== null}
          onClose={() => setViewMenu(null)}
          title={viewMenu ?? ""}
          actions={
            viewMenu
              ? [
                  saved.items.find((i) => i.name === viewMenu)?.default
                    ? { label: "Przestań używać jako domyślny", icon: <IconStarOff size={20} />, onClick: () => saved.setDefault(null) }
                    : { label: "Ustaw jako domyślny", description: "Otwiera się sam, gdy wchodzisz na listę bez filtrów", icon: <IconStar size={20} />, onClick: () => saved.setDefault(viewMenu) },
                  { label: "Zmień nazwę", icon: <IconPencil size={20} />, onClick: () => { setRenaming(viewMenu); setSaveName(viewMenu); setSaveOpen(true); } },
                  { label: "Usuń widok", icon: <IconTrash size={20} />, danger: true, onClick: () => saved.remove(viewMenu) },
                ]
              : []
          }
        />
        <Modal
          opened={saveOpen}
          onClose={() => { setSaveOpen(false); setRenaming(null); }}
          title={renaming ? "Zmień nazwę widoku" : "Zapisz widok"}
          size="sm"
        >
          <Stack>
            {!renaming && <Text size="sm" c="dimmed">{describeQuery(curQuery, names)}</Text>}
            <TextInput size="md" label="Nazwa" placeholder="Np. Suszarnia – braki" maxLength={40} value={saveName} onChange={(e) => setSaveName(e.currentTarget.value)} data-autofocus />
            <Button
              size="md"
              disabled={!saveName.trim()}
              onClick={() => {
                if (renaming) saved.rename(renaming, saveName.trim());
                else saved.save(saveName.trim(), curQuery);
                notifications.show({ color: "green", message: renaming ? "Zmieniono nazwę widoku." : `Zapisano widok „${saveName.trim()}”.` });
                setSaveOpen(false);
                setRenaming(null);
              }}
            >
              Zapisz
            </Button>
          </Stack>
        </Modal>

        <PickSheet opened={pick === "status"} onClose={() => setPick(null)} title="Pokaż" options={STATUS} value={[status]} onChange={(v) => update({ status: v[0] === "active" ? null : v[0] })} />
        <PickSheet opened={pick === "missing" || sub === "missing"} onClose={() => { setPick((x) => (x === "missing" ? null : x)); setSub(null); }} title="Braki w danych" options={missingOpts} value={missing} multiple clearLabel="Bez filtra" onChange={(v) => update({ missing: v })} />
        <PickSheet
          opened={pick === "agency" || sub === "agency"}
          onClose={() => { setPick((x) => (x === "agency" ? null : x)); setSub(null); }}
          title="Agencja (APT)"
          options={(agencies.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          value={agency ? [agency] : []}
          clearLabel="Wszystkie agencje"
          onChange={(v) => update({ agency: v[0] ?? null })}
        />
        <PickSheet
          opened={sub === "department"}
          onClose={() => setSub(null)}
          title="Wydział"
          options={(departments.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          value={department ? [department] : []}
          clearLabel="Wszystkie wydziały"
          onChange={(v) => update({ department: v[0] ?? null, position: null })}
        />
        <PickSheet
          opened={sub === "position"}
          onClose={() => setSub(null)}
          title="Stanowisko"
          options={positionOpts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={position ? [position] : []}
          clearLabel="Wszystkie stanowiska"
          onChange={(v) => update({ position: v[0] ?? null })}
        />
        <ActionSheet
          opened={pick === "add"}
          onClose={() => setPick(null)}
          title="Dodaj pracownika"
          actions={[
            { label: "Wpisz ręcznie", icon: <IconPencil size={20} />, onClick: () => navigate("/pracownicy/nowy") },
            { label: "Importuj z arkusza", description: "Excel, Numbers lub CSV", icon: <IconFileSpreadsheet size={20} />, onClick: () => navigate("/pracownicy/import") },
          ]}
        />
        {canPrint && <PrintCardsModal ids={[...selected]} opened={printOpen} onClose={() => setPrintOpen(false)} />}
        {trainingOpen && <TrainingModal employeeIds={[...selected]} editing={null} opened={trainingOpen} onClose={() => setTrainingOpen(false)} />}
        {docsOpen && <BatchDocumentsModal ids={[...selected]} opened={docsOpen} onClose={() => setDocsOpen(false)} />}
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Pracownicy</Title>
          {list.data && (
            <Text size="sm" c="dimmed" role="status" aria-live="polite">
              {list.data.total === 0 ? (params.toString() ? "Brak wyników" : "Brak pracowników") : `Znaleziono: ${list.data.total}`}
            </Text>
          )}
        </div>
        {staff && (
          <Menu position="bottom-end" width={290}>
            <Menu.Target>
              {mobile ? (
                <ActionIcon size={44} radius="md" aria-label="Dodaj pracownika">
                  <IconPlus size={22} />
                </ActionIcon>
              ) : (
                <Button leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={14} />}>
                  Dodaj pracownika
                </Button>
              )}
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} to="/pracownicy/nowy" leftSection={<IconPencil size={16} />}>
                Wpisz ręcznie
              </Menu.Item>
              <Menu.Item component={Link} to="/pracownicy/import" leftSection={<IconFileSpreadsheet size={16} />}>
                Importuj z arkusza (Excel, Numbers, CSV)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <Group align="flex-end" gap="sm">
        <TextInput
          aria-label="Szukaj pracownika"
          placeholder="Nazwisko, imię lub nr karty"
          leftSection={<IconSearch size={16} aria-hidden />}
          value={q}
          onChange={(e) => update({ q: e.currentTarget.value })}
          w={{ base: "100%", sm: 320 }}
        />
        <SegmentedControl
          value={status}
          onChange={(v) => update({ status: v === "active" ? null : v })}
          data={[
            { value: "active", label: "Aktywni" },
            { value: "terminated", label: "Archiwum" },
            { value: "all", label: "Wszyscy" },
          ]}
        />
        <Button
          variant={filtersOpen || activeFilters ? "light" : "default"}
          leftSection={<IconFilter size={16} />}
          rightSection={filtersOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filtry{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
      </Group>
      <Collapse in={filtersOpen}>
        <Group align="flex-end" gap="sm">
        <Select
          label="APT (agencja pracy)"
          placeholder="Wszystkie"
          clearable
          searchable
          w={{ base: "100%", sm: 200 }}
          data={options(agencies.data, agency ? Number(agency) : null)}
          value={agency}
          onChange={(v) => update({ agency: v })}
        />
        <Select
          label="Wydział"
          placeholder="Wszystkie"
          clearable
          searchable
          w={{ base: "100%", sm: 200 }}
          data={options(departments.data, department ? Number(department) : null)}
          value={department}
          onChange={(v) => update({ department: v, position: null })}
        />
        <Select
          label="Stanowisko"
          placeholder="Wszystkie"
          clearable
          searchable
          w={{ base: "100%", sm: 200 }}
          data={options(
            positions.data,
            position ? Number(position) : null,
            (p) => !department || p.department_id === null || p.department_id === Number(department),
          )}
          value={position}
          onChange={(v) => update({ position: v })}
        />
        <MultiSelect
          label="Braki danych"
          placeholder={missing.length ? undefined : "—"}
          clearable
          w={{ base: "100%", sm: 230 }}
          data={staff ? MISSING : MISSING.filter((m) => !["pesel", "birth_date"].includes(m.value))}
          value={missing}
          onChange={(v) => update({ missing: v })}
        />
          <SavedFilters params={params} onApply={(p) => setParams(p, { replace: true })} />
        </Group>
      </Collapse>

      {canPrint && list.data && list.data.total > 0 && (
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed" visibleFrom="sm" style={{ visibility: selected.size ? "hidden" : undefined }}>
            Zaznacz pola przy nazwiskach, aby drukować karty lub wystawiać dokumenty. Shift + kliknięcie zaznacza zakres.
          </Text>
          <Group gap="xs">
            {!mobile && selected.size === 0 && (
              <Button size="xs" variant="subtle" loading={selectingAll} onClick={selectAllResults}>
                Zaznacz wszystkie ({list.data.total})
              </Button>
            )}
            {exportMenu}
          </Group>
        </Group>
      )}

      {list.isLoading && <Loading />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}

      {list.data && list.data.items.length === 0 && (
        <EmptyState
          search={params.toString() !== ""}
          title={q.trim() ? `Brak wyników dla „${q.trim()}”` : params.toString() ? "Brak pracowników dla tych filtrów" : "Nie ma jeszcze pracowników"}
          text={params.toString() ? "Sprawdź pisownię albo wyczyść filtry." : "Dodaj pierwszego pracownika ręcznie albo zaimportuj listę z arkusza."}
          action={
            params.toString()
              ? { label: "Wyczyść wyszukiwanie i filtry", onClick: () => setParams(new URLSearchParams(), { replace: true }) }
              : staff
              ? { label: "Importuj z arkusza", onClick: () => navigate("/pracownicy/import") }
              : undefined
          }
          secondary={!params.toString() && staff ? { label: "Dodaj ręcznie", onClick: () => navigate("/pracownicy/nowy") } : undefined}
        />
      )}

      {list.data && list.data.items.length > 0 && mobile && (
        <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
          {list.data.items.map((e, i) => (
            <Group
              key={e.id}
              wrap="nowrap"
              gap="sm"
              px="sm"
              py={10}
              className={selected.has(e.id) ? "row-selected" : undefined}
              style={{ borderTop: i ? "1px solid var(--apt-line)" : undefined }}
            >
              {canPrint && selected.size > 0 && (
                <Checkbox aria-label={`Zaznacz ${e.last_name} ${e.first_name}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              )}
              <UnstyledButton component={Link} to={`/pracownicy/${e.id}`} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                <EmployeePhoto employee={e} width={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={700} size="sm" truncate>
                    {e.last_name} {e.first_name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {[e.department?.name, e.position?.name, e.agency?.name].filter(Boolean).join(" · ") || "—"}
                  </Text>
                </div>
                <Stack gap={2} align="flex-end">
                  <Text size="xs" c="dimmed" ff="monospace">
                    {e.number_display}
                  </Text>
                  {e.status !== "active" && <StatusBadge active={false} />}
                </Stack>
              </UnstyledButton>
            </Group>
          ))}
        </Paper>
      )}

      {list.data && list.data.items.length > 0 && !mobile && (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                {canPrint && (
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label="Zaznacz wszystkich na tej stronie"
                      checked={list.data.items.every((e) => selected.has(e.id))}
                      indeterminate={
                        list.data.items.some((e) => selected.has(e.id)) &&
                        !list.data.items.every((e) => selected.has(e.id))
                      }
                      onChange={(ev) => {
                        const on = ev.currentTarget.checked;
                        setSelected((prev) => {
                          const next = new Set(prev);
                          list.data!.items.forEach((e) => (on ? next.add(e.id) : next.delete(e.id)));
                          return next;
                        });
                      }}
                    />
                  </Table.Th>
                )}
                <Table.Th w={52} />
                {sortHeader("number", "Nr")}
                {sortHeader("name", "Nazwisko i imię")}
                <Table.Th>APT</Table.Th>
                <Table.Th>Wydział</Table.Th>
                <Table.Th>Stanowisko</Table.Th>
                {sortHeader("hire_date", "Zatrudniony")}
                {status !== "active" && <Table.Th>Status</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.items.map((e) => (
                <Table.Tr
                  key={e.id}
                  style={{ cursor: "pointer" }}
                  className={selected.has(e.id) ? "row-selected" : undefined}
                  onClick={() => navigate(`/pracownicy/${e.id}`)}
                >
                  {canPrint && (
                    <Table.Td onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        aria-label={`Zaznacz ${e.last_name} ${e.first_name}`}
                        checked={selected.has(e.id)}
                        onChange={() => undefined}
                        onClick={(ev) => pickRow(e.id, ev.shiftKey)}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <EmployeePhoto employee={e} width={30} />
                  </Table.Td>
                  <Table.Td ff="monospace">{e.number_display}</Table.Td>
                  <Table.Td>
                    <Link
                      to={`/pracownicy/${e.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                    >
                      {e.last_name} {e.first_name}
                    </Link>
                  </Table.Td>
                  <Table.Td>{e.agency?.name ?? "—"}</Table.Td>
                  <Table.Td>{e.department?.name ?? "—"}</Table.Td>
                  <Table.Td>{e.position?.name ?? "—"}</Table.Td>
                  <Table.Td>{formatDate(e.hire_date)}</Table.Td>
                  {status !== "active" && (
                    <Table.Td>
                      <StatusBadge active={e.status === "active"} />
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {canPrint && list.data && !mobile && (
        <SelectionBar
          count={selected.size}
          total={list.data.total}
          onSelectAll={selectAllResults}
          selectingAll={selectingAll}
          onClear={() => {
            setSelected(new Set());
            lastPicked.current = null;
          }}
        >
          <Button size="sm" leftSection={<IconPrinter size={16} />} onClick={() => setPrintOpen(true)}>
            Drukuj karty ({selected.size})
          </Button>
          {staff && (
            <Button size="sm" variant="default" leftSection={<IconFileText size={16} />} onClick={() => setDocsOpen(true)}>
              Dokument ({selected.size})
            </Button>
          )}
          {staff && (
            <Tooltip label="Najwyżej 200 osób naraz" disabled={selected.size <= 200} withArrow>
              <Button size="sm" variant="default" leftSection={<IconCertificate size={16} />} disabled={selected.size > 200} onClick={() => setTrainingOpen(true)}>
                Szkolenie ({selected.size})
              </Button>
            </Tooltip>
          )}
        </SelectionBar>
      )}

      {list.data && list.data.total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(list.data.total / PAGE_SIZE)}
          value={page}
          onChange={(p) => update({ page: p === 1 ? null : String(p) }, false)}
        />
      )}

      {canPrint && (
        <PrintCardsModal ids={[...selected]} opened={printOpen} onClose={() => setPrintOpen(false)} />
      )}
      {trainingOpen && (
        <TrainingModal employeeIds={[...selected]} editing={null} opened={trainingOpen} onClose={() => setTrainingOpen(false)} />
      )}
      {docsOpen && <BatchDocumentsModal ids={[...selected]} opened={docsOpen} onClose={() => setDocsOpen(false)} />}
    </Stack>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge color="green" variant="light" leftSection={<IconCheck size={12} aria-hidden />}>
      aktywny
    </Badge>
  ) : (
    <Badge color="gray" variant="light" leftSection={<IconArchive size={12} aria-hidden />}>
      archiwum
    </Badge>
  );
}
