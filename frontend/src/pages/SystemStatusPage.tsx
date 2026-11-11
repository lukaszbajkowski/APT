import { useQuery } from "@tanstack/react-query";
import { Alert, Paper, Progress, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, errorText, formatDateTime } from "../api";
import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, ListRow, PageHead, Section, SectionHead, StatusBadge, PageTitle, PageLoading } from "../components/Mobile";
import { useState, type ReactNode } from "react";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";

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
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
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
                <div className="ui-cnt-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
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
                  <div className="ui-cnt-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                    <Progress value={tPct} color={tPct > 90 ? "red" : tPct > 70 ? "yellow" : "teal"} />
                    <StatusBadge tone={(tPct > 90 ? "error" : tPct > 70 ? "warn" : "ok")}>{`${tPct}% limitu`}</StatusBadge>
                  </div>
                  <div className="ui-cnt-row ui-cnt-dim" style={{ gridTemplateColumns: "1fr" }}>
                    {s.translation.used.toLocaleString("pl-PL")} z {s.translation.limit.toLocaleString("pl-PL")} znaków w tym miesiącu
                  </div>
                </>
              ) : (
                <div className="ui-cnt-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
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
