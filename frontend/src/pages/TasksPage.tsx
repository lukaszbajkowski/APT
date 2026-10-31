import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Checkbox, Group, SegmentedControl, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCircleCheck } from "@tabler/icons-react";

import { api, errorText, formatDate } from "../api";
import { useAuth } from "../auth";
import { ChecklistTemplates, RESPONSIBLE, type ChecklistItem } from "../components/Lifecycle";
import { Loading } from "../components/States";

interface Task extends ChecklistItem {
  employee_id: number;
  employee: string;
  number: string;
  department: string | null;
}

export function TasksPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  return (
    <Stack maw={1300}>
      <div>
        <Title order={2}>Zadania</Title>
        <Text c="dimmed" size="sm">
          Checklisty wdrożenia i odejścia. Odhaczasz tutaj albo w kartotece pracownika. Pozycje z ⚡ odhaczą się same (np. po wydruku
          karty lub wpisaniu szkolenia).
        </Text>
      </div>
      <Tabs defaultValue="open" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="open">Otwarte zadania</Tabs.Tab>
          {staff && <Tabs.Tab value="settings">Ustawienia checklist</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="open">
          <OpenTasks />
        </Tabs.Panel>
        {staff && (
          <Tabs.Panel value="settings">
            <ChecklistTemplates />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

function OpenTasks() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const [mine, setMine] = useState(hasRole("manager") ? "mine" : "all");
  const q = useQuery({
    queryKey: ["tasks", mine],
    queryFn: () => api<Task[]>(`/tasks${mine === "mine" ? "?mine=true" : ""}`),
  });
  const done = useMutation({
    mutationFn: (id: number) => api(`/checklist-items/${id}`, { method: "PATCH", body: { done: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["employee-checklists"] });
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming"] });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const rows = q.data ?? [];
  const overdue = rows.filter((t) => t.state === "overdue").length;

  return (
    <Stack maw={1100}>
      <Group justify="space-between">
        <SegmentedControl
          value={mine}
          onChange={setMine}
          data={[
            { value: "mine", label: hasRole("manager") ? "Moje (kierownik)" : "Moje (HR)" },
            { value: "all", label: "Wszystkie" },
          ]}
        />
        {rows.length > 0 && (
          <Text size="sm" c={overdue ? "red" : "dimmed"}>
            Otwartych: {rows.length}
            {overdue ? ` · po terminie: ${overdue}` : ""}
          </Text>
        )}
      </Group>
      {q.isLoading && <Loading />}
      {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
      {q.data && rows.length === 0 && (
        <Alert color="green" icon={<IconCircleCheck />}>
          Brak otwartych zadań.
        </Alert>
      )}
      {rows.length > 0 && (
        <Card withBorder padding={0}>
          <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Zadanie</Table.Th>
                <Table.Th>Pracownik</Table.Th>
                <Table.Th ta="right">Termin</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Checkbox
                      aria-label={`Zrobione: ${t.label}`}
                      disabled={!t.can_edit || done.isPending}
                      checked={false}
                      onChange={() => done.mutate(t.id)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {t.label} {t.auto ? "⚡" : ""}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.kind === "onboarding" ? "Wdrożenie" : "Odejście"} · {RESPONSIBLE[t.responsible]}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={`/pracownicy/${t.employee_id}`} size="sm">
                      {t.employee}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      nr {t.number}
                      {t.department ? ` · ${t.department}` : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{formatDate(t.due_date)}</Text>
                    {t.state === "overdue" && (
                      <Badge color="red" variant="light" size="sm">
                        po terminie
                      </Badge>
                    )}
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
