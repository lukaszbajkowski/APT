import { useEffect, useRef, useState } from "react";
import { ActionIcon, Modal, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconDownload, IconFileTypePdf, IconPaperclip, IconPlus, IconX } from "@tabler/icons-react";

import { useT } from "../lib/i18n";

/** Plik w wiadomości (z serwera). */
export interface MsgFile {
  id: number;
  name: string;
  size: number;
  kind: "image" | "file";
  width?: number | null;
  height?: number | null;
}

export const MAX_FILES = 10;
const MAX_MB = 15;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export function fileSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const url = (base: string, id: number, thumb = false) => `/api${base}/files/${id}${thumb ? "?thumb=1" : ""}`;

/** Załączniki w dymku, jak w komunikatorze: zdjęcia jako obraz (kilka – siatka 2×2 z „+N”), PDF jako kafelek. */
export function MsgAttachments({ files, base }: { files: MsgFile[]; base: string }) {
  const T = useT();
  const [open, setOpen] = useState<number | null>(null);
  const imgs = files.filter((f) => f.kind === "image");
  const docs = files.filter((f) => f.kind !== "image");
  if (!files.length) return null;
  const shown = imgs.length > 4 ? imgs.slice(0, 4) : imgs;
  return (
    <div className="ui-mf">
      {imgs.length === 1 ? (
        <UnstyledButton className="ui-mf-one" onClick={() => setOpen(0)} aria-label={`${T("Otwórz zdjęcie")}: ${imgs[0].name}`}>
          <img
            src={url(base, imgs[0].id, true)}
            alt={imgs[0].name}
            loading="lazy"
            style={{ aspectRatio: imgs[0].width && imgs[0].height ? `${imgs[0].width} / ${imgs[0].height}` : undefined }}
          />
        </UnstyledButton>
      ) : imgs.length > 1 ? (
        <div className="ui-mf-grid" data-n={Math.min(imgs.length, 4)}>
          {shown.map((f, i) => (
            <UnstyledButton key={f.id} className="ui-mf-cell" onClick={() => setOpen(i)} aria-label={`${T("Otwórz zdjęcie")}: ${f.name}`}>
              <img src={url(base, f.id, true)} alt={f.name} loading="lazy" />
              {i === 3 && imgs.length > 4 && <span className="ui-mf-more">+{imgs.length - 4}</span>}
            </UnstyledButton>
          ))}
        </div>
      ) : null}
      {docs.map((f) => (
        <a key={f.id} className="ui-mf-file" href={url(base, f.id)} target="_blank" rel="noopener">
          <span className="ui-mf-ic" aria-hidden>
            <IconFileTypePdf size={20} />
          </span>
          <span className="ui-mf-txt">
            <span className="ui-mf-name">{f.name}</span>
            <span className="ui-mf-size">PDF · {fileSize(f.size)}</span>
          </span>
        </a>
      ))}
      {open !== null && <ImageViewer images={imgs} base={base} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Podgląd zdjęć na cały ekran: strzałki (także klawiatura), przesunięcie w bok – następne, w dół – zamknięcie. */
function ImageViewer({ images, base, start, onClose }: { images: MsgFile[]; base: string; start: number; onClose: () => void }) {
  const T = useT();
  const [i, setI] = useState(start);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = images.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const f = images[i];
  return (
    <Modal opened onClose={onClose} fullScreen withCloseButton={false} padding={0} classNames={{ content: "ui-mv", body: "ui-mv-body" }} aria-label={f.name}>
      <div className="ui-mv-bar">
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClose} aria-label={T("Zamknij")} className="ui-mv-btn">
          <IconX size={22} />
        </ActionIcon>
        <span className="ui-mv-count">{n > 1 ? `${i + 1} / ${n}` : ""}</span>
        <a className="ui-mv-btn ui-mv-dl" href={url(base, f.id)} download={f.name} aria-label={T("Pobierz")}>
          <IconDownload size={22} />
        </a>
      </div>
      <div
        className="ui-mv-stage"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = touch.current;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (dy > 80 && Math.abs(dy) > Math.abs(dx)) onClose();
          else if (Math.abs(dx) > 50 && n > 1) go(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        {n > 1 && (
          <ActionIcon variant="subtle" color="gray" size="xl" className="ui-mv-btn ui-mv-prev" onClick={() => go(-1)} aria-label={T("Poprzednie")}>
            <IconChevronLeft size={28} />
          </ActionIcon>
        )}
        <img src={url(base, f.id)} alt={f.name} />
        {n > 1 && (
          <ActionIcon variant="subtle" color="gray" size="xl" className="ui-mv-btn ui-mv-next" onClick={() => go(1)} aria-label={T("Następne")}>
            <IconChevronRight size={28} />
          </ActionIcon>
        )}
      </div>
      <div className="ui-mv-cap">{f.name}</div>
    </Modal>
  );
}

/** Pliki wybrane do wysłania: sprawdzenie typu i rozmiaru po stronie przeglądarki, miniatury. */
export function usePendingFiles() {
  const [files, setFiles] = useState<{ file: File; url: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    let err: string | null = null;
    for (const f of Array.from(list)) {
      const ok = f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!ok) err = `Pliku „${f.name}” nie da się wysłać – dozwolone są zdjęcia i PDF.`;
      else if (f.size > MAX_MB * 1024 * 1024) err = `Plik „${f.name}” jest za duży (max ${MAX_MB} MB).`;
      else if (next.length >= MAX_FILES) err = `Najwyżej ${MAX_FILES} plików w wiadomości.`;
      else next.push({ file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    setError(err);
    setFiles(next);
  };
  const remove = (i: number) =>
    setFiles((xs) => {
      const x = xs[i];
      if (x?.url) URL.revokeObjectURL(x.url);
      return xs.filter((_, j) => j !== i);
    });
  const clear = () => {
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setFiles([]);
    setError(null);
  };
  const form = (body: string) => {
    const fd = new FormData();
    fd.append("body", body);
    files.forEach((f) => fd.append("files", f.file, f.file.name));
    return fd;
  };
  return { files, error, add, remove, clear, form, setError };
}
export type Pending = ReturnType<typeof usePendingFiles>;

/** Spinacz (komputer) / „＋” (telefon): systemowy wybór pliku – na telefonie sam proponuje aparat, galerię i pliki. */
export function AttachButton({ pending, phone }: { pending: Pending; phone?: boolean }) {
  const T = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          pending.add(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <Tooltip label={T("Dodaj zdjęcie lub plik")} disabled={phone}>
        <ActionIcon
          variant="default"
          radius="xl"
          size={phone ? 44 : 36}
          className="ui-mf-attach"
          onClick={() => input.current?.click()}
          aria-label={T("Dodaj zdjęcie lub plik")}
        >
          {phone ? <IconPlus size={22} /> : <IconPaperclip size={18} />}
        </ActionIcon>
      </Tooltip>
    </>
  );
}

/** Miniatury plików wybranych do wysłania, z „✕”. */
export function PendingFiles({ pending }: { pending: Pending }) {
  const T = useT();
  if (!pending.files.length && !pending.error) return null;
  return (
    <div className="ui-mf-pending">
      {pending.files.map((f, i) => (
        <span className="ui-mf-th" key={`${f.file.name}-${i}`} title={f.file.name}>
          {f.url ? (
            <img src={f.url} alt={f.file.name} />
          ) : (
            <span className="ui-mf-thf">
              <IconFileTypePdf size={20} aria-hidden />
              <span>{f.file.name}</span>
            </span>
          )}
          <UnstyledButton className="ui-mf-thx" onClick={() => pending.remove(i)} aria-label={`${T("Usuń")}: ${f.file.name}`}>
            <IconX size={12} />
          </UnstyledButton>
        </span>
      ))}
      {pending.error && <span className="ui-mf-err" role="alert">{pending.error}</span>}
    </div>
  );
}
