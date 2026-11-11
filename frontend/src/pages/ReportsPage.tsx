import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Paper, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots, IconFileSpreadsheet, IconFileTypePdf } from "@tabler/icons-react";
import { useElementSize, useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, ListRow, PageHead, Section, SectionHead, StatusBadge, PageTitle, PageLoading } from "../components/Mobile";

import { api, apiDownload, errorText, formatDateTime, type ReportRow, type ReportSummary } from "../api";

function Bar({ value, max, color = "var(--mantine-primary-color-filled)" }: { value: number; max: number; color?: string }) {
  const pct = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <Box h={8} style={{ background: "var(--apt-subtle)", borderRadius: 4, overflow: "hidden" }}>
      <Box h="100%" w={`${value ? pct : 0}%`} style={{ background: color, borderRadius: 4 }} />
    </Box>
  );
}

type Month = ReportSummary["months"][number];

/** Wykres słupkowy 12 miesięcy (komputer i telefon): zatrudnieni – orzech, zwolnieni – szary; rysowany w rzeczywistej szerokości. */
function MonthsChart({ months, active, onHover, onPick }: { months: Month[]; active: string | null; onHover: (k: string | null) => void; onPick: (k: string) => void }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.hired, m.terminated]));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const { ref: box, width: boxW } = useElementSize();
  const W = Math.max(280, Math.round(boxW) || 960), H = 236, L = 32, B = 28, T = 28; // T: miejsce na podpis wartości nad najwyższym słupkiem
  const cw = (W - L) / months.length;
  const bw = Math.min(18, cw / 3.2);
  const y = (v: number) => H - B - ((H - B - T) * v) / top;
  return (
    <>
            <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ui-chart" role="img" aria-label="Wykres zatrudnień i zwolnień w ostatnich 12 miesiącach">
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="ui-chart-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="ui-chart-axis">
              {v}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + cw * i + cw / 2;
          const on = active === m.month;
          return (
            <g key={m.month} onMouseEnter={() => onHover(m.month)} onMouseLeave={() => onHover(null)} onClick={() => onPick(m.month)}>
              <rect x={L + cw * i} y={T} width={cw} height={H - B - T} className="ui-chart-hit" data-active={on || undefined} />
              {/* para słupków wyśrodkowana w miesiącu; gdy jeden jest zerowy, drugi stoi na środku */}
              {m.hired > 0 && (
                <rect x={m.terminated > 0 ? cx - bw - 1 : cx - bw / 2} y={y(m.hired)} width={bw} height={H - B - y(m.hired)} rx={3} className="ui-chart-bar ui-bar-hired" />
              )}
              {m.terminated > 0 && (
                <rect x={m.hired > 0 ? cx + 1 : cx - bw / 2} y={y(m.terminated)} width={bw} height={H - B - y(m.terminated)} rx={3} className="ui-chart-bar ui-bar-term" />
              )}
              {on && (
                // podpis wartości zawsze w obrębie wykresu (skrajne miesiące nie ucinają tekstu)
                <text x={Math.min(W - 18, Math.max(L + 18, cx))} y={Math.min(y(m.hired), y(m.terminated)) - 6} textAnchor="middle" className="ui-chart-val">
                  {m.hired} / {m.terminated}
                </text>
              )}
              {/* wąski wykres: podpis co drugiego miesiąca (wybrany zawsze) */}
              {(cw >= 36 || on || i % 2 === 0) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="ui-chart-axis" data-active={on || undefined}>
                  {m.label.split(" ")[0]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>
    </>
  );
}


/**
 * Zatrudnienia i zwolnienia: pasek 12 miesięcy; po kliknięciu w miesiąc albo „Pokaż wykres” rozwija się
 * wykres słupkowy (zatrudnieni – orzech, zwolnieni – szary), wybrany miesiąc podświetlony, wartości po najechaniu.
 */
function MonthsSection({ months }: { months: Month[] }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? pick;
  const toggle = (k?: string) => {
    if (k) {
      setPick((p) => (p === k && open ? null : k));
      setOpen(true);
    } else setOpen((o) => !o);
  };
  return (
    <section className="ui-dsec">
      <SectionHead
        title="Zatrudnienia i zwolnienia – 12 miesięcy"
        extra={<Text size="sm" c="dimmed">zatrudnieni / zwolnieni</Text>}
        action={{ label: open ? "Ukryj wykres" : "Pokaż wykres", onClick: () => toggle() }}
      />
      <Paper withBorder radius="md" className="ui-months-wrap">
        <div className="ui-months">
          {months.map((m) => (
            <button
              key={m.month}
              type="button"
              className="ui-month"
              data-active={(open && active === m.month) || undefined}
              aria-pressed={open && pick === m.month}
              aria-label={`${m.label}: zatrudnieni ${m.hired}, zwolnieni ${m.terminated}`}
              onClick={() => toggle(m.month)}
              onMouseEnter={() => setHover(m.month)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="ui-month-label">{m.label}</span>
              <span>
                <b>{m.hired}</b>
                <span className="ui-month-sep">/</span>
                <span className={m.terminated ? undefined : "ui-month-zero"}>{m.terminated}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="ui-chart-wrap" data-open={open || undefined}>
          <div className="ui-chart-inner">
            <div className="ui-chart-legend" aria-hidden>
              <span><i className="ui-sw ui-sw-hired" /> Zatrudnieni</span>
              <span><i className="ui-sw ui-sw-term" /> Zwolnieni</span>
            </div>
            <MonthsChart months={months} active={active} onHover={setHover} onPick={setPick} />
          </div>
        </div>
      </Paper>
    </section>
  );
}

/** Rozkład (komputer): sekcja na tle, lista w ramce – nazwa, pasek, liczba i procent. */
function CountList({ title, rows, limit = 8 }: { title: string; rows: ReportRow[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(0, ...rows.map((r) => r.count));
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <section className="ui-dsec">
      <SectionHead
        title={title}
        extra={<Text c="dimmed">{rows.length}</Text>}
        action={rows.length > limit ? { label: all ? "Pokaż mniej" : `Pokaż wszystkie ${rows.length}`, onClick: () => setAll((a) => !a) } : undefined}
      />
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Brak danych – pojawią się, gdy w kartotece będą pracownicy.
        </Text>
      ) : (
        <Paper withBorder radius="md" className="ui-cases">
          {shown.map((r) => (
            <div key={r.name} className="ui-cnt-row">
              <span className={r.name === "(brak)" ? "ui-cnt-dim" : undefined}>{r.name}</span>
              <Bar value={r.count} max={max} />
              <span className="ui-cnt-num">
                {r.count} <span className="ui-cnt-dim">· {total ? Math.round((r.count / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </Paper>
      )}
    </section>
  );
}

/* telefon: zatrudnienia i zwolnienia – „Pokaż wykres” rozwija wykres nad listą, dotknięcie miesiąca go podświetla */
function MobileMonths({ months }: { months: Month[] }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Section title="Zatrudnienia i zwolnienia" action={{ label: open ? "Ukryj wykres" : "Pokaż wykres", onClick: () => setOpen((o) => !o) }}>
      <div className="ui-chart-wrap ui-chart-mobile" data-open={open || undefined}>
        <div className="ui-chart-inner">
          <div className="ui-chart-legend" aria-hidden>
            <span><i className="ui-sw ui-sw-hired" /> Zatrudnieni</span>
            <span><i className="ui-sw ui-sw-term" /> Zwolnieni</span>
          </div>
          <MonthsChart months={months} active={pick} onHover={() => undefined} onPick={setPick} />
        </div>
      </div>
      {months.map((m) => (
        <ListRow
          key={m.month}
          title={m.label}
          description={`Zatrudnieni: ${m.hired} · zwolnieni: ${m.terminated}`}
          onClick={() => {
            setPick(m.month);
            setOpen(true);
          }}
          trailing={open && pick === m.month ? <StatusBadge tone="ok">Na wykresie</StatusBadge> : undefined}
        />
      ))}
    </Section>
  );
}

/* telefon: rozkład jako wiersze grupy – nazwa, pasek, liczba i procent */
function MobileCounts({ title, rows, limit = 5 }: { title: string; rows: ReportRow[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(0, ...rows.map((r) => r.count));
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <Section title={title} action={rows.length > limit ? { label: all ? "Pokaż mniej" : `Wszystkie (${rows.length})`, onClick: () => setAll((a) => !a) } : undefined}>
      {rows.length === 0 ? (
        <CompactEmpty title="Brak danych" text="Pojawią się, gdy w kartotece będą pracownicy." />
      ) : (
        shown.map((r) => (
          <ListRow
            key={r.name}
            title={r.name}
            muted={r.name === "(brak)"}
            description={<Bar value={r.count} max={max} />}
            trailing={
              <span className="ui-count-cell">
                <b>{r.count}</b> {total ? Math.round((r.count / total) * 100) : 0}%
              </span>
            }
          />
        ))
      )}
    </Section>
  );
}

export function ReportsPage() {
  const data = useQuery({ queryKey: ["report-summary"], queryFn: () => api<ReportSummary>("/reports/summary") });
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  async function download(format: "xlsx" | "pdf") {
    setBusy(format);
    try {
      await apiDownload(`/reports/summary.xlsx${format === "pdf" ? "?format=pdf" : ""}`, undefined, `zestawienie.${format}`);
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [more, setMore] = useState(false);
  if (data.isLoading) return <PageLoading title="Raporty" />;
  if (!data.data) return <Alert color="red">{errorText(data.error)}</Alert>;
  const s = data.data;

  if (mobile) {
    const n = (v: number) => <span className="ui-count-cell"><b>{v.toLocaleString("pl-PL")}</b></span>;
    return (
      <Stack gap={24}>
        <PageHead
          title="Raporty"
          subtitle={`Stan na ${formatDateTime(s.generated_at)}`}
          extra={{ label: "Pobierz raport", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setMore(true) }}
        />
        <Section title="Pracownicy">
          <ListRow title="Aktywni" trailing={n(s.active)} to="/pracownicy" />
          <ListRow title="W archiwum" trailing={n(s.terminated)} to="/pracownicy?status=terminated" />
          <ListRow title="Bez zdjęcia" description={s.missing_photo ? "Karta się nie wydrukuje" : undefined} trailing={s.missing_photo ? <StatusBadge tone="warn">{s.missing_photo}</StatusBadge> : n(0)} to="/pracownicy?missing=photo" />
          {s.missing_pesel !== null && <ListRow title="Bez PESEL" trailing={s.missing_pesel ? <StatusBadge tone="warn">{s.missing_pesel}</StatusBadge> : n(0)} to="/pracownicy?missing=pesel" />}
        </Section>
        <MobileCounts title="APT" rows={s.by_agency} />
        <MobileCounts title="Wydziały" rows={s.by_department} />
        <MobileCounts title="Stanowiska" rows={s.by_position} />
        <MobileCounts title="Obywatelstwo" rows={s.by_country} />
        <MobileMonths months={s.months} />
        <Section title="APT × wydział">
          {s.agency_department.length === 0 ? (
            <CompactEmpty title="Brak danych" />
          ) : (
            s.agency_department.map((r) => <ListRow key={`${r.agency}|${r.department}`} title={r.agency} description={r.department} trailing={n(r.count)} />)
          )}
        </Section>
        <ActionSheet
          opened={more}
          onClose={() => setMore(false)}
          title="Pobierz raport"
          actions={[
            { label: busy === "xlsx" ? "Pobieranie…" : "Excel", description: "Wszystkie tabele w arkuszu", icon: <IconFileSpreadsheet size={20} />, onClick: () => download("xlsx") },
            { label: busy === "pdf" ? "Pobieranie…" : "PDF", description: "Do wydruku lub wysłania", icon: <IconFileTypePdf size={20} />, onClick: () => download("pdf") },
          ]}
        />
      </Stack>
    );
  }

  const facts: { text: string; to: string; warn?: boolean }[] = [
    { text: `${s.active} aktywnych`, to: "/pracownicy" },
    { text: `${s.terminated} w archiwum`, to: "/pracownicy?status=terminated" },
    // te same pozycje co na telefonie (także zera); bursztyn tylko przy brakach
    { text: s.missing_photo ? `${s.missing_photo} bez zdjęcia – ich karty się nie wydrukują` : "0 bez zdjęcia", to: "/pracownicy?missing=photo", warn: !!s.missing_photo },
    ...(s.missing_pesel === null ? [] : [{ text: `${s.missing_pesel} bez PESEL`, to: "/pracownicy?missing=pesel", warn: !!s.missing_pesel }]),
  ];
  return (
    <Stack gap="xl" className="ui-page-narrow">
      <PageTitle
        title="Raporty"
        meta={`stan na ${formatDateTime(s.generated_at)}`}
        actions={
          <>
            <Button variant="default" leftSection={<IconFileTypePdf size={16} />} onClick={() => download("pdf")} loading={busy === "pdf"}>
              PDF
            </Button>
            <Button leftSection={<IconFileSpreadsheet size={16} />} onClick={() => download("xlsx")} loading={busy === "xlsx"}>
              Pobierz Excel
            </Button>
          </>
        }
      />
      {/* stan kartoteki jednym zdaniem – bursztyn tylko tam, gdzie trzeba działać */}
      <Text className="ui-facts">
        {facts.map((f, i) => (
          <span key={f.to}>
            {i > 0 && <span aria-hidden> · </span>}
            <Link to={f.to} className="summary-link" data-warn={f.warn || undefined}>
              {f.text}
            </Link>
          </span>
        ))}
      </Text>
      <div className="ui-two">
        <CountList title="APT" rows={s.by_agency} />
        <CountList title="Wydziały" rows={s.by_department} />
        <CountList title="Stanowiska" rows={s.by_position} />
        <CountList title="Obywatelstwo" rows={s.by_country} />
      </div>
      <section className="ui-dsec">
        <MonthsSection months={s.months} />
      </section>
        <section className="ui-dsec">
          <SectionHead title="APT × wydział" />
          {s.agency_department.length === 0 ? (
            <Text size="sm" c="dimmed">
              Brak danych.
            </Text>
          ) : (
          <Paper withBorder radius="md" className="ui-cases">
            {s.agency_department.map((r) => (
              <div key={`${r.agency}|${r.department}`} className="ui-cnt-row ui-cnt-row-3">
                <span>{r.agency}</span>
                <span className="ui-cnt-dim">{r.department}</span>
                <span className="ui-cnt-num">{r.count}</span>
              </div>
            ))}
          </Paper>
          )}
        </section>
      <Text size="sm" c="dimmed">
        Listę pracowników z dowolnymi filtrami pobierzesz na liście Pracownicy (Eksport: Excel lub PDF).
      </Text>
    </Stack>
  );
}
