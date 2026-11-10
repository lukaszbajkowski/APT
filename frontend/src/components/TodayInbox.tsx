import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Group, Paper, SegmentedControl, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { api, errorText } from "../api";
import { ErrorState, RowsSkeleton } from "./States";
import { cap } from "./Mobile";

/** Sprawa z kolejki kadr (GET /work-queue/cases). */
export interface Case {
  group: "reply" | "decide" | "tasks" | "renew" | "data";
  key: string;
  employee_id: number | null;
  name: string;
  sub: string | null;
  what: string;
  due: string | null;
  overdue: boolean;
  when: string | null;
  action: string;
  url: string;
  task_id: number | null;
}

const GROUPS: { key: Case["group"]; label: string; head: string }[] = [
  { key: "reply", label: "Odpowiedz", head: "Odpowiedz · wiadomości od pracowników" },
  { key: "decide", label: "Zdecyduj", head: "Zdecyduj · zgłoszenia agencji" },
  { key: "tasks", label: "Zadania", head: "Zadania z checklist po terminie" },
  { key: "renew", label: "Odnów", head: "Odnów · dokumenty pobytowe i szkolenia" },
  { key: "data", label: "Uzupełnij dane", head: "Uzupełnij dane" },
];
const PER_GROUP = 5; // w widoku „Wszystko” – reszta po kliknięciu „Pokaż wszystkie”

const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((x) => x.charAt(0))
    .join("")
    .toUpperCase();

function readMode(): "cases" | "people" {
  try {
    return localStorage.getItem("apt-today-mode") === "people" ? "people" : "cases";
  } catch {
    return "cases";
  }
}

export function useCases(enabled = true) {
  return useQuery({ queryKey: ["work-cases"], queryFn: () => api<{ total: number; cases: Case[] }>("/work-queue/cases"), refetchInterval: 60_000, enabled });
}

/**
 * „Dziś” na komputerze: wszystko, co czeka na kadry, w jednej ramce.
 * Przełącznik: po sprawach (grupy według rodzaju) albo po osobach (jeden wiersz na pracownika, szczegóły w panelu z boku).
 */
