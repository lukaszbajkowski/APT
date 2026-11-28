import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionIcon, Box, Button, Center, Group, Skeleton, Modal, Portal, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconDownload, IconEyeOff, IconShieldLock, IconZoomIn, IconZoomOut } from "@tabler/icons-react";

import { PageSheet } from "./PageSheet";
import { api, withAcct } from "../api";
import { useT } from "../lib/i18n";
import { ErrorState } from "./States";
import { StatusBadge, ViewScreen } from "./Mobile";
import { useIsPhone } from "../lib/device";

/** Nazwa pliku z miejscami łamania po „_”, „.”, „-” – długa nazwa zawija się w całych członach, a nie w środku słowa. */
export function breakableName(name: string) {
  return name.split(/(?<=[_.\-])/).map((part, i) => (
    <Fragment key={i}>
      {part}
      <wbr />
    </Fragment>
  ));
}

/** „1 strona”, „3 strony”, „5 stron” */
function pagesText(n: number, T: (s: string) => string) {
  if (n === 1) return T("1 strona");
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return `${n} ${few ? T("strony") : T("stron")}`;
}

interface Preview {
  pages: number;
  signed: boolean;
  title: string;
}

/**
 * Podgląd dokumentu w aplikacji: strony jako obrazy ze znakiem wodnym (kto i kiedy ogląda).
 * Utrudnia kopiowanie: brak menu kontekstowego, zaznaczania i przeciągania, strona ukrywa się
 * przy próbie zrzutu ekranu (PrtScn, Win+Shift+S, Cmd+Shift+3/4/5), drukowaniu i gdy okno traci fokus.
 */
