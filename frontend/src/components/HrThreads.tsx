import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Avatar, Badge, Box, Button, Group, Paper, ScrollArea, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArchive, IconArchiveOff, IconArrowLeft, IconPlus, IconSearch, IconSend } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useAuth } from "../auth";

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

function Conversation({ base, id, staff, onBack, showBack }: { base: string; id: number; staff: boolean; onBack: () => void; showBack: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["thread", base, id], queryFn: () => api<Thread>(`${base}/${id}`), refetchInterval: 3000, ...LIVE });
  const t = q.data;
  const count = t?.messages.length ?? 0;
  // tłumaczenie na żądanie (Google Cloud Translation); funkcja ukryta, gdy serwer nie ma klucza
  const { me: account } = useAuth();
  const cfg = useQuery({ queryKey: ["translate-config"], queryFn: () => api<{ enabled: boolean; languages: { code: string; name: string }[] }>("/translate/config"), staleTime: 3_600_000 });
  const langKey = `apt-translate-${account?.user.id ?? 0}`;
  const [lang, setLangState] = useState<string>(() => {
    try {
      return localStorage.getItem(langKey) || (staff ? "pl" : (navigator.language || "pl").slice(0, 2));
    } catch {
      return "pl";
    }
  });
  const setLang = (v: string | null) => {
    if (!v) return;
    setLangState(v);
    try {
      localStorage.setItem(langKey, v);
    } catch {
      /* brak pamięci przeglądarki – wybór obowiązuje do odświeżenia */
    }
  };
  const [tr, setTr] = useState<Record<number, { text: string; source: string | null; target: string } | "loading">>({});
  const langName = (code: string | null) => cfg.data?.languages.find((l) => l.code === code)?.name ?? code ?? "?";
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
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Wróć">
              <IconArrowLeft size={18} />
            </ActionIcon>
          )}
          <Box>
            <Text fw={600} lineClamp={1}>
              {staff ? (t?.employee_name ?? "…") : (t?.subject ?? "…")}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {staff ? `${t?.subject ?? ""} · ${t?.employee_number ?? ""}` : "Kadry"}
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
                data={Object.entries(THREAD_STATUS).map(([value, v]) => ({ value, label: v.label }))}
                onChange={(v) => v && setStatus.mutate(v)}
              />
            ) : (
              <Badge color={THREAD_STATUS[t.status].color}>{THREAD_STATUS[t.status].label}</Badge>
            )}
            {t.archived ? (
              <Button size="xs" variant="default" leftSection={<IconArchiveOff size={14} />} loading={archive.isPending} onClick={() => archive.mutate(false)}>
                Przywróć
              </Button>
            ) : (
              t.status === "done" && (
                <Button size="xs" variant="light" leftSection={<IconArchive size={14} />} loading={archive.isPending} onClick={() => archive.mutate(true)}>
                  Archiwizuj
                </Button>
              )
            )}
          </Group>
        )}
      </Group>
      {cfg.data?.enabled && (
        <Group px="sm" py={4} gap="xs" justify="flex-end" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <Text size="xs" c="dimmed" style={{ flex: 1 }} lineClamp={2}>
            „Przetłumacz” wysyła treść jednej wiadomości do Google Cloud Translation.
          </Text>
          <Select
            size="xs"
            w={150}
            searchable
            allowDeselect={false}
            aria-label="Język tłumaczenia"
            placeholder="Tłumacz na…"
            value={lang}
            onChange={setLang}
            data={(cfg.data.languages.length ? cfg.data.languages : [{ code: "pl", name: "polski" }]).map((l) => ({ value: l.code, label: l.name }))}
          />
        </Group>
      )}
      <ScrollArea style={{ flex: 1 }} px="sm" type="auto">
        <Stack gap={6} py="sm">
          {t?.messages.map((m) => {
            if (m.kind === "status") {
              const label = THREAD_STATUS[m.body as ThreadRow["status"]]?.label ?? m.body;
              const text = m.body === "done_auto"
                ? "Rozmowa zamknięta automatycznie – brak odpowiedzi przez 3 dni"
                : m.from_staff
                ? `Status rozmowy zmieniono na: ${label}${staff && m.author_name ? ` (${m.author_name})` : ""}`
                : "Rozmowa została otwarta ponownie";
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
                        Tłumaczenie: {langName((tr[m.id] as { source: string | null }).source)} → {langName((tr[m.id] as { target: string }).target)}
                      </Text>
                      <Text style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{(tr[m.id] as { text: string }).text}</Text>
                    </Box>
                  )}
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    {cfg.data?.enabled ? (
                      tr[m.id] === "loading" ? (
                        <Text size="10px" opacity={0.7}>Tłumaczę…</Text>
                      ) : tr[m.id] ? (
                        <Anchor component="button" type="button" size="10px" c="inherit" onClick={() => setTr((x) => { const { [m.id]: _d, ...rest } = x; return rest; })}>
                          Ukryj tłumaczenie
                        </Anchor>
                      ) : (
                        <Anchor component="button" type="button" size="10px" c="inherit" onClick={() => translateMessage(m.id)}>
                          Przetłumacz
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
      {error && (
        <Alert color="red" m="xs" p="xs">
          {error}
        </Alert>
      )}
      <Group p="sm" align="flex-end" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Textarea
          style={{ flex: 1 }}
          placeholder={staff ? "Napisz odpowiedź…" : "Napisz wiadomość…"}
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
        <ActionIcon size="lg" radius="xl" loading={send.isPending} disabled={!body.trim()} onClick={submit} aria-label="Wyślij">
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}

type Preset = { id: string; name: string };

function NewThread({ staff, preset, onCreated, onCancel }: { staff: boolean; preset?: Preset; onCreated: (id: number) => void; onCancel: () => void }) {
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
      <Title order={4}>{staff ? "Nowa wiadomość do pracownika" : "Nowa wiadomość do kadr"}</Title>
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
        <Select label="Temat" placeholder="Wybierz" data={subjects.data ?? []} value={subject} onChange={setSubject} />
      )}
      <Textarea label="Treść" autosize minRows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
      {staff && (
        <Text size="xs" c="dimmed">
          Pracownik dostanie powiadomienie bez treści (e-mail lub telefon, jeśli ma je włączone). Rozmowa zamknie się sama, jeśli nie odpowie przez 3 dni.
        </Text>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        <Button loading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
          Wyślij
        </Button>
        <Button variant="default" onClick={onCancel}>
          Anuluj
        </Button>
      </Group>
    </Stack>
  );
}

/** Skrzynka w stylu komunikatora: lista rozmów po lewej, rozmowa po prawej (na telefonie jedno okno naraz). */
export function Messenger({ staff, preset }: { staff: boolean; preset?: Preset }) {
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
              <Title order={4}>{staff ? "Wiadomości" : "Napisz do kadr"}</Title>
              <ActionIcon variant="light" size="lg" radius="xl" onClick={() => { setComposing(true); setOpenId(null); }} aria-label="Nowa wiadomość">
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
                { value: "active", label: "Aktywne" },
                { value: "archive", label: "Archiwum" },
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
              <Text size="sm" c="dimmed" p="md">
                {view === "archive"
                  ? "Archiwum jest puste. Zakończone rozmowy trafiają tu po kliknięciu „Archiwizuj” albo po 30 dniach bez ruchu."
                  : staff
                  ? "Brak wiadomości."
                  : "Nie masz jeszcze wiadomości. Kliknij +, aby napisać do kadr."}
              </Text>
            )}
            {rows.map((t) => {
              const name = staff ? (t.employee_name ?? "") : "Kadry";
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
                          {(t.last_from_staff === staff ? "Ty: " : "") + t.preview}
                        </Text>
                        {t.unread ? <Badge size="xs" circle color="red" /> : <Badge size="xs" variant="light" color={THREAD_STATUS[t.status].color}>{THREAD_STATUS[t.status].label}</Badge>}
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
              <Text c="dimmed">Wybierz rozmowę</Text>
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}
