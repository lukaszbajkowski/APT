/* Szkolenia na telefonie: matryca, raport i wymagania stanowisk (makiety „Szkolenia na telefonie”). */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Stack, Switch, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconClockHour4,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconLoader,
  IconPlus,
  IconStarFilled,
  IconX,
} from "@tabler/icons-react";

import { api, apiDownload, errorText, formatDate, TRAINING_STATUS, type DictionaryItem, type TrainingStatus, type TrainingType } from "../api";
import { useAuth } from "../auth";
import { REQ_STATE, reqValue, type Matrix, type MatrixCell, type MatrixRow, type PositionReqs, type ReqState } from "./Competence";
import { EMPTY, STATUS_ORDER, rowDates, toQuery, type Filters, type Report } from "./TrainingsReport";
import { ActionSheet, Chips, CompactEmpty, FormScreen, ListRow, PickSheet, Segments, SheetHandle, StatusBadge } from "./Mobile";
import { ErrorState, Loading } from "./States";
import { useNativeValue } from "../lib/nativeInput";

/** Systemowy kalendarz w wierszu filtra; „Wyzeruj” w Safari na iOS też czyści datę. */
function NativeDate({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useNativeValue(ref, value, onChange);
  return <input ref={ref} type="date" className="ui-date" defaultValue={value} aria-label={label} />;
}

type Tone = "ok" | "warn" | "error" | "neutral" | "wait";
const REQ_TONE: Record<ReqState, Tone> = { ok: "ok", expiring: "warn", in_progress: "wait", expired: "warn", missing: "warn" };
export const STATUS_TONE: Record<TrainingStatus, Tone> = {
  valid: "ok",
  completed: "ok",
  expiring: "warn",
  expired: "warn",
  overdue: "warn",
  in_progress: "wait",
  planned: "neutral",
  none: "neutral",
};

const people = (n: number) => (n === 1 ? "osoba" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "osoby" : "osób");

function ReqIcon({ state }: { state: ReqState }) {
  const p = { size: 12, stroke: 3 };
  return state === "ok" ? <IconCheck {...p} /> : state === "expiring" ? <IconClockHour4 {...p} /> : state === "in_progress" ? <IconLoader {...p} /> : state === "expired" ? <IconX {...p} /> : <IconAlertTriangle {...p} />;
}

function Sheet({ opened, onClose, title, subtitle, children }: { opened: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label={title}>
      <SheetHandle onClose={onClose}>
        <div className="ui-sheet-head">
          <div className="ui-sheet-title">{title}</div>
          {subtitle && <div className="ui-row-desc">{subtitle}</div>}
        </div>
      </SheetHandle>
      {children}
    </Drawer>
  );
}

function FilterRow({ label, value, on, onClick }: { label: string; value: string; on: boolean; onClick: () => void }) {
  return (
    <UnstyledButton className="ui-filter-row" onClick={onClick}>
      <span className="ui-filter-label">{label}</span>
      <span className="ui-filter-value" data-on={on || undefined}>
        {value}
        <IconChevronRight size={16} aria-hidden />
      </span>
    </UnstyledButton>
  );
}

// ---------- matryca ----------

/** Liczy, co osoba ma do uzupełnienia (tylko wymagane na jej stanowisku). */
function personSummary(r: MatrixRow, keys: string[]) {
  const cells = keys.map((k) => r.cells[k]).filter((c): c is MatrixCell => !!c && (c.required || c.state !== "missing"));
  const req = cells.filter((c) => c.required);
  const missing = req.filter((c) => c.state === "missing").length;
  const expired = req.filter((c) => c.state === "expired").length;
  const expiring = req.filter((c) => c.state === "expiring").length;
  const progress = cells.filter((c) => c.state === "in_progress").length;
  const todo = missing + expired;
  const text = todo
    ? missing && expired
      ? `${todo} do uzupełnienia`
      : missing
      ? `${missing} ${missing === 1 ? "brak" : "braki"}`
      : `${expired} wygasło`
    : expiring
    ? `${expiring} kończy się`
    : progress
    ? `${progress} w trakcie`
    : req.length
    ? "Komplet"
    : "Bez wymagań";
  const tone: Tone = todo || expiring ? "warn" : progress ? "wait" : req.length ? "ok" : "neutral";
  return { cells, text, tone, bad: todo + expiring };
}

export function MatrixMobile() {
  const navigate = useNavigate();
  const [dep, setDep] = useState<string | null>(null);
  const [pos, setPos] = useState<string | null>(null);
  const [general, setGeneral] = useState(false);
  const [onlyBad, setOnlyBad] = useState(false);
  const [mode, setMode] = useState("people");
  const [sheet, setSheet] = useState<null | "filters" | "dep" | "pos">(null);
  const [person, setPerson] = useState<MatrixRow | null>(null);
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api<(DictionaryItem & { department_id: number | null })[]>("/positions") });
  const params = new URLSearchParams();
  if (dep) params.set("department_id", dep);
  if (pos) params.set("position_id", pos);
  if (general) params.set("general", "true");
  const m = useQuery({ queryKey: ["training-matrix", params.toString()], queryFn: () => api<Matrix>(`/trainings/matrix?${params.toString()}`), placeholderData: keepPreviousData });
  const data = m.data;
  const keys = data?.columns.map((c) => c.key) ?? [];
  const nameOf = (l: { id: number; name: string }[] | undefined, id: string | null) => l?.find((x) => String(x.id) === id)?.name;
  const nFilters = (dep ? 1 : 0) + (pos ? 1 : 0) + (general ? 1 : 0);
  const rows = (data?.rows ?? []).map((r) => ({ r, s: personSummary(r, keys) })).filter((x) => !onlyBad || x.s.bad > 0);
  const byTraining = (data?.columns ?? []).map((c) => {
    const cells = (data?.rows ?? []).map((r) => r.cells[c.key]).filter((x) => x?.required);
    const ok = cells.filter((x) => x.state === "ok").length;
    const expiring = cells.filter((x) => x.state === "expiring").length;
    const progress = cells.filter((x) => x.state === "in_progress").length;
    const bad = cells.filter((x) => x.state === "missing" || x.state === "expired").length;
    return { c, total: cells.length, ok: ok + expiring, expiring, progress, bad };
  }).filter((x) => x.total > 0 && (!onlyBad || x.bad + x.expiring > 0));
  const scope = [nameOf(departments.data, dep), nameOf(positions.data, pos)].filter(Boolean).join(" · ");

  return (
    <Stack gap="md">
      <Chips
        items={[
          { label: nFilters ? `Filtry · ${nFilters}` : "Filtry", icon: <IconAdjustmentsHorizontal size={16} stroke={2.2} aria-hidden />, active: nFilters > 0, onClick: () => setSheet("filters") },
          { label: "Tylko braki", warn: true, active: onlyBad, onClick: () => setOnlyBad((x) => !x) },
        ]}
      />
      <Segments value={mode} onChange={setMode} items={[{ value: "people", label: "Według osób" }, { value: "trainings", label: "Według szkoleń" }]} />
      {scope && <Text size="sm" c="dimmed">{scope}</Text>}
      {m.error && <ErrorState error={m.error} onRetry={() => m.refetch()} />}
      {!data && m.isLoading && <Loading rows={4} />}
      {data && data.columns.length === 0 && <CompactEmpty title="Brak szkoleń do pokazania" text="Dodaj szkolenia stanowiskowe do katalogu albo włącz w filtrach zwykłe szkolenia." />}
      {data && data.columns.length > 0 && mode === "people" && (
        <>
          <div className="ui-legend">
            {(["ok", "expiring", "in_progress", "missing"] as ReqState[]).map((s) => (
              <span key={s} data-tone={REQ_TONE[s]}>
                <ReqIcon state={s} /> {REQ_STATE[s].label}
              </span>
            ))}
          </div>
          {rows.length === 0 ? (
            <CompactEmpty title={onlyBad ? "Nikt nie ma braków" : "Brak osób"} />
          ) : (
            <div className="ui-group">
              {rows.map(({ r, s }) => (
                <ListRow
                  key={r.employee_id}
                  onClick={() => setPerson(r)}
                  title={r.name}
                  description={
                    <>
                      {[r.department, r.position].filter(Boolean).join(" · ") || `nr ${r.number}`}
                      <span className="ui-matrix-line">
                        <span className="ui-matrix-dots">
                          {s.cells.slice(0, 8).map((c, i) => (
                            <span key={i} className="ui-matrix-dot" data-tone={c.state === "missing" && !c.required ? "neutral" : REQ_TONE[c.state]}>
                              <ReqIcon state={c.state} />
                            </span>
                          ))}
                          {s.cells.length > 8 && <span className="ui-row-desc">+{s.cells.length - 8}</span>}
                        </span>
                        <span className="ui-matrix-sum" data-tone={s.tone}>{s.text}</span>
                      </span>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {data && data.columns.length > 0 && mode === "trainings" && (
        byTraining.length === 0 ? (
          <CompactEmpty title={onlyBad ? "Wszystkie wymagania spełnione" : "Żadne szkolenie nie jest wymagane"} text={onlyBad ? undefined : "Ustaw wymagania stanowisk w menu ⋯."} />
        ) : (
          <div className="ui-group">
            {byTraining.map((x) => (
              <ListRow
                key={x.c.key}
                title={x.c.label}
                description={
                  <>
                    {x.total} {x.total === 1 ? "osoba wymaga" : x.total % 10 >= 2 && x.total % 10 <= 4 && (x.total % 100 < 10 || x.total % 100 >= 20) ? "osoby wymagają" : "osób wymaga"}
                    <span className="ui-matrix-line">
                      <span className="ui-bc-bar" role="img" aria-label={`Ma ${x.ok} z ${x.total}`} style={{ flex: 1 }}>
                        <span style={{ width: `${Math.round((x.ok / x.total) * 100)}%`, background: "var(--mantine-color-teal-filled)" }} />
                      </span>
                      <span className="ui-matrix-sum" data-tone={x.bad || x.expiring ? "warn" : x.progress ? "wait" : "ok"}>
                        {x.bad || x.expiring || x.progress
                          ? `${x.ok} z ${x.total}${x.bad ? ` · ${x.bad} brak` : ""}${x.expiring ? ` · ${x.expiring} kończy się` : ""}${!x.bad && !x.expiring && x.progress ? ` · ${x.progress} w trakcie` : ""}`
                          : "Komplet"}
                      </span>
                    </span>
                  </>
                }
                trailing={<span />}
              />
            ))}
          </div>
        )
      )}
      {data?.truncated && <Text size="sm" c="dimmed">Pokazano pierwsze 400 osób – zawęź wydziałem lub stanowiskiem.</Text>}

      <Sheet opened={sheet === "filters"} onClose={() => setSheet(null)} title="Filtry matrycy">
        <FilterRow label="Wydział" value={nameOf(departments.data, dep) ?? "Wszystkie"} on={!!dep} onClick={() => setSheet("dep")} />
        <FilterRow label="Stanowisko" value={nameOf(positions.data, pos) ?? "Wszystkie"} on={!!pos} onClick={() => setSheet("pos")} />
        <div className="ui-filter-row">
          <span className="ui-filter-label">Także zwykłe szkolenia (BHP, badania…)</span>
          <Switch size="md" checked={general} onChange={(e) => setGeneral(e.currentTarget.checked)} aria-label="Pokaż też zwykłe szkolenia" />
        </div>
        <div className="ui-filter-foot">
          <Button size="lg" variant="default" radius="md" style={{ flex: 1 }} onClick={() => { setDep(null); setPos(null); setGeneral(false); }}>
            Wyczyść
          </Button>
          <Button size="lg" radius="md" style={{ flex: 2 }} onClick={() => setSheet(null)}>
            {data ? `Pokaż ${data.rows.length} ${people(data.rows.length)}` : "Pokaż"}
          </Button>
        </div>
      </Sheet>
      <PickSheet
        opened={sheet === "dep"}
        onClose={() => setSheet("filters")}
        title="Wydział"
        options={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
        value={dep ? [dep] : []}
        clearLabel="Wszystkie wydziały"
        onChange={(v) => { setDep(v[0] ?? null); setPos(null); }}
      />
      <PickSheet
        opened={sheet === "pos"}
        onClose={() => setSheet("filters")}
        title="Stanowisko"
        options={(positions.data ?? []).filter((p) => !dep || p.department_id === null || String(p.department_id) === dep).map((p) => ({ value: String(p.id), label: p.name }))}
        value={pos ? [pos] : []}
        clearLabel="Wszystkie stanowiska"
        onChange={(v) => setPos(v[0] ?? null)}
      />

      <Sheet opened={!!person} onClose={() => setPerson(null)} title={person?.name ?? ""} subtitle={person ? [person.department, person.position, personSummary(person, keys).text].filter(Boolean).join(" · ") : undefined}>
        {person &&
          (data?.columns ?? [])
            .map((c) => ({ c, cell: person.cells[c.key] }))
            .filter((x) => x.cell && (x.cell.required || x.cell.state !== "missing"))
            .map(({ c, cell }) => (
              <div key={c.key} className="ui-filter-row" style={{ minHeight: 58 }}>
                <span className="ui-row-text">
                  <span className="ui-row-title">
                    {c.label} {cell.mentor && <IconStarFilled size={12} style={{ color: "var(--mantine-primary-color-text)" }} aria-label="Może prowadzić" />}
                  </span>
                  <span className="ui-row-desc">{[cell.required ? "Wymagane na stanowisku" : c.group, cell.mentor ? "może prowadzić" : null].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusBadge tone={cell.state === "missing" && !cell.required ? "neutral" : REQ_TONE[cell.state]}>
                  {cell.valid_until && cell.state !== "missing" ? `${REQ_STATE[cell.state].label} · do ${formatDate(cell.valid_until)}` : REQ_STATE[cell.state].label}
                </StatusBadge>
              </div>
            ))}
        {person && (
          <div className="ui-filter-foot">
            <Button size="lg" radius="md" variant="default" style={{ flex: 1 }} onClick={() => navigate(`/pracownicy/${person.employee_id}`)}>
              Karta pracownika
            </Button>
            <Button size="lg" radius="md" style={{ flex: 1 }} onClick={() => navigate(`/pracownicy/${person.employee_id}?tab=szkolenia`)}>
              Szkolenia osoby
            </Button>
          </div>
        )}
      </Sheet>
    </Stack>
  );
}

// ---------- raport ----------

export function ReportMobile({ menu, onMenuClose }: { menu: boolean; onMenuClose: () => void }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [sheet, setSheet] = useState<null | "filters" | "type" | "program" | "department" | "mentor" | "status">(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const query = toQuery(f).toString();
  const report = useQuery({ queryKey: ["trainings-report", query], queryFn: () => api<Report>(`/reports/trainings?${query}&limit=300`), placeholderData: keepPreviousData });
  const type = types.data?.find((t) => String(t.id) === f.type_id);
  const programs = (type ? [type] : types.data ?? []).flatMap((t) => t.programs);
  const mentors = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of types.data ?? []) for (const p of t.programs) for (const mm of p.mentors) map.set(mm.id, mm.name);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "pl")).map(([id, name]) => ({ value: String(id), label: name }));
  }, [types.data]);
  const data = report.data;
  const nFilters = (["type_id", "program_id", "department_id", "mentor_id"] as const).filter((k) => f[k]).length + (f.date_from || f.date_to ? 1 : 0) + (f.employees !== "active" ? 1 : 0);
  async function download(format: "xlsx" | "pdf") {
    try {
      const q = toQuery(f);
      if (format === "pdf") q.set("format", "pdf");
      await apiDownload(`/reports/trainings.xlsx?${q.toString()}`, undefined, `szkolenia.${format}`);
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    }
  }
  const tiles: { s: TrainingStatus[]; label: string; tone: Tone }[] = [
    { s: ["overdue", "expired"], label: "Po terminie", tone: "warn" },
    { s: ["in_progress", "planned"], label: "W trakcie", tone: "wait" },
    { s: ["valid", "expiring", "completed"], label: "Ważne", tone: "ok" },
  ];
  const optLabel = (opts: { value: string; label: string }[], v: string | null, all: string) => opts.find((o) => o.value === v)?.label ?? all;
  const typeOpts = (types.data ?? []).map((t) => ({ value: String(t.id), label: t.name }));
  const progOpts = programs.map((p) => ({ value: String(p.id), label: p.department ? `${p.name} · ${p.department}` : p.name }));
  const depOpts = (departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const statusOpts = STATUS_ORDER.map((s) => ({ value: s, label: TRAINING_STATUS[s].label }));
  return (
    <Stack gap="md">
      <Chips
        items={[
          { label: nFilters ? `Filtry · ${nFilters}` : "Filtry", icon: <IconAdjustmentsHorizontal size={16} stroke={2.2} aria-hidden />, active: nFilters > 0, onClick: () => setSheet("filters") },
          { label: f.status.length ? `Status: ${f.status.length}` : "Status", active: f.status.length > 0, menu: true, onClick: () => setSheet("status") },
        ]}
      />
      {data && (
        <div className="ui-tiles">
          {tiles.map((t) => {
            const n = t.s.reduce((a, s) => a + (data.by_status[s] ?? 0), 0);
            const on = t.s.every((s) => f.status.includes(s)) && f.status.length === t.s.length;
            return (
              <UnstyledButton key={t.label} className="ui-tile" data-tone={n ? t.tone : "neutral"} data-on={on || undefined} aria-pressed={on} onClick={() => set("status", on ? [] : t.s)}>
                <span className="ui-tile-n">{n}</span>
                <span className="ui-tile-l">{t.label}</span>
              </UnstyledButton>
            );
          })}
        </div>
      )}
      {report.error && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
      {!data && report.isLoading && <Loading rows={4} />}
      {data && data.total === 0 && <CompactEmpty title="Brak szkoleń dla tych filtrów" text="Zmień lub wyczyść filtry." />}
      {data && data.rows.length > 0 && (
        <div className="ui-group">
          {data.rows.map((r) => (
            <ListRow
              key={r.training_id}
              to={`/pracownicy/${r.employee_id}`}
              title={`${r.last_name} ${r.first_name}`}
              description={
                <>
                  {[r.name ?? r.type_name, r.mentor_name ? `opiekun: ${r.mentor_name}` : rowDates(r) !== "—" ? rowDates(r) : null].filter(Boolean).join(" · ")}
                  <br />
                  <StatusBadge tone={STATUS_TONE[r.status]}>
                    {TRAINING_STATUS[r.status].label}
                    {r.days !== null && !r.completed_on ? ` · dzień ${r.days}${r.standard_days !== null ? ` z ${r.standard_days}` : ""}` : r.valid_until ? ` · do ${formatDate(r.valid_until)}` : ""}
                  </StatusBadge>
                </>
              }
            />
          ))}
        </div>
      )}
      {data && data.total > data.rows.length && <Text size="sm" c="dimmed">Pokazano {data.rows.length} z {data.total}. Pełna lista w eksporcie (menu ⋯).</Text>}

      <ActionSheet
        opened={menu}
        onClose={onMenuClose}
        title="Raport szkoleń"
        subtitle={data ? `${data.total} wpisów z bieżącymi filtrami` : undefined}
        actions={[
          { label: "Pobierz – Excel", icon: <IconFileSpreadsheet size={20} />, onClick: () => download("xlsx") },
          { label: "Pobierz – PDF", icon: <IconFileTypePdf size={20} />, onClick: () => download("pdf") },
        ]}
      />
      <Sheet opened={sheet === "filters"} onClose={() => setSheet(null)} title="Filtry raportu" subtitle="Daty: ukończenie, a dla trwających – rozpoczęcie.">
        <div style={{ padding: "0 16px 10px" }}>
          <Segments value={f.employees} onChange={(v) => set("employees", v as Filters["employees"])} items={[{ value: "active", label: "Aktywni" }, { value: "all", label: "Wszyscy" }]} />
        </div>
        <FilterRow label="Rodzaj" value={optLabel(typeOpts, f.type_id, "Wszystkie")} on={!!f.type_id} onClick={() => setSheet("type")} />
        <FilterRow label="Szkolenie z katalogu" value={optLabel(progOpts, f.program_id, "Wszystkie")} on={!!f.program_id} onClick={() => setSheet("program")} />
        <FilterRow label="Wydział" value={optLabel(depOpts, f.department_id, "Wszystkie")} on={!!f.department_id} onClick={() => setSheet("department")} />
        <FilterRow label="Opiekun" value={optLabel(mentors, f.mentor_id, "Wszyscy")} on={!!f.mentor_id} onClick={() => setSheet("mentor")} />
        <div className="ui-filter-row">
          <span className="ui-filter-label">Od</span>
          <NativeDate value={f.date_from} onChange={(v) => set("date_from", v)} label="Data od" />
        </div>
        <div className="ui-filter-row">
          <span className="ui-filter-label">Do</span>
          <NativeDate value={f.date_to} onChange={(v) => set("date_to", v)} label="Data do" />
        </div>
        <div className="ui-filter-foot">
          <Button size="lg" variant="default" radius="md" style={{ flex: 1 }} onClick={() => setF(EMPTY)}>
            Wyczyść
          </Button>
          <Button size="lg" radius="md" style={{ flex: 2 }} onClick={() => setSheet(null)}>
            {data ? `Pokaż ${data.total} wpisów` : "Pokaż"}
          </Button>
        </div>
      </Sheet>
      <PickSheet opened={sheet === "type"} onClose={() => setSheet("filters")} title="Rodzaj" options={typeOpts} value={f.type_id ? [f.type_id] : []} clearLabel="Wszystkie rodzaje" onChange={(v) => setF((x) => ({ ...x, type_id: v[0] ?? null, program_id: null }))} />
      <PickSheet opened={sheet === "program"} onClose={() => setSheet("filters")} title="Szkolenie z katalogu" options={progOpts} value={f.program_id ? [f.program_id] : []} clearLabel="Wszystkie" onChange={(v) => set("program_id", v[0] ?? null)} />
      <PickSheet opened={sheet === "department"} onClose={() => setSheet("filters")} title="Wydział" options={depOpts} value={f.department_id ? [f.department_id] : []} clearLabel="Wszystkie wydziały" onChange={(v) => set("department_id", v[0] ?? null)} />
      <PickSheet opened={sheet === "mentor"} onClose={() => setSheet("filters")} title="Opiekun" options={mentors} value={f.mentor_id ? [f.mentor_id] : []} clearLabel="Wszyscy" onChange={(v) => set("mentor_id", v[0] ?? null)} />
      <PickSheet opened={sheet === "status"} onClose={() => setSheet(null)} title="Status" options={statusOpts} value={f.status} multiple clearLabel="Wszystkie" onChange={(v) => set("status", v)} />
    </Stack>
  );
}

// ---------- wymagania stanowisk ----------

export function RequirementsMobile() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["position-requirements"], queryFn: () => api<PositionReqs[]>("/position-requirements") });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [dep, setDep] = useState<string | null>(null);
  const [pickDep, setPickDep] = useState(false);
  const [edit, setEdit] = useState<PositionReqs | null>(null);
  const [value, setValue] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const options = (types.data ?? [])
    .filter((t) => t.is_active)
    .flatMap((t) => [
      { value: `t:${t.id}`, label: t.kind === "position" ? `${t.name} (dowolne)` : t.name },
      ...t.programs.map((pr) => ({ value: `p:${t.id}:${pr.id}`, label: `${t.name}: ${pr.name}${pr.department ? ` · ${pr.department}` : ""}` })),
    ]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? edit?.requirements.find((r) => reqValue(r.type_id, r.program_id) === v)?.label ?? v;
  const save = useMutation({
    mutationFn: () =>
      api(`/positions/${edit!.position_id}/requirements`, {
        method: "PUT",
        body: { items: value.map((v) => { const [k, t, pr] = v.split(":"); return { type_id: Number(t), program_id: k === "p" ? Number(pr) : null }; }) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["position-requirements"] });
      qc.invalidateQueries({ queryKey: ["training-matrix"] });
      qc.invalidateQueries({ queryKey: ["employee-requirements"] });
      notifications.show({ color: "green", message: `Zapisano wymagania: ${edit?.position}.` });
      setEdit(null);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const deps = [...new Set((list.data ?? []).map((p) => p.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, "pl"));
  const all = (list.data ?? []).filter((p) => p.is_active !== false);
  const emptyN = all.filter((p) => p.requirements.length === 0).length;
  const rows = all.filter((p) => (!onlyEmpty || p.requirements.length === 0) && (!dep || p.department === dep));
  if (list.isLoading || types.isLoading) return <Loading rows={4} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <Stack gap="md">
      <Chips
        items={[
          { label: dep ?? "Wydział", active: !!dep, menu: true, onClick: () => setPickDep(true) },
          ...(emptyN ? [{ label: `Bez wymagań · ${emptyN}`, warn: true, active: onlyEmpty, onClick: () => setOnlyEmpty((x) => !x) }] : []),
        ]}
      />
      {rows.length === 0 ? (
        <CompactEmpty title={all.length ? "Brak stanowisk dla tego filtra" : "Brak stanowisk w słowniku"} text={all.length ? undefined : "Stanowiska dodaje administrator w Słownikach."} />
      ) : (
        <div className="ui-group">
          {rows.map((p) => (
            <ListRow
              key={p.position_id}
              onClick={staff ? () => { setEdit(p); setValue(p.requirements.map((r) => reqValue(r.type_id, r.program_id))); } : undefined}
              title={p.position}
              description={
                <>
                  {[p.department, p.requirements.length ? `${p.requirements.length} ${p.requirements.length === 1 ? "wymaganie" : p.requirements.length < 5 ? "wymagania" : "wymagań"}` : null].filter(Boolean).join(" · ")}
                  {p.requirements.length ? (
                    <span className="ui-tags">
                      {p.requirements.map((r) => (
                        <span key={r.id} className="ui-tag">{r.label}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="ui-warn-line">
                      <IconAlertTriangle size={12} stroke={2.6} aria-hidden /> Nie ustawiono wymagań
                    </span>
                  )}
                </>
              }
              trailing={staff ? undefined : <span />}
            />
          ))}
        </div>
      )}
      <Text size="sm" c="dimmed">Braki widać w karcie pracownika, w matrycy, w „Brakach w danych” i w poniedziałkowym e-mailu.</Text>
      <PickSheet opened={pickDep} onClose={() => setPickDep(false)} title="Wydział" options={deps.map((d) => ({ value: d, label: d }))} value={dep ? [dep] : []} clearLabel="Wszystkie wydziały" onChange={(v) => setDep(v[0] ?? null)} />

      {edit && (
        <FormScreen
          title="Wymagane szkolenia"
          subtitle={`${edit.position}${edit.department ? ` · ${edit.department}` : ""}`}
          onClose={() => setEdit(null)}
          primary={{ label: "Zapisz", onClick: () => save.mutate(), loading: save.isPending }}
        >
          <Text size="sm" c="dimmed">Pracownicy na tym stanowisku muszą mieć:</Text>
          <div className="ui-group">
            {value.length === 0 && <CompactEmpty title="Brak wymagań" text="Dodaj szkolenia, które są obowiązkowe na tym stanowisku." />}
            {value.map((v) => (
              <ListRow
                key={v}
                title={labelOf(v)}
                trailing={
                  <UnstyledButton className="ui-chat-btn" aria-label={`Usuń wymaganie: ${labelOf(v)}`} onClick={() => setValue((x) => x.filter((y) => y !== v))}>
                    <IconX size={18} stroke={2.4} />
                  </UnstyledButton>
                }
              />
            ))}
            <ListRow leading={<span className="ui-row-icon" aria-hidden><IconPlus size={20} /></span>} title="Dodaj wymaganie" onClick={() => setAdding(true)} />
          </div>
        </FormScreen>
      )}
      <PickSheet opened={adding} onClose={() => setAdding(false)} title="Wymagane szkolenia" options={options} value={value} multiple onChange={setValue} />
    </Stack>
  );
}