export function DocumentViewer({
  docId,
  opened,
  onClose,
  base,
  downloadUrl,
  downloadLabel,
  overlay,
  nav,
  variant = base ? "signed" : "document",
}: {
  docId: string;
  opened: boolean;
  onClose: () => void;
  /** document – dokument z kartoteki (znak wodny, ochrona przed zrzutem); signed – podpisany dokument pracownika; attachment – załącznik komunikatu (bez ochrony i bez stopki) */
  variant?: "document" | "signed" | "attachment";
  /** Własne źródło podglądu (np. podpisany dokument pracownika): `${base}` zwraca informacje, `${base}/page/{i}` strony. */
  base?: string;
  downloadUrl?: string;
  /** napis przycisku pobierania (domyślnie „Pobierz PDF”) – np. „Pobierz” dla pliku Word z wiadomości */
  downloadLabel?: string;
  /** otwierany nad warstwą na cały ekran (rozmowa na telefonie) – okno pełnoekranowe zamiast ekranu z górnym paskiem */
  overlay?: boolean;
  /** przechodzenie między kilkoma plikami (zdjęcia w wiadomości): strzałki w pasku, klawiatura ←/→, przesunięcie palcem */
  nav?: { index: number; total: number; go: (delta: number) => void };
}) {
  const T = useT();
  const infoUrl = base ?? `/documents/${docId}/preview`;
  const pageUrl = (i: number) => (base ? `${base}/page/${i}` : `/documents/${docId}/preview/${i}`);
  const q = useQuery({
    queryKey: ["preview", docId, base],
    queryFn: async () => {
      const r = await api<Preview & { document?: string }>(infoUrl);
      return { ...r, title: r.title ?? r.document ?? "Dokument" };
    },
    enabled: opened,
    gcTime: 0,
    staleTime: 0,
  });
  const [hidden, setHidden] = useState(false);
  const phone = useIsPhone();
  // załączniki (komunikaty, wiadomości) zawsze w oknie na cały ekran – dopasowanie do okna i przybliżanie także na telefonie
  const mobile = phone && !overlay && variant !== "attachment";

  const protect = variant !== "attachment";
  useEffect(() => {
    if (!opened || !protect) return;
    const hide = () => setHidden(true);
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "PrintScreen" || k === "Meta" || k === "OS" || ((e.metaKey || e.ctrlKey) && ["p", "s", "P", "S"].includes(k)) || (e.metaKey && e.shiftKey)) {
        if (k !== "Meta" && k !== "OS") e.preventDefault();
        hide();
        if (k === "PrintScreen") void navigator.clipboard?.writeText?.("").catch(() => undefined);
      }
    };
    const onVis = () => document.hidden && hide();
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", hide);
    window.addEventListener("beforeprint", hide);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("copy", block, true);
    document.body.classList.add("doc-viewer-open");
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("beforeprint", hide);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("copy", block, true);
      document.body.classList.remove("doc-viewer-open");
    };
  }, [opened, protect]);

  const title = q.data?.title ?? T("Podgląd dokumentu");
  const multi = !!nav && nav.total > 1;
  // załączniki (wiadomości, komunikaty) w oknie: cała strona / zdjęcie / slajd od razu w oknie, z przybliżaniem
  const fit = variant === "attachment" && !mobile;
  const [zoom, setZoom] = useState(1);
  const zoomTo = (z: number) => setZoom(Math.min(5, Math.max(1, Math.round(z * 100) / 100)));
  const navKey = nav?.index;
  useEffect(() => setZoom(1), [navKey, docId]);
  // na telefonie przybliża się dwoma palcami (albo dwuklikiem) – w pasku zostaje miejsce na nazwę
  const zoomCtl = fit && !phone ? (
    <Group gap={4} wrap="nowrap" className="doc-viewer-zoom">
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= 1} aria-label={T("Oddal")}>
        <IconZoomOut size={20} />
      </ActionIcon>
      <UnstyledButton className="doc-viewer-zoomval" onClick={() => setZoom(1)} aria-label={T("Dopasuj do okna")} title={T("Dopasuj do okna")}>
        {Math.round(zoom * 100)}%
      </UnstyledButton>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= 5} aria-label={T("Przybliż")}>
        <IconZoomIn size={20} />
      </ActionIcon>
    </Group>
  ) : null;
  useEffect(() => {
    if (!opened || !multi) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nav!.go(1);
      if (e.key === "ArrowLeft") nav!.go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [opened, multi, nav]);
  const touch = useRef<{ x: number; y: number; samples: { x: number; t: number }[] } | null>(null);
  const navCtl = multi ? (
    <Group gap={4} wrap="nowrap" className="doc-viewer-nav">
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => nav!.go(-1)} aria-label={T("Poprzednie")}>
        <IconChevronLeft size={20} />
      </ActionIcon>
      <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {nav!.index + 1} / {nav!.total}
      </Text>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => nav!.go(1)} aria-label={T("Następne")}>
        <IconChevronRight size={20} />
      </ActionIcon>
    </Group>
  ) : null;
  const content = (
      <Box
        className="doc-viewer"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onClick={() => (hidden ? setHidden(false) : undefined)}
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", position: "relative" }}
        onTouchStart={(e) => {
          if (!multi || zoom > 1 || e.touches.length > 1) {
            touch.current = null;
            return;
          }
          const t0 = e.touches[0];
          touch.current = { x: t0.clientX, y: t0.clientY, samples: [{ x: t0.clientX, t: e.timeStamp }] };
        }}
        onTouchMove={(e) => {
          const s0 = touch.current;
          if (!s0) return;
          s0.samples.push({ x: e.touches[0].clientX, t: e.timeStamp });
          while (s0.samples.length > 2 && e.timeStamp - s0.samples[0].t > 100) s0.samples.shift();
        }}
        onTouchEnd={(e) => {
          // jak gesty w aplikacji: szybki ruch = prędkość ≥ 0,5 px/ms w chwili puszczenia (próbki z 100 ms) albo
          // spokojne przeciągnięcie przez ⅓ szerokości; ruch głównie w pionie to przewijanie, nie zmiana zdjęcia
          const s0 = touch.current;
          touch.current = null;
          if (!s0) return;
          const end = e.changedTouches[0];
          const dx = end.clientX - s0.x;
          const dy = end.clientY - s0.y;
          if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const first = s0.samples[0];
          const v = (end.clientX - first.x) / Math.max(1, e.timeStamp - first.t);
          const fast = Math.abs(v) >= 0.5 && Math.sign(v) === Math.sign(dx);
          if (fast || Math.abs(dx) > window.innerWidth / 3) nav!.go(dx < 0 ? 1 : -1);
        }}
      >
        {q.isLoading && (
          <Skeleton height="60dvh" radius="md" aria-busy="true" aria-label="Ładowanie dokumentu" />
        )}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && fit && (
          <FitPages
            pages={q.data.pages}
            src={(i) => `/api${pageUrl(i)}`}
            zoom={zoom}
            setZoom={zoomTo}
            hidden={hidden}
            onClose={onClose}
          />
        )}
        {q.data && !fit && (
          <Stack
            gap="md"
            align="center"
            py="md"
            title={T("Kliknij dokument, aby go zamknąć")}
            onClick={() => !hidden && onClose()}
            style={{ filter: hidden ? "blur(28px)" : undefined, transition: "filter .1s", cursor: "zoom-out" }}
          >
            {Array.from({ length: q.data.pages }, (_, i) => (
              <PageSheet key={i} index={i} src={`/api${pageUrl(i)}`} maw={900} />
            ))}
          </Stack>
        )}
        {protect && hidden && (
          <Portal>
          <Center style={{ position: "fixed", inset: 0, zIndex: 1000, cursor: "pointer" }} onClick={() => setHidden(false)}>
            <Stack align="center" gap={8} p="lg" style={{ borderRadius: 14, background: "var(--apt-surface)", color: "var(--mantine-color-text)", border: "1px solid var(--apt-line)", boxShadow: "0 8px 28px rgba(0,0,0,.35)", margin: 16 }}>
              <IconEyeOff size={36} color="var(--mantine-color-dimmed)" />
              <Text fw={700} size="lg">{T("Podgląd ukryty")}</Text>
              <Text size="sm" c="dimmed" ta="center" maw={320}>
                {T("Dokument ukrywa się, gdy okno traci fokus albo przy próbie zrzutu ekranu lub druku. Kliknij, aby wrócić.")}
              </Text>
            </Stack>
          </Center>
          </Portal>
        )}
        {variant !== "attachment" && (
          <Group justify="center" gap={8} pb="md" px="md" wrap="nowrap" align="flex-start">
            <IconShieldLock size={16} color="var(--mantine-color-dimmed)" style={{ flex: "none", marginTop: 4 }} />
            <Text size="sm" c="dimmed">
              {variant === "signed" ? T("Twój podpisany dokument") : T("Tylko podgląd · na stronach widnieje Twoje imię i nazwisko oraz czas otwarcia · otwarcie zapisano w dzienniku")}
            </Text>
          </Group>
        )}
      </Box>
  );

  if (mobile) {
    if (!opened) return null;
    return (
      <ViewScreen
        title={T("Podgląd dokumentu")}
        subtitle={q.data ? pagesText(q.data.pages, T) : undefined}
        label={title}
        onClose={onClose}
        bar={
          downloadUrl ? (
            <Button component="a" size="lg" radius="md" fullWidth href={withAcct(`/api${downloadUrl}`)} leftSection={<IconDownload size={20} />}>
              {downloadLabel ?? T("Pobierz PDF")}
            </Button>
          ) : undefined
        }
      >
        <div>
          <h2 className="ui-view-title">{breakableName(title)}</h2>
          {navCtl}
          {q.data?.signed && (
            <StatusBadge tone="ok">
              {T("wersja podpisana")}
            </StatusBadge>
          )}
        </div>
        {content}
      </ViewScreen>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      zIndex={500}
      classNames={{ title: "doc-viewer-title", content: fit ? "doc-viewer-content doc-viewer-fitc" : "doc-viewer-content", body: fit ? "doc-viewer-fitb" : undefined }}
      title={
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fw={600} truncate style={{ minWidth: 0 }}>{q.data?.title ?? T("Podgląd dokumentu")}</Text>
          {navCtl}
          {zoomCtl}
          {downloadUrl && phone && (
            <ActionIcon component="a" variant="light" size="lg" href={withAcct(`/api${downloadUrl}`)} aria-label={downloadLabel ?? T("Pobierz PDF")}>
              <IconDownload size={18} />
            </ActionIcon>
          )}
          {downloadUrl && !phone && (
            <Button component="a" size="xs" variant="light" href={withAcct(`/api${downloadUrl}`)} leftSection={<IconDownload size={14} />}>
              {downloadLabel ?? T("Pobierz PDF")}
            </Button>
          )}
          {q.data?.signed && (
            <StatusBadge tone="ok">
              {T("wersja podpisana")}
            </StatusBadge>
          )}
        </Group>
      }
      styles={{ body: fit ? { background: "var(--apt-subtle)", padding: 0 } : { background: "var(--apt-subtle)", minHeight: "calc(100vh - 60px)" } }}
    >
      {content}
    </Modal>
  );
}

