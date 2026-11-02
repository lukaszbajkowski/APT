import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Group, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { Select } from "../components/AptSelect";

import { notifications } from "@mantine/notifications";

import { useAuth } from "../auth";
import { api, errorText, formatDateTime, ROLE_LABELS, type Role } from "../api";
import { ErrorState, Loading } from "../components/States";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertTriangle } from "@tabler/icons-react";
import { ActionSheet, Chips, CompactEmpty, ListRow, PageHead, PickSheet, Section, Segments, StatusBadge, SwipePager, cap } from "../components/Mobile";
import { useConfirm } from "../lib/confirm";

const useMobile = () => useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
const PERIODS = [
  { value: "7", label: "Ostatnie 7 dni" },
  { value: "30", label: "Ostatnie 30 dni" },
  { value: "90", label: "Ostatnie 90 dni" },
  { value: "365", label: "Ostatni rok" },
];

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
  report_views: { ts: string; username: string | null }[];
  users: { username: string; views: number; employees: number; last_at: string }[];
  recent: { ts: string; username: string | null; employee_id: string | null; number: string | null }[];
}

function UsersTab() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["access-users"], queryFn: () => api<UserReview[]>("/access-review/users") });
  const disable = useMutation({
    mutationFn: (id: number) => api(`/users/${id}`, { method: "PATCH", body: { is_active: false } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-users"] });
      notifications.show({ color: "green", message: "Konto wyłączone." });
    },
  });
  const mobile = useMobile();
  const confirm = useConfirm();
  const [sel, setSel] = useState<UserReview | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  const attention = rows.filter((r) => r.flags.some((f) => f !== "pełne uprawnienia")).length;
  const canDisable = (r: UserReview) => r.is_active && r.id !== me?.user.id && r.flags.some((f) => f.startsWith("brak logowania od") || f.startsWith("nigdy"));
  if (mobile)
    return (
      <Section title={`Konta funkcyjne · ${rows.length}${attention ? ` · wymaga uwagi: ${attention}` : ""}`}>
        {rows.length === 0 && <CompactEmpty title="Brak kont" />}
        {rows.map((r) => {
          const warn = r.flags.filter((f) => f !== "pełne uprawnienia");
          return (
            <ListRow
              key={r.id}
              muted={!r.is_active}
              title={r.full_name}
              description={
                <>
                  {[ROLE_LABELS[r.role] ?? r.role, r.scope.length ? r.scope.join(", ") : null, r.last_login_at ? `ostatnio ${formatDateTime(r.last_login_at)}` : "nigdy się nie logował", `2FA: ${r.mfa ? "tak" : "nie"}`].filter(Boolean).join(" · ")}
                  {warn.length > 0 && (
                    <span className="ui-warn-line">
                      <IconAlertTriangle size={12} stroke={2.6} aria-hidden /> {cap(warn.join(", "))}
                    </span>
                  )}
                </>
              }
              trailing={!r.is_active ? <StatusBadge tone="neutral">Wyłączone</StatusBadge> : warn.length ? <StatusBadge tone="warn">Uwaga</StatusBadge> : <StatusBadge tone="ok">OK</StatusBadge>}
              onClick={canDisable(r) ? () => setSel(r) : undefined}
            />
          );
        })}
        <ActionSheet
          opened={!!sel}
          onClose={() => setSel(null)}
          title={sel?.full_name ?? ""}
          subtitle={sel ? cap(sel.flags.join(", ")) : undefined}
          actions={
            sel
              ? [
                  {
                    label: "Wyłącz konto",
                    description: "Użytkownik nie zaloguje się, dopóki go nie włączysz",
                    danger: true,
                    onClick: () => {
                      const r = sel;
                      confirm({ title: "Wyłączyć konto?", message: `${r.full_name} (${r.username}) nie zaloguje się do aplikacji.`, confirmLabel: "Wyłącz", danger: true }).then((ok) => ok && disable.mutate(r.id));
                    },
                  },
                ]
              : []
          }
        />
      </Section>
    );
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
              <Table.Th />
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
                <Table.Td>
                  {r.is_active && r.id !== me?.user.id && r.flags.some((f) => f.startsWith("brak logowania od") || f.startsWith("nigdy")) && (
                    <Button size="compact-xs" color="red" variant="light" loading={disable.isPending} onClick={() => disable.mutate(r.id)}>
                      Wyłącz konto
                    </Button>
                  )}
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
  const mobile = useMobile();
  const [pick, setPick] = useState(false);
  if (mobile)
    return (
      <Stack gap={24}>
        <Chips items={[{ label: PERIODS.find((p) => p.value === days)?.label ?? days, active: true, menu: true, onClick: () => setPick(true) }]} />
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <>
            <Section title={`Kto odsłaniał PESEL · ${q.data.total}`}>
              {q.data.users.length === 0 ? (
                <CompactEmpty title="Nikt nie odsłaniał PESEL" text="Każde odsłonięcie trafia do dziennika zdarzeń." />
              ) : (
                q.data.users.map((u) => <ListRow key={u.username} title={u.username} description={`Odsłonięć: ${u.views} · pracowników: ${u.employees} · ostatnio ${formatDateTime(u.last_at)}`} />)
              )}
            </Section>
            {q.data.recent.length > 0 && (
              <Section title="Ostatnie odsłonięcia">
                {q.data.recent.map((e, i) => (
                  <ListRow key={i} title={`Pracownik nr ${e.number ?? e.employee_id}`} description={`${formatDateTime(e.ts)} · ${e.username ?? "—"}`} />
                ))}
              </Section>
            )}
            <Section title="Kto oglądał ten raport">
              {q.data.report_views.length === 0 ? (
                <CompactEmpty title="Nikt" />
              ) : (
                q.data.report_views.map((v, i) => <ListRow key={i} title={v.username ?? "—"} description={formatDateTime(v.ts)} />)
              )}
            </Section>
          </>
        )}
        <PickSheet opened={pick} onClose={() => setPick(false)} title="Okres" options={PERIODS} value={[days]} onChange={(v) => v[0] && setDays(v[0])} />
      </Stack>
    );
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
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
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
          <Title order={5}>Kto oglądał ten raport</Title>
          <Text size="xs" c="dimmed">
            Samo zajrzenie do tego raportu też jest zapisywane w dzienniku zdarzeń.
          </Text>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {q.data.report_views.map((v, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{formatDateTime(v.ts)}</Table.Td>
                  <Table.Td>{v.username}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {q.data.total === 0 && <Text size="sm">Nikt nie odsłaniał PESEL w tym okresie.</Text>}
        </>
      )}
    </Stack>
  );
}

export function AccessReviewPage() {
  const [tab, setTab] = useState("users");
  const mobile = useMobile();
  const tabs = [
    { value: "users", label: "Uprawnienia kont" },
    { value: "pesel", label: "Dostęp do PESEL" },
  ];
  if (mobile)
    return (
      <Stack gap={16}>
        <PageHead title="Przegląd dostępu" subtitle="Konta pracowników są w „Kontach pracowników”" />
        <Segments value={tab} onChange={setTab} items={tabs} />
        <SwipePager index={tabs.findIndex((x) => x.value === tab)} onIndex={(i) => setTab(tabs[i].value)}>
          {[<UsersTab key="u" />, <PeselTab key="p" />]}
        </SwipePager>
      </Stack>
    );
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
