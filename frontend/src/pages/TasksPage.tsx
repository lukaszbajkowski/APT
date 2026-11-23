import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Anchor, Button, Checkbox, Drawer, Group, Progress, SegmentedControl, Skeleton, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconSearch, IconUser } from "@tabler/icons-react";

import { api, errorText, formatDate } from "../api";
import { useAuth } from "../auth";
import { ChecklistTemplates, RESPONSIBLE, type ChecklistItem } from "../components/Lifecycle";
import { ErrorState, Loading } from "../components/States";
import { CompactEmpty, PageTitle, Segments, SheetHandle, SwipeRow, useSheetResize, WrapRow } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

interface Task extends ChecklistItem {
  employee_id: number;
  employee: string;
  number: string;
  department: string | null;
}

export function TasksPage({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const { hasRole } = useAuth();
  const mobile = useIsPhone();
  const [mine, setMine] = useState(hasRole("manager") ? "mine" : "all");
  // licznik w nagłówku – ta sama lista co w tabeli (wspólna pamięć zapytań)
  const tasks = useQuery({
    queryKey: ["tasks", mine],
    queryFn: () => api<Task[]>(`/tasks${mine === "mine" ? "?mine=true" : ""}`),
    enabled: !mobile && !settingsOnly,
  });
  const openCount = tasks.data?.length;
  const lateCount = tasks.data?.filter((t) => t.state === "overdue").length ?? 0;
  if (mobile && settingsOnly) return <ChecklistTemplates />;
  if (mobile) return <OpenTasks />;
  if (settingsOnly)
    return (
      <Stack maw={1760}>
        <ChecklistTemplates
          page={{
            title: "Checklisty",
            description: "Zadania tworzone przy zatrudnieniu i odejściu – dla wszystkich albo wybranych APT i wydziałów. Otwarte zadania są w „Dziś”.",
          }}
        />
      </Stack>
    );
  return (
    <Stack maw={1760} className="ui-emp">
      <PageTitle
        title="Zadania"
        meta={openCount !== undefined ? `${lateCount ? `Po terminie ${lateCount} · ` : ""}Otwartych ${openCount}` : undefined}
        description="Zadania z checklist wdrożenia i odejścia. Ustawienia checklist są w „Checklisty”."
        actions={
          <SegmentedControl
            value={mine}
            onChange={setMine}
            aria-label="Czyje zadania"
            data={[
              { value: "mine", label: hasRole("manager") ? "Moje (kierownik)" : "Moje (HR)" },
              { value: "all", label: "Wszystkie" },
            ]}
          />
        }
      />
      <OpenTasks mine={mine} />
    </Stack>
  );
}

// ——— Lista otwartych zadań: wzorzec „edytor listy” (kartka z grupami + panel / arkusz), bez przeciągania ———
type GroupBy = "due" | "person";
const WEEK = 7 * 24 * 3600 * 1000;
const kindLabel = (k: Task["kind"]) => (k === "onboarding" ? "Wdrożenie" : "Odejście");
const plural = (n: number, f: [string, string, string]) => (n === 1 ? f[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? f[1] : f[2]);
const SHOW = 8;

function OpenTasks({ mine: mineProp }: { mine?: string } = {}) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [mineOwn, setMine] = useState(hasRole("manager") ? "mine" : "all");
  const mine = mineProp ?? mineOwn;
  const [by, setBy] = useState<GroupBy>("due");
  const [kind, setKind] = useState<"all" | "onboarding" | "offboarding">("all");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetH, setSheetH] = useState(60);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const sheet = useSheetResize(
    () => setSheetOpen(false),
    (vh) => setSheetH(vh),
  );
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

  const q = useQuery({ queryKey: ["tasks", mine], queryFn: () => api<Task[]>(`/tasks${mine === "mine" ? "?mine=true" : ""}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["employee-checklists"] });
    qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
  };
  const setDone = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => api(`/checklist-items/${id}`, { method: "PATCH", body: { done } }),
    onSuccess: (_r, v) => {
      refresh();
      if (v.done)
        notifications.show({
          color: "teal",
          message: (
            <Group gap="sm" wrap="nowrap" justify="space-between">
              <span>Odhaczono</span>
              <Anchor component="button" type="button" size="sm" onClick={() => setDone.mutate({ id: v.id, done: false })}>
                Cofnij
              </Anchor>
            </Group>
          ),
        });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const term = search.trim().toLowerCase();
  const all = q.data ?? [];
  const shown = all.filter((t) => (kind === "all" || t.kind === kind) && (!term || `${t.label} ${t.employee} ${t.number}`.toLowerCase().includes(term)));
  const lateCount = all.filter((t) => t.state === "overdue").length;
  const cur = shown.find((t) => t.id === sel) ?? null;

  // grupy: po terminie (zaległe · ten tydzień · później) albo po osobie (najstarsze zaległe na górze)
  const groups: { key: string; label: string; sub: React.ReactNode; warn?: boolean; rows: Task[] }[] = [];
  const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  if (by === "due") {
    const now = Date.now();
    const late = shown.filter((t) => t.state === "overdue").sort(byDue);
    const week = shown.filter((t) => t.state !== "overdue" && t.due_date && new Date(t.due_date).getTime() - now <= WEEK).sort(byDue);
    const later = shown.filter((t) => !late.includes(t) && !week.includes(t)).sort(byDue);
    if (late.length) groups.push({ key: "late", label: "Po terminie", sub: `${late.length} ${plural(late.length, ["zadanie", "zadania", "zadań"])}`, warn: true, rows: late });
    if (week.length) groups.push({ key: "week", label: "W ciągu 7 dni", sub: `${week.length} ${plural(week.length, ["zadanie", "zadania", "zadań"])}`, rows: week });
    if (later.length) groups.push({ key: "later", label: "Później", sub: `${later.length} ${plural(later.length, ["zadanie", "zadania", "zadań"])}`, rows: later });
  } else {
    const m = new Map<number, Task[]>();
    for (const t of shown) m.set(t.employee_id, [...(m.get(t.employee_id) ?? []), t]);
    [...m.values()]
      .map((rows) => rows.sort(byDue))
      .sort((a, b) => byDue(a[0], b[0]))
      .forEach((rows) => {
        const t = rows[0];
        const late = rows.filter((x) => x.state === "overdue").length;
        groups.push({
          key: `p${t.employee_id}`,
          label: t.employee,
          sub: (
            <>
              {[`nr ${t.number}`, t.department].filter(Boolean).join(" · ")} ·{" "}
              {late ? <span className="ui-warn">{late} po terminie</span> : `${rows.length} ${plural(rows.length, ["zadanie", "zadania", "zadań"])}`}
            </>
          ),
          rows,
        });
      });
  }

  const pick = (t: Task) => {
    setSel(t.id);
    if (phone) setSheetOpen(true);
    else if (narrow) setPanelOpen(true);
  };
  const meta = (t: Task) => (by === "due" ? [t.employee, kindLabel(t.kind), RESPONSIBLE[t.responsible]] : [kindLabel(t.kind), RESPONSIBLE[t.responsible]]).join(" · ");

  // telefon: przesunięcie wiersza w lewo = „Odhacz” (druga droga: pole zaznaczenia i przycisk w arkuszu);
  // przytrzymanie – menu z „Otwórz kartę”
  const wrapSwipe = (t: Task, body: React.ReactNode) =>
    phone ? (
      <SwipeRow
        menuTitle={t.label}
        menuSubtitle={t.employee}
        actions={[
          ...(t.can_edit ? [{ label: "Odhacz", tone: "accent" as const, icon: <IconCheck size={20} />, onClick: () => setDone.mutate({ id: t.id, done: true }) }] : []),
          { label: "Otwórz kartę", icon: <IconUser size={20} />, menuOnly: true, onClick: () => navigate(`/pracownicy/${t.employee_id}`) },
        ]}
      >
        <div className="ui-tk-swipe">{body}</div>
      </SwipeRow>
    ) : (
      body
    );
  const list = (
    <div className="ui-cl-list" role="group" aria-label="Otwarte zadania">
      {groups.flatMap((g) => {
        const open = more[g.key] || g.rows.length <= SHOW + 1;
        const rows = open ? g.rows : g.rows.slice(0, SHOW);
        return [
          <div key={`g:${g.key}`} className="ui-cl-glabel" data-warn={g.warn || undefined}>
            {g.label}
            <small>{g.sub}</small>
          </div>,
          ...rows.map((t, i) => (
            <div key={t.id} className="ui-cl-row ui-tk-row" data-on={(sel === t.id && (!phone || sheetOpen)) || undefined} data-glast={(open && i === rows.length - 1) || undefined}>
              {wrapSwipe(
                t,
                <>
                  <Checkbox
                    className="ui-tk-check"
                    aria-label={`Odhacz: ${t.label}`}
                    disabled={!t.can_edit || setDone.isPending}
                    checked={false}
                    onChange={() => setDone.mutate({ id: t.id, done: true })}
                  />
                  <button type="button" className="ui-cl-pick" onClick={() => pick(t)} aria-pressed={sel === t.id}>
                    <span className="ui-cl-text">
                      <span className="ui-cl-name">
                        {t.label}
                        {t.auto ? " ⚡" : ""}
                      </span>
                      <span className="ui-cl-meta">{meta(t)}</span>
                    </span>
                    <span className="ui-tk-due" data-warn={t.state === "overdue" || undefined}>
                      {t.due_date ? formatDate(t.due_date) : "bez terminu"}
                    </span>
                  </button>
                </>,
              )}
            </div>
          )),
          ...(open
            ? []
            : [
                <div key={`m:${g.key}`} className="ui-cl-row ui-tk-more" data-glast>
                  <UnstyledButton className="ui-cl-pick" onClick={() => setMore((m) => ({ ...m, [g.key]: true }))}>
                    <span className="ui-cl-name">Pokaż wszystkie {g.rows.length}</span>
                  </UnstyledButton>
                </div>,
              ]),
        ];
      })}
    </div>
  );

  const editor = cur ? <TaskPanel t={cur} phone={phone} titled={!narrow && !phone} onDone={() => setDone.mutate({ id: cur.id, done: true })} busy={setDone.isPending} /> : (
    <Text size="sm" c="dimmed">
      Wybierz zadanie z listy, aby zobaczyć szczegóły.
    </Text>
  );
  const empty = (
    <CompactEmpty
      title={term || kind !== "all" ? "Brak zadań dla tego filtra" : "Brak otwartych zadań"}
      text={term || kind !== "all" ? "Zmień wyszukiwanie albo rodzaj checklisty." : "Wszystko zrobione."}
    />
  );
  const byControl = (full?: boolean) =>
    full ? (
      <Segments value={by} onChange={(v) => setBy(v as GroupBy)} items={[{ value: "due", label: "Po terminie" }, { value: "person", label: "Po osobach" }]} />
    ) : (
      <SegmentedControl value={by} onChange={(v) => setBy(v as GroupBy)} aria-label="Układ listy" data={[{ value: "due", label: "Po terminie" }, { value: "person", label: "Po osobach" }]} />
    );

  if (phone)
    return (
      <div className="ui-cl ui-cl-phone ui-tasks">
        <div className="ui-head">
          <div className="ui-head-text">
            <h1 className="ui-head-title">Zadania</h1>
            <span className="ui-head-sub">
              {q.data ? (
                <>
                  {lateCount ? <span className="ui-warn">Po terminie {lateCount}</span> : null}
                  {lateCount ? " · " : ""}Otwartych {all.length}
                </>
              ) : (
                "Checklisty wdrożenia i odejścia"
              )}
            </span>
          </div>
        </div>
        <Segments value={mine} onChange={setMine} items={[{ value: "mine", label: hasRole("manager") ? "Moje" : "Moje (HR)" }, { value: "all", label: "Wszystkie" }]} />
        <TextInput aria-label="Szukaj zadania" placeholder="Szukaj" size="md" leftSection={<IconSearch size={18} aria-hidden />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Segments
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
          items={[
            { value: "all", label: "Wszystkie" },
            { value: "onboarding", label: "Wdrożenie" },
            { value: "offboarding", label: "Odejście" },
          ]}
        />
        {byControl(true)}
        <Text size="sm" c="dimmed">
          Przesuń zadanie w lewo albo zaznacz pole, aby odhaczyć. Dotknij, aby zobaczyć szczegóły.
        </Text>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton height={200} radius="md" /> : groups.length ? <div className="ui-tpe-paper ui-cl-phpaper">{list}</div> : empty}
        <Drawer
          opened={sheetOpen && !!cur}
          onClose={() => setSheetOpen(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet ui-tpe-fsheet ui-sheet-sized" }}
          styles={{ content: { "--sheet-h": `${sheetH}dvh` } as React.CSSProperties }}
          aria-label={cur?.label ?? "Zadanie"}
        >
          {cur && (
            <>
              <SheetHandle onClose={() => setSheetOpen(false)} sheet={sheet}>
                <div className="ui-sheet-head ui-tpe-fsheet-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ui-sheet-title">{cur.label}</div>
                    <div className="ui-row-desc">
                      {kindLabel(cur.kind)} · odpowiada {RESPONSIBLE[cur.responsible]}
                    </div>
                  </div>
                </div>
              </SheetHandle>
              <div className="ui-tpe-fsheet-body" ref={sheet.bodyRef}>
                {editor}
              </div>
              <Group gap="sm" grow mt="sm" className="ui-tpe-fsheet-done">
                <Button size="md" variant="default" onClick={() => navigate(`/pracownicy/${cur.employee_id}`)}>
                  Otwórz kartę
                </Button>
                {cur.can_edit && (
                  <Button
                    size="md"
                    loading={setDone.isPending}
                    onClick={() => {
                      setDone.mutate({ id: cur.id, done: true });
                      setSheetOpen(false);
                    }}
                  >
                    Odhacz
                  </Button>
                )}
              </Group>
            </>
          )}
        </Drawer>
      </div>
    );

  return (
    <div className="ui-cl ui-tasks" ref={rootRef}>
      <Group align="center" gap={10} wrap="nowrap" className="ui-emp-search-row">
        <TextInput aria-label="Szukaj zadania" placeholder="Szukaj: zadanie, nazwisko lub nr karty" leftSection={<IconSearch size={16} aria-hidden />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} style={{ flex: 1, minWidth: 0 }} />
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
          aria-label="Rodzaj checklisty"
          data={[
            { value: "all", label: "Wszystkie" },
            { value: "onboarding", label: "Wdrożenie" },
            { value: "offboarding", label: "Odejście" },
          ]}
        />
      </Group>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="ui-cl-grid" data-narrow={narrow || !groups.length || undefined}>
          <div className="ui-cl-paper ui-tpe-paper">
            <div className="ui-tpe-paperhead">
              <WrapRow className="ui-paper-headrow">
                <h2 className="ui-dsec-title">Otwarte zadania</h2>
                {byControl()}
              </WrapRow>
              <Text size="xs" c="dimmed">
                Zaznacz pole, aby odhaczyć. Kliknij zadanie, aby zobaczyć szczegóły. Pozycje z ⚡ odhaczą się same.
              </Text>
            </div>
            {q.isLoading ? <Loading rows={4} /> : groups.length ? list : empty}
          </div>
          {!narrow && groups.length > 0 && <aside className="ui-cl-side ui-cl-panel">{editor}</aside>}
        </div>
      )}
      <Drawer opened={narrow && panelOpen && !!cur} onClose={() => setPanelOpen(false)} position="right" size={420} title={cur?.label} overlayProps={{ backgroundOpacity: 0.12 }}>
        {editor}
      </Drawer>
    </div>
  );
}

/** Szczegóły zadania: osoba, postęp jej checklisty, kiedy odhaczy się samo, akcje. */
function TaskPanel({ t, phone, titled, onDone, busy }: { t: Task; phone: boolean; titled: boolean; onDone: () => void; busy: boolean }) {
  const cl = useQuery({
    queryKey: ["employee-checklists", t.employee_id],
    queryFn: () => api<{ onboarding: ChecklistItem[]; offboarding: ChecklistItem[] }>(`/employees/${t.employee_id}/checklists`),
    retry: false,
  });
  const items = cl.data?.[t.kind] ?? [];
  const doneN = items.filter((x) => x.state === "done").length;
  const late = t.state === "overdue";
  return (
    <section className="ui-cl-pbody" aria-label="Wybrane zadanie">
      {titled && (
        <div>
          <h2 className="ui-dsec-title">{t.label}</h2>
          <Text size="sm" c="dimmed">
            {kindLabel(t.kind)} · odpowiada {RESPONSIBLE[t.responsible]}
          </Text>
        </div>
      )}
      <div className="ui-tk-person">
        <span className="ui-case-ini" aria-hidden>
          {t.employee
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)}
        </span>
        <div>
          <Anchor component={Link} to={`/pracownicy/${t.employee_id}`} fw={600}>
            {t.employee}
          </Anchor>
          <Text size="xs" c="dimmed">
            nr {t.number}
            {t.department ? ` · ${t.department}` : ""}
          </Text>
        </div>
      </div>
      <div>
        <Text size="sm" className={late ? "ui-warn" : undefined} fw={late ? 600 : undefined}>
          Termin: {t.due_date ? formatDate(t.due_date) : "bez terminu"}
          {late ? " – po terminie" : ""}
        </Text>
        {t.auto && (
          <Text size="sm" c="dimmed">
            ⚡ Odhaczy się samo{t.auto_label ? `: ${t.auto_label}` : "."}
          </Text>
        )}
      </div>
      {items.length > 0 && (
        <div className="ui-tk-progress">
          <Text size="sm">
            Checklista – {kindLabel(t.kind).toLowerCase()}: {doneN} z {items.length}
          </Text>
          <Progress value={(doneN / items.length) * 100} color="teal" size="sm" radius="xl" aria-label="Postęp checklisty" />
        </div>
      )}
      {!phone && (
        <Group gap="sm">
          {t.can_edit && (
            <Button leftSection={<IconCheck size={16} />} onClick={onDone} loading={busy}>
              Odhacz
            </Button>
          )}
          <Button variant="default" component={Link} to={`/pracownicy/${t.employee_id}`}>
            Otwórz kartę
          </Button>
        </Group>
      )}
    </section>
  );
}
