import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, errorText, formatDate, type PermitRow } from "../api";
import { PERMIT_STATE } from "../components/Permits";
import { Loading } from "../components/States";

export function PermitsReportPage() {
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: ["permits-report", all],
    queryFn: () => api<PermitRow[]>(`/permits/report?only_problems=${all ? "false" : "true"}`),
  });
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
      {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
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
