import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Box, Button, Group, ScrollArea, SegmentedControl, Stack, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { Select } from "./AptSelect";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconArchiveOff, IconMicrophone, IconPencil, IconSearch } from "@tabler/icons-react";

import { EmptyState } from "./States";
import { api, errorText, shortTime, type Employee } from "../api";
import { useAuth } from "../auth";
import { useT } from "../lib/i18n";
import { useUrlOpen, useUrlTab } from "../lib/urlState";
import { useDraft } from "../lib/draft";
import { currentTz, differsFromHome, timeIn, tzCity } from "../lib/time";
import { canDictate, canSpeak, dictate, speak, speechLang, stopSpeaking } from "../lib/speech";
import { MasterDetail } from "./MasterDetail";
import { EmployeeAside } from "./EmployeeAside";
import { Link, useNavigate } from "react-router-dom";
import { ActionSheet, CompactEmpty, PageHead, RowMenu, Segments, SwipePager, useMobileHeader, useNavHeightVar } from "./Mobile";
import { IconCheck, IconChevronRight, IconDots, IconChevronLeft, IconArrowRight, IconCircleCheck, IconProgress, IconInbox, IconUser } from "@tabler/icons-react";

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
}
interface Thread {
  id: number;
  subject: string;
  status: ThreadRow["status"];
  archived: boolean;
  messages: { id: number; from_staff: boolean; kind: "message" | "status"; author_name: string | null; body: string; created_at: string }[];
  employee_name: string | null;
  employee_number: string | null;
  employee_id?: number | null;
  other_seen_at?: string | null;
}

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
function DictateButton({ lang, value, onChange }: { lang: string; value: string; onChange: (v: string) => void }) {
  const T = useT();
  const [on, setOn] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const base = useRef("");
  useEffect(() => () => stop.current?.(), []);
  if (!canDictate()) return null;
  function toggle() {
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
        if (err === "not-allowed" || err === "service-not-allowed") {
          notifications.show({
            color: "yellow",
            title: T("Brak dostępu do mikrofonu"),
            message: T("Mikrofon służy tylko do dyktowania treści wiadomości. Zezwól na niego w ustawieniach przeglądarki (ikona kłódki przy adresie strony) albo wpisz tekst ręcznie."),
            autoClose: 10000,
          });
        }
      },
    );
  }
  // nasłuch: fale rozchodzą się od przycisku, słupki „grają” – widać, że aplikacja słucha (tekst wpada do pola)
  return (
    <Tooltip label={on ? T("Słucham… – kliknij, aby zakończyć") : T("Dyktuj głosem (dźwięk może być przetwarzany przez dostawcę przeglądarki: Google lub Apple)")} multiline w={260}>
      <button type="button" className="ui-mic" data-on={on || undefined} onClick={toggle} aria-pressed={on} aria-label={on ? T("Zakończ dyktowanie") : T("Dyktuj głosem")}>
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
  );
}

