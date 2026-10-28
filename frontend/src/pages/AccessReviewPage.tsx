import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Group, Loader, SegmentedControl, Select, Stack, Table, Text, Title } from "@mantine/core";

import { api, errorText, formatDateTime, ROLE_LABELS, type Role } from "../api";

interface UserReview {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  email: string | null;
  last_login_at: string | null;
  days_since_login: number | null;
  mfa: boolean;
  passkeys: number;
  scope: string[];
  flags: string[];
}
interface PeselReport {
  days: number;
  total: number;
  users: { username: string; views: number; employees: number; last_at: string }[];
  recent: { ts: string; username: string | null; employee_id: string | null; number: string | null }[];
}

function UsersTab() {
  const q = useQuery({ queryKey: ["access-users"], queryFn: () => api<UserReview[]>("/access-review/users") });
  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  const attention = rows.filter((r) => r.flags.some((f) => f !== "pełne uprawnienia")).length;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {rows.length} kont funkcyjnych, {attention} wymaga uwagi (konta pracowników są w „Kontach pracowników”).
      </Text>
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Użytkownik</Table.Th>
              <Table.Th>Rola</Table.Th>
              <Table.Th>Zakres</Table.Th>
              <Table.Th>Ostatnie logowanie</Table.Th>
              <Table.Th>Zabezpieczenia</Table.Th>
              <Table.Th>Uwagi</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {r.full_name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.username}
                    {!r.is_active ? " · wyłączone" : ""}
                  </Text>
                </Table.Td>
                <Table.Td>{ROLE_LABELS[r.role] ?? r.role}</Table.Td>
                <Table.Td>
                  <Text size="xs">{r.scope.length ? r.scope.join(", ") : r.role === "manager" ? "brak (nic nie widzi)" : "—"}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.last_login_at ? formatDateTime(r.last_login_at) : "—"}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Badge variant="light" color={r.mfa ? "teal" : "gray"}>
                      2FA {r.mfa ? "tak" : "nie"}
                    </Badge>
                    {r.passkeys > 0 && (
                      <Badge variant="light" color="teal">
                        klucze: {r.passkeys}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {r.flags.map((f) => (
                      <Badge key={f} variant="light" color={f === "pełne uprawnienia" ? "blue" : "orange"}>
                        {f}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function PeselTab() {
  const [days, setDays] = useState("30");
  const q = useQuery({ queryKey: ["access-pesel", days], queryFn: () => api<PeselReport>(`/access-review/pesel?days=${days}`) });
  return (
    <Stack>
      <Group>
        <Select
          label="Okres"
          w={200}
          allowDeselect={false}
          value={days}
          onChange={(v) => v && setDays(v)}
          data={[
            { value: "7", label: "Ostatnie 7 dni" },
            { value: "30", label: "Ostatnie 30 dni" },
            { value: "90", label: "Ostatnie 90 dni" },
            { value: "365", label: "Ostatni rok" },
          ]}
        />
      </Group>
      {q.isLoading && <Loader />}
      {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
      {q.data && (
        <>
          <Text size="sm" c="dimmed">
            Odsłonięć pełnego PESEL w tym okresie: <b>{q.data.total}</b>. Każde odsłonięcie jest zapisane w dzienniku zdarzeń.
          </Text>
          {q.data.users.length > 0 && (
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Użytkownik</Table.Th>
                  <Table.Th>Odsłonięć</Table.Th>
                  <Table.Th>Różnych pracowników</Table.Th>
                  <Table.Th>Ostatnio</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.users.map((u) => (
                  <Table.Tr key={u.username}>
                    <Table.Td>{u.username}</Table.Td>
                    <Table.Td>{u.views}</Table.Td>
                    <Table.Td>{u.employees}</Table.Td>
                    <Table.Td>{formatDateTime(u.last_at)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {q.data.recent.length > 0 && (
            <>
              <Title order={5}>Ostatnie odsłonięcia</Title>
              <Table verticalSpacing={4}>
                <Table.Tbody>
                  {q.data.recent.map((e, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{formatDateTime(e.ts)}</Table.Td>
                      <Table.Td>{e.username}</Table.Td>
                      <Table.Td>pracownik nr {e.number ?? e.employee_id}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
          {q.data.total === 0 && <Text size="sm">Nikt nie odsłaniał PESEL w tym okresie.</Text>}
        </>
      )}
    </Stack>
  );
}

export function AccessReviewPage() {
  const [tab, setTab] = useState("users");
  return (
    <Stack>
      <Title order={2}>Przegląd dostępu</Title>
      <SegmentedControl
        w="fit-content"
        value={tab}
        onChange={setTab}
        data={[
          { value: "users", label: "Uprawnienia kont" },
          { value: "pesel", label: "Dostęp do PESEL" },
        ]}
      />
      {tab === "users" ? <UsersTab /> : <PeselTab />}
    </Stack>
  );
}
