import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, Modal, SegmentedControl, Select, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerStop, IconVolume } from "@tabler/icons-react";

import { api, errorText, formatDateTime, type DictionaryItem } from "../api";
import { useAuth } from "../auth";
import { useT } from "../lib/i18n";
import { canSpeak, speak, speechLang, stopSpeaking } from "../lib/speech";

interface Broadcast {
  id: number;
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

export function BroadcastsPage() {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const list = useQuery({ queryKey: ["broadcasts"], queryFn: () => api<Broadcast[]>("/broadcasts") });
  const [agency, setAgency] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
  const [kind, setKind] = useState<"info" | "document">("info");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const target = { agency_id: agency ? Number(agency) : null, department_id: dept ? Number(dept) : null, everyone };
  const hasTarget = !!(agency || dept || everyone);
  const preview = useQuery({
    queryKey: ["bc-preview", agency, dept, everyone],
    queryFn: () => api<Preview>("/broadcasts/preview", { method: "POST", body: target }),
    enabled: hasTarget,
  });
  const send = useMutation({
    mutationFn: () => api<Broadcast>("/broadcasts", { method: "POST", body: { ...target, kind, subject, body } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      notifications.show({ color: "green", message: "Komunikat wysłany." });
      setSubject("");
      setBody("");
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
          <Textarea label="Treść" autosize minRows={4} maxLength={kind === "document" ? 20000 : 2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button
              disabled={!hasTarget || !subject.trim() || !body.trim() || !preview.data?.total}
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
      <Title order={4}>Wysłane</Title>
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
                <Button size="compact-xs" variant="light" onClick={() => setOpen(b.id)}>
                  Przeczytało {b.read} z {b.total}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {open !== null && <Recipients id={open} onClose={() => setOpen(null)} />}
    </Stack>
  );
}

interface Mine {
  id: number;
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
  const q = useQuery({ queryKey: ["my-broadcasts"], queryFn: () => api<Mine[]>("/me/broadcasts") });
  const read = useMutation({
    mutationFn: (id: number) => api(`/me/broadcasts/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-broadcasts"] });
      qc.invalidateQueries({ queryKey: ["my-bc-count"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  return (
    <Stack maw={760}>
      <Title order={2}>{t("Komunikaty")}</Title>
      {q.isLoading && <Loader size="sm" />}
      {q.data && q.data.length === 0 && <Text c="dimmed">{t("Brak komunikatów.")}</Text>}
      {(q.data ?? []).map((m) => (
        <Card key={m.id} withBorder padding="md">
          <Group justify="space-between" mb={4}>
            <Text fw={600}>{m.subject}</Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(m.sent_at)}
            </Text>
          </Group>
          <Text style={{ whiteSpace: "pre-wrap" }}>{m.body}</Text>
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