function Conversation({ base, id, staff, onBack, mobile }: { base: string; id: number; staff: boolean; onBack: () => void; showBack: boolean; mobile?: boolean }) {
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
  const send = useMutation({
    mutationFn: () => api<Thread>(`${base}/${id}/messages`, { method: "POST", body: { body } }),
    onSuccess: (nt) => {
      setBody("");
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
  const submit = () => body.trim() && !send.isPending && send.mutate();
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
  const lastMineId = [...(t?.messages ?? [])].reverse().find((m) => m.kind === "message" && m.from_staff === staff)?.id;
  const seen = (m: { id: number; created_at: string }) => !!t?.other_seen_at && m.id === lastMineId && t.other_seen_at >= m.created_at;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <div className="ui-dchat-head">
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
            {staff ? [t?.subject, emp.data ? [emp.data.position?.name, emp.data.department?.name, emp.data.agency?.name].filter(Boolean).join(", ") : null].filter(Boolean).join(" · ") : T("Kadry")}
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
        <Stack gap={6} py="sm" px="lg">
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
            const mine = m.from_staff === staff;
            const trx = tr[m.id];
            return (
              <div key={m.id} className="ui-bub" data-mine={mine || undefined}>
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</div>
                {trx && trx !== "loading" && (
                  <Box mt={6} pt={6} style={{ borderTop: "1px solid currentColor", opacity: 0.9 }}>
                    <Text size="xs" opacity={0.75}>
                      {T("Tłumaczenie:")} {langName(trx.source)} → {langName(trx.target)}
                    </Text>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{trx.text}</div>
                  </Box>
                )}
                <div className="ui-bub-meta">
                  <span style={{ display: "flex", gap: 10 }}>
                    {cfg.data?.enabled && !cfg.data.exhausted && (
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
      <Group px="lg" py="sm" align="flex-end" wrap="nowrap" gap={8} style={{ borderTop: "1px solid var(--apt-line)" }}>
        <DictateButton lang={ownLang ?? "pl"} value={body} onChange={setBody} />
        <Textarea
          style={{ flex: 1 }}
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
        <Button loading={send.isPending} disabled={!body.trim()} onClick={submit}>
          {T("Wyślij")}
        </Button>
      </Group>
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
  const lastMine = [...msgs].reverse().find((m) => m.kind === "message" && m.from_staff === staff);
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
          const mine = m.from_staff === staff;
          const trv = tl?.tr[m.id];
          const idx = msgs.indexOf(m);
          const nx = msgs[idx + 1];
          // podpis tylko pod ostatnim dymkiem z serii tej samej osoby
          const lastInRun = !nx || nx.kind !== "message" || nx.from_staff !== m.from_staff || dayLabel(nx.created_at, T) !== dl;
          const showMeta = lastInRun || !!trv || (listen?.speakingId === m.id);
          const meta = [mine && staff && m.author_name && m.author_name !== myName ? m.author_name : null, hm(m.created_at), m === lastMine && seen ? T("przeczytane") : null].filter(Boolean).join(" · ");
          const canTr = tl && !tl.exhausted && !mine;
          return [
            sep,
            <div key={m.id} className="ui-chat-msg" data-mine={mine || undefined} data-tight={!showMeta || undefined}>
              <div className="ui-chat-bubble">
                {m.body}
                {trv && trv !== "loading" && (
                  <div className="ui-chat-tr">
                    <span className="ui-chat-tr-label">{T("Tłumaczenie:")} {tl!.langName(trv.source)} → {tl!.langName(trv.target)}</span>
                    {trv.text}
                  </div>
                )}
              </div>
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
      <div className="ui-chat-compose">
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
        <DictateButton lang={props.lang} value={props.body} onChange={props.setBody} />
        <ActionIcon size={44} radius="xl" variant="filled" loading={props.sending} disabled={!props.body.trim()} onClick={props.submit} aria-label={T("Wyślij")}>
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
  const [employee, setEmployee] = useState<string | null>(preset?.id ?? null);
  const [search, setSearch] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
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
        ? api<{ id: number }>("/hr-messages", { method: "POST", body: { employee_id: Number(employee), subject: custom.trim(), body } })
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
  const picked = employee
    ? preset && preset.id === employee
      ? preset.name
      : (people.data ?? []).find((p) => String(p.employee_id) === employee)?.name ?? pickedName
    : null;
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
              <span className="ui-form-hint">Tylko osoby z aktywnym kontem w aplikacji – inne nie przeczytałyby wiadomości.</span>
              {(() => {
                const list = (people.data ?? []).slice(0, 8);
                const rows = employee && picked && !list.some((p) => String(p.employee_id) === employee)
                  ? [{ employee_id: Number(employee), number: "", name: picked }, ...list]
                  : list;
                return rows.length > 0 ? (
                  <div className="ui-group">
                    {rows.map((p) => {
                      const on = String(p.employee_id) === employee;
                      return (
                        <UnstyledButton key={p.employee_id} className="ui-pick-row" data-on={on || undefined} aria-pressed={on} onClick={() => { setEmployee(on ? null : String(p.employee_id)); setPickedName(p.name); }}>
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
                  Pracownik dostanie powiadomienie bez treści (e-mail lub telefon, jeśli ma je włączone). Rozmowa zamknie się sama, jeśli nie odpowie przez 3 dni.
                </span>
              )}
            </>
          )}
          {error && <Alert color="red">{error}</Alert>}
        </div>
        <div className="ui-chat-compose">
          {!onTresc ? (
            <Button size="lg" fullWidth radius="md" disabled={!employee} rightSection={<IconChevronRight size={18} />} onClick={() => setStep(2)}>
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
                {T("Wyślij")}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Stack p="md" maw={560}>
      <Title order={4}>{staff ? "Nowa wiadomość do pracownika" : T("Nowa wiadomość do kadr")}</Title>
      {staff ? (
        <>
          <Select
            label="Pracownik"
            description="Tylko osoby z aktywnym kontem w aplikacji – inne nie przeczytałyby wiadomości."
            placeholder="Wpisz nazwisko"
            searchable
            data={[
              ...(preset ? [{ value: preset.id, label: preset.name }] : []),
              ...(people.data ?? [])
                .filter((p) => String(p.employee_id) !== preset?.id)
                .map((p) => ({ value: String(p.employee_id), label: `${p.name} (${p.number})` })),
            ]}
            value={employee}
            onChange={setEmployee}
            searchValue={search}
            onSearchChange={setSearch}
            nothingFoundMessage="Brak pracownika z aktywnym kontem"
            filter={({ options }) => options}
          />
          <TextInput label="Temat" maxLength={80} value={custom} onChange={(e) => setCustom(e.currentTarget.value)} />
        </>
      ) : (
        <Select label={T("Temat")} placeholder={T("Wybierz")} data={(subjects.data ?? []).map((x) => ({ value: x, label: T(x) }))} value={subject} onChange={setSubject} />
      )}
      <Group align="flex-end" wrap="nowrap">
        <Textarea style={{ flex: 1 }} label={T("Treść")} autosize minRows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
        <DictateButton lang={account?.user.language ?? "pl"} value={body} onChange={setBody} />
      </Group>
      {staff && (
        <Text size="xs" c="dimmed">
          Pracownik dostanie powiadomienie bez treści (e-mail lub telefon, jeśli ma je włączone). Rozmowa zamknie się sama, jeśli nie odpowie przez 3 dni.
        </Text>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        <Button loading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
          {T("Wyślij")}
        </Button>
        <Button variant="default" onClick={onCancel}>
          {T("Anuluj")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Skrzynka w stylu komunikatora: lista rozmów po lewej, rozmowa po prawej (na telefonie jedno okno naraz). */
export function Messenger({ staff, preset }: { staff: boolean; preset?: Preset }) {
  const T = useT();
  const base = staff ? "/hr-messages" : "/me/messages";
  const mobile = useMediaQuery("(max-width: 48em)");
  const [openId, setOpenId] = useUrlOpen();
  const [composing, setComposing] = useState(!!preset);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useUrlTab("widok", ["active", "archive"] as const, "active");
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
  const showList = !mobile || (openId === null && !composing);
  const showRight = !mobile || openId !== null || composing;
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
                        <UnstyledButton key={t.id} className="ui-thread" data-unread={t.unread || undefined} onClick={() => { setOpenId(t.id); setComposing(false); }}>
                          <span className="ui-thread-avatar" aria-hidden>{initials(staff ? name : T("Kadry"))}</span>
                          <span className="ui-row-text">
                            <span className="ui-thread-line">
                              <span className="ui-thread-name">{name}</span>
                              <span className="ui-thread-time">{shortTime(t.updated_at)}</span>
                            </span>
                            <span className="ui-thread-line">
                              <span className="ui-thread-snip">{staff ? `${t.subject} · ${snip}` : snip}</span>
                              {t.unread ? (
                                <span className="ui-thread-count" aria-label={`${T("Nieprzeczytane")}: ${t.unread_count || 1}`}>{t.unread_count || 1}</span>
                              ) : null}
                            </span>
                          </span>
                        </UnstyledButton>
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
    <MasterDetail
      mobile={!!mobile}
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
                setView(v === "archive" ? "archive" : "active");
                setStatus(v === "archive" || v === "all" ? "" : v);
                setOpenId(null);
                setComposing(false);
              }}
              data={deskItems}
            />
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {rows.length === 0 &&
              (q.trim() || status ? (
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
                  {staff && <span className="ui-inrow-sub">{t.subject}</span>}
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
          <Conversation key={openId} base={base} id={openId} staff={staff} onBack={back} showBack={!!mobile} mobile={!!mobile} />
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
  );
}
