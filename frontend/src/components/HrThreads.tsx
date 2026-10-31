import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Avatar, Badge, Box, Button, Group, Paper, ScrollArea, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconArchiveOff, IconArrowLeft, IconMicrophone, IconPlayerStop, IconPlus, IconSearch, IconSend, IconVolume } from "@tabler/icons-react";

import { EmptyState } from "./States";
import { api, errorText, formatDateTime } from "../api";
import { useAuth } from "../auth";
import { useT } from "../lib/i18n";
import { canDictate, canSpeak, dictate, speak, speechLang, stopSpeaking } from "../lib/speech";

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
}
interface Thread {
  id: number;
  subject: string;
  status: ThreadRow["status"];
  archived: boolean;
  messages: { id: number; from_staff: boolean; kind: "message" | "status"; author_name: string | null; body: string; created_at: string }[];
  employee_name: string | null;
  employee_number: string | null;
}

export const THREAD_STATUS: Record<ThreadRow["status"], { label: string; color: string }> = {
  new: { label: "nowa", color: "blue" },
  in_progress: { label: "w toku", color: "yellow" },
  done: { label: "zakończona", color: "green" },
};

// Odświeżanie „na żywo”: odpytywanie co kilka sekund, tylko gdy karta jest widoczna.
const LIVE = { refetchOnWindowFocus: true, refetchIntervalInBackground: false } as const;

function shortTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

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
  return (
    <Tooltip label={T("Dyktuj głosem (dźwięk może być przetwarzany przez dostawcę przeglądarki: Google lub Apple)")} multiline w={260}>
      <ActionIcon size="lg" radius="xl" variant={on ? "filled" : "light"} color={on ? "red" : "blue"} onClick={toggle} aria-label={on ? T("Zatrzymaj dyktowanie") : T("Dyktuj głosem")}>
        {on ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function Conversation({ base, id, staff, onBack, showBack }: { base: string; id: number; staff: boolean; onBack: () => void; showBack: boolean }) {
  const T = useT();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["thread", base, id], queryFn: () => api<Thread>(`${base}/${id}`), refetchInterval: 3000, ...LIVE });
  const t = q.data;
  const count = t?.messages.length ?? 0;
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
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" p="sm" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap="sm" wrap="nowrap">
          {showBack && (
            <ActionIcon variant="subtle" onClick={onBack} aria-label={T("Wróć")}>
              <IconArrowLeft size={18} />
            </ActionIcon>
          )}
          <Box>
            <Text fw={600} lineClamp={1}>
              {staff ? (t?.employee_name ?? "…") : (t?.subject ?? "…")}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {staff ? `${t?.subject ?? ""} · ${t?.employee_number ?? ""}` : T("Kadry")}
            </Text>
          </Box>
        </Group>
        {t && (
          <Group gap="xs" wrap="nowrap">
            {staff ? (
              <Select
                size="xs"
                w={140}
                allowDeselect={false}
                value={t.status}
                data={Object.entries(THREAD_STATUS).map(([value, v]) => ({ value, label: T(v.label) }))}
                onChange={(v) => v && setStatus.mutate(v)}
              />
            ) : (
              <Badge color={THREAD_STATUS[t.status].color}>{T(THREAD_STATUS[t.status].label)}</Badge>
            )}
            {t.archived ? (
              <Button size="xs" variant="default" leftSection={<IconArchiveOff size={14} />} loading={archive.isPending} onClick={() => archive.mutate(false)}>
                {T("Przywróć")}
              </Button>
            ) : (
              t.status === "done" && (
                <Button size="xs" variant="light" leftSection={<IconArchive size={14} />} loading={archive.isPending} onClick={() => archive.mutate(true)}>
                  {T("Archiwizuj")}
                </Button>
              )
            )}
          </Group>
        )}
      </Group>
      {cfg.data?.enabled && (
        <Group px="sm" py={4} gap="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <Text size="xs" c="dimmed" style={{ flex: 1 }} lineClamp={2}>
            {cfg.data.exhausted
              ? T("Miesięczny limit tłumaczeń wykorzystany – wróci od początku miesiąca.")
              : T("„Przetłumacz” wysyła treść jednej wiadomości do Google Cloud Translation.")}
          </Text>
        </Group>
      )}
      <ScrollArea style={{ flex: 1 }} px="sm" type="auto">
        <Stack gap={6} py="sm">
          {t?.messages.map((m) => {
            if (m.kind === "status") {
              const label = T(THREAD_STATUS[m.body as ThreadRow["status"]]?.label ?? m.body);
              const text = m.body === "done_auto"
                ? T("Rozmowa zamknięta automatycznie – brak odpowiedzi przez 3 dni")
                : m.from_staff
                ? `${T("Status rozmowy zmieniono na: {label}", { label })}${staff && m.author_name ? ` (${m.author_name})` : ""}`
                : T("Rozmowa została otwarta ponownie");
              return (
                <Text key={m.id} size="xs" c="dimmed" ta="center" py={6}>
                  {text} · {formatDateTime(m.created_at)}
                </Text>
              );
            }
            const mine = m.from_staff === staff;
            return (
              <Group key={m.id} justify={mine ? "flex-end" : "flex-start"}>
                <Paper
                  px="sm"
                  py={6}
                  radius="lg"
                  maw="75%"
                  bg={mine ? "var(--mantine-color-blue-filled)" : "var(--mantine-color-default-hover)"}
                  c={mine ? "white" : undefined}
                >
                  <Text style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</Text>
                  {tr[m.id] && tr[m.id] !== "loading" && (
                    <Box mt={4} pt={4} style={{ borderTop: "1px solid currentColor", opacity: 0.9 }}>
                      <Text size="xs" opacity={0.75}>
                        {T("Tłumaczenie:")} {langName((tr[m.id] as { source: string | null }).source)} → {langName((tr[m.id] as { target: string }).target)}
                      </Text>
                      <Text style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{(tr[m.id] as { text: string }).text}</Text>
                    </Box>
                  )}
                  {!staff && canSpeak() && (
                    <Anchor component="button" type="button" size="10px" c="inherit" onClick={() => listen(m)}>
                      <Group gap={3} wrap="nowrap">
                        {speakingId === m.id ? <IconPlayerStop size={11} /> : <IconVolume size={11} />}
                        {speakingId === m.id ? T("Zatrzymaj") : T("Odsłuchaj")}
                      </Group>
                    </Anchor>
                  )}
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    {cfg.data?.enabled && !cfg.data.exhausted ? (
                      tr[m.id] === "loading" ? (
                        <Text size="10px" opacity={0.7}>{T("Tłumaczę…")}</Text>
                      ) : tr[m.id] ? (
                        <Anchor component="button" type="button" size="10px" c="inherit" onClick={() => setTr((x) => { const { [m.id]: _d, ...rest } = x; return rest; })}>
                          {T("Ukryj tłumaczenie")}
                        </Anchor>
                      ) : (
                        <Anchor component="button" type="button" size="10px" c="inherit" onClick={() => translateMessage(m.id)}>
                          {T("Przetłumacz")}
                        </Anchor>
                      )
                    ) : (
                      <span />
                    )}
                    <Text size="10px" ta="right" opacity={0.7}>
                      {formatDateTime(m.created_at)}
                    </Text>
                  </Group>
                </Paper>
              </Group>
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
      <Group p="sm" align="flex-end" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Textarea
          style={{ flex: 1 }}
          placeholder={staff ? "Napisz odpowiedź…" : T("Napisz wiadomość…")}
          autosize
          minRows={1}
          maxRows={5}
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
        <DictateButton lang={ownLang ?? "pl"} value={body} onChange={setBody} />
        <ActionIcon size="lg" radius="xl" loading={send.isPending} disabled={!body.trim()} onClick={submit} aria-label={T("Wyślij")}>
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}

type Preset = { id: string; name: string };

function NewThread({ staff, preset, onCreated, onCancel }: { staff: boolean; preset?: Preset; onCreated: (id: number) => void; onCancel: () => void }) {
  const T = useT();
  const { me: account } = useAuth();
  const qc = useQueryClient();
  const [subject, setSubject] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [employee, setEmployee] = useState<string | null>(preset?.id ?? null);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState("");
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
      onCreated(t.id);
    },
    onError: (e) => setError(errorText(e)),
  });
  const ready = !!body.trim() && (staff ? !!employee && custom.trim().length >= 3 : !!subject);
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
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(!!preset);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"active" | "archive">("active");
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
  const showList = !mobile || (openId === null && !composing);
  const showRight = !mobile || openId !== null || composing;
  const back = () => {
    setOpenId(null);
    setComposing(false);
  };
  return (
    <Paper
      withBorder
      radius="md"
      style={{ display: "flex", height: "calc(100dvh - 110px)", minHeight: 420, overflow: "hidden" }}
    >
      {showList && (
        <Stack gap={0} w={mobile ? "100%" : 340} style={{ borderRight: mobile ? undefined : "1px solid var(--mantine-color-default-border)", minHeight: 0 }}>
          <Stack p="sm" gap="xs">
            <Group justify="space-between">
              <Title order={4}>{staff ? "Wiadomości" : T("Napisz do kadr")}</Title>
              <ActionIcon variant="light" size="lg" radius="xl" onClick={() => { setComposing(true); setOpenId(null); }} aria-label={T("Nowa wiadomość")}>
                <IconPlus size={18} />
              </ActionIcon>
            </Group>
            <SegmentedControl
              size="xs"
              fullWidth
              value={view}
              onChange={(v) => {
                setView(v as "active" | "archive");
                setOpenId(null);
                setComposing(false);
              }}
              data={[
                { value: "active", label: T("Aktywne") },
                { value: "archive", label: T("Archiwum") },
              ]}
            />
            {staff && (
              <>
                <TextInput size="xs" placeholder="Szukaj: nazwisko lub temat" leftSection={<IconSearch size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={status}
                  onChange={setStatus}
                  data={[
                    { value: "", label: "Wszystkie" },
                    { value: "new", label: "Nowe" },
                    { value: "in_progress", label: "W toku" },
                    { value: "done", label: "Zakończone" },
                  ]}
                />
              </>
            )}
          </Stack>
          <ScrollArea style={{ flex: 1 }}>
            {rows.length === 0 && (
              q.trim() || status ? (
                <EmptyState
                  search
                  title={q.trim() ? `Brak wyników dla „${q.trim()}”` : "Brak wiadomości w tym filtrze"}
                  text="Sprawdź pisownię albo pokaż wszystkie wiadomości."
                  action={{ label: "Wyczyść wyszukiwanie i filtr", onClick: () => { setQ(""); setStatus(""); } }}
                />
              ) : view === "archive" ? (
                <EmptyState
                  title={T("Archiwum jest puste")}
                  text={T("Zakończone rozmowy trafiają tu po kliknięciu „Archiwizuj” albo po 30 dniach bez ruchu.")}
                />
              ) : (
                <EmptyState
                  title={staff ? T("Brak wiadomości") : T("Nie masz jeszcze wiadomości")}
                  text={staff ? "Pracownicy nie napisali jeszcze do kadr. Możesz też sam zacząć rozmowę." : T("Masz pytanie do kadr? Napisz tutaj – odpowiedź zobaczysz w tym miejscu.")}
                  action={{ label: T("Nowa wiadomość"), onClick: () => { setComposing(true); setOpenId(null); } }}
                />
              )
            )}
            {rows.map((t) => {
              const name = staff ? (t.employee_name ?? "") : T("Kadry");
              return (
                <UnstyledButton
                  key={t.id}
                  w="100%"
                  p="sm"
                  onClick={() => { setOpenId(t.id); setComposing(false); }}
                  bg={openId === t.id ? "var(--mantine-color-default-hover)" : undefined}
                >
                  <Group wrap="nowrap" align="flex-start">
                    <Avatar radius="xl" color="blue">
                      {initials(name)}
                    </Avatar>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group justify="space-between" wrap="nowrap" gap={4}>
                        <Text size="sm" fw={t.unread ? 700 : 500} lineClamp={1}>
                          {name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {shortTime(t.updated_at)}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {t.subject}
                      </Text>
                      <Group justify="space-between" wrap="nowrap" gap={4}>
                        <Text size="xs" fw={t.unread ? 700 : 400} lineClamp={1} style={{ flex: 1 }}>
                          {(t.last_from_staff === staff ? T("Ty:") + " " : "") + t.preview}
                        </Text>
                        {t.unread ? <Badge size="xs" circle color="red" /> : <Badge size="xs" variant="light" color={THREAD_STATUS[t.status].color}>{T(THREAD_STATUS[t.status].label)}</Badge>}
                      </Group>
                    </Box>
                  </Group>
                </UnstyledButton>
              );
            })}
          </ScrollArea>
        </Stack>
      )}
      {showRight && (
        <Box style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {composing ? (
            <NewThread staff={staff} preset={preset} onCreated={(id) => { setComposing(false); setOpenId(id); }} onCancel={back} />
          ) : openId !== null ? (
            <Conversation key={openId} base={base} id={openId} staff={staff} onBack={back} showBack={!!mobile} />
          ) : (
            <Stack h="100%" align="center" justify="center">
              <Text c="dimmed">{T("Wybierz rozmowę")}</Text>
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}
