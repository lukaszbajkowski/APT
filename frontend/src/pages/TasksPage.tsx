import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Badge, Card, Checkbox, Group, SegmentedControl, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { IconAdjustmentsHorizontal, IconCheck, IconCircleCheck, IconDotsVertical, IconListCheck, IconUser } from "@tabler/icons-react";

import { api, formatDate } from "../api";
import { useAuth } from "../auth";
import { ChecklistTemplates, RESPONSIBLE, type ChecklistItem } from "../components/Lifecycle";
import { ErrorState, Loading } from "../components/States";
import { ActionSheet, CompactEmpty, GroupLabel, PageHead, Segments } from "../components/Mobile";

interface Task extends ChecklistItem {
  employee_id: number;
  employee: string;
  number: string;
  department: string | null;
}

export function TasksPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [settings, setSettings] = useState(false);
  if (mobile)
    return (
      <Stack gap="md">
        <PageHead
          title={settings ? "Ustawienia checklist" : "Zadania"}
          subtitle={settings ? "Szablony wdrożenia i odejścia" : "Checklisty wdrożenia i odejścia"}
          action={
            staff
              ? settings
                ? { label: "Wróć do zadań", icon: <IconListCheck size={20} />, variant: "outline", onClick: () => setSettings(false) }
                : { label: "Ustawienia checklist", icon: <IconAdjustmentsHorizontal size={20} />, variant: "outline", onClick: () => setSettings(true) }
              : undefined
          }
        />
        {settings ? <ChecklistTemplates /> : <OpenTasks />}
      </Stack>
    );
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
  });
  const rows = q.data ?? [];
  const overdue = rows.filter((t) => t.state === "overdue").length;
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Task | null>(null);

  if (mobile) {
    const late = rows.filter((t) => t.state === "overdue");
    const rest = rows.filter((t) => t.state !== "overdue");
    const row = (t: Task) => (
      <div key={t.id} className="ui-task">
        <Checkbox
          size="md"
          aria-label={`Zrobione: ${t.label}`}
          disabled={!t.can_edit || done.isPending}
          checked={false}
          onChange={() => done.mutate(t.id)}
          style={{ padding: 10, flex: "none" }}
        />
        <span className="ui-row-text">
          <span className="ui-row-title">{t.label}</span>
          <span className="ui-row-desc">
            <Link to={`/pracownicy/${t.employee_id}`} className="ui-link-strong">
              {t.employee}
            </Link>
            <span data-warn={t.state === "overdue" || undefined} className="ui-due"> · termin {formatDate(t.due_date)}</span>
          </span>
        </span>
        <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Akcje: ${t.label}`} onClick={() => setSheet(t)}>
          <IconDotsVertical size={20} />
        </ActionIcon>
      </div>
    );
    return (
      <Stack gap="md">
        <Segments
          swipe
          value={mine}
          onChange={setMine}
          items={[
            { value: "mine", label: hasRole("manager") ? "Moje" : "Moje (HR)" },
            { value: "all", label: "Wszystkie" },
          ]}
        />
        {q.isLoading && <Loading rows={3} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && rows.length === 0 && <CompactEmpty title="Brak otwartych zadań" text="Wszystko zrobione." />}
        {late.length > 0 && (
          <>
            <GroupLabel warn>Po terminie · {late.length}</GroupLabel>
            <div className="ui-group">{late.map(row)}</div>
          </>
        )}
        {rest.length > 0 && (
          <>
            <GroupLabel>Najbliższe</GroupLabel>
            <div className="ui-group">{rest.map(row)}</div>
          </>
        )}
        <ActionSheet
          opened={!!sheet}
          onClose={() => setSheet(null)}
          title={sheet?.label ?? ""}
          subtitle={sheet ? `${sheet.kind === "onboarding" ? "Wdrożenie" : "Odejście"} · ${RESPONSIBLE[sheet.responsible]} · ${sheet.employee}` : undefined}
          actions={
            sheet
              ? [
                  ...(sheet.can_edit ? [{ label: "Oznacz jako zrobione", icon: <IconCheck size={20} />, onClick: () => done.mutate(sheet.id) }] : []),
                  { label: "Otwórz kartę pracownika", icon: <IconUser size={20} />, onClick: () => navigate(`/pracownicy/${sheet.employee_id}`) },
                ]
              : []
          }
        />
      </Stack>
    );
  }

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
          <Text size="sm" c={overdue ? "orange" : "dimmed"}>
            Otwartych: {rows.length}
            {overdue ? ` · po terminie: ${overdue}` : ""}
          </Text>
        )}
      </Group>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
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
                      <Badge color="orange" variant="light" size="sm">
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
