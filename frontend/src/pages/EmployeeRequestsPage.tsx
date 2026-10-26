import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { ApiError, api, errorText, formatDate, formatDateTime, type EmployeeRequest } from "../api";
import { options, useCountries, useDepartments, usePositions } from "../dictionaries";

const STATUS: Record<EmployeeRequest["status"], { label: string; color: string }> = {
  pending: { label: "czeka na kadry", color: "orange" },
  approved: { label: "zatwierdzone", color: "teal" },
  rejected: { label: "odrzucone", color: "red" },
};

interface FormValues {
  first_name: string;
  last_name: string;
  pesel: string;
  country_id: string | null;
  department_id: string | null;
  position_id: string | null;
  hire_date: string;
  notes: string;
}
const EMPTY: FormValues = {
  first_name: "",
  last_name: "",
  pesel: "",
  country_id: null,
  department_id: null,
  position_id: null,
  hire_date: "",
  notes: "",
};

function PersonFields({ v, set, notes = true }: { v: FormValues; set: (v: FormValues) => void; notes?: boolean }) {
  const countries = useCountries();
  const departments = useDepartments();
  const positions = usePositions();
  const num = (x: string | null) => (x ? Number(x) : null);
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Imię" required value={v.first_name} onChange={(e) => set({ ...v, first_name: e.currentTarget.value })} />
        <TextInput label="Nazwisko" required value={v.last_name} onChange={(e) => set({ ...v, last_name: e.currentTarget.value })} />
        <TextInput
          label="PESEL"
          inputMode="numeric"
          maxLength={11}
          value={v.pesel}
          onChange={(e) => set({ ...v, pesel: e.currentTarget.value.replace(/\D/g, "") })}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", letterSpacing: 1 } }}
        />
        <Select label="Obywatelstwo" searchable clearable data={options(countries.data, num(v.country_id))} value={v.country_id} onChange={(x) => set({ ...v, country_id: x })} />
        <Select
          label="Wydział"
          searchable
          clearable
          data={options(departments.data, num(v.department_id))}
          value={v.department_id}
          onChange={(x) => set({ ...v, department_id: x, position_id: null })}
        />
        <Select
          label="Stanowisko"
          searchable
          clearable
          data={options(positions.data, num(v.position_id), (p) => !p.department_id || !v.department_id || p.department_id === num(v.department_id))}
          value={v.position_id}
          onChange={(x) => set({ ...v, position_id: x })}
        />
        <TextInput label="Data rozpoczęcia pracy" type="date" value={v.hire_date} onChange={(e) => set({ ...v, hire_date: e.currentTarget.value })} />
      </SimpleGrid>
      {notes && (
        <Textarea label="Uwagi dla kadr" autosize minRows={2} maxLength={1000} value={v.notes} onChange={(e) => set({ ...v, notes: e.currentTarget.value })} />
      )}
    </Stack>
  );
}

function body(v: FormValues) {
  return {
    first_name: v.first_name,
    last_name: v.last_name,
    pesel: v.pesel || null,
    country_id: v.country_id ? Number(v.country_id) : null,
    department_id: v.department_id ? Number(v.department_id) : null,
    position_id: v.position_id ? Number(v.position_id) : null,
    hire_date: v.hire_date || null,
    notes: v.notes || null,
  };
}

