import { useEffect, useRef, useState } from "react";
import { ActionIcon, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconFileText,
  IconFileTypeCsv,
  IconFileTypeDoc,
  IconFileTypeDocx,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeTxt,
  IconFileTypeXls,
  IconPaperclip,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";

import { AttachmentViewer, type AttachmentMode } from "./AttachmentViewer";

import { withAcct } from "../api";
import { useT } from "../lib/i18n";

/** Plik w wiadomości (z serwera). */
export interface MsgFile {
  id: number;
  name: string;
  size: number;
  kind: "image" | "audio" | "file";
  ext?: string;
  width?: number | null;
  height?: number | null;
}

export const MAX_FILES = 10;
const MAX_MB = 15;
const OFFICE = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv"];
const AUDIO = ["m4a", "mp3", "ogg", "opus", "wav", "webm", "aac"];
const ACCEPT = ["image/*", "application/pdf", "audio/*", ...OFFICE.map((e) => `.${e}`), ...AUDIO.map((e) => `.${e}`)].join(",");

/** Ikona i nazwa typu pliku (kafelek w dymku i miniatura przed wysłaniem). */
function fileType(name: string, ext?: string): { label: string; Icon: typeof IconFileText; tone: string } {
  const e = (ext || name.split(".").pop() || "").toLowerCase();
  if (e === "pdf") return { label: "PDF", Icon: IconFileTypePdf, tone: "red" };
  if (e === "docx") return { label: "Word", Icon: IconFileTypeDocx, tone: "blue" };
  if (e === "doc" || e === "rtf" || e === "odt") return { label: e === "odt" ? "Dokument" : "Word", Icon: IconFileTypeDoc, tone: "blue" };
  if (e === "xls" || e === "xlsx" || e === "ods") return { label: "Excel", Icon: IconFileTypeXls, tone: "green" };
  if (e === "csv") return { label: "CSV", Icon: IconFileTypeCsv, tone: "green" };
  if (e === "ppt" || e === "pptx" || e === "odp") return { label: e === "odp" ? "Prezentacja" : "PowerPoint", Icon: IconFileTypePpt, tone: "orange" };
  if (e === "txt") return { label: "Tekst", Icon: IconFileTypeTxt, tone: "gray" };
  return { label: e.toUpperCase(), Icon: IconFileText, tone: "gray" };
}

export function fileSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const url = (base: string, id: number, thumb = false) => `/api${base}/files/${id}${thumb ? "?thumb=1" : ""}`;

/** Tryb podglądu wg typu: tekst w aplikacji, arkusz jako tabela, prezentacja slajd po slajdzie, reszta – strony. */
function viewMode(base: string, f: MsgFile): AttachmentMode {
  const e = (f.ext || f.name.split(".").pop() || "").toLowerCase();
  if (e === "txt") return { kind: "text", url: `${base}/files/${f.id}/text` };
  if (["csv", "xlsx", "xls", "ods"].includes(e)) return { kind: "table", url: `${base}/files/${f.id}/table` };
  return {
    kind: "pages",
    infoUrl: `${base}/files/${f.id}/preview`,
    pageUrl: (i) => `${base}/files/${f.id}/preview/page/${i}`,
    slides: ["ppt", "pptx", "odp"].includes(e),
  };
}

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/** Nagranie głosowe w dymku jak notatka głosowa: odtwórz / pauza, pasek postępu (przewijanie), czas. */
function VoiceNote({ src, name }: { src: string; name: string }) {
  const T = useT();
  const a = useRef<HTMLAudioElement>(null);
  const [play, setPlay] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const probing = useRef(false);
  return (
    <div className="ui-mf-voice">
      <audio
        ref={a}
        src={withAcct(src)}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration)) return setD(el.duration);
          // nagranie z przeglądarki (WebM) nie ma zapisanej długości – przeskok na koniec ją odczytuje
          probing.current = true;
          el.currentTime = 1e7;
        }}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setD(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (probing.current) {
            if (Number.isFinite(el.duration)) {
              probing.current = false;
              setD(el.duration);
              el.currentTime = 0;
            }
            return;
          }
          setT(el.currentTime);
        }}
        onPlay={() => setPlay(true)}
        onPause={() => setPlay(false)}
        onEnded={() => {
          setPlay(false);
          setT(0);
        }}
      />
      <ActionIcon variant="filled" radius="xl" size={36} onClick={() => (play ? a.current?.pause() : a.current?.play())} aria-label={play ? T("Pauza") : `${T("Odtwórz nagranie")}: ${name}`}>
        {play ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
      </ActionIcon>
      <input
        type="range"
        className="ui-mf-seek"
        min={0}
        max={d || 0}
        step={0.1}
        value={Math.min(t, d || 0)}
        onChange={(e) => {
          if (a.current) a.current.currentTime = Number(e.currentTarget.value);
        }}
        aria-label={T("Przewiń nagranie")}
        style={{ "--p": d ? `${(t / d) * 100}%` : "0%" } as React.CSSProperties}
      />
      <span className="ui-mf-time">{fmt(play || t ? t : d)}</span>
      <span className="ui-mf-vname" title={name}>
        {name}
      </span>
    </div>
  );
}

