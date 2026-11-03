import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Group, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { useMediaQuery } from "@mantine/hooks";
import { CompactEmpty, ListRow, PageHead, Segments, StatusBadge, SwipePager } from "../components/Mobile";

interface Row {
  employee_id: number;
  number: string;
  name: string;
  username: string;
  status: "pending" | "active" | "disabled";
  has_passkey: boolean;
  invite_pending: boolean;
  last_login_at: string | null;
}

const STATUS: Record<Row["status"], { label: string; color: string }> = {
  active: { label: "Aktywne", color: "green" },
  pending: { label: "Czeka na aktywację", color: "yellow" },
  disabled: { label: "Wyłączone", color: "gray" },
};

export function EmployeeAccountsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const list = useQuery({
    enabled: !mobile,
    queryKey: ["employee-accounts", q, status],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status_filter", status);
      return api<Row[]>(`/employee-accounts?${p.toString()}`);
    },
  });

  // telefon: jedna lista bez filtra statusu – każda zakładka filtruje ją u siebie, więc sąsiednia jest gotowa przy przesuwaniu
  const all = useQuery({
    queryKey: ["employee-accounts", q, "all"],
    queryFn: () => api<Row[]>(`/employee-accounts?${new URLSearchParams(q.trim() ? { q: q.trim() } : {}).toString()}`),
    enabled: !!mobile,
  });
  if (mobile) {
    const TONE = { active: "ok", pending: "wait", disabled: "neutral" } as const;
    const SHORT = { active: "Aktywne", pending: "Czeka", disabled: "Wyłączone" } as const;
    const TABS = [
      { value: "", label: "Wszystkie" },
      { value: "pending", label: "Czekają" },
      { value: "active", label: "Aktywne" },
      { value: "disabled", label: "Wyłączone" },
    ];
    return (
      <Stack gap={16}>
        <PageHead title="Konta pracowników" subtitle="Zaproszenie i reset dostępu – w karcie pracownika" />
        <TextInput
          aria-label="Szukaj konta"
          placeholder="Nazwisko, imię lub login"
          leftSection={<IconSearch size={18} aria-hidden />}
          size="md"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Segments value={status} onChange={setStatus} items={TABS} />
        {all.isError && <ErrorState error={all.error} onRetry={() => all.refetch()} />}
        {all.isLoading && <Loading />}
        {all.data && (
          <SwipePager index={TABS.findIndex((t) => t.value === status)} onIndex={(i) => setStatus(TABS[i].value)}>
            {TABS.map((tab) => {
              const rows = all.data.filter((r) => !tab.value || r.status === tab.value);
              return rows.length === 0 ? (
                <CompactEmpty
                  key={tab.value}
                  title={q.trim() ? `Brak wyników dla „${q.trim()}”` : tab.value ? `Brak kont: ${tab.label.toLowerCase()}` : "Brak kont"}
                  text={q.trim() ? "Sprawdź pisownię albo wybierz „Wszystkie”." : "Zaproszenie wyślesz z karty pracownika."}
                />
              ) : (
                <div key={tab.value} className="ui-group">
                  {rows.map((r) => (
                    <ListRow
                      key={r.employee_id}
                      to={`/pracownicy/${r.employee_id}?tab=konto`}
                      title={r.name}
                      description={[`nr ${r.number}`, r.username, r.status === "pending" && r.invite_pending ? "zaproszenie wysłane" : r.last_login_at ? `ostatnio ${formatDateTime(r.last_login_at)}` : null].filter(Boolean).join(" · ")}
                      trailing={<StatusBadge tone={TONE[r.status]}>{SHORT[r.status]}</StatusBadge>}
                    />
                  ))}
                </div>
              );
            })}
          </SwipePager>
        )}
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={2}>Konta pracowników</Title>
      <Text size="sm" c="dimmed">
        Zaproszenia, reset dostępu i wyłączenie konta wykonasz w karcie pracownika.
      </Text>
      <Group>
        <TextInput
          aria-label="Szukaj konta"
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
      {list.isLoading && <Loading />}
      {list.data && (
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover>
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
                    <Anchor component={Link} to={`/pracownicy/${r.employee_id}?tab=konto`}>
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
                    {r.has_passkey ? "Klucz dostępu" : "—"}
                  </Table.Td>
                  <Table.Td>{r.last_login_at ? formatDateTime(r.last_login_at) : "—"}</Table.Td>
                </Table.Tr>
              ))}
              {list.data.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <EmptyState compact title="Brak kont"
          text="Zaproszenie wyślesz z karty pracownika." />
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
