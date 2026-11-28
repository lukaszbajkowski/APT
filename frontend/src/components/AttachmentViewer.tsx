import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionIcon, Button, Modal, Skeleton, Tabs, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconDownload, IconX, IconZoomIn, IconZoomOut } from "@tabler/icons-react";

import { api, withAcct } from "../api";
import { useT } from "../lib/i18n";
import { useIsPhone } from "../lib/device";
import { ErrorState } from "./States";

/** Co pokazać w podglądzie załącznika. */
export type AttachmentMode =
  | { kind: "pages"; infoUrl: string; pageUrl: (i: number) => string; slides?: boolean }
  | { kind: "text"; url: string }
  | { kind: "table"; url: string };

/**
 * Podgląd załącznika (Wiadomości, Komunikaty) na cały ekran – jeden pasek dla wszystkich typów:
 * komputer – nazwa i opis po lewej, przybliżanie na środku, „Pobierz” i „✕” po prawej, strzałki po bokach;
 * telefon – „✕” | nazwa i „2 z 5” | pobieranie, kropki na dole, przybliżanie dwoma palcami.
 * Kliknięcie w tło zamyka, Esc zamyka, ← / → i przesunięcie palcem zmieniają zdjęcie lub slajd.
 */
export function AttachmentViewer({
  title,
  meta,
  downloadUrl,
  downloadLabel,
  onClose,
  nav,
  mode,
}: {
  /** nazwa pliku (bez niej – z serwera) */
  title?: string;
  /** typ i rozmiar, np. „Zdjęcie · 412 KB” */
  meta?: string;
  downloadUrl?: string;
  downloadLabel?: string;
  onClose: () => void;
  /** kilka plików w wiadomości (zdjęcia): przechodzenie między nimi */
  nav?: { index: number; total: number; go: (delta: number) => void };
  mode: AttachmentMode;
}) {
  const T = useT();
  const phone = useIsPhone();
  const [zoom, setZoomRaw] = useState(1);
  const setZoom = (z: number) => setZoomRaw(Math.min(5, Math.max(1, Math.round(z * 100) / 100)));
  const [slide, setSlide] = useState(0);
  const info = useQuery({
    queryKey: ["att-info", mode.kind === "pages" ? mode.infoUrl : ""],
    queryFn: () => api<{ pages: number; title: string }>((mode as { infoUrl: string }).infoUrl),
    enabled: mode.kind === "pages",
    gcTime: 0,
  });
  const pages = info.data?.pages ?? 0;
  const name = title ?? info.data?.title ?? T("Podgląd");
  const slides = mode.kind === "pages" && !!mode.slides && pages > 1;
  // jedna oś przechodzenia: slajdy prezentacji albo pliki (zdjęcia) w wiadomości
  const step = slides
    ? { index: slide, total: pages, go: (d: number) => setSlide((s) => (s + d + pages) % pages), label: (i: number, n: number) => T("Slajd {i} z {n}", { i, n }) }
    : nav && nav.total > 1
      ? { ...nav, label: (i: number, n: number) => `${i} ${T("z")} ${n}` }
      : null;
  const resetKey = `${nav?.index ?? 0}-${slide}`;
  useEffect(() => setZoomRaw(1), [resetKey]);
  useEffect(() => {
    if (!step) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step.go(1);
      if (e.key === "ArrowLeft") step.go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  // przesunięcie palcem: szybki ruch (≥ 0,5 px/ms w chwili puszczenia, próbki z 100 ms) albo ⅓ szerokości
  const touch = useRef<{ x: number; y: number; samples: { x: number; t: number }[] } | null>(null);
  const swipe = step && zoom === 1
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          const t0 = e.touches[0];
          touch.current = e.touches.length === 1 ? { x: t0.clientX, y: t0.clientY, samples: [{ x: t0.clientX, t: e.timeStamp }] } : null;
        },
        onTouchMove: (e: React.TouchEvent) => {
          const s0 = touch.current;
          if (!s0 || e.touches.length !== 1) return;
          s0.samples.push({ x: e.touches[0].clientX, t: e.timeStamp });
          while (s0.samples.length > 2 && e.timeStamp - s0.samples[0].t > 100) s0.samples.shift();
        },
        onTouchEnd: (e: React.TouchEvent) => {
          const s0 = touch.current;
          touch.current = null;
          if (!s0) return;
          const end = e.changedTouches[0];
          const dx = end.clientX - s0.x;
          const dy = end.clientY - s0.y;
          if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const first = s0.samples[0];
          const v = (end.clientX - first.x) / Math.max(1, e.timeStamp - first.t);
          if ((Math.abs(v) >= 0.5 && Math.sign(v) === Math.sign(dx)) || Math.abs(dx) > window.innerWidth / 3) step.go(dx < 0 ? 1 : -1);
        },
      }
    : {};
  const zoomable = mode.kind === "pages";
  const where = step ? step.label(step.index + 1, step.total) : null;
  const sub = [meta, where].filter(Boolean).join(" · ");
  const dl = downloadUrl ? withAcct(`/api${downloadUrl}`) : undefined;
  const dlLabel = downloadLabel ?? T("Pobierz");

  const head = phone ? (
    <div className="ui-av-bar" data-phone>
      <ActionIcon variant="subtle" color="gray" size={44} onClick={onClose} aria-label={T("Zamknij")} data-autofocus>
        <IconX size={22} />
      </ActionIcon>
      <div className="ui-av-title" data-center>
        <span className="ui-av-name">{name}</span>
        {where && <span className="ui-av-meta">{where}</span>}
      </div>
      {dl ? (
        <ActionIcon component="a" href={dl} variant="subtle" color="gray" size={44} aria-label={dlLabel}>
          <IconDownload size={22} />
        </ActionIcon>
      ) : (
        <span />
      )}
    </div>
  ) : (
    <div className="ui-av-bar">
      <div className="ui-av-title">
        <Tooltip label={name} openDelay={500}>
          <span className="ui-av-name">{name}</span>
        </Tooltip>
        {sub && <span className="ui-av-meta">{sub}</span>}
      </div>
      {zoomable && (
        <div className="ui-av-zoom" role="group" aria-label={T("Przybliżenie")}>
          <UnstyledButton onClick={() => setZoom(zoom / 1.25)} disabled={zoom <= 1} aria-label={T("Oddal")}>
            <IconZoomOut size={18} />
          </UnstyledButton>
          <UnstyledButton className="ui-av-zoomval" onClick={() => setZoomRaw(1)} aria-label={T("Dopasuj do okna")} title={T("Dopasuj do okna")}>
            {Math.round(zoom * 100)}%
          </UnstyledButton>
          <UnstyledButton onClick={() => setZoom(zoom * 1.25)} disabled={zoom >= 5} aria-label={T("Przybliż")}>
            <IconZoomIn size={18} />
          </UnstyledButton>
        </div>
      )}
      <div className="ui-av-actions">
        {dl && (
          <Button component="a" href={dl} variant="default" size="sm" leftSection={<IconDownload size={16} />}>
            {dlLabel}
          </Button>
        )}
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClose} aria-label={T("Zamknij")} data-autofocus>
          <IconX size={20} />
        </ActionIcon>
      </div>
    </div>
  );

  let body: ReactNode;
  if (mode.kind === "pages") {
    if (info.isLoading) body = <div className="ui-av-load"><Skeleton height="70%" width="min(640px, 90%)" radius="sm" /></div>;
    else if (info.error) body = <ErrorState error={info.error} onRetry={() => info.refetch()} />;
    else
      body = (
        <FitPages
          key={resetKey}
          pages={slides ? [slide] : Array.from({ length: pages }, (_, i) => i)}
          src={(i) => `/api${mode.pageUrl(i)}`}
          zoom={zoom}
          setZoom={setZoom}
          onClose={onClose}
          bottom={phone && step && step.total <= 12 ? 24 : 0}
        />
      );
  } else if (mode.kind === "text") body = <TextBody url={mode.url} onClose={onClose} />;
  else body = <TableBody url={mode.url} />;

  return (
    <Modal opened onClose={onClose} fullScreen withCloseButton={false} padding={0} zIndex={500} classNames={{ content: "ui-av", body: "ui-av-body" }} aria-label={name}>
      {head}
      <div className="ui-av-stage" {...swipe}>
        {body}
        {step && !phone && (
          <>
            <ActionIcon className="ui-av-side" data-side="l" variant="default" radius="xl" size={44} onClick={() => step.go(-1)} aria-label={T("Poprzednie")}>
              <IconChevronLeft size={22} />
            </ActionIcon>
            <ActionIcon className="ui-av-side" data-side="r" variant="default" radius="xl" size={44} onClick={() => step.go(1)} aria-label={T("Następne")}>
              <IconChevronRight size={22} />
            </ActionIcon>
          </>
        )}
        {phone && zoomable && zoom > 1 ? (
          <UnstyledButton className="ui-av-chip" onClick={() => setZoomRaw(1)}>
            {Math.round(zoom * 100)}% · <b>{T("Dopasuj")}</b>
          </UnstyledButton>
        ) : phone && step && step.total <= 12 ? (
          <div className="ui-av-dots" aria-hidden>
            {Array.from({ length: step.total }, (_, i) => (
              <i key={i} data-on={i === step.index || undefined} />
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Strony / zdjęcie / slajd dopasowane do okna (całe widać od razu), z przybliżaniem: przyciski w pasku,
 * Ctrl + kółko, dwa palce, dwuklik; przybliżone przesuwa się palcem lub paskami. Klik w tło zamyka.
 */
function FitPages({ pages, src, zoom, setZoom, onClose, bottom = 0 }: { pages: number[]; src: (i: number) => string; zoom: number; setZoom: (z: number) => void; onClose: () => void; bottom?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<Record<number, { w: number; h: number }>>({});
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setRef = useRef(setZoom);
  setRef.current = setZoom;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setRef.current(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  const pad = 24;
  const dims = (i: number) => {
    const n = nat[i];
    if (!size || !n) return undefined;
    // „bottom” – miejsce na kropki pod slajdem / zdjęciem (telefon)
    const s = Math.min((size.w - 2 * pad) / n.w, (size.h - 2 * pad - bottom) / n.h);
    return { width: Math.round(n.w * s * zoom), height: Math.round(n.h * s * zoom) };
  };
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  return (
    <div
      ref={box}
      className="ui-av-fit"
      data-zoomed={zoom > 1 || undefined}
      style={bottom ? { paddingBottom: pad + bottom } : undefined}
      onTouchStart={(e) => {
        if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoomRef.current };
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinch.current) setZoom(pinch.current.z * (dist(e.touches) / pinch.current.d));
      }}
      onTouchEnd={(e) => {
        if (e.touches.length < 2) pinch.current = null;
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {pages.map((i) => (
        <div
          key={i}
          className="ui-av-page"
          role="img"
          aria-label={`Strona ${i + 1}`}
          onDoubleClick={() => setZoom(zoom > 1 ? 1 : 2)}
          style={dims(i) ?? { width: "min(60%, 480px)", aspectRatio: "210 / 297", maxHeight: "100%" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <img
            src={withAcct(src(i))}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const im = e.currentTarget;
              setNat((x) => ({ ...x, [i]: { w: im.naturalWidth, h: im.naturalHeight } }));
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Plik tekstowy jako zwykły tekst: zawijany, do zaznaczenia i skopiowania. */
function TextBody({ url, onClose }: { url: string; onClose: () => void }) {
  const T = useT();
  const q = useQuery({ queryKey: ["att-text", url], queryFn: () => api<{ text: string; truncated: boolean }>(url), gcTime: 0 });
  if (q.isLoading) return <div className="ui-av-load"><Skeleton height={240} width="min(72ch, 90%)" radius="sm" /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="ui-av-scroll" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ui-av-text">
        {q.data!.text || <Text c="dimmed">{T("Plik jest pusty.")}</Text>}
        {q.data!.truncated && <Text size="sm" c="dimmed" mt="md">{T("Pokazano początek pliku – całość po pobraniu.")}</Text>}
      </div>
    </div>
  );
}

/** Arkusz (Excel, CSV) jako tabela w aplikacji; kilka arkuszy – zakładki. Szeroka tabela przewija się w bok. */
function TableBody({ url }: { url: string }) {
  const T = useT();
  const q = useQuery({ queryKey: ["att-table", url], queryFn: () => api<{ sheets: { name: string; rows: string[][]; more: boolean }[] }>(url), gcTime: 0 });
  const [tab, setTab] = useState<string | null>("0");
  if (q.isLoading) return <div className="ui-av-load"><Skeleton height={240} width="min(900px, 90%)" radius="sm" /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const sheets = q.data!.sheets;
  const sheet = sheets[Number(tab ?? 0)] ?? sheets[0];
  return (
    <div className="ui-av-tablewrap">
      {sheets.length > 1 && (
        <Tabs value={tab} onChange={setTab} className="ui-av-tabs">
          <Tabs.List>
            {sheets.map((s, i) => (
              <Tabs.Tab key={i} value={String(i)}>
                {s.name}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      <div className="ui-av-tablescroll">
        {sheet && sheet.rows.length ? (
          <table className="ui-av-table">
            <tbody>
              {sheet.rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  {r.map((c, j) => (
                    <td key={j} data-num={/^-?[\d\s]+(,\d+)?$/.test(c) || undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Text c="dimmed" p="lg">{T("Arkusz jest pusty.")}</Text>
        )}
        {sheet?.more && <Text size="sm" c="dimmed" p="md">{T("Pokazano pierwsze 2000 wierszy – całość po pobraniu.")}</Text>}
      </div>
    </div>
  );
}