/** Załączniki w dymku, jak w komunikatorze: zdjęcia jako obraz (kilka – siatka 2×2 z „+N”), PDF jako kafelek. */
export function MsgAttachments({ files, base }: { files: MsgFile[]; base: string }) {
  const T = useT();
  const [doc, setDoc] = useState<MsgFile | null>(null);
  const imgs = files.filter((f) => f.kind === "image");
  const auds = files.filter((f) => f.kind === "audio");
  const docs = files.filter((f) => f.kind === "file");
  if (!files.length) return null;
  const shown = imgs.length > 4 ? imgs.slice(0, 4) : imgs;
  return (
    <div className="ui-mf">
      {imgs.length === 1 ? (
        <UnstyledButton className="ui-mf-one" onClick={() => setDoc(imgs[0])} aria-label={`${T("Otwórz zdjęcie")}: ${imgs[0].name}`}>
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
            <UnstyledButton key={f.id} className="ui-mf-cell" onClick={() => setDoc(f)} aria-label={`${T("Otwórz zdjęcie")}: ${f.name}`}>
              <img src={url(base, f.id, true)} alt={f.name} loading="lazy" />
              {i === 3 && imgs.length > 4 && <span className="ui-mf-more">+{imgs.length - 4}</span>}
            </UnstyledButton>
          ))}
        </div>
      ) : null}
      {auds.map((f) => (
        <VoiceNote key={f.id} src={url(base, f.id)} name={f.name} />
      ))}
      {docs.map((f) => {
        const ft = fileType(f.name, f.ext);
        return (
          <UnstyledButton key={f.id} className="ui-mf-file" onClick={() => setDoc(f)} aria-label={`${T("Otwórz podgląd")}: ${f.name}`}>
            <span className="ui-mf-ic" data-tone={ft.tone} aria-hidden>
              <ft.Icon size={20} />
            </span>
            <span className="ui-mf-txt">
              <span className="ui-mf-name">{f.name}</span>
              <span className="ui-mf-size">
                {ft.label} · {fileSize(f.size)}
              </span>
            </span>
          </UnstyledButton>
        );
      })}
      {doc && (
        <AttachmentViewer
          title={doc.name}
          meta={`${doc.kind === "image" ? T("Zdjęcie") : fileType(doc.name, doc.ext).label} · ${fileSize(doc.size)}`}
          onClose={() => setDoc(null)}
          downloadUrl={`${base}/files/${doc.id}`}
          downloadLabel={doc.kind !== "image" && (doc.ext ?? "") === "pdf" ? T("Pobierz PDF") : T("Pobierz")}
          mode={viewMode(base, doc)}
          nav={
            doc.kind === "image" && imgs.length > 1
              ? {
                  index: imgs.findIndex((x) => x.id === doc.id),
                  total: imgs.length,
                  go: (d: number) => setDoc(imgs[(imgs.findIndex((x) => x.id === doc.id) + d + imgs.length) % imgs.length]),
                }
              : undefined
          }
        />
      )}
    </div>
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
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const ok = f.type === "application/pdf" || f.type.startsWith("image/") || /^(pdf|jpe?g|png|webp|heic|heif)$/.test(ext) || OFFICE.includes(ext) || AUDIO.includes(ext) || f.type.startsWith("audio/");
      if (!ok) err = `Pliku „${f.name}” nie da się wysłać. Dozwolone są zdjęcia, PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV i nagrania głosowe.`;
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
              {(() => {
                const ft = fileType(f.file.name);
                return <ft.Icon size={20} aria-hidden />;
              })()}
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
