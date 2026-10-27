import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Group, Loader, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";

interface Row {
  employee_id: number;
  number: string;
  name: string;
  username: string;
  status: "pending" | "active" | "disabled";
  has_passkey: boolean;
  has_password: boolean;
  invite_pending: boolean;
  last_login_at: string | null;
}

const STATUS: Record<Row["status"], { label: string; color: string }> = {
  active: { label: "aktywne", color: "green" },
  pending: { label: "czeka na aktywację", color: "yellow" },
  disabled: { label: "wyłączone", color: "gray" },
};

export function EmployeeAccountsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["employee-accounts", q, status],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status_filter", status);
      return api<Row[]>(`/employee-accounts?${p.toString()}`);
    },
  });

  return (
    <Stack>
      <Title order={2}>Konta pracowników</Title>
      <Text size="sm" c="dimmed">
        Zaproszenia, reset dostępu i wyłączenie konta wykonasz w karcie pracownika.
      </Text>
      <Group>
        <TextInput
          placeholder="Szukaj: nazwisko, imię lub login"
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
            { value: "pending", label: "Czekają" },
            { value: "active", label: "Aktywne" },
            { value: "disabled", label: "Wyłączone" },
          ]}
        />
      </Group>
      {list.isError && <Alert color="red">{errorText(list.error)}</Alert>}
      {list.isLoading && <Loader />}
      {list.data && (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pracownik</Table.Th>
                <Table.Th>Login</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Logowanie</Table.Th>
                <Table.Th>Ostatnio</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.map((r) => (
                <Table.Tr key={r.employee_id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                      {r.name}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      nr {r.number}
                    </Text>
                  </Table.Td>
                  <Table.Td>{r.username}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge>
                    {r.status === "pending" && r.invite_pending && (
                      <Text size="xs" c="dimmed">
                        zaproszenie wysłane
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {[r.has_passkey && "klucz dostępu", r.has_password && "hasło + kod"].filter(Boolean).join(", ") || "—"}
                  </Table.Td>
                  <Table.Td>{r.last_login_at ? formatDateTime(r.last_login_at) : "—"}</Table.Td>
                </Table.Tr>
              ))}
              {list.data.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center">
                      Brak kont. Zaproszenie wyślesz z karty pracownika.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