/**
 * Strony załącznika dopasowane do okna (całe zdjęcie / strona / slajd widać od razu), z przybliżaniem:
 * przyciski w pasku, Ctrl + kółko myszy, dwa palce; przybliżoną stronę przesuwa się palcem albo paskami przewijania.
 */
function FitPages({ pages, src, zoom, setZoom, hidden, onClose }: { pages: number; src: (i: number) => string; zoom: number; setZoom: (z: number) => void; hidden: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<Record<number, { w: number; h: number }>>({});
  const pinch = useRef<{ d: number; z: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [setZoom]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pad = 16;
  const dims = (i: number) => {
    const n = nat[i];
    if (!size || !n) return undefined;
    const s = Math.min((size.w - 2 * pad) / n.w, (size.h - 2 * pad) / n.h);
    return { width: Math.round(n.w * s * zoom), height: Math.round(n.h * s * zoom) };
  };
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  return (
    <div
      ref={box}
      className="doc-fit"
      data-zoomed={zoom > 1 || undefined}
      style={{ filter: hidden ? "blur(28px)" : undefined }}
      onTouchStart={(e) => {
        if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoomRef.current };
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinch.current) {
          e.preventDefault();
          setZoom(pinch.current.z * (dist(e.touches) / pinch.current.d));
        }
      }}
      onTouchEnd={(e) => {
        if (e.touches.length < 2) pinch.current = null;
      }}
      // kliknięcie w tło (poza stroną / zdjęciem) zamyka podgląd; dwuklik na stronie – przybliżenie
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {Array.from({ length: pages }, (_, i) => {
        const d = dims(i);
        return (
          <div key={i} className="doc-fit-page" onDoubleClick={() => setZoom(zoom > 1 ? 1 : 2)} role="img" aria-label={`Strona ${i + 1}`} style={d ?? { width: "60%", aspectRatio: "210 / 297", maxHeight: "100%" }}>
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
        );
      })}
    </div>
  );
}
