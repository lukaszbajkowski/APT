import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Box, Button, Card, Checkbox, FileInput, Group, Loader, Modal, SegmentedControl, Select, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerStop, IconVolume } from "@tabler/icons-react";

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

const SAMPLE = {
  subject: "Zasady BHP na stanowisku pracy (przykład)",
  body: `ZASADY BEZPIECZEŃSTWA I HIGIENY PRACY – PRZYKŁADOWY DOKUMENT

1. Przed rozpoczęciem pracy sprawdź swoje stanowisko oraz sprawność maszyn i urządzeń. Usterki zgłoś od razu przełożonemu.
2. Używaj środków ochrony indywidualnej wymaganych na stanowisku: obuwia ochronnego, rękawic, okularów, ochronników słuchu.
3. Nie wyłączaj ani nie omijaj osłon i zabezpieczeń maszyn.
4. Drogi ewakuacyjne, gaśnice i wyjścia awaryjne muszą być zawsze wolne.
5. W razie wypadku, pożaru lub zagrożenia zachowaj spokój, wezwij pomoc i powiadom przełożonego.
6. Nie pracuj pod wpływem alkoholu ani środków odurzających.
7. Zasady dotyczące przerw, noszenia kart identyfikacyjnych i wejść na halę wynikają z regulaminu pracy.

Potwierdzając zapoznanie się z dokumentem, oświadczasz, że rozumiesz powyższe zasady i będziesz ich przestrzegać. W razie wątpliwości zapytaj kadry lub przełożonego.

(To jest przykład. Zastąp go treścią swojego regulaminu lub instrukcji.)`,
};

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
            {kind === "document" && (
              <Button
                size="compact-sm"
                variant="default"
                onClick={() => {
                  setSubject(SAMPLE.subject);
                  setBody(SAMPLE.body);
                }}
              >
                Wstaw przykładowy dokument
              </Button>
            )}
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

export function MyBroadcastsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { me } = useAuth();
  const lang = me?.user.language ?? "pl";
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [noVoice, setNoVoice] = useState(false);
  const [view, setView] = useState<"active" | "archive">("active");
  const q = useQuery({
    queryKey: ["my-broadcasts", lang, view],
    queryFn: () => api<Mine[]>(`/me/broadcasts?archived=${view === "archive"}`),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  // zmiana języka: przerwij odczyt i pokaż komunikaty od nowa w nowym języku (treść tłumaczy serwer)
  useEffect(() => {
    stopSpeaking();
    setSpeaking(null);
    setNoVoice(false);
  }, [lang]);
  useEffect(() => () => stopSpeaking(), []);
  const read = useMutation({
    mutationFn: (id: number) => api(`/me/broadcasts/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-broadcasts"], exact: false });
      qc.invalidateQueries({ queryKey: ["my-bc-count"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const arch = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => api(`/me/broadcasts/${v.id}/archive?on=${v.on}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-broadcasts"], exact: false });
      qc.invalidateQueries({ queryKey: ["my-bc-count"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  return (
    <Stack maw={760}>
      <Group justify="space-between">
        <Title order={2}>{t("Komunikaty")}</Title>
        <SegmentedControl
          value={view}
          onChange={(v) => {
            stopSpeaking();
            setSpeaking(null);
            setView(v as "active" | "archive");
          }}
          data={[
            { value: "active", label: t("Aktualne") },
            { value: "archive", label: t("Archiwum") },
          ]}
        />
      </Group>
      {q.isLoading && <Loader size="sm" />}
      {q.data && q.data.length === 0 && <Text c="dimmed">{view === "archive" ? t("Archiwum jest puste.") : t("Brak komunikatów.")}</Text>}
      {(q.data ?? []).map((m) => (
        <Card key={m.id} withBorder padding="md">
          <Group justify="space-between" mb={4}>
            <Text fw={600}>{m.subject}</Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(m.sent_at)}
            </Text>
          </Group>
          <Text style={{ whiteSpace: "pre-wrap" }}>{m.body}</Text>
          <FileDocs files={m.files} />
          {canSpeak() && (
            <Button
              mt="xs"
              size="compact-xs"
              variant="subtle"
              leftSection={speaking === m.id ? <IconPlayerStop size={14} /> : <IconVolume size={14} />}
              onClick={() => {
                if (speaking === m.id) {
                  stopSpeaking();
                  setSpeaking(null);
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
          )}
          {noVoice && (
            <Text size="xs" c="dimmed">
              {t("Brak głosu dla tego języka w tym urządzeniu.")}
            </Text>
          )}
          {m.read_at && (!m.archived || m.own_archived) && (
            <Button mt="sm" ml="xs" size="xs" variant="default" loading={arch.isPending} onClick={() => arch.mutate({ id: m.id, on: !m.own_archived })}>
              {m.own_archived ? t("Przywróć") : t("Archiwizuj")}
            </Button>
          )}
          {!m.read_at ? (
            <Button mt="sm" size="xs" loading={read.isPending} onClick={() => read.mutate(m.id)}>
              {m.kind === "document" ? t("Zapoznałem(-am) się z dokumentem") : t("Przeczytałem(-am)")}
            </Button>
          ) : (
            <Badge mt="sm" variant="light" color="teal">
              {t("Potwierdzone")}
            </Badge>
          )}
        </Card>
      ))}
    </Stack>
  );
}
