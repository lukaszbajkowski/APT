import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Anchor, Badge, Card, Checkbox, Group, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { IconCheck, IconCircleCheck, IconDotsVertical, IconUser } from "@tabler/icons-react";

import { api, formatDate } from "../api";
import { useAuth } from "../auth";
import { ChecklistTemplates, RESPONSIBLE, type ChecklistItem } from "../components/Lifecycle";
import { ErrorState, Loading } from "../components/States";
import { ActionSheet, CompactEmpty, GroupLabel, PageHead, Segments, SwipePager, PageTitle } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

interface Task extends ChecklistItem {
  employee_id: number;
  employee: string;
  number: string;
  department: string | null;
}

export function TasksPage({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const { hasRole } = useAuth();
  const mobile = useIsPhone();
  const [mine, setMine] = useState(hasRole("manager") ? "mine" : "all");
  // licznik w nagłówku – ta sama lista co w tabeli (wspólna pamięć zapytań)
  const tasks = useQuery({
    queryKey: ["tasks", mine],
    queryFn: () => api<Task[]>(`/tasks${mine === "mine" ? "?mine=true" : ""}`),
    enabled: !mobile && !settingsOnly,
  });
  const openCount = tasks.data?.length;
  const lateCount = tasks.data?.filter((t) => t.state === "overdue").length ?? 0;
  if (mobile && settingsOnly) return <ChecklistTemplates />;
  if (mobile)
    return (
      <Stack gap="md">
        <PageHead
          title="Zadania"
          subtitle="Checklisty wdrożenia i odejścia"
        />
        <OpenTasks />
      </Stack>
    );
  if (settingsOnly)
    return (
      <Stack maw={1760}>
        <ChecklistTemplates
          page={{
            title: "Checklisty",
            description: "Zadania tworzone przy zatrudnieniu i odejściu – dla wszystkich albo wybranych APT i wydziałów. Otwarte zadania są w „Dziś”.",
          }}
        />
      </Stack>
    );
  return (
    <Stack maw={1760} className="ui-emp">
      <PageTitle
        title="Zadania"
        meta={openCount !== undefined ? `Otwartych ${openCount}${lateCount ? ` · Po terminie ${lateCount}` : ""}` : undefined}
        description="Pozycje z ⚡ odhaczą się same, np. po wydruku karty lub wpisaniu szkolenia."
      />
      {/* ustawienia checklist są w „Checklisty” – tu tylko otwarte zadania, przełącznik „Moje / Wszystkie” */}
      <Group align="center" justify="flex-end" gap={10} className="ui-emp-search-row">
        <SegmentedControl
          value={mine}
          onChange={setMine}
          aria-label="Czyje zadania"
          data={[
            { value: "mine", label: hasRole("manager") ? "Moje (kierownik)" : "Moje (HR)" },
            { value: "all", label: "Wszystkie" },
          ]}
        />
      </Group>
      <OpenTasks mine={mine} />
    </Stack>
  );
}

function OpenTasks({ mine: mineProp }: { mine?: string } = {}) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const [mineOwn, setMine] = useState(hasRole("manager") ? "mine" : "all");
  // komputer: „Moje / Wszystkie” jest w nagłówku ekranu (jak w Pracownikach) – wartość przychodzi z góry
  const mine = mineProp ?? mineOwn;
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
  const mobile = useIsPhone();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Task | null>(null);
  // telefon: obie zakładki wczytane od razu – przesuwanie pokazuje gotową treść
  const other = useQuery({
    queryKey: ["tasks", mine === "mine" ? "all" : "mine"],
    queryFn: () => api<Task[]>(`/tasks${mine === "mine" ? "" : "?mine=true"}`),
    enabled: !!mobile,
  });

  if (mobile) {
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
          value={mine}
          onChange={setMine}
          items={[
            { value: "mine", label: hasRole("manager") ? "Moje" : "Moje (HR)" },
            { value: "all", label: "Wszystkie" },
          ]}
        />
        <SwipePager index={mine === "mine" ? 0 : 1} onIndex={(i) => setMine(i === 0 ? "mine" : "all")}>
          {(["mine", "all"] as const).map((v) => {
            const src = v === mine ? q : other;
            const list = src.data ?? [];
            const late = list.filter((t) => t.state === "overdue");
            const rest = list.filter((t) => t.state !== "overdue");
            return (
              <Stack key={v} gap="md">
                {src.isLoading && <Loading rows={3} />}
                {src.error && <ErrorState error={src.error} onRetry={() => src.refetch()} />}
                {src.data && list.length === 0 && <CompactEmpty title="Brak otwartych zadań" text="Wszystko zrobione." />}
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
              </Stack>
            );
          })}
        </SwipePager>
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
    <Stack>
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