export function TodayInbox() {
  const q = useCases();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("all");
  const [mode, setModeState] = useState(readMode);
  const [person, setPerson] = useState<string | null>(null);
  const setMode = (m: string) => {
    setModeState(m as "cases" | "people");
    try {
      localStorage.setItem("apt-today-mode", m);
    } catch {
      /* tryb prywatny – bez zapamiętania */
    }
  };
  const done = useMutation({
    mutationFn: (id: number) => api(`/checklist-items/${id}`, { method: "PATCH", body: { done: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-cases"] });
      notifications.show({ color: "teal", message: "Zadanie odhaczone." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const all = q.data?.cases ?? [];
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.key, all.filter((c) => c.group === g.key).length])), [all]);
  const shown = filter === "all" ? all : all.filter((c) => c.group === filter);
  const people = useMemo(() => {
    const m = new Map<string, Case[]>();
    for (const c of shown) {
      const k = c.employee_id ? `e${c.employee_id}` : `n${c.key}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    // najpierw osoby z czymś po terminie, potem z największą liczbą spraw
    return [...m.entries()].sort((a, b) => Number(b[1].some((c) => c.overdue)) - Number(a[1].some((c) => c.overdue)) || b[1].length - a[1].length);
  }, [shown]);
  const primaryKey = shown[0]?.key;

  const act = (c: Case, primary = false) => (
    <Button
      size="xs"
      variant={primary ? "filled" : "default"}
      loading={done.isPending && done.variables === c.task_id}
      onClick={(ev) => {
        ev.stopPropagation();
        if (c.task_id) done.mutate(c.task_id);
        else navigate(c.url);
      }}
    >
      {c.action}
    </Button>
  );
  const row = (c: Case) => (
    <div key={c.key} className="ui-case">
      <span className="ui-case-ini" aria-hidden>
        {initials(c.name)}
      </span>
      <div className="ui-case-name">
        {c.employee_id ? (
          <UnstyledButton className="ui-case-link" onClick={() => navigate(`/pracownicy/${c.employee_id}`)}>
            {c.name}
          </UnstyledButton>
        ) : (
          c.name
        )}
        {c.sub && <span className="ui-case-sub ui-mono">{c.sub}</span>}
      </div>
      <div className="ui-case-what">{cap(c.what)}</div>
      <div className={c.overdue ? "ui-case-when ui-warn" : "ui-case-when"}>{c.when}</div>
      <div className="ui-case-act">{act(c, c.key === primaryKey)}</div>
    </div>
  );

  const open = person ? people.find(([k]) => k === person)?.[1] ?? [] : [];

  return (
    <div className="ui-today">
      <div className="ui-today-bar">
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: `Wszystko ${all.length}` },
            ...GROUPS.filter((g) => counts[g.key]).map((g) => ({ value: g.key, label: `${g.label} ${counts[g.key]}` })),
          ]}
        />
        <SegmentedControl
          value={mode}
          onChange={setMode}
          aria-label="Układ listy"
          data={[
            { value: "cases", label: "Po sprawach" },
            { value: "people", label: "Po osobach" },
          ]}
        />
      </div>
      {q.isLoading && <RowsSkeleton />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && all.length === 0 && (
        <Paper withBorder radius="md" p="lg">
          <Text fw={600}>Nic nie czeka</Text>
          <Text size="sm" c="dimmed">
            Wszystkie sprawy załatwione. Nowe pojawią się tu same.
          </Text>
        </Paper>
      )}
      {all.length > 0 && mode === "cases" && (
        <Paper withBorder radius="md" className="ui-cases">
          {GROUPS.filter((g) => shown.some((c) => c.group === g.key)).map((g) => {
            const items = shown.filter((c) => c.group === g.key);
            const cut = filter === "all" ? items.slice(0, PER_GROUP) : items;
            return (
              <section key={g.key} aria-label={g.head}>
                <div className="ui-case-head">
                  <span>{g.head}</span>
                  <span>{items.length}</span>
                </div>
                {cut.map(row)}
                {cut.length < items.length && (
                  <UnstyledButton className="ui-case-more" onClick={() => setFilter(g.key)}>
                    Pokaż wszystkie {items.length}
                  </UnstyledButton>
                )}
              </section>
            );
          })}
        </Paper>
      )}
      {all.length > 0 && mode === "people" && (
        <Paper withBorder radius="md" className="ui-cases">
          {people.map(([k, cs]) => (
            <UnstyledButton key={k} className="ui-case ui-case-person" onClick={() => setPerson(k)}>
              <span className="ui-case-ini" aria-hidden>
                {initials(cs[0].name)}
              </span>
              <div className="ui-case-name">
                {cs[0].name}
                {cs[0].sub && <span className="ui-case-sub ui-mono">{cs[0].sub}</span>}
              </div>
              <div className="ui-case-chips">
                {cs.map((c) => (
                  <span key={c.key} className="ui-case-chip" data-warn={c.overdue || c.group !== "data" || undefined}>
                    {cap(c.what)}
                    {c.when ? ` · ${c.when}` : ""}
                  </span>
                ))}
              </div>
              <div className="ui-case-when">{cs.length === 1 ? "1 sprawa" : cs.length < 5 ? `${cs.length} sprawy` : `${cs.length} spraw`}</div>
            </UnstyledButton>
          ))}
        </Paper>
      )}
      <Drawer opened={!!person && open.length > 0} onClose={() => setPerson(null)} position="right" size={420} title={<Text fw={600} size="lg">{open[0]?.name}</Text>}>
        {open[0]?.sub && (
          <Text size="sm" c="dimmed" className="ui-mono" mb="md">
            {open[0].sub}
          </Text>
        )}
        <Paper withBorder radius="md">
          {open.map((c, i) => (
            <div key={c.key} className="ui-case-side">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {cap(c.what)}
                </Text>
                {c.when && (
                  <Text size="xs" c={c.overdue ? "orange.8" : "dimmed"} fw={c.overdue ? 600 : undefined}>
                    {c.when}
                  </Text>
                )}
              </div>
              {act(c, i === 0)}
            </div>
          ))}
        </Paper>
        {open[0]?.employee_id && (
          <Group mt="md">
            <Button variant="subtle" onClick={() => navigate(`/pracownicy/${open[0].employee_id}`)}>
              Otwórz kartę pracownika
            </Button>
          </Group>
        )}
      </Drawer>
    </div>
  );
}
