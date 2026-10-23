import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, Code, Group, Loader, Pagination, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";

import { ACTION_LABELS, api, ApiError, formatDateTime, type AuditEntry, type Page } from "../api";

const PAGE_SIZE = 50;

function describe(e: AuditEntry): string {
  const d = e.details ?? {};
  switch (e.action) {
    case "user_created":
      return `login: ${String(d.username ?? "")}, rola: ${String(d.role ?? "")}`;
    case "login_failed":
      if (d.reason === "unknown") return "nieznany login";
      if (d.reason === "inactive") return "konto wyłączone";
      return d.locked ? "błędne hasło – konto zablokowane" : `błędne hasło (${String(d.failed_count ?? "")})`;
    default:
      return e.details ? JSON.stringify(e.details) : "";
  }
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [debouncedUsername] = useDebouncedValue(username, 300);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (action) params.set("action", action);
  if (debouncedUsername.trim()) params.set("username", debouncedUsername.trim());
  if (dateFrom) params.set("date_from", new Date(`${dateFrom}T00:00:00`).toISOString());
  if (dateTo) {
    const end = new Date(`${dateTo}T00:00:00`);
    end.setDate(end.getDate() + 1);
    params.set("date_to", end.toISOString());
  }

  const actions = useQuery({ queryKey: ["audit-actions"], queryFn: () => api<string[]>("/audit/actions") });
  const log = useQuery({
    queryKey: ["audit", params.toString()],
    queryFn: () => api<Page<AuditEntry>>(`/audit?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <Stack>
      <Title order={2}>Dziennik zdarzeń</Title>
      <Group align="flex-end">
        <Select
          label="Zdarzenie"
          placeholder="Wszystkie"
          clearable
          w={260}
          data={(actions.data ?? []).map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))}
          value={action}
          onChange={resetPage(setAction)}
        />
        <TextInput
          label="Użytkownik"
          placeholder="login"
          value={username}
          onChange={(e) => {
            setUsername(e.currentTarget.value);
            setPage(1);
          }}
        />
        <TextInput label="Od" type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.currentTarget.value)} />
        <TextInput label="Do" type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.currentTarget.value)} />
      </Group>

      {log.isLoading && <Loader />}
      {log.error && <Alert color="red">{log.error instanceof ApiError ? log.error.message : "Błąd"}</Alert>}

      {log.data && (
        <>
          <Text size="sm" c="dimmed">
            Znaleziono: {log.data.total}
          </Text>
          <Table.ScrollContainer minWidth={800}>
            <Table striped verticalSpacing="xs" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Czas</Table.Th>
                  <Table.Th>Użytkownik</Table.Th>
                  <Table.Th>Zdarzenie</Table.Th>
                  <Table.Th>Obiekt</Table.Th>
                  <Table.Th>Szczegóły</Table.Th>
                  <Table.Th>IP</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {log.data.items.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDateTime(e.ts)}</Table.Td>
                    <Table.Td>{e.username ?? "—"}</Table.Td>
                    <Table.Td>{ACTION_LABELS[e.action] ?? e.action}</Table.Td>
                    <Table.Td>{e.entity_type ? `${e.entity_type} #${e.entity_id}` : "—"}</Table.Td>
                    <Table.Td maw={360}>
                      <Text size="xs" lineClamp={2}>
                        {describe(e)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{e.ip ? <Code>{e.ip}</Code> : "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {log.data.total > PAGE_SIZE && (
            <Pagination total={Math.ceil(log.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          )}
        </>
      )}
    </Stack>
  );
}
