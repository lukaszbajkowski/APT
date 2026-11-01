import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, formatDate, type PermitRow } from "../api";
import { PERMIT_STATE } from "../components/Permits";
import { ErrorState, Loading } from "../components/States";
import { useMediaQuery } from "@mantine/hooks";
import { CompactEmpty, ListRow, PageHead, Segments, StatusBadge, SwipePager, cap } from "../components/Mobile";

export function PermitsReportPage() {
  const [all, setAll] = useState(false);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const q = useQuery({
    queryKey: ["permits-report", all],
    queryFn: () => api<PermitRow[]>(`/permits/report?only_problems=${all ? "false" : "true"}`),
  });
  if (mobile) return <PermitsMobile all={all} setAll={setAll} />;
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Dokumenty pobytowe i zezwolenia</Title>
          <Text c="dimmed" size="sm">
            Nieważne i kończące się w ciągu 60 dni (aktywni pracownicy). Przypomnienie e-mail przychodzi w poniedziałki.
          </Text>
        </div>
        <Switch label="Pokaż także ważne" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
      </Group>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <Alert color="teal">Nic nie wymaga uwagi.</Alert>}
      {q.data && q.data.length > 0 && (
        <Card withBorder padding="sm">
          <Table verticalSpacing={6} fz="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pracownik</Table.Th>
                <Table.Th>Dokument</Table.Th>
                <Table.Th>Ważny do</Table.Th>
                <Table.Th>Stan</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {q.data.map((r, i) => (
                <Table.Tr key={`${r.employee_id}-${r.kind_label}-${i}`}>
                  <Table.Td>
                    <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                      {r.employee}
                    </Anchor>{" "}
                    <Text span size="xs" c="dimmed">
                      nr {r.number}
                    </Text>
                  </Table.Td>
                  <Table.Td>{r.kind_label}</Table.Td>
                  <Table.Td>{formatDate(r.valid_until)}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={PERMIT_STATE[r.state].color}>
                      {r.days_left < 0 ? `po terminie ${-r.days_left} dni` : `za ${r.days_left} dni`}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

function PermitsList({ all }: { all: boolean }) {
  const q = useQuery({
    queryKey: ["permits-report", all],
    queryFn: () => api<PermitRow[]>(`/permits/report?only_problems=${all ? "false" : "true"}`),
  });
  return (
    <Stack gap="md">
      {q.isLoading && <Loading rows={3} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <CompactEmpty title={all ? "Brak dokumentów pobytowych" : "Nic nie wymaga uwagi"} />}
      {q.data && q.data.length > 0 && (
        <div className="ui-group">
          {q.data.map((r, i) => (
            <ListRow
              key={`${r.employee_id}-${r.kind_label}-${i}`}
              to={`/pracownicy/${r.employee_id}`}
              title={r.employee}
              description={
                <>
                  {cap(r.kind_label)} · nr {r.number}
                  <br />
                  <StatusBadge tone={r.state === "expired" ? "error" : r.state === "expiring" ? "warn" : "ok"}>
                    {r.state === "expired" ? `Nieważny od ${formatDate(r.valid_until)}` : r.state === "expiring" ? `Kończy się ${formatDate(r.valid_until)}` : `Ważny do ${formatDate(r.valid_until)}`}
                  </StatusBadge>
                </>
              }
            />
          ))}
        </div>
      )}
      <Text size="sm" c="dimmed">
        Przypomnienie e-mail przychodzi w poniedziałki.
      </Text>
    </Stack>
  );
}

function PermitsMobile({ all, setAll }: { all: boolean; setAll: (v: boolean) => void }) {
  const problems = useQuery({ queryKey: ["permits-report", false], queryFn: () => api<PermitRow[]>(`/permits/report?only_problems=true`) });
  return (
    <Stack gap="md">
      <PageHead title="Dokumenty pobytowe" subtitle="Nieważne i kończące się w 60 dni" />
      <Segments
        value={all ? "all" : "problems"}
        onChange={(v) => setAll(v === "all")}
        items={[
          { value: "problems", label: problems.data ? `Wymagają uwagi · ${problems.data.length}` : "Wymagają uwagi" },
          { value: "all", label: "Wszystkie" },
        ]}
      />
      <SwipePager index={all ? 1 : 0} onIndex={(i) => setAll(i === 1)}>
        {[<PermitsList key="p" all={false} />, <PermitsList key="a" all />]}
      </SwipePager>
    </Stack>
  );
}
