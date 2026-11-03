import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Avatar, Badge, Box, Button, ScrollArea, UnstyledButton, Checkbox, FileButton, FileInput, Group, SegmentedControl, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconArrowRight, IconChevronRight, IconPaperclip, IconFileText, IconPlus, IconSearch, IconPlayerStop, IconSpeakerphone, IconVolume } from "@tabler/icons-react";

import { api, errorText, formatDateTime, shortTime, type DictionaryItem } from "../api";
import { useAuth } from "../auth";
import { PageSheet } from "../components/PageSheet";
import { DocumentViewer } from "../components/DocumentViewer";
import { useT } from "../lib/i18n";
import { canSpeak, speak, speechLang, stopSpeaking } from "../lib/speech";
import { EmptyState, Loading } from "../components/States";
import { useConfirm } from "../lib/confirm";
import { MasterDetail } from "../components/MasterDetail";
import { CompactEmpty, ListRow, PageHead, Section, Segments, StatusBadge, SwipePager, useMobileHeader, useNavHeightVar, useSwipeAnywhere } from "../components/Mobile";

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

/** Dokument pokazany jak w podglądzie: strony jako obrazy ze znakiem wodnym, bez pobierania pliku. */
function InlineDoc({ base }: { base: string }) {
  const info = useQuery({ queryKey: ["bc-doc", base], queryFn: () => api<{ pages: number; title: string }>(base), gcTime: 0 });
  const [full, setFull] = useState(false);
  if (info.isLoading) return <Loading />;
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
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", background: "var(--apt-subtle)", padding: 8, borderRadius: 6 }}
      >
        {Array.from({ length: info.data.pages }, (_, i) => (
          <PageSheet key={i} index={i} src={`/api${base}/page/${i}`} />
        ))}
      </Stack>
      {full && <DocumentViewer docId={base} opened onClose={() => setFull(false)} base={base} variant="attachment" />}
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

/** Zakładka „Kto przeczytał”: przypomnienie, wyszukiwarka, filtr i lista przewijana osobno (komunikat może iść do setek osób). */
function RecipientsPane({ id, mobile }: { id: number; mobile?: boolean }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState("unread");
  const remind = useMutation({
    mutationFn: () => api<{ unread: number; pushed: number }>(`/broadcasts/${id}/remind`, { method: "POST" }),
    onSuccess: (r) => notifications.show({ color: "green", message: `Przypomnienie wysłane na ${r.pushed} z ${r.unread} kont.` }),
  });
  const data = useQuery({ queryKey: ["bc-recipients", id], queryFn: () => api<Recipient[]>(`/broadcasts/${id}/recipients`) });
  const all = data.data ?? [];
  const unread = all.filter((r) => !r.read_at).length;
  const rows = all.filter(
    (r) =>
      (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())) &&
      (f === "all" || (f === "read") === !!r.read_at),
  );
  if (mobile)
    return (
      <Stack gap={16}>
        <Button
          size="lg"
          fullWidth
          variant="default"
          loading={remind.isPending}
          disabled={unread === 0}
          onClick={() => remind.mutate()}
          h="auto"
          mih={50}
          styles={{ label: { whiteSpace: "normal", textAlign: "center", lineHeight: 1.3, paddingBlock: 8 } }}
        >
          {unread ? `Wyślij przypomnienie · ${unread} os.` : "Wszyscy przeczytali"}
        </Button>
        <TextInput size="md" aria-label="Szukaj osoby" placeholder="Szukaj: nazwisko" leftSection={<IconSearch size={18} aria-hidden />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Segments
          value={f}
          onChange={setF}
          items={[
            { value: "all", label: "Wszyscy" },
            { value: "unread", label: "Nie przeczytali" },
            { value: "read", label: "Przeczytali" },
          ]}
        />
        {data.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <CompactEmpty title="Brak osób" text={q.trim() ? "Sprawdź pisownię nazwiska." : "Nikt nie pasuje do tego filtra."} />
        ) : (
          <div className="ui-group">
            {rows.map((r) => (
              <ListRow
                key={r.employee_id}
                title={r.name}
                description={r.read_at ? `Przeczytał(a) ${formatDateTime(r.read_at)}` : undefined}
                trailing={r.read_at ? <StatusBadge tone="ok">Przeczytane</StatusBadge> : <StatusBadge tone="wait">Nie przeczytał(a)</StatusBadge>}
              />
            ))}
          </div>
        )}
      </Stack>
    );
  return (
    <>
      <Group p="sm" gap="xs" style={{ borderBottom: "1px solid var(--apt-line)" }}>
        <Button size="compact-sm" variant="light" loading={remind.isPending} disabled={unread === 0} onClick={() => remind.mutate()}>
          Przypomnij tym, którzy nie przeczytali ({unread})
        </Button>
        <TextInput size="xs" aria-label="Szukaj osoby" style={{ flex: 1, minWidth: 140 }} placeholder="Szukaj: nazwisko" leftSection={<IconSearch size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <SegmentedControl
          size="xs"
          value={f}
          onChange={setF}
          data={[
            { value: "all", label: "Wszyscy" },
            { value: "unread", label: "Nieprzeczytali" },
            { value: "read", label: "Przeczytali" },
          ]}
        />
      </Group>
      <ScrollArea style={{ flex: 1 }}>
        {data.isLoading && <Loading />}
        {!data.isLoading && rows.length === 0 && (
          <Text size="sm" c="dimmed" p="md">
            Brak osób dla tego filtra.
          </Text>
        )}
        <Table verticalSpacing={6} fz="sm" px="sm">
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.employee_id}>
                <Table.Td pl="md">{r.name}</Table.Td>
                <Table.Td ta="right" pr="md">
                  <Badge variant="light" color={r.read_at ? "teal" : "gray"}>
                    {r.read_at ? formatDateTime(r.read_at) : "nie przeczytał(a)"}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </>
  );
}

