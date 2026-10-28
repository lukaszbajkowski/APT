import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Paper, Select, Stack, Text, Textarea, Title } from "@mantine/core";
import { IconArrowLeft, IconSend } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";

export interface ThreadRow {
  id: number;
  subject: string;
  status: "new" | "in_progress" | "done";
  updated_at: string;
  last_from_staff: boolean;
  preview: string;
  employee_id: number | null;
  employee_name: string | null;
  employee_number: string | null;
}
interface Thread {
  id: number;
  subject: string;
  status: ThreadRow["status"];
  messages: { id: number; from_staff: boolean; body: string; created_at: string }[];
  employee_name: string | null;
  employee_number: string | null;
}

export const THREAD_STATUS: Record<ThreadRow["status"], { label: string; color: string }> = {
  new: { label: "nowa", color: "blue" },
  in_progress: { label: "w toku", color: "yellow" },
  done: { label: "zakończona", color: "green" },
};

/** Podgląd wątku z odpowiedzią. base: /me/messages (pracownik) albo /hr-messages (kadry). */
export function ThreadView({ base, id, staff, onBack }: { base: string; id: number; staff: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["thread", base, id], queryFn: () => api<Thread>(`${base}/${id}`) });
  const refresh = (t: Thread) => {
    qc.setQueryData(["thread", base, id], t);
    qc.invalidateQueries({ queryKey: ["threads", base] });
    qc.invalidateQueries({ queryKey: ["hr-count"] });
  };
  const send = useMutation({
    mutationFn: () => api<Thread>(`${base}/${id}/messages`, { method: "POST", body: { body } }),
    onSuccess: (t) => {
      setBody("");
      setError(null);
      refresh(t);
    },
    onError: (e) => setError(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api<Thread>(`${base}/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });
  const t = q.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>
          Wróć
        </Button>
        {t && <Badge color={THREAD_STATUS[t.status].color}>{THREAD_STATUS[t.status].label}</Badge>}
      </Group>
      {t && (
        <>
          <Title order={4}>
            {t.subject}
            {staff && t.employee_name ? ` – ${t.employee_name} (${t.employee_number})` : ""}
          </Title>
          <Stack gap="xs">
            {t.messages.map((m) => {
              const mine = m.from_staff === staff;
              return (
                <Paper key={m.id} withBorder p="sm" bg={mine ? "var(--mantine-color-blue-light)" : undefined} ml={mine ? "xl" : 0} mr={mine ? 0 : "xl"}>
                  <Text size="xs" c="dimmed">
                    {m.from_staff ? "Kadry" : staff ? (t.employee_name ?? "Pracownik") : "Ty"} · {formatDateTime(m.created_at)}
                  </Text>
                  <Text style={{ whiteSpace: "pre-wrap" }}>{m.body}</Text>
                </Paper>
              );
            })}
          </Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Textarea
            placeholder={staff ? "Odpowiedź" : "Dopisz wiadomość"}
            autosize
            minRows={2}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
          />
          <Group>
            <Button leftSection={<IconSend size={16} />} loading={send.isPending} disabled={!body.trim()} onClick={() => send.mutate()}>
              Wyślij
            </Button>
            {staff && t.status !== "done" && (
              <Button variant="default" loading={setStatus.isPending} onClick={() => setStatus.mutate("done")}>
                Oznacz jako zakończoną
              </Button>
            )}
            {staff && t.status === "done" && (
              <Button variant="default" loading={setStatus.isPending} onClick={() => setStatus.mutate("in_progress")}>
                Otwórz ponownie
              </Button>
            )}
          </Group>
        </>
      )}
    </Stack>
  );
}

/** Karta pracownika „Napisz do kadr”. */
export function WriteToHrCard() {
  const qc = useQueryClient();
  const base = "/me/messages";
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["threads", base], queryFn: () => api<ThreadRow[]>(base) });
  const subjects = useQuery({ queryKey: ["thread-subjects"], queryFn: () => api<string[]>(`${base}/subjects`) });
  const create = useMutation({
    mutationFn: () => api<{ id: number }>(base, { method: "POST", body: { subject, body } }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["threads", base] });
      setComposing(false);
      setSubject(null);
      setBody("");
      setError(null);
      setOpenId(t.id);
    },
    onError: (e) => setError(errorText(e)),
  });

  if (openId !== null)
    return (
      <Card withBorder padding="lg">
        <ThreadView base={base} id={openId} staff={false} onBack={() => setOpenId(null)} />
      </Card>
    );
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Napisz do kadr</Title>
        {!composing && <Button onClick={() => setComposing(true)}>Nowa wiadomość</Button>}
      </Group>
      {composing && (
        <Stack mb="md">
          <Select label="Temat" placeholder="Wybierz" data={subjects.data ?? []} value={subject} onChange={setSubject} />
          <Textarea label="Treść" autosize minRows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          {error && <Alert color="red">{error}</Alert>}
          <Group>
            <Button loading={create.isPending} disabled={!subject || !body.trim()} onClick={() => create.mutate()}>
              Wyślij
            </Button>
            <Button variant="default" onClick={() => setComposing(false)}>
              Anuluj
            </Button>
          </Group>
        </Stack>
      )}
      <Stack gap="xs">
        {list.data?.length === 0 && !composing && <Text size="sm" c="dimmed">Nie masz jeszcze wiadomości.</Text>}
        {list.data?.map((t) => (
          <Paper key={t.id} withBorder p="sm" style={{ cursor: "pointer" }} onClick={() => setOpenId(t.id)}>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={500}>
                {t.subject}
                {t.last_from_staff && t.status !== "done" ? " · odpowiedź kadr" : ""}
              </Text>
              <Badge color={THREAD_STATUS[t.status].color}>{THREAD_STATUS[t.status].label}</Badge>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {formatDateTime(t.updated_at)} · {t.preview}
            </Text>
          </Paper>
        ))}
      </Stack>
    </Card>
  );
}
