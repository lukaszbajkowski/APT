import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Avatar, Badge, Box, Button, Card, Paper, ScrollArea, UnstyledButton, Checkbox, FileInput, Group, Loader, Modal, SegmentedControl, Select, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconFileText, IconPlayerStop, IconSpeakerphone, IconVolume } from "@tabler/icons-react";

import { api, errorText, formatDateTime, withAcct, type DictionaryItem } from "../api";
import { useAuth } from "../auth";
import { DocumentViewer } from "../components/DocumentViewer";
import { useT } from "../lib/i18n";
import { canSpeak, speak, speechLang, stopSpeaking } from "../lib/speech";

interface FileRef {
  id: number;
  name: string;
  size: number;
}
interface Broadcast {
  id: number;
  finished: boolean;
  files: FileRef[];
  archived: boolean;
  kind: "info" | "document";
  subject: string;
  body: string;
  target: string;
  created_by_name: string | null;
  created_at: string;
  total: number;
  read: number;
}
interface Preview {
  total: number;
  with_account: number;
  with_email: number;
  unreachable: number;
}
interface Recipient {
  employee_id: number;
  name: string;
  read_at: string | null;
}

function Recipients({ id, onClose }: { id: number; onClose: () => void }) {
  const remind = useMutation({
    mutationFn: () => api<{ unread: number; pushed: number }>(`/broadcasts/${id}/remind`, { method: "POST" }),
    onSuccess: (r) => notifications.show({ color: "green", message: `Przypomnienie wysłane na ${r.pushed} z ${r.unread} kont.` }),
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const q = useQuery({ queryKey: ["bc-recipients", id], queryFn: () => api<Recipient[]>(`/broadcasts/${id}/recipients`) });
  return (
    <Modal opened onClose={onClose} title="Kto przeczytał" size="md">
      {q.isLoading && <Loader size="sm" />}
      <Group justify="flex-end" mb="xs">
        <Button size="compact-sm" variant="light" loading={remind.isPending} onClick={() => remind.mutate()}>
          Przypomnij tym, którzy nie przeczytali
        </Button>
      </Group>
      <Table verticalSpacing={4} fz="sm">
        <Table.Tbody>
          {(q.data ?? []).map((r) => (
            <Table.Tr key={r.employee_id}>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td ta="right">
                {r.read_at ? (
                  <Badge variant="light" color="teal">
                    {formatDateTime(r.read_at)}
                  </Badge>
                ) : (
                  <Badge variant="light" color="gray">
                    nie przeczytał(a)
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}

/** Dokument pokazany jak w podglądzie: strony jako obrazy ze znakiem wodnym, bez pobierania pliku. */
function InlineDoc({ base }: { base: string }) {
  const info = useQuery({ queryKey: ["bc-doc", base], queryFn: () => api<{ pages: number; title: string }>(base), gcTime: 0 });
  const [full, setFull] = useState(false);
  if (info.isLoading) return <Loader size="sm" mt="xs" />;
  if (info.error || !info.data) return <Alert color="red">{errorText(info.error)}</Alert>;
  return (
    <Stack gap="xs" mt="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {info.data.title}
        </Text>
        <Button size="compact-xs" variant="light" onClick={() => setFull(true)}>
          Pełny ekran
        </Button>
      </Group>
      <Stack
        gap="sm"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", background: "var(--mantine-color-gray-1)", padding: 8, borderRadius: 6 }}
      >
        {Array.from({ length: info.data.pages }, (_, i) => (
          <Box
            key={i}
            role="img"
            aria-label={`Strona ${i + 1}`}
            w="100%"
            style={{
              aspectRatio: "210 / 297",
              backgroundImage: `url(${withAcct(`/api${base}/page/${i}`)})`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center top",
              backgroundColor: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,.15)",
              pointerEvents: "none",
            }}
          />
        ))}
      </Stack>
      {full && <DocumentViewer docId={base} opened onClose={() => setFull(false)} base={base} />}
    </Stack>
  );
}

function FileDocs({ files, staff }: { files: FileRef[]; staff?: boolean }) {
  return (
    <>
      {files.map((f) => (
        <InlineDoc key={f.id} base={staff ? `/broadcasts/files/${f.id}/preview` : `/me/broadcasts/files/${f.id}/preview`} />
      ))}
    </>
  );
}

export function BroadcastsPage() {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const [archive, setArchive] = useState(false);
  const list = useQuery({ queryKey: ["broadcasts", archive], queryFn: () => api<Broadcast[]>(`/broadcasts?archived=${archive}`) });
  const [agency, setAgency] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
  const [kind, setKind] = useState<"info" | "document">("info");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [docOf, setDocOf] = useState<Broadcast | null>(null);
  const arch = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => api(`/broadcasts/${v.id}/archive?on=${v.on}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["broadcasts"] }),
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const target = { agency_id: agency ? Number(agency) : null, department_id: dept ? Number(dept) : null, everyone };
  const hasTarget = !!(agency || dept || everyone);
  const preview = useQuery({
    queryKey: ["bc-preview", agency, dept, everyone],
    queryFn: () => api<Preview>("/broadcasts/preview", { method: "POST", body: target }),
    enabled: hasTarget,
  });
  const send = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("kind", kind);
      f.append("subject", subject);
      f.append("body", body);
      if (agency) f.append("agency_id", agency);
      if (dept) f.append("department_id", dept);
      if (everyone) f.append("everyone", "true");
      files.forEach((x) => f.append("files", x));
      return api<Broadcast>("/broadcasts", { method: "POST", form: f });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      notifications.show({ color: "green", message: "Komunikat wysłany." });
      setSubject("");
      setBody("");
      setFiles([]);
      setError(null);
    },
    onError: (e) => setError(errorText(e)),
  });
  const opts = (d?: DictionaryItem[]) => (d ?? []).filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: x.name }));
  return (
    <Stack maw={900}>
      <div>
        <Title order={2}>Komunikaty do grup</Title>
        <Text c="dimmed" size="sm">
          Wiadomość do wszystkich aktywnych pracowników agencji lub wydziału. Pracownik dostaje powiadomienie i e-mail w swoim języku,
          czyta komunikat w aplikacji i potwierdza przeczytanie.
        </Text>
      </div>
      <Card withBorder padding="lg">
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Group grow align="flex-end">
            <Select label="Agencja" clearable data={opts(agencies.data)} value={agency} onChange={setAgency} />
            <Select label="Wydział" clearable data={opts(departments.data)} value={dept} onChange={setDept} />
          </Group>
          <Checkbox label="Wszyscy aktywni pracownicy" checked={everyone} onChange={(e) => setEveryone(e.currentTarget.checked)} />
          {preview.data && (
            <Text size="sm">
              Odbiorców: <b>{preview.data.total}</b> (z kontem w aplikacji: {preview.data.with_account}, z e-mailem: {preview.data.with_email}
              {preview.data.unreachable > 0 ? `, bez żadnego kontaktu: ${preview.data.unreachable}` : ""}).
            </Text>
          )}
          <Group justify="space-between">
            <SegmentedControl
              value={kind}
              onChange={(v) => setKind(v as "info" | "document")}
              data={[
                { value: "info", label: "Komunikat" },
                { value: "document", label: "Dokument do zapoznania się" },
              ]}
            />
          </Group>
          <TextInput label="Temat" maxLength={120} value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Textarea label={files.length ? "Treść (opcjonalna – dokument będzie widoczny w komunikacie)" : "Treść"} autosize minRows={4} maxLength={kind === "document" ? 20000 : 2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <FileInput
            label="Dokumenty (PDF, JPG, PNG – do 5 plików, po 15 MB). Pracownik zobaczy je otwarte w aplikacji, bez pobierania."
            placeholder="Dodaj pliki"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            clearable
            value={files}
            onChange={(v) => setFiles((v ?? []).slice(0, 5))}
          />
          <Group justify="flex-end">
            <Button
              disabled={!hasTarget || !subject.trim() || (!body.trim() && files.length === 0) || !preview.data?.total}
              loading={send.isPending}
              onClick={() => {
                if (window.confirm(`Wysłać komunikat do ${preview.data?.total ?? 0} osób?`)) send.mutate();
              }}
            >
              Wyślij
            </Button>
          </Group>
        </Stack>
      </Card>
      <Group justify="space-between">
        <Title order={4}>{archive ? "Archiwum" : "Wysłane"}</Title>
        <SegmentedControl
          size="xs"
          value={archive ? "a" : "w"}
          onChange={(v) => setArchive(v === "a")}
          data={[
            { value: "w", label: "Aktualne" },
            { value: "a", label: "Archiwum" },
          ]}
        />
      </Group>
      {!archive && (
        <Text size="xs" c="dimmed">
          Jak przy wiadomościach do kadr: komunikat jest zakończony, gdy przeczytali go wszyscy albo minęły 3 dni; zakończony możesz zarchiwizować ręcznie (pracownik archiwizuje u siebie osobno), a po 30 dniach bez ruchu trafia do archiwum obu stron.
        </Text>
      )}
      {list.isLoading && <Loader size="sm" />}
      <Table verticalSpacing={6} fz="sm">
        <Table.Tbody>
          {(list.data ?? []).map((b) => (
            <Table.Tr key={b.id}>
              <Table.Td>
                <Text fw={500}>
                  {b.subject}{" "}
                  {b.kind === "document" && (
                    <Badge size="xs" variant="light">
                      dokument
                    </Badge>
                  )}
                </Text>
                <Text size="xs" c="dimmed">
                  {b.target} · {formatDateTime(b.created_at)} · {b.created_by_name ?? "—"}
                </Text>
                
              </Table.Td>
              <Table.Td ta="right">
                <Group gap={6} justify="flex-end" wrap="nowrap">
                  {b.files.length > 0 && (
                    <Button size="compact-xs" variant="default" onClick={() => setDocOf(b)}>
                      Dokument
                    </Button>
                  )}
                  <Button size="compact-xs" variant="light" onClick={() => setOpen(b.id)}>
                    Przeczytało {b.read} z {b.total}
                  </Button>
                  <Button size="compact-xs" variant="subtle" color="gray" loading={arch.isPending} disabled={!archive && !b.finished} title={!archive && !b.finished ? "Archiwizować można zakończone komunikaty: przeczytane przez wszystkich albo starsze niż 3 dni." : undefined} onClick={() => arch.mutate({ id: b.id, on: !archive })}>
                    {archive ? "Przywróć" : "Archiwizuj"}
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {docOf && (
        <Modal opened onClose={() => setDocOf(null)} title={docOf.subject} size="xl">
          <FileDocs files={docOf.files} staff />
        </Modal>
      )}
      {open !== null && <Recipients id={open} onClose={() => setOpen(null)} />}
    </Stack>
  );
}

interface Mine {
  id: number;
  archived: boolean;
  own_archived: boolean;
  files: FileRef[];
  kind: "info" | "document";
  subject: string;
  body: string;
  sent_at: string;
  read_at: string | null;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

/** Komunikaty pracownika w stylu „Napisz do kadr”: lista po lewej, treść po prawej (na telefonie jedno okno naraz). */
export function MyBroadcastsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { me } = useAuth();
  const lang = me?.user.language ?? "pl";
  const mobile = useMediaQuery("(max-width: 48em)");
  const [view, setView] = useState<"active" | "archive">("active");
  const [openId, setOpenId] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [noVoice, setNoVoice] = useState(false);
  const q = useQuery({
    queryKey: ["my-broadcasts", lang, view],
    queryFn: () => api<Mine[]>(`/me/broadcasts?archived=${view === "archive"}`),
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  // zmiana języka: przerwij odczyt i pokaż komunikaty od nowa w nowym języku (treść tłumaczy serwer)
  useEffect(() => {
    stopSpeaking();
    setSpeaking(null);
    setNoVoice(false);
  }, [lang]);
  useEffect(() => () => stopSpeaking(), []);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-broadcasts"], exact: false });
    qc.invalidateQueries({ queryKey: ["my-bc-count"] });
  };
  const read = useMutation({
    mutationFn: (id: number) => api(`/me/broadcasts/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const arch = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => api(`/me/broadcasts/${v.id}/archive?on=${v.on}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      refresh();
      if (v.on || view === "archive") setOpenId(null);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const rows = q.data ?? [];
  const m = rows.find((x) => x.id === openId) ?? null;
  const showList = !mobile || m === null;
  const showRight = !mobile || m !== null;
  const stop = () => {
    stopSpeaking();
    setSpeaking(null);
  };
  return (
    <Paper withBorder radius="md" style={{ display: "flex", height: "calc(100dvh - 110px)", minHeight: 420, overflow: "hidden" }}>
      {showList && (
        <Stack gap={0} w={mobile ? "100%" : 340} style={{ borderRight: mobile ? undefined : "1px solid var(--mantine-color-default-border)", minHeight: 0 }}>
          <Stack p="sm" gap="xs">
            <Title order={4}>{t("Komunikaty")}</Title>
            <SegmentedControl
              size="xs"
              fullWidth
              value={view}
              onChange={(v) => {
                stop();
                setView(v as "active" | "archive");
                setOpenId(null);
              }}
              data={[
                { value: "active", label: t("Aktywne") },
                { value: "archive", label: t("Archiwum") },
              ]}
            />
          </Stack>
          <ScrollArea style={{ flex: 1 }}>
            {q.isLoading && <Loader size="sm" m="md" />}
            {!q.isLoading && rows.length === 0 && (
              <Text size="sm" c="dimmed" p="md">
                {view === "archive" ? t("Archiwum jest puste.") : t("Brak komunikatów.")}
              </Text>
            )}
            {rows.map((x) => (
              <UnstyledButton
                key={x.id}
                w="100%"
                p="sm"
                onClick={() => {
                  stop();
                  setOpenId(x.id);
                }}
                bg={openId === x.id ? "var(--mantine-color-default-hover)" : undefined}
              >
                <Group wrap="nowrap" align="flex-start">
                  <Avatar radius="xl" color={x.kind === "document" ? "teal" : "blue"}>
                    {x.kind === "document" ? <IconFileText size={18} /> : <IconSpeakerphone size={18} />}
                  </Avatar>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Group justify="space-between" wrap="nowrap" gap={4}>
                      <Text size="sm" fw={x.read_at ? 500 : 700} lineClamp={1}>
                        {x.subject}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {shortTime(x.sent_at)}
                      </Text>
                    </Group>
                    <Group justify="space-between" wrap="nowrap" gap={4}>
                      <Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>
                        {x.body || (x.files.length ? x.files[0].name : "")}
                      </Text>
                      {!x.read_at ? (
                        <Badge size="xs" circle color="red" />
                      ) : (
                        <Badge size="xs" variant="light" color="teal">
                          {t("Potwierdzone")}
                        </Badge>
                      )}
                    </Group>
                  </Box>
                </Group>
              </UnstyledButton>
            ))}
          </ScrollArea>
        </Stack>
      )}
      {showRight && (
        <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {m === null ? (
            <Stack h="100%" align="center" justify="center">
              <Text c="dimmed">{t("Wybierz komunikat")}</Text>
            </Stack>
          ) : (
            <>
              <Group p="sm" gap="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                {mobile && (
                  <ActionIcon variant="subtle" onClick={() => { stop(); setOpenId(null); }} aria-label={t("Wróć")}>
                    <IconArrowLeft size={18} />
                  </ActionIcon>
                )}
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={600} lineClamp={2}>
                    {m.subject}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Kadry")} · {formatDateTime(m.sent_at)}
                  </Text>
                </Box>
                {m.read_at && (!m.archived || m.own_archived) && (
                  <Button size="xs" variant="default" loading={arch.isPending} onClick={() => arch.mutate({ id: m.id, on: !m.own_archived })}>
                    {m.own_archived ? t("Przywróć") : t("Archiwizuj")}
                  </Button>
                )}
              </Group>
              <ScrollArea style={{ flex: 1 }} p="md">
                <Stack gap="sm" pb="md">
                  {m.body && <Text style={{ whiteSpace: "pre-wrap" }}>{m.body}</Text>}
                  <FileDocs files={m.files} />
                  {canSpeak() && (
                    <Group>
                      <Button
                        size="compact-sm"
                        variant="light"
                        leftSection={speaking === m.id ? <IconPlayerStop size={14} /> : <IconVolume size={14} />}
                        onClick={() => {
                          if (speaking === m.id) {
                            stop();
                            return;
                          }
                          stopSpeaking();
                          setNoVoice(false);
                          setSpeaking(m.id);
                          if (speak(`${m.subject}. ${m.body}`, speechLang(lang), () => setSpeaking(null)) === "no-voice") {
                            setNoVoice(true);
                            setSpeaking(null);
                          }
                        }}
                      >
                        {speaking === m.id ? t("Zatrzymaj") : t("Odsłuchaj")}
                      </Button>
                    </Group>
                  )}
                  {noVoice && (
                    <Text size="xs" c="dimmed">
                      {t("Brak głosu dla tego języka w tym urządzeniu.")}
                    </Text>
                  )}
                </Stack>
              </ScrollArea>
              <Box p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                {!m.read_at ? (
                  <Button fullWidth loading={read.isPending} onClick={() => read.mutate(m.id)}>
                    {m.kind === "document" ? t("Zapoznałem(-am) się z dokumentem") : t("Przeczytałem(-am)")}
                  </Button>
                ) : (
                  <Badge variant="light" color="teal">
                    {t("Potwierdzone")} · {formatDateTime(m.read_at)}
                  </Badge>
                )}
              </Box>
            </>
          )}
        </Box>
      )}
    </Paper>
  );
}