function NewRequest({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<FormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<EmployeeRequest>("/employee-requests", { method: "POST", body: body(v) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-requests"] });
      notifications.show({ color: "green", message: "Zgłoszenie wysłane do kadr." });
      setV(EMPTY);
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Zgłoś nową osobę" size="lg">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <PersonFields v={v} set={setV} />
          <Text size="xs" c="dimmed">
            Kadry sprawdzą dane i dodadzą osobę do kartoteki. Po zatwierdzeniu zobaczysz ją na liście pracowników i będziesz mógł wgrać
            zdjęcie oraz badania lekarskie.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!v.first_name.trim() || !v.last_name.trim()}>
              Wyślij zgłoszenie
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function Decide({ r, onClose }: { r: EmployeeRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [v, setV] = useState<FormValues>({
    first_name: r.first_name,
    last_name: r.last_name,
    pesel: r.pesel ?? "",
    country_id: r.country_id ? String(r.country_id) : null,
    department_id: r.department_id ? String(r.department_id) : null,
    position_id: r.position_id ? String(r.position_id) : null,
    hire_date: r.hire_date ?? "",
    notes: r.notes ?? "",
  });
  const [reason, setReason] = useState("");
  const [duplicate, setDuplicate] = useState<{ number: string; name: string; id: number } | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["employee-requests"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
    onClose();
  };
  const approve = useMutation({
    mutationFn: () => {
      const b = body(v);
      return api<EmployeeRequest>(`/employee-requests/${r.id}/approve`, {
        method: "POST",
        body: {
          first_name: b.first_name,
          last_name: b.last_name,
          pesel: b.pesel,
          country_id: b.country_id,
          department_id: b.department_id,
          position_id: b.position_id,
          hire_date: b.hire_date,
          confirm_duplicate: confirmDup,
        },
      });
    },
    onSuccess: () => {
      notifications.show({ color: "green", message: "Zatwierdzono – osoba dodana do kartoteki." });
      done();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === "possible_duplicate" || e.code === "pesel_duplicate")) {
        setDuplicate(e.data?.employee as { number: string; name: string; id: number });
      }
      setError(errorText(e));
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`/employee-requests/${r.id}/reject`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: () => {
      notifications.show({ color: "green", message: "Zgłoszenie odrzucone." });
      done();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Modal opened onClose={onClose} title={`Zgłoszenie: ${r.last_name} ${r.first_name} (${r.agency.name})`} size="lg">
      <Stack>
        <SegmentedControl
          value={mode}
          onChange={(x) => setMode(x as "approve" | "reject")}
          data={[
            { value: "approve", label: "Zatwierdź" },
            { value: "reject", label: "Odrzuć" },
          ]}
        />
        {error && <Alert color="red">{error}</Alert>}
        {mode === "approve" ? (
          <>
            <Text size="sm" c="dimmed">
              Sprawdź i w razie potrzeby popraw dane. Po zatwierdzeniu osoba trafi do kartoteki w APT „{r.agency.name}”.
            </Text>
            <PersonFields v={v} set={setV} notes={false} />
            {r.notes && (
              <Alert color="gray" variant="light" title="Uwagi agencji">
                {r.notes}
              </Alert>
            )}
            {duplicate && (
              <Alert color="orange">
                <Stack gap={6}>
                  <Text size="sm">
                    W kartotece jest już podobna osoba:{" "}
                    <Anchor component={Link} to={`/pracownicy/${duplicate.id}`} target="_blank" size="sm">
                      {duplicate.name} ({duplicate.number})
                    </Anchor>
                  </Text>
                  <Checkbox label="To inna osoba – dodaj mimo to" checked={confirmDup} onChange={(e) => setConfirmDup(e.currentTarget.checked)} />
                </Stack>
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Anuluj
              </Button>
              <Button leftSection={<IconCheck size={16} />} color="teal" loading={approve.isPending} onClick={() => approve.mutate()}>
                Zatwierdź i dodaj do kartoteki
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Textarea
              label="Powód odrzucenia"
              description="Agencja zobaczy ten powód przy swoim zgłoszeniu."
              autosize
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Anuluj
              </Button>
              <Button color="red" leftSection={<IconX size={16} />} loading={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
                Odrzuć zgłoszenie
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

export function EmployeeRequestsPage() {
  const { hasRole } = useAuth();
  const isAgency = hasRole("agency");
  const q = useQuery({ queryKey: ["employee-requests"], queryFn: () => api<EmployeeRequest[]>("/employee-requests") });
  const [newOpen, setNewOpen] = useState(false);
  const [deciding, setDeciding] = useState<EmployeeRequest | null>(null);
  const [show, setShow] = useState<"pending" | "all">("pending");
  const rows = (q.data ?? []).filter((r) => show === "all" || r.status === "pending");
  const pending = (q.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Zgłoszenia nowych osób</Title>
          <Text c="dimmed" size="sm">
            {isAgency
              ? "Zgłoś osobę, która ma zacząć pracę – kadry sprawdzą dane i dodadzą ją do kartoteki."
              : "Osoby zgłoszone przez agencje pracy. Zatwierdzenie dodaje osobę do kartoteki (te same kontrole co przy ręcznym dodaniu)."}
          </Text>
        </div>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={show}
            onChange={(x) => setShow(x as "pending" | "all")}
            data={[
              { value: "pending", label: `Oczekujące (${pending})` },
              { value: "all", label: "Wszystkie" },
            ]}
          />
          {isAgency && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setNewOpen(true)}>
              Zgłoś osobę
            </Button>
          )}
        </Group>
      </Group>
      {q.isLoading && <Loader />}
      {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
      {q.data && rows.length === 0 && <Text c="dimmed">{show === "pending" ? "Brak oczekujących zgłoszeń." : "Brak zgłoszeń."}</Text>}
      {rows.length > 0 && (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing="xs" fz="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Osoba</Table.Th>
                  {!isAgency && <Table.Th>APT</Table.Th>}
                  <Table.Th>Start pracy</Table.Th>
                  <Table.Th>Zgłoszono</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {r.employee_id ? (
                          <Anchor component={Link} to={`/pracownicy/${r.employee_id}`} size="sm">
                            {r.last_name} {r.first_name}
                          </Anchor>
                        ) : (
                          `${r.last_name} ${r.first_name}`
                        )}
                      </Text>
                      {r.pesel && (
                        <Text size="xs" c="dimmed" ff="monospace">
                          {r.pesel}
                        </Text>
                      )}
                    </Table.Td>
                    {!isAgency && <Table.Td>{r.agency.name}</Table.Td>}
                    <Table.Td>{formatDate(r.hire_date)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDateTime(r.created_at)}</Text>
                      <Text size="xs" c="dimmed">
                        {r.created_by_name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={STATUS[r.status].color}>
                        {STATUS[r.status].label}
                      </Badge>
                      {r.status === "rejected" && r.reject_reason && (
                        <Text size="xs" c="dimmed" mt={2}>
                          {r.reject_reason}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {!isAgency && r.status === "pending" && (
                        <Button size="compact-sm" variant="light" onClick={() => setDeciding(r)}>
                          Rozpatrz
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {isAgency && <NewRequest opened={newOpen} onClose={() => setNewOpen(false)} />}
      {deciding && <Decide r={deciding} onClose={() => setDeciding(null)} />}
    </Stack>
  );
}
