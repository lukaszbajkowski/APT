import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Group, Loader, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { THREAD_STATUS, ThreadView, type ThreadRow } from "../components/HrThreads";

export function HrMessagesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["threads", "/hr-messages", q, status],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status_filter", status);
      return api<ThreadRow[]>(`/hr-messages?${p.toString()}`);
    },
    refetchInterval: 60_000,
  });
  if (openId !== null)
    return (
      <Stack maw={720}>
        <ThreadView base="/hr-messages" id={openId} staff onBack={() => setOpenId(null)} />
      </Stack>
    );
  return (
    <Stack>
      <Title order={2}>Wiadomości od pracowników</Title>
      <Group>
        <TextInput
          placeholder="Szukaj: nazwisko, imię lub temat"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          style={{ flex: "1 1 240px", maxWidth: 360 }}
        />
        <SegmentedControl
          value={status}
          onChange={setStatus}
          data={[
            { value: "", label: "Wszystkie" },
            { value: "new", label: "Nowe" },
            { value: "in_progress", label: "W toku" },
            { value: "done", label: "Zakończone" },
          ]}
        />
      </Group>
      {list.isLoading && <Loader />}
      {list.error && <Alert color="red">{errorText(list.error)}</Alert>}
      {list.data && list.data.length === 0 && <Text c="dimmed">Brak wiadomości.</Text>}
      {list.data && list.data.length > 0 && (
        <Table.ScrollContainer minWidth={560}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pracownik</Table.Th>
                <Table.Th>Temat</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Ostatnia zmiana</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.map((t) => (
                <Table.Tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(t.id)}>
                  <Table.Td>
                    {t.employee_name}
                    <Text size="xs" c="dimmed">
                      {t.employee_number}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {t.subject}
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {t.preview}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={THREAD_STATUS[t.status].color}>{THREAD_STATUS[t.status].label}</Badge>
                  </Table.Td>
                  <Table.Td>{formatDateTime(t.updated_at)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
