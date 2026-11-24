import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Paper, Progress, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, errorText, formatDateTime } from "../api";
import { ActionSheet, CompactEmpty, ListRow, PageHead, Section, SectionHead, StatusBadge, PageTitle, PageLoading, Segments, WrapRow } from "../components/Mobile";
import { useState, type ReactNode } from "react";
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconCircleCheck } from "@tabler/icons-react";
import { useIsPhone } from "../lib/device";

function runState(run: Run | null | undefined, staleHours: number) {
  const stale = run ? Date.now() - new Date(run.at).getTime() > staleHours * 3600_000 : false;
  if (!run) return { tone: "neutral" as const, label: "Brak danych" };
  if (!run.ok) return { tone: "error" as const, label: "Błąd" };
  if (stale) return { tone: "warn" as const, label: "Dawno" };
  return { tone: "ok" as const, label: "OK" };
}
/** „Dziś, 21:59” / „Wczoraj, 22:03” / „30.10.2026, 22:03” */
function when(at: string) {
  const d = new Date(at);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return diff === 0 ? `Dziś, ${time}` : diff === 1 ? `Wczoraj, ${time}` : formatDateTime(at);
}
const STATE_TEXT = { ok: "", warn: "Dawno się nie wykonała – sprawdź serwer", error: "Ostatnia próba się nie udała", neutral: "Jeszcze się nie wykonała" } as const;
function RunRow({ label, run, staleHours, onOpen }: { label: string; run: Run | null | undefined; staleHours: number; onOpen: (d: { title: string; info: string }) => void }) {
  const st = runState(run, staleHours);
  const desc = !run ? STATE_TEXT.neutral : st.tone === "ok" ? when(run.at) : `${when(run.at)} · ${STATE_TEXT[st.tone]}`;
  return <ListRow title={label} description={desc} trailing={<StatusBadge tone={st.tone}>{st.label}</StatusBadge>} onClick={run?.info ? () => onOpen({ title: label, info: `${formatDateTime(run.at)} · ${run.info}` }) : undefined} />;
}

interface Run {
  at: string;
  ok: boolean;
  info: string;
}
interface Status {
  version: string;
  migration: string | null;
  backup: { local: Run | null; offsite: Run | null } | null;
  restore_test: Run | null;
  disk: { total_gb: number; free_gb: number; used_percent: number } | null;
  translation: { enabled: boolean; used: number; limit: number };
  retention_due: number;
  unusual: string[];
  mail_enabled: boolean;
}

