import { useQuery } from "@tanstack/react-query";
import { Anchor, Skeleton, Text } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, formatDate, type Employee, type GeneratedDoc } from "../api";
import { EmployeePhoto } from "./EmployeePhoto";
import type { ChecklistItem } from "./Lifecycle";

/**
 * Kolumna kontekstu przy rozmowie (komputer ≥ 1600 px): kto pisze, co wymaga uwagi, ostatnie dokumenty –
 * kadry odpowiadają bez przełączania się na kartę pracownika.
 */
export function EmployeeAside({ employeeId, threadId }: { employeeId: number; threadId: number }) {
  const e = useQuery({ queryKey: ["employee", String(employeeId)], queryFn: () => api<Employee>(`/employees/${employeeId}`) });
  const checklists = useQuery({
    queryKey: ["employee-checklists", employeeId],
    queryFn: () => api<{ onboarding: ChecklistItem[]; offboarding: ChecklistItem[] }>(`/employees/${employeeId}/checklists`),
  });
  const docs = useQuery({ queryKey: ["documents", employeeId], queryFn: () => api<GeneratedDoc[]>(`/employees/${employeeId}/documents`) });
  const reqs = useQuery({
    queryKey: ["employee-requirements", employeeId],
    queryFn: () => api<{ label: string; state: string }[]>(`/employees/${employeeId}/requirements`),
  });
  if (!e.data)
    return (
      <div aria-busy="true" aria-label="Ładowanie">
        <Skeleton height={72} width={56} mb="sm" />
        <Skeleton height={12} width="70%" mb={8} />
        <Skeleton height={10} width="50%" />
      </div>
    );
  const emp = e.data;
  const overdue = [...(checklists.data?.onboarding ?? []), ...(checklists.data?.offboarding ?? [])].filter((i) => i.state === "overdue").length;
  const pending = (docs.data ?? []).filter((d) => d.signature_pending && !d.signed_at);
  const gaps = (reqs.data ?? []).filter((r) => r.state === "missing" || r.state === "expired");
  const attention = [
    overdue ? `${overdue === 1 ? "1 zadanie" : `${overdue} zadania`} z checklisty po terminie` : null,
    ...pending.map((d) => `${d.template_name} – czeka na podpis`),
    gaps.length ? `Brak szkoleń wymaganych na stanowisku: ${gaps.length}` : null,
  ].filter(Boolean) as string[];
  const place = [emp.position?.name, emp.department?.name, emp.agency?.name].filter(Boolean).join(" · ");
  return (
    <div key={threadId}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 56, flex: "none" }}>
          <EmployeePhoto employee={emp} width={56} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>
            {emp.last_name} {emp.first_name}
          </Text>
          <Text size="sm" c="dimmed" className="ui-mono">
            {emp.number_display}
          </Text>
          {place && (
            <Text size="sm" c="dimmed">
              {place}
            </Text>
          )}
        </div>
      </div>
      {attention.length > 0 && (
        <div className="ui-aside-sec">
          <h3>Wymaga uwagi</h3>
          {attention.map((a) => (
            <div key={a} className="ui-aside-row ui-warn">
              {a}
            </div>
          ))}
        </div>
      )}
      {(docs.data?.length ?? 0) > 0 && (
        <div className="ui-aside-sec">
          <h3>Ostatnie dokumenty</h3>
          {docs.data!.slice(0, 3).map((d) => (
            <div key={d.id} className="ui-aside-row">
              {d.template_name}
              <Text size="xs" c="dimmed">
                {formatDate(d.created_at.slice(0, 10))}
                {d.signed_at ? " · podpisany" : d.signature_pending ? " · czeka na podpis" : ""}
              </Text>
            </div>
          ))}
        </div>
      )}
      <div className="ui-aside-sec">
        <Anchor component={Link} to={`/pracownicy/${employeeId}`} fw={600} size="sm">
          Otwórz kartę pracownika
        </Anchor>
      </div>
    </div>
  );
}
