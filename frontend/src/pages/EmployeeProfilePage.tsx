import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconArrowLeft,
  IconCamera,
  IconDots,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPrinter,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react";

import {
  ACTION_LABELS,
  api,
  errorText,
  FIELD_LABELS,
  formatDate,
  formatDateTime,
  type AuditEntry,
  type Employee,
} from "../api";
import { useAuth } from "../auth";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { PhotoEditor } from "../components/PhotoEditor";
import { PrintCardsModal } from "../components/PrintCardsModal";
import { DocumentsCard } from "../components/DocumentsCard";
import { TrainingsCard } from "../components/TrainingsCard";

const PESEL_VISIBLE_SECONDS = 30;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.04em" }}>
        {label}
      </Text>
      <Text component="div">{children}</Text>
    </div>
  );
}

function historyText(entry: AuditEntry): string {
  const d = entry.details ?? {};
  if (entry.action === "employee_updated") {
    const changes = (d.changes ?? {}) as Record<string, unknown>;
    return Object.keys(changes)
      .map((k) => FIELD_LABELS[k] ?? k)
      .join(", ");
  }
  if (entry.action === "employee_terminated") return `data zwolnienia: ${formatDate(String(d.termination_date))}`;
  return "";
}

function PeselValue({ employee }: { employee: Employee }) {
  const [pesel, setPesel] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const reveal = useMutation({
    mutationFn: () => api<{ pesel: string }>(`/employees/${employee.id}/pesel`, { method: "POST" }),
    onSuccess: (r) => {
      setPesel(r.pesel);
      setLeft(PESEL_VISIBLE_SECONDS);
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });

  useEffect(() => {
    if (!pesel) return;
    if (left <= 0) {
      setPesel(null);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [pesel, left]);

  if (!employee.has_pesel) return <Text c="dimmed">brak</Text>;
  return (
    <Group gap="xs">
      <Code fz="md">{pesel ?? employee.pesel_masked}</Code>
      {pesel ? (
        <Button size="compact-xs" variant="subtle" leftSection={<IconEyeOff size={14} />} onClick={() => setPesel(null)}>
          Ukryj ({left} s)
        </Button>
      ) : (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconEye size={14} />}
          loading={reveal.isPending}
          onClick={() => reveal.mutate()}
          title="Odczyt zostanie zapisany w dzienniku zdarzeń"
        >
          Pokaż
        </Button>
      )}
    </Group>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const canEdit = hasRole("admin", "hr", "manager");

  const employee = useQuery({ queryKey: ["employee", id], queryFn: () => api<Employee>(`/employees/${id}`) });
  const history = useQuery({
    queryKey: ["employee-history", id],
    queryFn: () => api<AuditEntry[]>(`/employees/${id}/history`),
    enabled: staff,
  });

  const [photoOpen, setPhotoOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminationDate, setTerminationDate] = useState(new Date().toISOString().slice(0, 10));

  const refresh = (e: Employee) => {
    qc.setQueryData(["employee", id], e);
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["employee-history", id] });
  };

  const terminate = useMutation({
    mutationFn: () =>
      api<Employee>(`/employees/${id}/terminate`, { method: "POST", body: { termination_date: terminationDate } }),
    onSuccess: (e) => {
      refresh(e);
      setTerminateOpen(false);
      notifications.show({ color: "green", message: "Pracownik przeniesiony do archiwum." });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });
  const restore = useMutation({
    mutationFn: () => api<Employee>(`/employees/${id}/restore`, { method: "POST" }),
    onSuccess: (e) => {
      refresh(e);
      notifications.show({ color: "green", message: "Pracownik przywrócony z archiwum." });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });
  const deletePhoto = useMutation({
    mutationFn: () => api(`/employees/${id}/photo`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee", id] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-history", id] });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });

  if (employee.isLoading) return <Loader />;
  if (employee.error || !employee.data)
    return <Alert color="red">{employee.error ? errorText(employee.error) : "Brak danych."}</Alert>;
  const e = employee.data;

  return (
    <Stack maw={1000}>
      <Anchor component={Link} to="/pracownicy" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Lista pracowników
        </Group>
      </Anchor>

      <Card withBorder padding="lg">
        <Group align="flex-start" gap="xl" wrap="wrap">
          <Stack gap="xs" align="center">
            <EmployeePhoto employee={e} width={150} />
            {staff && (
              <Group gap={4}>
                <Button size="compact-sm" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setPhotoOpen(true)}>
                  {e.has_photo ? "Zmień" : "Dodaj zdjęcie"}
                </Button>
                {e.has_photo && (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="red"
                    aria-label="Usuń zdjęcie"
                    loading={deletePhoto.isPending}
                    onClick={() => deletePhoto.mutate()}
                  >
                    <IconTrash size={14} />
                  </Button>
                )}
              </Group>
            )}
          </Stack>

          <Stack gap={6} style={{ flex: 1, minWidth: 260 }}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={2}>
                  {e.last_name} {e.first_name}
                </Title>
                <Group gap="xs" mt={4}>
                  <Text c="dimmed">Nr ewidencyjny</Text>
                  <Code fz="md">{e.number_display}</Code>
                  {e.status === "active" ? (
                    <Badge color="green" variant="light">
                      aktywny
                    </Badge>
                  ) : (
                    <Badge color="gray">archiwum od {formatDate(e.termination_date)}</Badge>
                  )}
                  {e.retention_until && (
                    <Tooltip
                      label={
                        e.retention_hold_until
                          ? "Usunięcie wstrzymane przez administratora"
                          : "Po tej dacie administrator usunie dane trwale (okres przechowywania)"
                      }
                    >
                      <Badge color={e.retention_hold_until ? "orange" : "gray"} variant="outline">
                        przechowywane do {formatDate(e.retention_until)}
                      </Badge>
                    </Tooltip>
                  )}
                </Group>
              </div>
              <Group gap="xs">
                {canEdit && (
                  <Button component={Link} to={`/pracownicy/${e.id}/edycja`} leftSection={<IconPencil size={16} />}>
                    Edytuj
                  </Button>
                )}
                {canEdit && (
                  <Button variant="light" leftSection={<IconPrinter size={16} />} onClick={() => setPrintOpen(true)}>
                    Drukuj kartę
                  </Button>
                )}
                {staff && (
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <Button variant="default" px="xs" aria-label="Więcej akcji">
                        <IconDots size={16} />
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {e.status === "active" ? (
                        <Menu.Item leftSection={<IconArchive size={16} />} onClick={() => setTerminateOpen(true)}>
                          Przenieś do archiwum (zwolnienie)
                        </Menu.Item>
                      ) : (
                        <Menu.Item leftSection={<IconRestore size={16} />} onClick={() => restore.mutate()}>
                          Przywróć z archiwum
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} mt="md" spacing="md" verticalSpacing="md">
              <Field label="APT">{e.agency?.name ?? "—"}</Field>
              <Field label="Wydział">{e.department?.name ?? "—"}</Field>
              <Field label="Stanowisko">{e.position?.name ?? "—"}</Field>
              <Field label="Data zatrudnienia">{formatDate(e.hire_date)}</Field>
              {e.personal_data_visible ? (
                <>
                  <Field label="PESEL">
                    <PeselValue employee={e} />
                  </Field>
                  <Field label="Data urodzenia">
                    {formatDate(e.birth_date)}
                    {e.age !== null && <Text span c="dimmed"> ({e.age} lat)</Text>}
                  </Field>
                </>
              ) : (
                <Field label="Wiek">{e.age !== null ? `${e.age} lat` : "—"}</Field>
              )}
              <Field label="Obywatelstwo">{e.country?.name ?? "—"}</Field>
              <Field label="Płeć">{e.sex === "K" ? "kobieta" : e.sex === "M" ? "mężczyzna" : "—"}</Field>
            </SimpleGrid>
          </Stack>
        </Group>
      </Card>

      {e.notes && (
        <Card withBorder padding="lg">
          <Title order={5} mb={4}>
            Uwagi
          </Title>
          <Text style={{ whiteSpace: "pre-wrap" }}>{e.notes}</Text>
        </Card>
      )}

      {canEdit && <DocumentsCard employee={e} />}

      <TrainingsCard employee={e} />

      {staff && (
        <Card withBorder padding="lg">
          <Title order={5} mb="md">
            Historia zmian
          </Title>
          {history.isLoading && <Loader size="sm" />}
          {history.data && history.data.length === 0 && <Text c="dimmed">Brak wpisów.</Text>}
          {history.data && history.data.length > 0 && (
            <Timeline bulletSize={12} lineWidth={2}>
              {history.data.map((h) => (
                <Timeline.Item key={h.id} title={ACTION_LABELS[h.action] ?? h.action}>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(h.ts)} · {h.username ?? "—"}
                  </Text>
                  {historyText(h) && <Text size="sm">{historyText(h)}</Text>}
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </Card>
      )}

      {staff && <PhotoEditor employee={e} opened={photoOpen} onClose={() => setPhotoOpen(false)} />}
      {canEdit && <PrintCardsModal ids={[e.id]} opened={printOpen} onClose={() => setPrintOpen(false)} />}

      <Modal opened={terminateOpen} onClose={() => setTerminateOpen(false)} title="Przeniesienie do archiwum">
        <Stack>
          <Text size="sm">
            Pracownik zniknie z listy aktywnych. Dane zostaną zachowane w archiwum i będzie można je przywrócić.
            Po okresie przechowywania (10 lat od końca roku zwolnienia) administrator usunie je trwale.
          </Text>
          <TextInput
            label="Data zwolnienia"
            type="date"
            required
            value={terminationDate}
            onChange={(ev) => setTerminationDate(ev.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTerminateOpen(false)}>
              Anuluj
            </Button>
            <Button color="red" loading={terminate.isPending} disabled={!terminationDate} onClick={() => terminate.mutate()}>
              Przenieś do archiwum
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