export function SystemStatusPage() {
  const q = useQuery({ queryKey: ["system-status"], queryFn: () => api<Status>("/system/status"), refetchInterval: 60_000 });
  const mobile = useIsPhone();
  const [detail, setDetail] = useState<{ title: string; info: string } | null>(null);
  if (q.isLoading) return <PageLoading title="Stan systemu" />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const s = q.data!;
  const tPct = s.translation.limit > 0 ? Math.min(100, Math.round((100 * s.translation.used) / s.translation.limit)) : 0;
  if (mobile) {
    const pctTone = (p: number) => (p > 90 ? "error" : p > 70 ? "warn" : "ok") as "error" | "warn" | "ok";
    return (
      <Stack gap={24}>
        <PageHead title="Stan systemu" subtitle={`Wersja ${s.version} · Migracja ${s.migration ?? "?"}`} />
        {(() => {
          const states = [runState(s.backup?.local, 36), runState(s.backup?.offsite, 36), runState(s.restore_test, 15 * 24)];
          const problems =
            states.filter((x) => x.tone !== "ok").length +
            s.unusual.length +
            (s.disk && s.disk.used_percent > 85 ? 1 : 0) +
            (s.mail_enabled ? 0 : 1) +
            (s.retention_due ? 1 : 0);
          return (
            <div className="ui-group">
              <ListRow
                leading={<span className="ui-row-icon" data-tone={problems ? "warn" : undefined} aria-hidden>{problems ? <IconAlertTriangle size={22} /> : <IconCircleCheck size={22} />}</span>}
                title={problems ? `Wymaga uwagi: ${problems}` : "Wszystko działa"}
                description={problems ? "Szczegóły w wierszach oznaczonych niżej" : "Kopie zapasowe, dysk i wysyłka są w porządku"}
              />
            </div>
          );
        })()}
        {s.unusual.length > 0 && (
          <Section title="Nietypowa aktywność (24 godz.)">
            {s.unusual.map((x) => (
              <ListRow key={x} title={x} trailing={<StatusBadge tone="error">Sprawdź</StatusBadge>} />
            ))}
          </Section>
        )}
        <AppErrors mobile />
        <Section title="Kopie zapasowe">
          <RunRow label="Kopia na serwerze" run={s.backup?.local} staleHours={36} onOpen={setDetail} />
          <RunRow label="Kopia poza serwerem" run={s.backup?.offsite} staleHours={36} onOpen={setDetail} />
          <RunRow label="Test odtwarzania (co tydzień)" run={s.restore_test} staleHours={15 * 24} onOpen={setDetail} />
        </Section>
        <Section title="Serwer">
          {s.disk ? (
            <ListRow
              title="Dysk"
              description={
                <span className="ui-row-progress">
                  <Progress value={s.disk.used_percent} size="sm" color={s.disk.used_percent > 85 ? "red" : s.disk.used_percent > 70 ? "yellow" : "teal"} />
                  {`Wolne ${String(s.disk.free_gb).replace(".", ",")} GB z ${String(s.disk.total_gb).replace(".", ",")} GB`}
                </span>
              }
              trailing={<span className="ui-bar-trail"><StatusBadge tone={s.disk.used_percent > 85 ? "error" : s.disk.used_percent > 70 ? "warn" : "ok"}>{`${s.disk.used_percent}% zajęte`}</StatusBadge></span>}
            />
          ) : (
            <CompactEmpty title="Dysk: brak danych" text="Pojawią się po pierwszym uruchomieniu zadań cyklicznych." />
          )}
          <ListRow
            title="Tłumaczenia"
            description={
              s.translation.enabled ? (
                <span className="ui-row-progress">
                  <Progress value={tPct} size="sm" color={tPct > 90 ? "red" : tPct > 70 ? "yellow" : "teal"} />
                  {`Wykorzystano ${tPct}% miesięcznego limitu`}
                </span>
              ) : (
                "Brak klucza – pracownik widzi teksty po polsku"
              )
            }
            trailing={<span className="ui-bar-trail">{s.translation.enabled ? <StatusBadge tone={pctTone(tPct)}>{tPct > 90 ? "Kończy się" : "OK"}</StatusBadge> : <StatusBadge tone="neutral">Wyłączone</StatusBadge>}</span>}
            onClick={s.translation.enabled ? () => setDetail({ title: "Tłumaczenia", info: `${s.translation.used.toLocaleString("pl-PL")} z ${s.translation.limit.toLocaleString("pl-PL")} znaków w tym miesiącu` }) : undefined}
          />
          <ListRow title="Wysyłka e-mail" trailing={<StatusBadge tone={s.mail_enabled ? "ok" : "warn"}>{s.mail_enabled ? "Włączona" : "Wyłączona"}</StatusBadge>} />
          <ListRow
            title="Dane po okresie przechowywania"
            trailing={s.retention_due ? <StatusBadge tone="warn">{String(s.retention_due)}</StatusBadge> : <StatusBadge tone="ok">Brak</StatusBadge>}
            to={s.retention_due ? "/retencja" : undefined}
          />
        </Section>
        <ActionSheet opened={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ""} subtitle={detail?.info} actions={[]} />
      </Stack>
    );
  }
  // na górze jedno zdanie: co jest nie tak (albo że wszystko działa)
  const runs = [
    { label: "Kopia na serwerze", run: s.backup?.local, h: 36 },
    { label: "Kopia poza serwerem", run: s.backup?.offsite, h: 36 },
    { label: "Test odtwarzania (co tydzień)", run: s.restore_test, h: 15 * 24 },
  ];
  const issues = [
    ...runs.flatMap((r) => {
      const st = runState(r.run, r.h);
      return st.tone === "ok" ? [] : [r.label.replace(/ \(.*\)$/, "").toLowerCase()];
    }),
    ...(s.disk && s.disk.used_percent > 85 ? [`dysk (${s.disk.used_percent}%)`] : []),
    ...(s.mail_enabled ? [] : ["wysyłka e-mail"]),
    ...(s.retention_due ? ["dane po okresie przechowywania"] : []),
    ...(s.unusual.length ? ["nietypowa aktywność"] : []),
  ];
  const row = (label: string, detail: ReactNode, badge: ReactNode, to?: string) => (
    <div className="ui-st-row" key={label}>
      <span>{to ? <Link to={to} className="ui-case-link">{label}</Link> : label}</span>
      <span className="ui-cnt-dim">{detail}</span>
      <span>{badge}</span>
    </div>
  );
  const diskTone = s.disk ? (s.disk.used_percent > 85 ? "error" : s.disk.used_percent > 70 ? "warn" : "ok") : "neutral";
  return (
    <Stack gap="xl" className="ui-page-narrow">
      <PageTitle title="Stan systemu" meta={`Wersja ${s.version} · Migracja ${s.migration ?? "?"}`} />
      <Text className={issues.length ? "ui-facts ui-warn" : "ui-facts ui-ok-text"}>
        {issues.length ? `Wymaga uwagi: ${issues.join(", ")} – szczegóły niżej.` : "Wszystko działa: kopie zapasowe, dysk i wysyłka są w porządku."}
      </Text>
      {s.unusual.length > 0 && (
        <section className="ui-dsec">
          <SectionHead title="Nietypowa aktywność (24 godz.)" />
          <Paper withBorder radius="md" className="ui-cases">
            {s.unusual.map((x) => row(x, "", <StatusBadge tone="error">Sprawdź</StatusBadge>))}
          </Paper>
        </section>
      )}
      <AppErrors />
      <section className="ui-dsec">
        <SectionHead title="Kopie zapasowe" />
        <Paper withBorder radius="md" className="ui-cases">
          {runs.map((r) => {
            const st = runState(r.run, r.h);
            return row(r.label, r.run ? `${when(r.run.at)}${r.run.info ? ` · ${r.run.info}` : ""}` : "Jeszcze się nie wykonała", <StatusBadge tone={st.tone}>{st.label}</StatusBadge>);
          })}
        </Paper>
      </section>
      <div className="ui-two">
        <div className="ui-dsec" style={{ gap: "var(--s-6)" }}>
          <section className="ui-dsec">
            <SectionHead title="Dysk" />
            {s.disk ? (
              <Paper withBorder radius="md" className="ui-cases">
                <div className="ui-cnt-row ui-bar-row">
                  <Progress value={s.disk.used_percent} color={diskTone === "error" ? "red" : diskTone === "warn" ? "yellow" : "teal"} />
                  <StatusBadge tone={diskTone}>{`${s.disk.used_percent}% zajęte`}</StatusBadge>
                </div>
                <div className="ui-cnt-row ui-cnt-dim" style={{ gridTemplateColumns: "1fr" }}>
                  Wolne {String(s.disk.free_gb).replace(".", ",")} GB z {String(s.disk.total_gb).replace(".", ",")} GB
                </div>
              </Paper>
            ) : (
              <Text size="sm" c="dimmed">
                Brak danych – pojawią się po pierwszym uruchomieniu zadań cyklicznych.
              </Text>
            )}
          </section>
          {/* tłumaczenia jak dysk: pasek wykorzystania miesięcznego limitu */}
          <section className="ui-dsec">
            <SectionHead title="Tłumaczenia" />
            <Paper withBorder radius="md" className="ui-cases">
              {s.translation.enabled ? (
                <>
                  <div className="ui-cnt-row ui-bar-row">
                    <Progress value={tPct} color={tPct > 90 ? "red" : tPct > 70 ? "yellow" : "teal"} />
                    <StatusBadge tone={(tPct > 90 ? "error" : tPct > 70 ? "warn" : "ok")}>{`${tPct}% limitu`}</StatusBadge>
                  </div>
                  <div className="ui-cnt-row ui-cnt-dim" style={{ gridTemplateColumns: "1fr" }}>
                    {s.translation.used.toLocaleString("pl-PL")} z {s.translation.limit.toLocaleString("pl-PL")} znaków w tym miesiącu
                  </div>
                </>
              ) : (
                <div className="ui-cnt-row ui-bar-row">
                  <span className="ui-cnt-dim">Brak klucza – pracownik widzi teksty po polsku</span>
                  <StatusBadge tone="neutral">Wyłączone</StatusBadge>
                </div>
              )}
            </Paper>
          </section>
        </div>
        <section className="ui-dsec">
          <SectionHead title="Pozostałe" />
          <Paper withBorder radius="md" className="ui-cases">
            {row("Wysyłka e-mail", "", <StatusBadge tone={s.mail_enabled ? "ok" : "warn"}>{s.mail_enabled ? "Włączona" : "Wyłączona"}</StatusBadge>)}
            {row(
              "Dane po okresie przechowywania",
              "",
              s.retention_due ? <StatusBadge tone="warn">{String(s.retention_due)}</StatusBadge> : <StatusBadge tone="ok">Brak</StatusBadge>,
              s.retention_due ? "/retencja" : undefined,
            )}
          </Paper>
        </section>
      </div>
    </Stack>
  );
}

