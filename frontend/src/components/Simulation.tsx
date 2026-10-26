import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Group, Menu, Select, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUserCog } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth";
import { api, errorText, ROLE_LABELS, type DictionaryItem, type Me, type Role } from "../api";

function useSimulate(onDone?: () => void) {
  const { setMe } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (role: Role | null, agency_id: number | null = null, department_id: number | null = null) => {
    try {
      const me = await api<Me>("/auth/simulate", { method: "POST", body: { role, agency_id, department_id } });
      onDone?.();
      setMe(me);
      qc.clear();
      navigate("/");
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    }
  };
}

/** Wybór symulowanej roli w menu użytkownika (tylko administrator). */
export function SimulationMenu({ onDone }: { onDone?: () => void }) {
  const { me } = useAuth();
  const simulate = useSimulate(onDone);
  const isManager = me?.sim_role === "manager";
  const [pickAgency, setPickAgency] = useState(false);
  const agencies = useQuery({
    queryKey: ["agencies"],
    queryFn: () => api<DictionaryItem[]>("/agencies"),
    enabled: isManager || pickAgency || me?.sim_role === "agency",
  });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments"), enabled: isManager });
  if (me?.real_role !== "admin") return null;
  const scope = me.sim_agency_id ? `a:${me.sim_agency_id}` : me.sim_department_id ? `d:${me.sim_department_id}` : null;
  return (
    <>
      <Menu.Label>Symuluj uprawnienia</Menu.Label>
      <Box px="xs" pb="xs">
        <Select
          size="xs"
          leftSection={<IconUserCog size={14} />}
          value={pickAgency ? "agency" : (me.sim_role ?? "admin")}
          onChange={(v) => {
            if (!v) return;
            if (v === "agency") return setPickAgency(true); // najpierw wybór APT
            setPickAgency(false);
            simulate(v === "admin" ? null : (v as Role));
          }}
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          data={(["admin", "hr", "manager", "viewer", "agency"] as Role[]).map((r) => ({
            value: r,
            label: r === "admin" ? "Administrator (bez symulacji)" : ROLE_LABELS[r],
          }))}
        />
        {(pickAgency || me.sim_role === "agency") && (
          <Select
            mt={6}
            size="xs"
            placeholder="Wybierz APT agencji"
            value={me.sim_role === "agency" && me.sim_agency_id ? String(me.sim_agency_id) : null}
            comboboxProps={{ withinPortal: false }}
            onChange={(v) => {
              if (!v) return;
              setPickAgency(false);
              simulate("agency", Number(v));
            }}
            data={(agencies.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          />
        )}
        {isManager && (
          <Select
            mt={6}
            size="xs"
            placeholder="Zakres kierownika: brak"
            value={scope}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(v) =>
              simulate("manager", v?.startsWith("a:") ? Number(v.slice(2)) : null, v?.startsWith("d:") ? Number(v.slice(2)) : null)
            }
            data={[
              { group: "APT", items: (agencies.data ?? []).map((a) => ({ value: `a:${a.id}`, label: a.name })) },
              { group: "Wydział", items: (departments.data ?? []).map((d) => ({ value: `d:${d.id}`, label: d.name })) },
            ]}
          />
        )}
      </Box>
      <Menu.Divider />
    </>
  );
}

/** Pasek nad treścią, gdy administrator symuluje inną rolę. */
export function SimulationBanner() {
  const { me } = useAuth();
  const simulate = useSimulate();
  const agencies = useQuery({
    queryKey: ["agencies"],
    queryFn: () => api<DictionaryItem[]>("/agencies"),
    enabled: me?.sim_role === "agency",
  });
  const agencyName = agencies.data?.find((a) => a.id === me?.sim_agency_id)?.name;
  if (me?.real_role !== "admin" || !me.sim_role) return null;
  return (
    <Alert color="orange" variant="filled" radius={0} py={6} mb="md" style={{ position: "sticky", top: 0, zIndex: 50 }}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" fw={500}>
          Symulujesz uprawnienia: {ROLE_LABELS[me.sim_role as Role]}
          {me.sim_role === "manager" && !me.sim_agency_id && !me.sim_department_id && " (bez zakresu – nie widzi pracowników)"}
          {me.sim_role === "agency" && agencyName && ` – ${agencyName}`}
          . Działania zapisują się w dzienniku jako Twoje.
        </Text>
        <Button size="compact-xs" variant="white" color="orange" onClick={() => simulate(null)}>
          Zakończ symulację
        </Button>
      </Group>
    </Alert>
  );
}
