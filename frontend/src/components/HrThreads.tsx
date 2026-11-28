import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Box, Button, Group, ScrollArea, SegmentedControl, Stack, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import { IconUsers, IconX, IconArchive, IconArchiveOff, IconMessage, IconMicrophone, IconPencil, IconSearch } from "@tabler/icons-react";

import { EmptyState } from "./States";
import { api, errorText, shortTime, type Employee } from "../api";
import { useAuth } from "../auth";
import { useT } from "../lib/i18n";
import { useUrlOpen, useUrlTab } from "../lib/urlState";
import { useDraft } from "../lib/draft";
import { currentTz, differsFromHome, timeIn, tzCity } from "../lib/time";
import { canDictate, canSpeak, dictate, speak, speechLang, stopSpeaking } from "../lib/speech";
import { MasterDetail, useNarrowArea } from "./MasterDetail";
import { AttachButton, MsgAttachments, PendingFiles, usePendingFiles, type MsgFile, type Pending } from "./MessageFiles";
import { EmployeeAside } from "./EmployeeAside";
import { Link, useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { ActionSheet, CompactEmpty, PageHead, RowMenu, Segments, SwipePager, SwipeRow, useMobileHeader, useNavHeightVar, type RowAction } from "./Mobile";
import { IconCheck, IconChevronRight, IconDots, IconChevronLeft, IconArrowRight, IconCircleCheck, IconProgress, IconInbox, IconUser } from "@tabler/icons-react";
import { useIsPhone } from "../lib/device";
import { MicHelp, type MicHelpState } from "./MicHelp";

export interface ThreadRow {
  id: number;
  subject: string;
  status: "new" | "in_progress" | "done";
  updated_at: string;
  last_from_staff: boolean;
  preview: string;
  unread: boolean;
  archived: boolean;
  employee_id: number | null;
  employee_name: string | null;
  employee_number: string | null;
  unread_count?: number;
  is_group?: boolean;
  member_count?: number;
  batch_size?: number | null;
}
interface Thread {
  id: number;
  subject: string;
  status: ThreadRow["status"];
  archived: boolean;
  messages: { id: number; from_staff: boolean; mine?: boolean; files?: MsgFile[]; kind: "message" | "status"; author_name: string | null; body: string; created_at: string }[];
  is_group?: boolean;
  members?: { employee_id: number | null; name: string; number: string | null }[];
  batch_size?: number | null;
  employee_name: string | null;
  employee_number: string | null;
  employee_id?: number | null;
  other_seen_at?: string | null;
}

/** Dopisek przy rozmowie do kilku osób: wspólna rozmowa albo jedna z osobnych z tej samej wysyłki. */
function groupNote(t: { is_group?: boolean; member_count?: number; members?: unknown[]; batch_size?: number | null }, T: (s: string, v?: Record<string, string | number>) => string): string | null {
  const n = t.member_count ?? t.members?.length ?? 0;
  if (t.is_group) return T("Rozmowa grupowa · {n} os.", { n });
  if (t.batch_size) return T("Wysłano do {n} osób", { n: t.batch_size });
  return null;
}
const isMine = (m: { from_staff: boolean; mine?: boolean }, staff: boolean) => m.mine ?? m.from_staff === staff;

export const THREAD_STATUS: Record<ThreadRow["status"], { label: string; color: string }> = {
  new: { label: "Nowa", color: "blue" },
  in_progress: { label: "W toku", color: "yellow" },
  done: { label: "Zakończona", color: "green" },
};

// Odświeżanie „na żywo”: odpytywanie co kilka sekund, tylko gdy karta jest widoczna.
const LIVE = { refetchOnWindowFocus: true, refetchIntervalInBackground: false } as const;


function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Mikrofon: dyktowanie treści do pola (dopisuje do tego, co już wpisano). */
const HOLD_MS = 350; // przytrzymanie dłuższe niż to – nagranie głosowe (krótkie stuknięcie – dyktowanie)
const MAX_REC_S = 300;

/**
 * Mikrofon: stuknięcie – dyktowanie treści do pola (dopisuje do tego, co już wpisano);
 * przytrzymanie (gdy jest `onVoice`) – nagranie głosowe jak w komunikatorze: puść – wyślij, przesuń w lewo – anuluj.
 * Druga droga bez gestu dla nagrania: „+” / spinacz i plik z dyktafonu; klawiatura (Enter / Spacja) – dyktowanie.
 */
export type RecUi = { secs: number; cancel: boolean; levels: number[] };

function DictateButton({ lang, value, onChange, onVoice, onRecUi }: { lang: string; value: string; onChange: (v: string) => void; onVoice?: (f: File) => void; /** komputer / tablet: stan nagrywania do pokazania w wierszu pisania (zamiast paska na dole) */ onRecUi?: (s: RecUi | null) => void }) {
  const T = useT();
  const [on, setOn] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const base = useRef("");
  const hold = useRef<{ timer: number; x: number; recording: boolean; failed?: boolean } | null>(null);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; started: number; cancel: boolean } | null>(null);
  const [recState, setRecState] = useState<RecUi | null>(null);
  const [help, setHelp] = useState<MicHelpState>(null);
  const meter = useRef<{ ctx: AudioContext; an: AnalyserNode } | null>(null);
  useEffect(() => onRecUi?.(recState), [recState]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      stop.current?.();
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (!recState) return;
    const id = window.setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const secs = Math.floor((Date.now() - r.started) / 1000);
      // głośność do „fali” – widać, że mikrofon łapie dźwięk
      let lvl = 0;
      const m = meter.current;
      if (m) {
        const buf = new Uint8Array(m.an.fftSize);
        m.an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        lvl = Math.min(1, Math.sqrt(sum / buf.length) / 40);
      }
      setRecState((x) => (x ? { ...x, secs, levels: [...x.levels, lvl].slice(-80) } : x));
      if (secs >= MAX_REC_S) finishRec(false);
    }, 100);
    return () => window.clearInterval(id);
  }, [recState === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const dictation = canDictate();
  if (!dictation && !onVoice) return null;
  function toggle() {
    if (!dictation) return;
    if (on) {
      stop.current?.();
      return;
    }
    base.current = value ? value.replace(/\s+$/, "") + " " : "";
    setOn(true);
    stop.current = dictate(
      speechLang(lang),
      (text) => onChange((base.current + text).slice(0, 2000)),
      (err) => {
        setOn(false);
        stop.current = null;
        if (err === "not-allowed" || err === "service-not-allowed") void micProblem(err);
      },
    );
  }
  // okno „odblokuj mikrofon” tylko przy faktycznym braku zgody; przy zgodzie – prawdziwa przyczyna
  async function micProblem(err?: string) {
    const st = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => null);
    if (st?.state === "prompt") return setHelp("ask");
    if (st?.state === "denied") return setHelp("blocked");
    const msg =
      err === "NotFoundError"
        ? T("Nie znaleziono mikrofonu – podłącz go albo wybierz w ustawieniach systemu.")
        : err === "NotReadableError"
          ? T("Mikrofon jest zajęty przez inny program (np. rozmowę wideo). Zamknij go i spróbuj ponownie.")
          : err === "service-not-allowed" || err === "not-allowed"
            ? T("Dyktowanie jest teraz niedostępne w tej przeglądarce. Wpisz tekst albo przytrzymaj mikrofon, aby nagrać wiadomość głosową.")
            : null;
    if (msg) notifications.show({ color: "yellow", message: msg, autoClose: 8000 });
    else setHelp("blocked");
  }
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      notifications.show({ color: "yellow", message: T("Ta przeglądarka nie nagrywa dźwięku – wyślij nagranie z dyktafonu przez „+”.") });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!hold.current?.recording) {
        stream.getTracks().forEach((t) => t.stop()); // palec puszczony, zanim przeglądarka dała mikrofon
        return;
      }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const r = { mr, chunks: [] as Blob[], stream, started: Date.now(), cancel: false };
      mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = (Date.now() - r.started) / 1000;
        if (r.cancel) return;
        if (secs < 1) {
          notifications.show({ color: "gray", message: T("Za krótkie nagranie – przytrzymaj mikrofon dłużej.") });
          return;
        }
        const mime = mr.mimeType || type || "audio/webm";
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const now = new Date();
        const name = `Nagranie ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}.${ext}`;
        onVoice?.(new File(r.chunks, name, { type: mime.split(";")[0] }));
      };
      mr.start(250);
      rec.current = r;
      try {
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        meter.current = { ctx, an };
      } catch {
        meter.current = null;
      }
      setRecState({ secs: 0, cancel: false, levels: [] });
      navigator.vibrate?.(15);
    } catch (e) {
      // nieudane nagranie: puszczenie palca nie może już włączyć dyktowania
      if (hold.current) hold.current.failed = true;
      void micProblem((e as DOMException)?.name);
    }
  }
  function finishRec(cancel: boolean) {
    const r = rec.current;
    rec.current = null;
    hold.current = null;
    setRecState(null);
    meter.current?.ctx.close().catch(() => undefined);
    meter.current = null;
    if (!r) return;
    r.cancel = cancel;
    if (r.mr.state !== "inactive") r.mr.stop();
  }
  const pointer = onVoice
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0 || on) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const h = { x: e.clientX, recording: false, timer: 0 };
          h.timer = window.setTimeout(() => {
            h.recording = true;
            void startRec();
          }, HOLD_MS);
          hold.current = h;
        },
        onPointerMove: (e: React.PointerEvent) => {
          const h = hold.current;
          if (!h?.recording || !rec.current) return;
          const cancel = e.clientX - h.x < -80;
          if (cancel !== rec.current.cancel) {
            rec.current.cancel = cancel;
            setRecState((x) => (x ? { ...x, cancel } : x));
          }
        },
        onPointerUp: () => {
          const h = hold.current;
          if (!h) return toggle();
          window.clearTimeout(h.timer);
          if (h.failed) {
            hold.current = null;
            return;
          }
          if (!h.recording) {
            hold.current = null;
            toggle();
            return;
          }
          finishRec(!!rec.current?.cancel);
        },
        onPointerCancel: () => {
          if (hold.current) window.clearTimeout(hold.current.timer);
          finishRec(true);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : { onClick: toggle };
  const tip = on
    ? T("Słucham… – kliknij, aby zakończyć")
    : onVoice
      ? dictation
        ? T("Stuknij – dyktuj tekst; przytrzymaj – nagraj wiadomość głosową")
        : T("Przytrzymaj, aby nagrać wiadomość głosową")
      : T("Dyktuj głosem (dźwięk może być przetwarzany przez dostawcę przeglądarki: Google lub Apple)");
  // nasłuch: fale rozchodzą się od przycisku, słupki „grają” – widać, że aplikacja słucha (tekst wpada do pola)
  return (
    <>
      <MicHelp state={help} setState={setHelp}>
      <Tooltip label={tip} multiline w={260} disabled={!!recState || !!help}>
        <button
          type="button"
          className="ui-mic"
          data-on={on || undefined}
          data-rec={recState ? true : undefined}
          aria-pressed={on}
          aria-label={on ? T("Zakończ dyktowanie") : onVoice ? T("Mikrofon: stuknij – dyktuj, przytrzymaj – nagraj") : T("Dyktuj głosem")}
          {...pointer}
        >
          {on ? (
            <span className="ui-mic-eq" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <IconMicrophone size={18} aria-hidden />
          )}
        </button>
      </Tooltip>
      </MicHelp>
      {recState &&
        !onRecUi &&
        createPortal(
          <div className="ui-rec" data-cancel={recState.cancel || undefined} role="status" aria-live="polite">
            <span className="ui-rec-dot" aria-hidden />
            <span className="ui-rec-time">
              {Math.floor(recState.secs / 60)}:{String(recState.secs % 60).padStart(2, "0")}
            </span>
            <span className="ui-rec-hint">{recState.cancel ? T("Puść, aby anulować") : T("‹ Przesuń w lewo, aby anulować · puść, aby wysłać")}</span>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Wiersz nagrywania w miejscu pola pisania (komputer / tablet): kropka, czas, fala głośności, podpowiedź. */
function RecLine({ s }: { s: RecUi }) {
  const T = useT();
  const bars = [...Array(Math.max(0, 80 - s.levels.length)).fill(0), ...s.levels];
  return (
    <div className="ui-recline" data-cancel={s.cancel || undefined} role="status" aria-live="polite">
      <span className="ui-rec-dot" aria-hidden />
      <span className="ui-rec-time">
        {Math.floor(s.secs / 60)}:{String(s.secs % 60).padStart(2, "0")}
      </span>
      <span className="ui-recline-wave" aria-hidden>
        {bars.map((v, i) => (
          <i key={i} style={{ height: `${Math.max(3, Math.round(v * 24))}px` }} />
        ))}
      </span>
      <span className="ui-rec-hint">{s.cancel ? T("Puść, aby anulować") : T("‹ Przesuń w lewo, aby anulować")}</span>
    </div>
  );
}

function Conversation({ base, id, staff, onBack, showBack, mobile }: { base: string; id: number; staff: boolean; onBack: () => void; showBack: boolean; mobile?: boolean }) {
  const T = useT();
  const qc = useQueryClient();
  // szkic odpowiedzi zostaje po wyjściu z rozmowy (np. przypadkowe „Wstecz”) aż do wysłania
  const [body, setBody] = useDraft(`apt-draft-${base}-${id}`);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["thread", base, id], queryFn: () => api<Thread>(`${base}/${id}`), refetchInterval: 3000, ...LIVE });
  const t = q.data;
  const count = t?.messages.length ?? 0;
  const emp = useQuery({
    queryKey: ["employee", String(t?.employee_id)],
    queryFn: () => api<Employee>(`/employees/${t!.employee_id}`),
    enabled: staff && !mobile && !!t?.employee_id,
  });
  // tłumaczenie na żądanie (Google Cloud Translation); funkcja ukryta, gdy serwer nie ma klucza
  const { me: account } = useAuth();
  const cfg = useQuery({ queryKey: ["translate-config"], queryFn: () => api<{ enabled: boolean; exhausted: boolean; languages: { code: string; name: string }[] }>("/translate/config"), staleTime: 3_600_000 });
  // język tłumaczenia wynika ze strony: pracownik – język jego konta, kadry – polski (bez osobnego wyboru)
  const lang = staff ? "pl" : (account?.user.language ?? "pl");
  const [tr, setTr] = useState<Record<number, { text: string; source: string | null; target: string } | "loading">>({});
  const langName = (code: string | null) => cfg.data?.languages.find((l) => l.code === code)?.name ?? code ?? "?";
  // „Odsłuchaj”: wiadomość kadr czytana w języku pracownika (przetłumaczona, gdy jest tłumacz)
  const ownLang = account?.user.language ?? null;
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const heard = useRef<Record<number, string>>({});
  useEffect(() => () => stopSpeaking(), []);
  async function listen(m: { id: number; body: string; from_staff: boolean }) {
    if (speakingId === m.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeechNote(null);
    setSpeakingId(m.id);
    let text = m.body;
    if (ownLang && m.from_staff && cfg.data?.enabled && !cfg.data.exhausted) {
      if (heard.current[m.id] === undefined) {
        try {
          const r = await api<{ text: string }>("/translate/message", { method: "POST", body: { message_id: m.id, target: ownLang } });
          heard.current[m.id] = r.text;
        } catch {
          heard.current[m.id] = m.body;
        }
      }
      text = heard.current[m.id];
    }
    const spoken = ownLang && m.from_staff && text !== m.body ? ownLang : m.from_staff ? "pl" : (ownLang ?? "pl");
    const res = speak(text, speechLang(spoken), () => setSpeakingId((x) => (x === m.id ? null : x)));
    if (res === "no-voice") {
      setSpeakingId(null);
      setSpeechNote(T("To urządzenie nie ma głosu w tym języku. Zainstaluj go w ustawieniach telefonu (Mowa / Czytanie na głos)."));
    }
  }
  async function translateMessage(id: number) {
    setTr((x) => ({ ...x, [id]: "loading" }));
    try {
      const r = await api<{ text: string; source: string | null; target: string }>("/translate/message", { method: "POST", body: { message_id: id, target: lang } });
      setTr((x) => ({ ...x, [id]: r }));
    } catch (e) {
      setTr((x) => {
        const { [id]: _drop, ...rest } = x;
        return rest;
      });
      setError(errorText(e));
    }
  }
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count, id]);
  // otwarcie wątku oznacza go jako przeczytany – odśwież listę i liczniki
  useEffect(() => {
    if (t) {
      qc.invalidateQueries({ queryKey: ["threads", base] });
      qc.invalidateQueries({ queryKey: ["hr-count"] });
    }
  }, [count, t === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = (nt: Thread) => {
    qc.setQueryData(["thread", base, id], nt);
    qc.invalidateQueries({ queryKey: ["threads", base] });
    qc.invalidateQueries({ queryKey: ["hr-count"] });
  };
  const pending = usePendingFiles();
  const [recUi, setRecUi] = useState<RecUi | null>(null);
  const send = useMutation({
    mutationFn: () =>
      pending.files.length
        ? api<Thread>(`${base}/${id}/files`, { method: "POST", form: pending.form(body) })
        : api<Thread>(`${base}/${id}/messages`, { method: "POST", body: { body } }),
    onSuccess: (nt) => {
      setBody("");
      pending.clear();
      setError(null);
      refresh(nt);
    },
    onError: (e) => setError(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api<Thread>(`${base}/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });
  const archive = useMutation({
    mutationFn: (on: boolean) => api<Thread>(`${base}/${id}/${on ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: (nt) => {
      refresh(nt);
      onBack();
    },
    onError: (e) => setError(errorText(e)),
  });
  const canSend = !!body.trim() || pending.files.length > 0;
  // nagranie głosowe (przytrzymanie mikrofonu) – wysyłane od razu jako osobna wiadomość
  const voice = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("body", "");
      fd.append("files", f, f.name);
      return api<Thread>(`${base}/${id}/files`, { method: "POST", form: fd });
    },
    onSuccess: (nt) => {
      setError(null);
      refresh(nt);
    },
    onError: (e) => setError(errorText(e)),
  });
  const submit = () => canSend && !send.isPending && send.mutate();
  if (mobile) {
    return (
      <MobileChat
        t={t}
        staff={staff}
        onBack={onBack}
        body={body}
        setBody={setBody}
        submit={submit}
        sending={send.isPending}
        pending={pending}
        base={base}
        onVoice={(f) => voice.mutate(f)}
        error={error}
        speechNote={speechNote}
        clearSpeechNote={() => setSpeechNote(null)}
        lang={ownLang ?? "pl"}
        bottomRef={bottom}
        setStatus={(v) => setStatus.mutate(v)}
        archive={(on) => archive.mutate(on)}
        translate={cfg.data?.enabled ? { exhausted: cfg.data.exhausted, tr, run: translateMessage, hide: (mid) => setTr((x) => { const { [mid]: _d, ...rest } = x; return rest; }), langName } : null}
        listen={!staff && canSpeak() ? { speakingId, run: listen } : null}
      />
    );
  }
  // komputer: nagłówek z osobą (link do karty), separatory dni, godzina bez strefy przy dymku
  const tzNote = differsFromHome() ? ` · ${T("czas")}: ${tzCity(currentTz())}` : "";
  const items: ({ kind: "day"; label: string; key: string } | { kind: "msg"; m: Thread["messages"][number] })[] = [];
  let lastDay = "";
  for (const m of t?.messages ?? []) {
    const d = dayLabel(m.created_at, T);
    if (d !== lastDay) {
      items.push({ kind: "day", label: d, key: `d-${m.id}` });
      lastDay = d;
    }
    items.push({ kind: "msg", m });
  }
  const lastMineId = [...(t?.messages ?? [])].reverse().find((m) => m.kind === "message" && isMine(m, staff))?.id;
  const seen = (m: { id: number; created_at: string }) => !!t?.other_seen_at && m.id === lastMineId && t.other_seen_at >= m.created_at;
  return (
    <Stack
      gap={0}
      h="100%"
      style={{ minHeight: 0 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          pending.add(e.dataTransfer.files);
        }
      }}
    >
      <div className="ui-dchat-head">
        {showBack && (
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={onBack} aria-label={T("Wróć do wiadomości")} style={{ flex: "none" }}>
            <IconChevronLeft size={20} />
          </ActionIcon>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {staff && t?.employee_id ? (
            <Anchor component={Link} to={`/pracownicy/${t.employee_id}`} className="ui-chat-name">
              {t.employee_name}
            </Anchor>
          ) : (
            <Text fw={600}>{staff ? (t?.employee_name ?? "…") : (t?.subject ?? "…")}</Text>
          )}
          {staff && t?.employee_number && (
            <Text span size="sm" c="dimmed" className="ui-mono">
              {" "}
              · {t.employee_number}
            </Text>
          )}
          <Text size="sm" c="dimmed">
            {t?.is_group
              ? staff
                ? [t.subject, groupNote(t, T)].join(" · ")
                : [T("Kadry"), ...(t.members ?? []).map((x) => x.name)].join(", ")
              : staff
                ? [t?.subject, t ? groupNote(t, T) : null, emp.data ? [emp.data.position?.name, emp.data.department?.name, emp.data.agency?.name].filter(Boolean).join(", ") : null].filter(Boolean).join(" · ")
                : T("Kadry")}
          </Text>
        </div>
        {t && (
          <Group gap={8} wrap="nowrap" style={{ flex: "none" }}>
            {staff ? (
              t.status !== "done" ? (
                <Button size="xs" variant="default" loading={setStatus.isPending} onClick={() => setStatus.mutate("done")}>
                  Oznacz jako zakończoną
                </Button>
              ) : (
                <Text size="sm" c="dimmed">
                  zakończona
                </Text>
              )
            ) : (
              <Text size="sm" c="dimmed">
                {T(THREAD_STATUS[t.status].label)}
              </Text>
            )}
            <RowMenu
              label={t.subject}
              items={[
                { label: "Oznacz jako w toku", icon: <IconProgress size={16} />, onClick: () => setStatus.mutate("in_progress"), hidden: !staff || t.status === "in_progress" },
                { label: T("Przywróć z archiwum"), icon: <IconArchiveOff size={16} />, onClick: () => archive.mutate(false), hidden: !t.archived },
                { label: T("Archiwizuj"), icon: <IconArchive size={16} />, onClick: () => archive.mutate(true), hidden: t.archived || t.status !== "done" },
              ]}
            />
          </Group>
        )}
      </div>
      {cfg.data?.enabled && cfg.data.exhausted && (
        <Text size="xs" c="dimmed" px="lg" py={4} style={{ borderBottom: "1px solid var(--apt-line)" }}>
          {T("Miesięczny limit tłumaczeń wykorzystany – wróci od początku miesiąca.")}
        </Text>
      )}
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap={8} py="sm" px="lg">
          {items.map((it) => {
            if (it.kind === "day")
              return (
                <div key={it.key} className="ui-chat-day">
                  {it.label}
                  {tzNote}
                </div>
              );
            const m = it.m;
            if (m.kind === "status") {
              const label = T(THREAD_STATUS[m.body as ThreadRow["status"]]?.label ?? m.body);
              const text = m.body === "done_auto"
                ? T("Rozmowa zamknięta automatycznie – brak odpowiedzi przez 3 dni")
                : m.from_staff
                ? `${T("Status rozmowy zmieniono na: {label}", { label })}${staff && m.author_name ? ` (${m.author_name})` : ""}`
                : T("Rozmowa została otwarta ponownie");
              return (
                <Text key={m.id} size="xs" c="dimmed" ta="center" py={4}>
                  {text} · {hm(m.created_at)}
                </Text>
              );
            }
            const mine = isMine(m, staff);
            const trx = tr[m.id];
            return (
              <div key={m.id} className="ui-bub" data-mine={mine || undefined} data-media={!!m.files?.length || undefined}>
                {!!m.files?.length && <MsgAttachments files={m.files} base={base} />}
                {t?.is_group && !mine && m.author_name && (
                  <Text size="xs" fw={600}>
                    {m.author_name}
                  </Text>
                )}
                {m.body && (
                  <div className={m.files?.length ? "ui-bub-text" : undefined} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {m.body}
                  </div>
                )}
                {trx && trx !== "loading" && (
                  <Box mt={8} pt={8} style={{ borderTop: "1px solid currentColor", opacity: 0.9 }}>
                    <Text size="xs" opacity={0.75}>
                      {T("Tłumaczenie:")} {langName(trx.source)} → {langName(trx.target)}
                    </Text>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{trx.text}</div>
                  </Box>
                )}
                <div className="ui-bub-meta">
                  <span style={{ display: "flex", gap: 12 }}>
                    {cfg.data?.enabled && !cfg.data.exhausted && !!m.body && (
                      trx === "loading" ? (
                        <span>{T("Tłumaczę…")}</span>
                      ) : trx ? (
                        <Anchor component="button" type="button" size="12px" c="inherit" onClick={() => setTr((x) => { const { [m.id]: _d, ...rest } = x; return rest; })}>
                          {T("Ukryj tłumaczenie")}
                        </Anchor>
                      ) : (
                        <Anchor component="button" type="button" size="12px" c="inherit" title={T("„Przetłumacz” wysyła treść jednej wiadomości do Google Cloud Translation.")} onClick={() => translateMessage(m.id)}>
                          {T("Przetłumacz")}
                        </Anchor>
                      )
                    )}
                    {!staff && canSpeak() && (
                      <Anchor component="button" type="button" size="12px" c="inherit" onClick={() => listen(m)}>
                        {speakingId === m.id ? T("Zatrzymaj") : T("Odsłuchaj")}
                      </Anchor>
                    )}
                  </span>
                  <span>
                    {hm(m.created_at)}
                    {mine && seen(m) ? ` · ${T("przeczytana")}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </Stack>
      </ScrollArea>
      {speechNote && (
        <Alert color="orange" m="xs" p="xs" withCloseButton onClose={() => setSpeechNote(null)}>
          {speechNote}
        </Alert>
      )}
      {error && (
        <Alert color="red" m="xs" p="xs">
          {error}
        </Alert>
      )}
      <div style={{ borderTop: "1px solid var(--apt-line)" }}>
      <PendingFiles pending={pending} />
      <Group px={20} py={12} align="flex-end" wrap="nowrap" gap={12}>
        <span style={{ visibility: recUi ? "hidden" : undefined, display: "contents" }}>
          <AttachButton pending={pending} />
        </span>
        <DictateButton lang={ownLang ?? "pl"} value={body} onChange={setBody} onVoice={(f) => voice.mutate(f)} onRecUi={setRecUi} />
        {recUi && <RecLine s={recUi} />}
        <Textarea
          style={{ flex: 1, display: recUi ? "none" : undefined }}
          onPaste={(e) => {
            const fs = Array.from(e.clipboardData.files);
            if (fs.length) {
              e.preventDefault();
              pending.add(fs);
            }
          }}
          aria-label={staff ? "Treść odpowiedzi" : T("Treść wiadomości")}
          placeholder={staff ? "Twoja odpowiedź" : T("Twoja wiadomość")}
          autosize
          minRows={1}
          maxRows={6}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {!recUi && (
          <Button loading={send.isPending} disabled={!canSend} onClick={submit}>
            {T("Wyślij")}
          </Button>
        )}
      </Group>
      </div>
    </Stack>
  );
}


// godziny i dni rozmowy w strefie użytkownika (konto albo urządzenie) – jak w reszcie aplikacji
const hm = (iso: string) => timeIn(new Date(iso));
function dayLabel(iso: string, T: (s: string) => string): string {
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: currentTz() });
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86_400_000);
  if (day(d) === day(today)) return T("Dziś");
  if (day(d) === day(y)) return T("Wczoraj");
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: currentTz() });
}

type TrState = Record<number, { text: string; source: string | null; target: string } | "loading">;

/** Pełny ekran na telefonie: blokuje przewijanie strony i dopasowuje się do klawiatury iOS. */
function useChatViewport(box: React.RefObject<HTMLDivElement>, on = true) {
  useEffect(() => {
    if (!on) return;
    const vv = window.visualViewport;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const fit = () => {
      if (!box.current || !vv) return;
      box.current.style.height = `${vv.height}px`;
      box.current.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return () => {
      document.body.style.overflow = prev;
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
    };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Rozmowa na telefonie: pełny ekran jak w komunikatorze (makieta „Listy · Rozmowa”). */
function MobileChat(props: {
  t: Thread | undefined;
  staff: boolean;
  onBack: () => void;
  body: string;
  setBody: (v: string) => void;
  submit: () => void;
  sending: boolean;
  pending: Pending;
  base: string;
  onVoice: (f: File) => void;
  error: string | null;
  speechNote: string | null;
  clearSpeechNote: () => void;
  lang: string;
  bottomRef: React.RefObject<HTMLDivElement>;
  setStatus: (v: string) => void;
  archive: (on: boolean) => void;
  translate: { exhausted: boolean; tr: TrState; run: (id: number) => void; hide: (id: number) => void; langName: (c: string | null) => string } | null;
  listen: { speakingId: number | null; run: (m: { id: number; body: string; from_staff: boolean }) => void } | null;
}) {
  const { t, staff, translate: tl, listen } = props;
  const T = useT();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useChatViewport(box);
  const { me: account } = useAuth();
  const myName = account?.user.full_name;
  // kolejne zmiany statusu bez wiadomości pomiędzy – pokazujemy tylko ostatnią
  const all = t?.messages ?? [];
  const msgs = all.filter((m, i) => !(m.kind === "status" && all[i + 1]?.kind === "status"));
  const lastMine = [...msgs].reverse().find((m) => m.kind === "message" && isMine(m, staff));
  const seen = !!(lastMine && t?.other_seen_at && t.other_seen_at >= lastMine.created_at);
  let day = "";
  const statusActions = staff && t
    ? (Object.entries(THREAD_STATUS) as [ThreadRow["status"], { label: string }][])
        .filter(([v]) => v !== t.status)
        .map(([v, x]) => ({
          label: `${T("Oznacz jako")}: ${T(x.label).toLowerCase()}`,
          icon: v === "done" ? <IconCircleCheck size={20} /> : v === "in_progress" ? <IconProgress size={20} /> : <IconInbox size={20} />,
          onClick: () => props.setStatus(v),
        }))
    : [];
  return (
    <div className="ui-chat" ref={box}>
      <header className="ui-chat-head">
        <UnstyledButton className="ui-chat-btn" onClick={props.onBack} aria-label={T("Wróć do wiadomości")}>
          <IconChevronLeft size={26} stroke={2.2} />
        </UnstyledButton>
        <span className="ui-chat-title">
          <span className="ui-chat-name">{staff ? (t?.employee_name ?? "…") : (t?.subject ?? "…")}</span>
          <span className="ui-chat-sub">
            {staff ? `${t?.subject ?? ""}${t?.employee_number ? ` · nr ${t.employee_number}` : ""}` : T("Kadry")}
            {t ? ` · ${T(THREAD_STATUS[t.status].label)}` : ""}
          </span>
        </span>
        <UnstyledButton className="ui-chat-btn" onClick={() => setMenu(true)} aria-label={T("Więcej akcji")} disabled={!t}>
          <IconDots size={24} />
        </UnstyledButton>
      </header>
      <div className="ui-chat-body">
        {msgs.map((m) => {
          const dl = dayLabel(m.created_at, T);
          const sep = dl !== day ? ((day = dl), <span key={`d${m.id}`} className="ui-chat-day">{dl}</span>) : null;
          if (m.kind === "status") {
            const label = T(THREAD_STATUS[m.body as ThreadRow["status"]]?.label ?? m.body);
            const text = m.body === "done_auto"
              ? T("Zamknięta automatycznie")
              : m.from_staff
              ? label
              : T("Otwarta ponownie");
            const who = staff && m.author_name && m.author_name !== myName ? ` · ${m.author_name}` : "";
            return [sep, <div key={m.id} className="ui-chat-event" role="note"><span>{text} · {hm(m.created_at)}{who}</span></div>];
          }
          const mine = isMine(m, staff);
          const trv = tl?.tr[m.id];
          const idx = msgs.indexOf(m);
          const nx = msgs[idx + 1];
          // podpis tylko pod ostatnim dymkiem z serii tej samej osoby
          const lastInRun = !nx || nx.kind !== "message" || nx.from_staff !== m.from_staff || nx.author_name !== m.author_name || dayLabel(nx.created_at, T) !== dl;
          const showMeta = lastInRun || !!trv || (listen?.speakingId === m.id);
          const meta = [mine && staff && m.author_name && m.author_name !== myName ? m.author_name : null, hm(m.created_at), m === lastMine && seen ? T("przeczytane") : null].filter(Boolean).join(" · ");
          const canTr = tl && !tl.exhausted && !mine && !!m.body; // sam plik – nie ma czego tłumaczyć
          return [
            sep,
            <div key={m.id} className="ui-chat-msg" data-mine={mine || undefined} data-tight={!showMeta || undefined}>
              {!!m.files?.length && <MsgAttachments files={m.files} base={props.base} />}
              {(m.body || (t?.is_group && !mine && m.author_name)) && <div className="ui-chat-bubble">
                {t?.is_group && !mine && m.author_name && <span className="ui-chat-author">{m.author_name}</span>}
                {m.body}
                {trv && trv !== "loading" && (
                  <div className="ui-chat-tr">
                    <span className="ui-chat-tr-label">{T("Tłumaczenie:")} {tl!.langName(trv.source)} → {tl!.langName(trv.target)}</span>
                    {trv.text}
                  </div>
                )}
              </div>}
              {showMeta && <span className="ui-chat-meta">
                {meta}
                {canTr && (
                  <>
                    {" · "}
                    {trv === "loading" ? (
                      T("Tłumaczę…")
                    ) : (
                      <button type="button" className="ui-chat-link" onClick={() => (trv ? tl.hide(m.id) : tl.run(m.id))}>
                        {trv ? T("Ukryj tłumaczenie") : T("Przetłumacz")}
                      </button>
                    )}
                  </>
                )}
                {listen && (
                  <>
                    {" · "}
                    <button type="button" className="ui-chat-link" onClick={() => listen.run(m)}>
                      {listen.speakingId === m.id ? T("Zatrzymaj") : T("Odsłuchaj")}
                    </button>
                  </>
                )}
              </span>}
            </div>,
          ];
        })}
        <div ref={props.bottomRef} />
      </div>
      {props.speechNote && (
        <Alert color="orange" m="xs" p="xs" withCloseButton onClose={props.clearSpeechNote}>
          {props.speechNote}
        </Alert>
      )}
      {props.error && (
        <Alert color="red" m="xs" p="xs">
          {props.error}
        </Alert>
      )}
      <PendingFiles pending={props.pending} />
      <div className="ui-chat-compose">
        <AttachButton pending={props.pending} phone />
        <Textarea
          className="ui-chat-input"
          aria-label={staff ? "Treść odpowiedzi" : T("Treść wiadomości")}
          placeholder={staff ? "Napisz odpowiedź" : T("Napisz wiadomość")}
          autosize
          minRows={1}
          maxRows={5}
          maxLength={2000}
          radius="xl"
          size="md"
          value={props.body}
          onChange={(e) => props.setBody(e.currentTarget.value)}
        />
        <DictateButton lang={props.lang} value={props.body} onChange={props.setBody} onVoice={props.onVoice} />
        <ActionIcon size={44} radius="xl" variant="filled" loading={props.sending} disabled={!props.body.trim() && !props.pending.files.length} onClick={props.submit} aria-label={T("Wyślij")}>
          <IconArrowRight size={20} stroke={2.2} />
        </ActionIcon>
      </div>
      {t && (
        <ActionSheet
          opened={menu}
          onClose={() => setMenu(false)}
          title={staff ? (t.employee_name ?? "") : t.subject}
          subtitle={`${T("Status")}: ${T(THREAD_STATUS[t.status].label).toLowerCase()}${tl ? ` · ${tl.exhausted ? T("Miesięczny limit tłumaczeń wykorzystany – wróci od początku miesiąca.") : T("„Przetłumacz” wysyła treść jednej wiadomości do Google Cloud Translation.")}` : ""}`}
          actions={[
            ...statusActions,
            ...(staff && t.employee_id ? [{ label: "Otwórz kartę pracownika", icon: <IconUser size={20} />, onClick: () => nav(`/pracownicy/${t.employee_id}`) }] : []),
            ...(t.archived
              ? [{ label: T("Przywróć z archiwum"), icon: <IconArchiveOff size={20} />, onClick: () => props.archive(false) }]
              : t.status === "done"
              ? [{ label: T("Archiwizuj"), icon: <IconArchive size={20} />, onClick: () => props.archive(true) }]
              : []),
          ]}
        />
      )}
    </div>
  );
}

type Preset = { id: string; name: string };

function NewThread({ staff, preset, onCreated, onCancel, mobile }: { staff: boolean; preset?: Preset; onCreated: (id: number) => void; onCancel: () => void; mobile?: boolean }) {
  const T = useT();
  const { me: account } = useAuth();
  const qc = useQueryClient();
  const [subject, setSubject] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  // odbiorcy (kadry): jedna osoba albo kilka – wtedy osobno do każdego albo wspólna rozmowa
  const [picks, setPicks] = useState<{ id: string; name: string; number?: string }[]>(preset ? [{ id: preset.id, name: preset.name }] : []);
  const [mode, setMode] = useState<"separate" | "group">("separate");
  const employee = picks[0]?.id ?? null;
  const togglePick = (p: { id: string; name: string; number?: string }) =>
    setPicks((xs) => (xs.some((x) => x.id === p.id) ? xs.filter((x) => x.id !== p.id) : xs.length >= 50 ? xs : [...xs, p]));
  const many = picks.length > 1;
  const [search, setSearch] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [body, setBody] = useDraft(`apt-draft-${staff ? "hr" : "me"}-new${preset ? `-${preset.id}` : ""}`);
  const [step, setStep] = useState<1 | 2>(preset ? 2 : 1);
  const [error, setError] = useState<string | null>(null);
  const subjects = useQuery({ queryKey: ["thread-subjects"], queryFn: () => api<string[]>("/me/messages/subjects"), enabled: !staff });
  const people = useQuery({
    queryKey: ["thread-people", search],
    queryFn: () => api<{ employee_id: number; number: string; name: string }[]>(`/employee-accounts?status_filter=active&q=${encodeURIComponent(search)}`),
    enabled: staff,
  });
  const create = useMutation({
    mutationFn: () =>
      staff
        ? api<{ id: number }>("/hr-messages", { method: "POST", body: { employee_ids: picks.map((p) => Number(p.id)), mode, subject: custom.trim(), body } })
        : api<{ id: number }>("/me/messages", { method: "POST", body: { subject, body } }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["threads", staff ? "/hr-messages" : "/me/messages"] });
      setBody("");
      onCreated(t.id);
    },
    onError: (e) => setError(errorText(e)),
  });
  const ready = !!body.trim() && (staff ? !!employee && custom.trim().length >= 3 : !!subject);
  useChatViewport(box, false);
  useNavHeightVar();
  const picked = picks.length === 0 ? null : many ? `${picks.length} os.` : picks[0].name;
  const sendLabel = many ? T("Wyślij · {n} os.", { n: picks.length }) : T("Wyślij");
  const modeSwitch = many ? (
    <div className="ui-nw-mode">
      <SegmentedControl
        size="sm"
        fullWidth={!!mobile}
        value={mode}
        onChange={(v) => setMode(v as "separate" | "group")}
        data={[
          { value: "separate", label: "Osobno do każdego" },
          { value: "group", label: "Wspólna rozmowa" },
        ]}
      />
      <Text size="xs" c="dimmed">
        {mode === "group"
          ? "Wszyscy uczestnicy widzą wiadomości i nazwiska pozostałych."
          : "Każdy dostaje osobną rozmowę – odpowiedzi widzą tylko kadry."}
      </Text>
    </div>
  ) : null;
  const twoSteps = staff && !preset;
  const onTresc = !twoSteps || step === 2;
  const goBack = () => (twoSteps && step === 2 ? setStep(1) : onCancel());
  useMobileHeader(
    mobile
      ? {
          title: T("Nowa wiadomość"),
          subtitle: twoSteps ? (step === 1 ? "Krok 1 z 2 · Do kogo" : `Krok 2 z 2 · Treść · do ${picked ?? ""}`) : staff ? `Do: ${picked ?? ""}` : T("Do kadr"),
          onBack: goBack,
        }
      : null,
  );
  if (mobile) {
    return (
      <div className="ui-inpage" ref={box}>
        <div className="ui-chat-body ui-form-body">
          {!onTresc ? (
            <div className="ui-form-field">
              <span className="ui-form-label">Pracownik</span>
              <TextInput size="md" placeholder="Wpisz nazwisko" leftSection={<IconSearch size={18} aria-hidden />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label="Szukaj pracownika" />
              <span className="ui-form-hint">Tylko osoby z aktywnym kontem w aplikacji – inne nie przeczytałyby wiadomości. Możesz wybrać kilka osób.</span>
              {(() => {
                const list = (people.data ?? []).slice(0, 8);
                const extra = picks.filter((x) => !list.some((p) => String(p.employee_id) === x.id)).map((x) => ({ employee_id: Number(x.id), number: x.number ?? "", name: x.name }));
                const rows = [...extra, ...list];
                return rows.length > 0 ? (
                  <div className="ui-group">
                    {rows.map((p) => {
                      const on = picks.some((x) => x.id === String(p.employee_id));
                      return (
                        <UnstyledButton key={p.employee_id} className="ui-pick-row" data-on={on || undefined} aria-pressed={on} onClick={() => togglePick({ id: String(p.employee_id), name: p.name, number: p.number })}>
                          <span className="ui-thread-avatar" aria-hidden>{initials(p.name)}</span>
                          <span className="ui-row-text">
                            <span className="ui-thread-name">{p.name}</span>
                            {p.number && <span className="ui-thread-snip">nr {p.number}</span>}
                          </span>
                          {on && <span className="ui-pick-check"><IconCheck size={20} stroke={2.4} aria-hidden /></span>}
                        </UnstyledButton>
                      );
                    })}
                  </div>
                ) : (
                  search.trim() && <span className="ui-form-hint">Brak pracownika z aktywnym kontem</span>
                );
              })()}
            </div>
          ) : (
            <>
              {modeSwitch}
              {staff ? (
                <>
                  <TextInput size="md" label="Temat" placeholder="Np. Odbiór karty" maxLength={80} value={custom} onChange={(e) => setCustom(e.currentTarget.value)} />
                  <span className="ui-count">{custom.length}/80</span>
                </>
              ) : (
                <Select size="md" label={T("Temat")} placeholder={T("Wybierz")} data={(subjects.data ?? []).map((x) => ({ value: x, label: T(x) }))} value={subject} onChange={setSubject} />
              )}
              <Textarea
                size="md"
                label={T("Treść")}
                autosize
                minRows={5}
                maxRows={12}
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.currentTarget.value)}
                rightSection={<DictateButton lang={account?.user.language ?? "pl"} value={body} onChange={setBody} />}
                rightSectionProps={{ style: { alignItems: "flex-end", paddingBottom: 8 } }}
                rightSectionWidth={52}
              />
              <span className="ui-count">{body.length}/2000</span>
              {staff && (
                <span className="ui-form-hint">
                  {many && mode === "group"
                    ? "Uczestnicy dostaną powiadomienie bez treści. Wspólną rozmowę kończysz sam – nie zamyka się po 3 dniach."
                    : "Pracownik dostanie powiadomienie bez treści (e-mail lub telefon, jeśli ma je włączone). Rozmowa zamknie się sama, jeśli nie odpowie przez 3 dni."}
                </span>
              )}
            </>
          )}
          {error && <Alert color="red">{error}</Alert>}
        </div>
        <div className="ui-chat-compose">
          {!onTresc ? (
            <Button size="lg" fullWidth radius="md" disabled={!picks.length} rightSection={<IconChevronRight size={18} />} onClick={() => setStep(2)}>
              Dalej – treść
            </Button>
          ) : (
            <>
              {twoSteps && (
                <Button size="lg" radius="md" variant="default" onClick={() => setStep(1)} style={{ flex: "none", minWidth: 110 }}>
                  Wstecz
                </Button>
              )}
              <Button size="lg" fullWidth radius="md" leftSection={<IconArrowRight size={18} />} loading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
                {sendLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // komputer (wariant A): wygląda jak otwarta rozmowa – nagłówek z „✕”, wiersze „Do” i „Temat”, na dole ten sam pasek pisania
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <div className="ui-dchat-head">
        <Text fw={600} style={{ flex: 1 }}>
          {T("Nowa wiadomość")}
        </Text>
        <Tooltip label={T("Anuluj")}>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={onCancel} aria-label={T("Anuluj")}>
            <IconX size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="ui-nw-field">
        <span className="ui-nw-label">{T("Do")}</span>
        {!staff ? (
          <Text size="sm">{T("Kadry")}</Text>
        ) : (
          <div className="ui-nw-to">
            {picks.map((x) => (
              <span className="ui-nw-chip" key={x.id}>
                {x.name}
                {x.number && <span className="ui-mono ui-nw-no">{x.number}</span>}
                <UnstyledButton className="ui-nw-chipx" onClick={() => togglePick(x)} aria-label={`Usuń odbiorcę – ${x.name}`}>
                  <IconX size={14} />
                </UnstyledButton>
              </span>
            ))}
            {picks.length < 50 && (
              <Select
                className="ui-nw-add"
                aria-label="Pracownik"
                placeholder={picks.length ? "Dodaj osobę" : "Wpisz nazwisko"}
                searchable
                autoFocus={!picks.length}
                data={(people.data ?? [])
                  .filter((p) => !picks.some((x) => x.id === String(p.employee_id)))
                  .map((p) => ({ value: String(p.employee_id), label: `${p.name} · ${p.number}` }))}
                value={null}
                onChange={(v) => {
                  const p = (people.data ?? []).find((x) => String(x.employee_id) === v);
                  if (p) togglePick({ id: v!, name: p.name, number: p.number });
                  setSearch("");
                }}
                searchValue={search}
                onSearchChange={setSearch}
                nothingFoundMessage="Brak pracownika z aktywnym kontem"
                filter={({ options }) => options}
              />
            )}
          </div>
        )}
      </div>
      {many && <div className="ui-nw-field">
        <span className="ui-nw-label">{T("Tryb")}</span>
        {modeSwitch}
      </div>}
      <div className="ui-nw-field">
        <span className="ui-nw-label">{T("Temat")}</span>
        {staff ? (
          <>
            <TextInput style={{ flex: 1 }} aria-label="Temat" placeholder="Np. Odbiór karty" maxLength={80} value={custom} onChange={(e) => setCustom(e.currentTarget.value)} />
            <Text size="xs" c="dimmed" className="ui-nw-count">
              {custom.length}/80
            </Text>
          </>
        ) : (
          <Select style={{ flex: 1 }} aria-label={T("Temat")} placeholder={T("Wybierz")} data={(subjects.data ?? []).map((x) => ({ value: x, label: T(x) }))} value={subject} onChange={setSubject} />
        )}
      </div>
      <div className="ui-nw-empty">
        <Text size="sm" c="dimmed">
          {T("Napisz pierwszą wiadomość – pojawi się tu jak w rozmowie.")}
        </Text>
        <Text size="xs" c="dimmed" maw="46ch">
          {staff
            ? many && mode === "group"
              ? "Tylko osoby z aktywnym kontem w aplikacji. Uczestnicy dostaną powiadomienie bez treści. Wspólną rozmowę kończysz sam – nie zamyka się po 3 dniach."
              : "Tylko osoby z aktywnym kontem w aplikacji. Pracownik dostanie powiadomienie bez treści (e-mail lub telefon, jeśli ma je włączone). Rozmowa zamknie się sama, jeśli nie odpowie przez 3 dni."
            : T("Kadry odpowiedzą w tej rozmowie.")}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
      </div>
      <Group px={20} py={12} align="flex-end" wrap="nowrap" gap={12} style={{ borderTop: "1px solid var(--apt-line)" }}>
        <DictateButton lang={account?.user.language ?? "pl"} value={body} onChange={setBody} />
        <Textarea
          style={{ flex: 1 }}
          aria-label={T("Treść")}
          placeholder={T("Twoja wiadomość")}
          autosize
          minRows={1}
          maxRows={6}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (ready && !create.isPending) create.mutate();
            }
          }}
        />
        <Button loading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
          {sendLabel}
        </Button>
      </Group>
    </Stack>
  );
}

/** Skrzynka w stylu komunikatora: lista rozmów po lewej, rozmowa po prawej (na telefonie jedno okno naraz). */
export function Messenger({ staff, preset }: { staff: boolean; preset?: Preset }) {
  const T = useT();
  const base = staff ? "/hr-messages" : "/me/messages";
  const mobile = useIsPhone();
  const [openId, setOpenId] = useUrlOpen();
  const [composing, setComposing] = useState(!!preset);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useUrlTab("widok", ["active", "archive"] as const, "active");
  const [, setUrl] = useSearchParams();
  const list = useQuery({
    queryKey: ["threads", base, q, status, view],
    queryFn: () => {
      const p = new URLSearchParams();
      if (view === "archive") p.set("archived", "true");
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status_filter", status);
      return api<ThreadRow[]>(`${base}?${p.toString()}`);
    },
    refetchInterval: 4000,
    ...LIVE,
  });
  const rows = list.data ?? [];
  // telefon: akcje wiersza (przesunięcie / przytrzymanie) – te same co „⋯” w otwartej rozmowie
  const qcRow = useQueryClient();
  const rowAct = useMutation({
    mutationFn: (v: { id: number; act: "done" | "in_progress" | "archive" | "unarchive" }) =>
      v.act === "archive" || v.act === "unarchive"
        ? api<Thread>(`${base}/${v.id}/${v.act}`, { method: "POST" })
        : api<Thread>(`${base}/${v.id}/status`, { method: "POST", body: { status: v.act } }),
    onSuccess: (_r, v) => {
      qcRow.invalidateQueries({ queryKey: ["threads", base] });
      qcRow.invalidateQueries({ queryKey: ["hr-count"] });
      const msg = { done: T("Rozmowa zakończona"), in_progress: T("Rozmowa w toku"), archive: T("Przeniesiono do archiwum"), unarchive: T("Przywrócono z archiwum") }[v.act];
      notifications.show({ color: "green", message: msg });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const rowActions = (t: ThreadRow): RowAction[] => {
    const a: RowAction[] = [];
    if (staff && t.status !== "done" && !t.archived) a.push({ label: T("Zakończ"), tone: "accent", icon: <IconCheck size={20} />, onClick: () => rowAct.mutate({ id: t.id, act: "done" }) });
    if (t.status === "done" && !t.archived) a.push({ label: T("Archiwizuj"), icon: <IconArchive size={20} />, onClick: () => rowAct.mutate({ id: t.id, act: "archive" }) });
    if (t.archived) a.push({ label: T("Przywróć"), icon: <IconArchiveOff size={20} />, onClick: () => rowAct.mutate({ id: t.id, act: "unarchive" }) });
    if (staff && t.status === "new" && !t.archived)
      a.push({ label: T("Oznacz jako w toku"), icon: <IconProgress size={20} />, menuOnly: true, onClick: () => rowAct.mutate({ id: t.id, act: "in_progress" }) });
    a.push({ label: T("Otwórz rozmowę"), icon: <IconMessage size={20} />, menuOnly: true, onClick: () => { setOpenId(t.id); setComposing(false); } });
    return a;
  };
  // telefon: wszystkie zakładki wczytane od razu – przesuwanie pokazuje gotową treść
  const segs: string[] = staff ? ["all", "new", "archive"] : ["all", "archive"];
  const segQuery = (sv: string) => ({
    queryKey: ["threads", base, q, sv === "new" ? "new" : "", sv === "archive" ? "archive" : "active"],
    queryFn: () => {
      const p = new URLSearchParams();
      if (sv === "archive") p.set("archived", "true");
      if (q.trim()) p.set("q", q.trim());
      if (sv === "new") p.set("status_filter", "new");
      return api<ThreadRow[]>(`${base}?${p.toString()}`);
    },
    refetchInterval: 4000,
    enabled: !!mobile && (sv !== "new" || staff),
    ...LIVE,
  });
  const segQ = { all: useQuery(segQuery("all")), new: useQuery(segQuery("new")), archive: useQuery(segQuery("archive")) } as Record<string, ReturnType<typeof useQuery<ThreadRow[]>>>;
  const counts = useQuery({ queryKey: ["hr-count", "seg"], queryFn: () => api<{ new: number; unread: number }>("/hr-messages/count"), enabled: staff && !!mobile, refetchInterval: 10000, ...LIVE });
  const deskCounts = useQuery({ queryKey: ["hr-count", "desk"], queryFn: () => api<{ new: number; unread: number }>("/hr-messages/count"), enabled: staff && !mobile, refetchInterval: 10000, ...LIVE });
  const newRows = useQuery({
    queryKey: ["threads", base, "", "new", "active"],
    queryFn: () => api<ThreadRow[]>(`${base}?status_filter=new`),
    enabled: staff && !mobile,
    refetchInterval: 10000,
    ...LIVE,
  });
  // komputer: na start „Nowe”, a gdy nowych nie ma – „W toku” (bez osobnego „Wszystkie”)
  useEffect(() => {
    if (staff && !mobile && view === "active" && status === "" && deskCounts.data) setStatus(deskCounts.data.new ? "new" : "in_progress");
  }, [staff, mobile, view, status, deskCounts.data]);
  const oldestNew = [...(newRows.data ?? [])].sort((x, y) => (x.updated_at < y.updated_at ? -1 : 1))[0];
  // wąski obszar na komputerze (< 880 px, ten sam próg co Checklisty): lista albo rozmowa, nie obie ściśnięte
  const [pageRef, narrow] = useNarrowArea(!!mobile);
  const single = !!mobile || narrow;
  const showList = !single || (openId === null && !composing);
  const showRight = !single || openId !== null || composing;
  const back = () => {
    setOpenId(null);
    setComposing(false);
  };
  if (mobile && showList) {
    const unreadN = rows.filter((t) => t.unread).length;
    const newN = counts.data?.new ?? 0;
    const seg = view === "archive" ? "archive" : status === "new" ? "new" : "all";
    const compose = () => {
      setComposing(true);
      setOpenId(null);
    };
    return (
      <Stack gap="md">
        <PageHead
          title={T("Wiadomości")}
          subtitle={view === "active" && unreadN ? `${unreadN} ${T("nieprzeczytane")}` : undefined}
          action={{ label: T("Nowa wiadomość"), icon: <IconPencil size={22} />, onClick: compose }}
        />
        {staff && (
          <TextInput size="md" aria-label="Szukaj wiadomości" placeholder="Nazwisko lub temat" leftSection={<IconSearch size={18} aria-hidden />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        )}
        <Segments
          value={seg}
          onChange={(v) => {
            setView(v === "archive" ? "archive" : "active");
            setStatus(v === "new" ? "new" : "");
          }}
          items={[
            { value: "all", label: T("Wszystkie") },
            ...(staff ? [{ value: "new", label: newN ? `Nowe · ${newN}` : "Nowe" }] : []),
            { value: "archive", label: T("Archiwum") },
          ]}
        />
        <SwipePager
          index={Math.max(0, segs.indexOf(seg))}
          onIndex={(i) => {
            const v = segs[i];
            setView(v === "archive" ? "archive" : "active");
            setStatus(v === "new" ? "new" : "");
          }}
        >
          {segs.map((sv) => {
            const src = segQ[sv];
            const rs = src.data ?? [];
            return (
              <div key={sv}>
                {src.data && rs.length === 0 ? (
                  <CompactEmpty
                    title={q.trim() ? `Brak wyników dla „${q.trim()}”` : sv === "archive" ? T("Archiwum jest puste") : sv === "new" ? "Brak nowych rozmów" : staff ? T("Brak wiadomości") : T("Nie masz jeszcze wiadomości")}
                    text={sv === "archive" ? undefined : staff ? "Możesz sam zacząć rozmowę ikoną ołówka." : T("Masz pytanie do kadr? Napisz tutaj – odpowiedź zobaczysz w tym miejscu.")}
                  />
                ) : (
                  <div className="ui-group">
                    {rs.map((t) => {
                      // pracownik rozmawia zawsze z kadrami, więc wiersz rozpoznaje po temacie
                      const name = staff ? (t.employee_name ?? "") : t.subject;
                      const snip = (t.last_from_staff === staff ? T("Ty:") + " " : "") + (t.preview || t.subject);
                      return (
                        <SwipeRow key={t.id} actions={rowActions(t)} menuTitle={name} menuSubtitle={t.subject !== name ? t.subject : undefined}>
                        <UnstyledButton className="ui-thread" data-unread={t.unread || undefined} onClick={() => { setOpenId(t.id); setComposing(false); }}>
                          <span className="ui-thread-avatar" aria-hidden>{t.is_group ? <IconUsers size={20} /> : initials(staff ? name : T("Kadry"))}</span>
                          <span className="ui-row-text">
                            <span className="ui-thread-line">
                              <span className="ui-thread-name">{name}</span>
                              <span className="ui-thread-time">{shortTime(t.updated_at)}</span>
                            </span>
                            <span className="ui-thread-line">
                              <span className="ui-thread-snip">{[staff ? t.subject : null, groupNote(t, T), snip].filter(Boolean).join(" · ")}</span>
                              {t.unread ? (
                                <span className="ui-thread-count" aria-label={`${T("Nieprzeczytane")}: ${t.unread_count || 1}`}>{t.unread_count || 1}</span>
                              ) : null}
                            </span>
                          </span>
                        </UnstyledButton>
                        </SwipeRow>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </SwipePager>
      </Stack>
    );
  }

  // komputer: filtr statusu jednym przełącznikiem na szerokość wyszukiwarki
  const deskSeg = view === "archive" ? "archive" : status || "all";
  const deskItems = staff
    ? [
        { value: "new", label: deskCounts.data?.new ? `${T("Nowe")} (${deskCounts.data.new})` : T("Nowe") },
        { value: "in_progress", label: T("W toku") },
        { value: "done", label: T("Zakończone") },
        { value: "archive", label: T("Archiwum") },
      ]
    : [
        { value: "all", label: T("Aktywne") },
        { value: "archive", label: T("Archiwum") },
      ];
  const compose = () => {
    setComposing(true);
    setOpenId(null);
  };
  const openRow = rows.find((r) => r.id === openId);
  return (
    <div ref={pageRef}>
    <MasterDetail
      mobile={!!mobile}
      single={narrow}
      showList={showList}
      showRight={showRight}
      plainDetail
      head={
        <div className="ui-inbox-head">
          <Title order={1}>{staff ? "Wiadomości" : T("Napisz do kadr")}</Title>
          <Button onClick={compose}>{T("Nowa wiadomość")}</Button>
        </div>
      }
      aside={staff && !composing && openRow?.employee_id ? <EmployeeAside employeeId={openRow.employee_id} threadId={openRow.id} /> : undefined}
      list={
        <>
          <div className="ui-inbox-tools">
            {staff && (
              <TextInput aria-label="Szukaj wiadomości" placeholder="Szukaj: nazwisko, temat, treść" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            )}
            <SegmentedControl
              fullWidth
              value={deskSeg === "all" && staff ? "" : deskSeg}
              onChange={(v) => {
                // jedna zmiana adresu: widok i zamknięcie rozmowy razem (dwie osobne nadpisywały się – Archiwum nie dało się otworzyć)
                setUrl(
                  (p) => {
                    const n = new URLSearchParams(p);
                    if (v === "archive") n.set("widok", "archive");
                    else n.delete("widok");
                    n.delete("id");
                    return n;
                  },
                  { replace: true },
                );
                setStatus(v === "archive" || v === "all" ? "" : v);
                setComposing(false);
              }}
              data={deskItems}
            />
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {rows.length === 0 &&
              (q.trim() || (status && view !== "archive") ? (
                <EmptyState
                  search
                  title={q.trim() ? `Brak wyników dla „${q.trim()}”` : "Brak rozmów w tym filtrze"}
                  text="Sprawdź pisownię albo wybierz inny filtr."
                  action={{ label: "Wyczyść wyszukiwanie i filtr", onClick: () => { setQ(""); setStatus(""); } }}
                />
              ) : view === "archive" ? (
                <EmptyState title={T("Archiwum jest puste")} text={T("Zakończone rozmowy trafiają tu po kliknięciu „Archiwizuj” albo po 30 dniach bez ruchu.")} />
              ) : (
                <EmptyState
                  title={staff ? T("Brak wiadomości") : T("Nie masz jeszcze wiadomości")}
                  text={staff ? "Pracownicy nie napisali jeszcze do kadr. Możesz też sam zacząć rozmowę." : T("Masz pytanie do kadr? Napisz tutaj – odpowiedź zobaczysz w tym miejscu.")}
                />
              ))}
            {rows.map((t) => {
              const name = staff ? (t.employee_name ?? "") : t.subject;
              return (
                <UnstyledButton
                  key={t.id}
                  className="ui-inrow"
                  data-unread={t.unread || undefined}
                  data-selected={openId === t.id || undefined}
                  aria-current={openId === t.id || undefined}
                  onClick={() => { setOpenId(t.id); setComposing(false); }}
                >
                  <span className="ui-inrow-name">
                    {t.unread && <span className="ui-inrow-dot" aria-label={T("Nieprzeczytane")} />}
                    {name}
                  </span>
                  <span className="ui-inrow-time">{shortTime(t.updated_at)}</span>
                  {(staff || groupNote(t, T)) && (
                    <span className="ui-inrow-sub">{[staff ? t.subject : null, groupNote(t, T)].filter(Boolean).join(" · ")}</span>
                  )}
                  <span className="ui-inrow-pv">{(t.last_from_staff === staff ? T("Ty:") + " " : "") + t.preview}</span>
                  {t.status === "done" && <span className="ui-inrow-st">{T("zakończona")}</span>}
                </UnstyledButton>
              );
            })}
          </ScrollArea>
        </>
      }
      detail={
        composing ? (
          <NewThread staff={staff} preset={preset} onCreated={(id) => { setComposing(false); setOpenId(id); }} onCancel={back} mobile={!!mobile} />
        ) : openId !== null ? (
          <Conversation key={openId} base={base} id={openId} staff={staff} onBack={back} showBack={single} mobile={!!mobile} />
        ) : staff && (deskCounts.data?.new ?? 0) > 0 ? (
          <div className="ui-chat-empty">
            <Text fw={600} size="lg">
              {deskCounts.data!.new === 1 ? "1 nowa rozmowa czeka na odpowiedź" : `Nowe rozmowy czekające na odpowiedź: ${deskCounts.data!.new}`}
            </Text>
            {oldestNew && (
              <>
                <Text c="dimmed" size="sm">
                  Najstarsza: {oldestNew.employee_name}, {shortTime(oldestNew.updated_at)}
                </Text>
                <Button variant="default" onClick={() => setOpenId(oldestNew.id)}>
                  Otwórz najstarszą
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="ui-chat-empty">
            <Text c="dimmed">{T("Wybierz rozmowę z listy.")}</Text>
          </div>
        )
      }
    />
    </div>
  );
}