interface AppError {
  id: number;
  source: "api" | "browser";
  kind: string;
  message: string;
  path: string;
  status: number | null;
  role: string | null;
  count: number;
  first_at: string;
  last_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  reopened: boolean;
}

/** Błędy aplikacji z ostatnich 7 dni (serwer 5xx i przeglądarka) – zgrupowane, bez danych osobowych.
 *  „Rozwiązany” przenosi wpis do archiwum (Rozwiązane); gdy błąd wróci, wraca do bieżących. */
function AppErrors({ mobile }: { mobile?: boolean }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"open" | "resolved">("open");
  const done = view === "resolved";
  const q = useQuery({
    queryKey: ["system-errors", view],
    queryFn: () => api<AppError[]>(done ? "/system/errors?resolved=true" : "/system/errors?days=7"),
    refetchInterval: 60_000,
  });
  const counts = useQuery({ queryKey: ["system-errors", "counts"], queryFn: () => api<{ open: number; resolved: number }>("/system/errors/counts?days=7"), refetchInterval: 60_000 });
  const [open, setOpen] = useState<AppError | null>(null);
  const act = useMutation({
    mutationFn: ({ id, to }: { id: number; to: "resolve" | "reopen" }) => api(`/system/errors/${id}/${to}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system-errors"] }),
  });
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  const where = (e: AppError) => (e.source === "api" ? "Serwer" : "Przeglądarka");
  const what = (e: AppError) => [e.kind, e.message].filter(Boolean).join(": ");
  const meta = (e: AppError) =>
    [
      e.path || "—",
      e.count === 1 ? "raz" : `${e.count} razy`,
      e.resolved_at ? `rozwiązany ${when(e.resolved_at)}${e.resolved_by ? ` przez ${e.resolved_by}` : ""}` : `ostatnio ${when(e.last_at)}`,
      e.reopened && !e.resolved_at ? "wrócił po rozwiązaniu" : null,
      e.role ? `rola ${e.role}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const tone = (e: AppError) => (e.resolved_at ? "neutral" : e.source === "api" ? "error" : "warn");
  const c = counts.data;
  const items = [
    { value: "open", label: `Bieżące${c ? ` ${c.open}` : ""}` },
    { value: "resolved", label: `Rozwiązane${c ? ` ${c.resolved}` : ""}` },
  ];
  const empty = done ? "Nic nie jest oznaczone jako rozwiązane (archiwum trzyma wpisy 30 dni)." : "W ostatnich 7 dniach serwer i przeglądarki nie zgłosiły nowych błędów.";
  const title = "Błędy aplikacji (7 dni)";
  if (mobile)
    return (
      <Section title={title}>
        <Segments value={view} onChange={(v) => setView(v as typeof view)} items={items} />
        {q.isLoading ? null : rows.length === 0 ? (
          <CompactEmpty title={done ? "Archiwum jest puste" : "Brak błędów"} text={empty} />
        ) : (
          rows.map((e) => <ListRow key={e.id} title={what(e)} description={meta(e)} trailing={<StatusBadge tone={tone(e)}>{where(e)}</StatusBadge>} onClick={() => setOpen(e)} />)
        )}
        <ActionSheet
          opened={!!open}
          onClose={() => setOpen(null)}
          title={open ? what(open) : ""}
          subtitle={open ? `${where(open)} · ${meta(open)} · pierwszy raz ${when(open.first_at)}` : undefined}
          actions={
            open
              ? open.resolved_at
                ? [{ label: "Przywróć do bieżących", description: "Cofnij oznaczenie jako rozwiązany.", icon: <IconArrowBackUp size={20} />, onClick: () => act.mutate({ id: open.id, to: "reopen" }) }]
                : [{ label: "Oznacz jako rozwiązany", description: "Wpis trafi do archiwum; gdy błąd wróci, pojawi się znów w bieżących.", icon: <IconCheck size={20} />, onClick: () => act.mutate({ id: open.id, to: "resolve" }) }]
              : []
          }
        />
      </Section>
    );
  return (
    <section className="ui-dsec">
      {/* przełącznik w linii nagłówka sekcji – jak na kartce Checklist (WrapRow) */}
      <WrapRow className="ui-paper-headrow">
        <Title order={2} className="ui-dsec-title">
          {title}
        </Title>
        <SegmentedControl value={view} onChange={(v) => setView(v as typeof view)} aria-label="Błędy aplikacji" data={items} />
      </WrapRow>
      {q.isLoading ? null : rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Paper withBorder radius="md" className="ui-cases">
          {rows.map((e) => (
            <div className="ui-st-row ui-err-row" key={e.id}>
              <span className="ui-err-what">
                <span className="ui-err-msg">{what(e)}</span>
                <span className="ui-cnt-dim">{meta(e)}</span>
              </span>
              <StatusBadge tone={tone(e)}>{where(e)}</StatusBadge>
              <Button size="xs" variant="subtle" loading={act.isPending && act.variables?.id === e.id} onClick={() => act.mutate({ id: e.id, to: e.resolved_at ? "reopen" : "resolve" })}>
                {e.resolved_at ? "Przywróć" : "Rozwiązany"}
              </Button>
            </div>
          ))}
        </Paper>
      )}
    </section>
  );
}