/** Komunikaty do grup w stylu „Napisz do kadr”: lista po lewej („+” = nowy), szczegóły lub formularz po prawej. */
export function BroadcastsPage() {
  const qc = useQueryClient();
  const mobile = useMediaQuery("(max-width: 48em)");
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const [archive, setArchive] = useState(false);
  const list = useQuery({
    queryKey: ["broadcasts", archive],
    queryFn: () => api<Broadcast[]>(`/broadcasts?archived=${archive}`),
    refetchInterval: 15_000,
  });
  // telefon: obie listy wczytane od razu, żeby przesuwanie zakładek pokazywało gotową treść
  const live = useQuery({ queryKey: ["broadcasts", false], queryFn: () => api<Broadcast[]>(`/broadcasts?archived=false`), refetchInterval: 15_000, enabled: !!mobile });
  const arch2 = useQuery({ queryKey: ["broadcasts", true], queryFn: () => api<Broadcast[]>(`/broadcasts?archived=true`), refetchInterval: 15_000, enabled: !!mobile });
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<"content" | "read">("content");
  useEffect(() => setTab("content"), [openId]);
  const [composing, setComposing] = useState(false);
  const [agency, setAgency] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
  const [kind, setKind] = useState<"info" | "document">("info");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cStep, setCStep] = useState<1 | 2>(1);
  useNavHeightVar();
  useEffect(() => {
    if (composing) setCStep(1);
  }, [composing]);
  const arch = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => api(`/broadcasts/${v.id}/archive?on=${v.on}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      setOpenId(null);
    },
  });
  const target = { agency_id: agency ? Number(agency) : null, department_id: dept ? Number(dept) : null, everyone };
  const hasTarget = !!(agency || dept || everyone);
  const preview = useQuery({
    queryKey: ["bc-preview", agency, dept, everyone],
    queryFn: () => api<Preview>("/broadcasts/preview", { method: "POST", body: target }),
    enabled: hasTarget && composing,
  });
  const confirm = useConfirm();
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
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      notifications.show({
        color: "green",
        title: "Komunikat wysłany",
        message: `Trafił do ${b.total} osób. Pracownicy dostają powiadomienie i e-mail; w zakładce „Kto przeczytał” zobaczysz, kto go otworzył.`,
        autoClose: 8000,
      });
      setSubject("");
      setBody("");
      setFiles([]);
      setError(null);
      setArchive(false);
      setComposing(false);
      setOpenId(b.id);
    },
    onError: (e) => setError(errorText(e)),
  });
  const opts = (d?: DictionaryItem[]) => (d ?? []).filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: x.name }));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const all = list.data ?? [];
  const rows = all.filter(
    (x) =>
      (!q.trim() || `${x.subject} ${x.target}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (status === "" || (status === "done") === x.finished || (status === "open" && !x.finished)),
  );
  const b = all.find((x) => x.id === openId) ?? null;
  const hasRight = composing || b !== null;
  const showList = !mobile || !hasRight;
  const showRight = !mobile || hasRight;
  const audience = everyone
    ? "wszyscy aktywni"
    : [agencies.data?.find((x) => String(x.id) === agency)?.name, departments.data?.find((x) => String(x.id) === dept)?.name].filter(Boolean).join(", ");
  const canSend = hasTarget && !!preview.data?.total && !!subject.trim() && (kind === "document" ? files.length > 0 : !!body.trim() || files.length > 0);
  useMobileHeader(
    mobile && composing
      ? {
          title: "Nowy komunikat",
          subtitle: cStep === 1 ? "Krok 1 z 2 · Do kogo" : `Krok 2 z 2 · Treść · ${audience}${preview.data ? `, ${preview.data.total} os.` : ""}`,
          onBack: () => (cStep === 2 ? setCStep(1) : back()),
        }
      : mobile && b
        ? { title: b.subject, subtitle: `${b.kind === "document" ? "Dokument · " : ""}${b.target} · ${formatDateTime(b.created_at)}`, onBack: () => back() }
        : null,
  );
  // przesunięcie palcem w bok przełącza „Komunikat” ↔ „Dokument do zapoznania się” (jak zakładki)
  useSwipeAnywhere(!!mobile && composing && cStep === 2, () => setKind("document"), () => setKind("info"));
  const mobileComposer = (
    <div className="ui-inpage">
      <div className="ui-chat-body ui-form-body">
        {cStep === 1 ? (
          <>
            <Text size="sm" c="dimmed">Pracownik dostaje powiadomienie i e-mail w swoim języku, czyta komunikat w aplikacji i potwierdza przeczytanie.</Text>
            {!hasTarget && <span className="ui-hint-warn">Wybierz agencję, wydział albo „Wszyscy”, żeby przejść dalej.</span>}
            {hasTarget && preview.data?.total === 0 && <span className="ui-hint-warn">Brak aktywnych pracowników w tej grupie – wybierz inną.</span>}
            <Group grow align="flex-start" gap={10}>
              <Select size="md" label="Agencja" placeholder="Wszystkie" clearable data={opts(agencies.data)} value={agency} onChange={setAgency} />
              <Select size="md" label="Wydział" placeholder="Wszystkie" clearable data={opts(departments.data)} value={dept} onChange={setDept} />
            </Group>
            <Checkbox size="md" label="Wszyscy aktywni pracownicy" checked={everyone} onChange={(e) => setEveryone(e.currentTarget.checked)} />
            {preview.data && (
              <div className="ui-summary">
                Odbiorców: <b>{preview.data.total}</b>
                <small>
                  z kontem w aplikacji: {preview.data.with_account} · z e-mailem: {preview.data.with_email}
                  {preview.data.unreachable > 0 ? ` · bez żadnego kontaktu: ${preview.data.unreachable}` : ""}
                </small>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="ui-seg2" role="radiogroup" aria-label="Rodzaj">
              {([["info", "Komunikat"], ["document", "Dokument do zapoznania się"]] as const).map(([v, l]) => (
                <UnstyledButton key={v} role="radio" aria-checked={kind === v} data-on={kind === v || undefined} onClick={() => setKind(v)}>
                  {l}
                </UnstyledButton>
              ))}
            </div>
            <TextInput size="md" label="Temat" maxLength={80} value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
            <span className="ui-count">{subject.length}/80</span>
            <Textarea
              size="md"
              label={kind === "document" ? <>Treść <Text span c="dimmed" fw={400} inherit>(opcjonalna)</Text></> : "Treść"}
              autosize
              minRows={4}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
            />
            <span className="ui-count">{body.length}/2000</span>
            <div className="ui-form-field">
              {kind === "document" && (
                <span className="ui-form-label">
                  Dokument <span className="ui-warn-line" style={{ display: "inline" }}>* wymagany</span>
                </span>
              )}
              <FileButton multiple accept="application/pdf,image/jpeg,image/png" onChange={(v) => setFiles([...files, ...(v ?? [])].slice(0, 5))}>
                {(props) => (
                  <UnstyledButton {...props} className="ui-drop-row" data-warn={(kind === "document" && files.length === 0) || undefined}>
                    <span style={{ color: "var(--mantine-primary-color-text)", display: "flex", flex: "none" }}><IconPaperclip size={22} aria-hidden /></span>
                    <span className="ui-row-text">
                      <span className="ui-row-title">Dodaj pliki</span>
                      <span className="ui-row-desc">PDF, JPG, PNG – do 5 plików, po 15 MB. Pracownik zobaczy je w aplikacji, bez pobierania.</span>
                    </span>
                  </UnstyledButton>
                )}
              </FileButton>
              {files.length > 0 && (
                <div className="ui-group">
                  {files.map((f, i) => (
                    <div key={i} className="ui-pick-row">
                      <IconFileText size={20} aria-hidden />
                      <span className="ui-row-text"><span className="ui-row-title">{f.name}</span></span>
                      <Button variant="subtle" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Usuń</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </div>
      <div className="ui-chat-compose">
        {cStep === 1 ? (
          <Button size="lg" fullWidth radius="md" rightSection={<IconChevronRight size={18} />} disabled={!hasTarget || !preview.data?.total} onClick={() => setCStep(2)}>
            Dalej – treść
          </Button>
        ) : (
          <>
            <Button size="lg" radius="md" variant="default" onClick={() => setCStep(1)} style={{ flex: "none", minWidth: 110 }}>
              Wstecz
            </Button>
            <Button
              size="lg"
              fullWidth
              radius="md"
              leftSection={<IconArrowRight size={18} />}
              loading={send.isPending}
              disabled={!canSend}
              onClick={() => confirm({ title: "Wysłać komunikat?", message: `Komunikat „${subject.trim()}” trafi do ${preview.data?.total ?? 0} osób. Tej operacji nie da się cofnąć.`, confirmLabel: "Wyślij" }).then((ok) => ok && send.mutate())}
            >
              Wyślij
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const back = () => {
    setComposing(false);
    setOpenId(null);
  };
  if (mobile && showList) {
    const seg = archive ? "archive" : status === "done" ? "done" : "active";
    return (
      <Stack gap="md">
        <PageHead
          title="Komunikaty"
          subtitle="Do grup pracowników"
          action={{ label: "Nowy komunikat", icon: <IconPlus size={22} />, onClick: () => { setComposing(true); setOpenId(null); } }}
        />
        <Segments
          value={seg}
          onChange={(v) => {
            setArchive(v === "archive");
            setStatus(v === "done" ? "done" : v === "active" ? "open" : "");
          }}
          items={[
            { value: "active", label: "W toku" },
            { value: "done", label: "Zakończone" },
            { value: "archive", label: "Archiwum" },
          ]}
        />
        <SwipePager
          index={["active", "done", "archive"].indexOf(seg)}
          onIndex={(i) => {
            const v = ["active", "done", "archive"][i];
            setArchive(v === "archive");
            setStatus(v === "done" ? "done" : v === "active" ? "open" : "");
          }}
        >
          {(["active", "done", "archive"] as const).map((v) => {
            const src = v === "archive" ? arch2.data : live.data;
            const items = (src ?? []).filter((x) => v === "archive" || (v === "done") === x.finished);
            return (
              <Stack key={v} gap="md">
                {!src && <Loading rows={3} />}
                {src && items.length === 0 && <CompactEmpty title="Brak komunikatów" text={v === "archive" ? undefined : "Nowy komunikat dodasz przyciskiem „+”."} />}
                {items.length > 0 && (
                  <div className="ui-group">
                    {items.map((x) => (
                      <UnstyledButton key={x.id} className="ui-bc" onClick={() => setOpenId(x.id)}>
                        <span className="ui-thread-line">
                          <span className="ui-thread-name">{x.subject}</span>
                          <span className="ui-thread-time">{shortTime(x.created_at)}</span>
                        </span>
                        <span className="ui-row-desc">{x.target}{x.kind === "document" ? " · Dokument" : ""}</span>
                        <span className="ui-bc-read">
                          <span className="ui-bc-bar" role="img" aria-label={`Przeczytało ${x.read} z ${x.total}`}>
                            <span style={{ width: `${x.total ? Math.round((x.read / x.total) * 100) : 0}%` }} />
                          </span>
                          <span>Przeczytało {x.read} z {x.total}</span>
                        </span>
                      </UnstyledButton>
                    ))}
                  </div>
                )}
              </Stack>
            );
          })}
        </SwipePager>
      </Stack>
    );
  }
  return (
    <MasterDetail
      mobile={!!mobile}
      showList={showList}
      showRight={showRight}
      list={
        <>
  <Stack p="sm" gap="xs">
    <Group justify="space-between">
      <Title order={4}>Komunikaty do grup</Title>
      <ActionIcon variant="light" size="lg" radius="xl" onClick={() => { setOpenId(null); setComposing(true); }} aria-label="Nowy komunikat">
        <IconPlus size={18} />
      </ActionIcon>
    </Group>
    <SegmentedControl
      size="xs"
      fullWidth
      value={archive ? "a" : "w"}
      onChange={(v) => {
        setArchive(v === "a");
        back();
      }}
      data={[
        { value: "w", label: "Aktywne" },
        { value: "a", label: "Archiwum" },
      ]}
    />
    <TextInput size="xs" aria-label="Szukaj komunikatów" placeholder="Szukaj: temat lub odbiorcy" leftSection={<IconSearch size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
    <SegmentedControl
      size="xs"
      fullWidth
      value={status}
      onChange={setStatus}
      data={[
        { value: "", label: "Wszystkie" },
        { value: "open", label: "W toku" },
        { value: "done", label: "Zakończone" },
      ]}
    />
  </Stack>
  <ScrollArea style={{ flex: 1 }}>
    {list.isLoading && <Loading />}
    {!list.isLoading && rows.length === 0 && (
      q.trim() || status ? (
        <EmptyState
          search
          title={q.trim() ? `Brak wyników dla „${q.trim()}”` : "Brak komunikatów w tym filtrze"}
          text="Sprawdź pisownię albo pokaż wszystkie komunikaty."
          action={{ label: "Wyczyść wyszukiwanie i filtr", onClick: () => { setQ(""); setStatus(""); } }}
        />
      ) : archive ? (
        <EmptyState title="Archiwum jest puste" text="Zakończone komunikaty trafiają tu po archiwizacji albo po 30 dniach bez ruchu." />
      ) : (
        <EmptyState
          title="Nie wysłano jeszcze komunikatów"
          text="Komunikat trafia do wszystkich aktywnych pracowników wybranej agencji lub wydziału."
          action={{ label: "Nowy komunikat", onClick: () => { setOpenId(null); setComposing(true); } }}
        />
      )
    )}
    {rows.map((x) => (
      <UnstyledButton
        key={x.id}
        w="100%"
        p="sm"
        onClick={() => {
          setComposing(false);
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
              <Text size="sm" fw={600} lineClamp={1}>
                {x.subject}
              </Text>
              <Text size="xs" c="dimmed">
                {shortTime(x.created_at)}
              </Text>
            </Group>
            <Group justify="space-between" wrap="nowrap" gap={4}>
              <Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>
                {x.target}
              </Text>
              <Badge size="xs" variant="light" color={x.read >= x.total ? "teal" : "gray"}>
                {x.read}/{x.total}
              </Badge>
            </Group>
          </Box>
        </Group>
      </UnstyledButton>
    ))}
  </ScrollArea>
        </>
      }
      detail={
        <>
  {composing && mobile ? (
    mobileComposer
  ) : composing ? (
    <>
      <Group p="sm" gap="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--apt-line)" }}>
        {mobile && (
          <ActionIcon variant="subtle" onClick={back} aria-label="Wróć">
            <IconArrowLeft size={18} />
          </ActionIcon>
        )}
        <Text fw={600}>Nowy komunikat</Text>
      </Group>
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack pb="md">
          <Text c="dimmed" size="sm">
            Wiadomość do wszystkich aktywnych pracowników agencji lub wydziału. Pracownik dostaje powiadomienie i e-mail w swoim
            języku, czyta komunikat w aplikacji i potwierdza przeczytanie.
          </Text>
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
          <SegmentedControl
            value={kind}
            onChange={(v) => setKind(v as "info" | "document")}
            data={[
              { value: "info", label: "Komunikat" },
              { value: "document", label: "Dokument do zapoznania się" },
            ]}
          />
          <TextInput label="Temat" maxLength={80} value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Textarea label={files.length ? "Treść (opcjonalna – dokument będzie widoczny w komunikacie)" : "Treść"} autosize minRows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <FileInput
            label="Dokumenty (PDF, JPG, PNG – do 5 plików, po 15 MB). Pracownik zobaczy je otwarte w aplikacji, bez pobierania."
            placeholder="Dodaj pliki"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            clearable
            value={files}
            onChange={(v) => setFiles((v ?? []).slice(0, 5))}
          />
        </Stack>
      </ScrollArea>
      <Group p="sm" justify="space-between" style={{ borderTop: "1px solid var(--apt-line)" }}>
        <Text size="xs" c="dimmed">
          {!hasTarget
            ? "Wybierz agencję, wydział albo „Wszyscy”."
            : preview.data && preview.data.total === 0
            ? "Brak aktywnych pracowników w tej grupie – wybierz inną."
            : !subject.trim()
            ? "Wpisz temat komunikatu."
            : kind === "document" && files.length === 0
            ? "Dokument do zapoznania się wymaga pliku."
            : !body.trim() && files.length === 0
            ? "Dodaj treść albo dokument."
            : ""}
        </Text>
        <Button
          disabled={!canSend}
          loading={send.isPending}
          onClick={() => {
            confirm({ title: "Wysłać komunikat?", message: `Komunikat „${subject.trim()}” trafi do ${preview.data?.total ?? 0} osób. Tej operacji nie da się cofnąć.`, confirmLabel: "Wyślij" }).then((ok) => ok && send.mutate());
          }}
        >
          Wyślij
        </Button>
      </Group>
    </>
  ) : b === null ? (
    <Stack h="100%" align="center" justify="center">
      <Text c="dimmed">Wybierz komunikat lub dodaj nowy („+”)</Text>
    </Stack>
  ) : mobile ? (
    <Stack gap={16}>
      <Segments
        value={tab}
        onChange={(v) => setTab(v === "read" ? "read" : "content")}
        items={[
          { value: "content", label: "Treść" },
          { value: "read", label: `Kto przeczytał · ${b.read}/${b.total}` },
        ]}
      />
      <SwipePager index={tab === "read" ? 1 : 0} onIndex={(i) => setTab(i === 1 ? "read" : "content")}>
        {[
          <Stack key="c" gap={16}>
            {b.body && <Text style={{ whiteSpace: "pre-wrap" }}>{b.body}</Text>}
            <FileDocs files={b.files} staff />
            <Section title="Szczegóły">
              <ListRow title="Odbiorcy" description={b.target} />
              <ListRow title="Wysłał(a)" description={`${b.created_by_name ?? "—"} · ${formatDateTime(b.created_at)}`} />
            </Section>
            <Button
              size="lg"
              fullWidth
              variant="default"
              loading={arch.isPending}
              disabled={!archive && !b.finished}
              onClick={() => arch.mutate({ id: b.id, on: !archive })}
            >
              {archive ? "Przywróć z archiwum" : "Archiwizuj"}
            </Button>
            {!archive && !b.finished && (
              <Text size="sm" c="dimmed">
                Archiwizować można zakończony komunikat: przeczytany przez wszystkich albo starszy niż 3 dni. Po 30 dniach bez ruchu trafia do archiwum sam.
              </Text>
            )}
          </Stack>,
          <RecipientsPane key="r" id={b.id} mobile />,
        ]}
      </SwipePager>
    </Stack>
  ) : (
    <>
      <Group p="sm" gap="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--apt-line)" }}>
        {mobile && (
          <ActionIcon variant="subtle" onClick={back} aria-label="Wróć">
            <IconArrowLeft size={18} />
          </ActionIcon>
        )}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={8} wrap="nowrap" align="center">
            <Text fw={600} lineClamp={2}>
              {b.subject}
            </Text>
            {b.kind === "document" && (
              <Badge size="sm" variant="light" style={{ flexShrink: 0 }}>
                dokument
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {b.target} · {formatDateTime(b.created_at)} · {b.created_by_name ?? "—"}
          </Text>
        </Box>
        <Button
          size="xs"
          variant="default"
          loading={arch.isPending}
          disabled={!archive && !b.finished}
          title={!archive && !b.finished ? "Archiwizować można zakończone komunikaty: przeczytane przez wszystkich albo starsze niż 3 dni." : undefined}
          onClick={() => arch.mutate({ id: b.id, on: !archive })}
        >
          {archive ? "Przywróć" : "Archiwizuj"}
        </Button>
      </Group>
      <Tabs value={tab} onChange={(v) => setTab(v === "read" ? "read" : "content")}>
        <Tabs.List px="sm">
          <Tabs.Tab value="content">Treść</Tabs.Tab>
          <Tabs.Tab value="read">Kto przeczytał ({b.read}/{b.total})</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === "read" ? (
        <RecipientsPane id={b.id} />
      ) : (
        <ScrollArea style={{ flex: 1 }} p="md">
          <Stack gap="md" pb="md">
            {b.body && <Text style={{ whiteSpace: "pre-wrap" }}>{b.body}</Text>}
            <FileDocs files={b.files} staff />
            {!archive && (
              <Text size="xs" c="dimmed">
                Komunikat jest zakończony, gdy przeczytali go wszyscy albo minęły 3 dni; zakończony możesz zarchiwizować ręcznie
                (pracownik archiwizuje u siebie osobno), a po 30 dniach bez ruchu trafia do archiwum obu stron.
              </Text>
            )}
          </Stack>
        </ScrollArea>
      )}
    </>
  )}
        </>
      }
    />
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
  });
  const arch = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => api(`/me/broadcasts/${v.id}/archive?on=${v.on}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      refresh();
      if (v.on || view === "archive") setOpenId(null);
    },
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
    <MasterDetail
      mobile={!!mobile}
      showList={showList}
      showRight={showRight}
      list={
        <>
  <Stack p={mobile ? 0 : "sm"} gap="md" pb={mobile ? "md" : undefined}>
    {mobile ? (
      <PageHead title={t("Komunikaty")} subtitle={view === "active" && rows.some((x) => !x.read_at) ? `${rows.filter((x) => !x.read_at).length} ${t("nieprzeczytane")}` : undefined} />
    ) : (
      <Title order={4}>{t("Komunikaty")}</Title>
    )}
    {mobile ? (
      <Segments
        value={view}
        onChange={(v) => {
          stop();
          setView(v as "active" | "archive");
          setOpenId(null);
        }}
        items={[
          { value: "active", label: t("Aktywne") },
          { value: "archive", label: t("Archiwum") },
        ]}
      />
    ) : (
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
    )}
  </Stack>
  <ScrollArea style={{ flex: 1 }}>
    {q.isLoading && <Loading />}
    {!q.isLoading && rows.length === 0 && (
      <EmptyState
        title={view === "archive" ? t("Archiwum jest puste") : t("Brak komunikatów")}
        text={
          view === "archive"
            ? t("Zarchiwizowane komunikaty pojawią się tutaj.")
            : t("Kadry nie wysłały jeszcze komunikatu. Gdy coś się pojawi, dostaniesz powiadomienie.")
        }
      />
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
              <Text size={mobile ? "md" : "sm"} fw={x.read_at ? 500 : 700} lineClamp={1}>
                {x.subject}
              </Text>
              <Text size="xs" c="dimmed">
                {shortTime(x.sent_at)}
              </Text>
            </Group>
            <Group justify="space-between" wrap="nowrap" gap={4}>
              <Text size={mobile ? "sm" : "xs"} c="dimmed" lineClamp={1} style={{ flex: 1 }}>
                {x.body || (x.files.length ? x.files[0].name : "")}
              </Text>
              {!x.read_at ? (
                <Badge size="xs" circle aria-label="Nieprzeczytane" />
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
        </>
      }
      detail={
        <>
  {m === null ? (
    <Stack h="100%" align="center" justify="center">
      <Text c="dimmed">{t("Wybierz komunikat")}</Text>
    </Stack>
  ) : (
    <>
      <Group p="sm" gap="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--apt-line)" }}>
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
      <Box p="sm" style={{ borderTop: "1px solid var(--apt-line)" }}>
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
        </>
      }
    />
  );
}
