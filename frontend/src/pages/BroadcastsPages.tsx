import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, Modal, Select, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { api, errorText, formatDateTime, type DictionaryItem } from "../api";
import { useT } from "../lib/i18n";

interface Broadcast {
  id: number;
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
  const q = useQuery({ queryKey: ["bc-recipients", id], queryFn: () => api<Recipient[]>(`/broadcasts/${id}/recipients`) });
  return (
    <Modal opened onClose={onClose} title="Kto przeczytał" size="md">
      {q.isLoading && <Loader size="sm" />}
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

export function BroadcastsPage() {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const list = useQuery({ queryKey: ["broadcasts"], queryFn: () => api<Broadcast[]>("/broadcasts") });
  const [agency, setAgency] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
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
    mutationFn: () => api<Broadcast>("/broadcasts", { method: "POST", body: { ...target, subject, body } }),
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
          <TextInput label="Temat" maxLength={120} value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Textarea label="Treść" autosize minRows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
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
                <Text fw={500}>{b.subject}</Text>
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
  subject: string;
  body: string;
  sent_at: string;
  read_at: string | null;
}

export function MyBroadcastsPage() {
  const t = useT();
  const qc = useQueryClient();
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
          {!m.read_at ? (
            <Button mt="sm" size="xs" loading={read.isPending} onClick={() => read.mutate(m.id)}>
              {t("Przeczytałem(-am)")}
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
