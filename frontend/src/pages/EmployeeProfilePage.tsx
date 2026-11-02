import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Tabs,
  UnstyledButton,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Menu,
  Modal,
  SimpleGrid,
  Flex,
  Stack,
  Text,
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
  IconUserCheck,
  IconTrash,
  IconMessage,
  IconCheck,
  IconAlertTriangle,
  IconChevronRight,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";

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
import { MedicalExamsCard } from "../components/MedicalExams";
import { PermitsCard } from "../components/Permits";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { PhotoEditor } from "../components/PhotoEditor";
import { PrintCardsModal } from "../components/PrintCardsModal";
import { DocumentsCard } from "../components/DocumentsCard";
import { TrainingsCard } from "../components/TrainingsCard";
import { ChecklistsCard, RehireModal, TimelineCard } from "../components/Lifecycle";
import { MentorProgramsCard } from "../components/MentorPrograms";
import { DataLinkCard } from "../components/DataLinkCard";
import { EmployeeAccountCard } from "../components/EmployeeAccountCard";
import { EmptyState, Loading } from "../components/States";
import { DateField } from "../components/DateField";
import { useConfirm } from "../lib/confirm";
import { ActionSheet, CompactEmpty, InfoRow, ListRow, Section, StatusBadge, useMobileHeader, SwipePager, type SheetAction } from "../components/Mobile";

const PESEL_VISIBLE_SECONDS = 30;

function ContactLine({ employeeId, kind, value }: { employeeId: number; kind: "phone" | "email"; value?: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api(`/employees/${employeeId}/contact/${kind}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee", String(employeeId)] });
      qc.invalidateQueries({ queryKey: ["data-link-status", employeeId] });
    },
  });
  if (!value) return null;
  return (
    <Group gap={6} wrap="nowrap">
      <Text span size="sm">
        {value}
      </Text>
      <Button
        size="compact-xs"
        variant="subtle"
        color="red"
        loading={remove.isPending}
        onClick={() => confirm({ title: "Usunąć dane kontaktowe?", message: `Usunąć ${kind === "phone" ? "telefon" : "e-mail"} z kartoteki? Pracownik może go później podać ponownie.`, confirmLabel: "Usuń", danger: true }).then((ok) => ok && remove.mutate())}
      >
        Usuń
      </Button>
    </Group>
  );
}

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

const HISTORY_SHORT = 5;

export function EmployeeProfilePage() {
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const { id } = useParams();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const canEdit = hasRole("admin", "hr", "manager");
  const isAgency = hasRole("agency");
  const canPhoto = staff || isAgency;

  const employee = useQuery({ queryKey: ["employee", id], queryFn: () => api<Employee>(`/employees/${id}`) });
  const history = useQuery({
    queryKey: ["employee-history", id],
    queryFn: () => api<AuditEntry[]>(`/employees/${id}/history`),
    enabled: staff,
  });

  const [historyAll, setHistoryAll] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [rehireOpen, setRehireOpen] = useState(searchParams.get("rehire") === "1");
  const [moreSheet, setMoreSheet] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [tab, setTab] = useState(() => searchParams.get("tab") ?? "dane");
  useEffect(() => {
    document.querySelector<HTMLElement>('.profile-tabs [role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [tab]);

  const navigate = useNavigate();
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
      qc.invalidateQueries({ queryKey: ["employee-checklists"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      notifications.show({ color: "green", message: "Pracownik przeniesiony do archiwum – utworzono checklistę odejścia." });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });
  const restore = useMutation({
    mutationFn: () => api<Employee>(`/employees/${id}/restore`, { method: "POST" }),
    onSuccess: (e) => {
      refresh(e);
      qc.invalidateQueries({ queryKey: ["employee-checklists"] });
      notifications.show({ color: "green", message: "Cofnięto zwolnienie." });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });
  const askDelete = useConfirm();
  const deletePhoto = useMutation({
    mutationFn: () => api(`/employees/${id}/photo`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee", id] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-history", id] });
    },
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });

  const emp = employee.data;
  const checklists = useQuery({
    queryKey: ["employee-checklists", Number(id)],
    queryFn: () => api<{ onboarding: { state: string }[]; offboarding: { state: string }[] }>(`/employees/${id}/checklists`),
    enabled: mobile && canEdit,
  });
  const docsQ = useQuery({ queryKey: ["documents", Number(id)], queryFn: () => api<unknown[]>(`/employees/${id}/documents`), enabled: mobile && canEdit });
  const reqs = useQuery({
    queryKey: ["employee-requirements", Number(id)],
    queryFn: () => api<{ state: string }[]>(`/employees/${id}/requirements`),
    enabled: mobile && !isAgency,
  });
  const overdueN = [...(checklists.data?.onboarding ?? []), ...(checklists.data?.offboarding ?? [])].filter((x) => x.state === "overdue").length;
  const missingReq = (reqs.data ?? []).filter((r) => r.state === "missing" || r.state === "expired").length;
  useMobileHeader(
    mobile && emp
      ? {
          title: "Pracownik",
          back: "/pracownicy",
          scrolledTitle: `${emp.last_name} ${emp.first_name}`,
          scrolledSubtitle: `nr ${emp.number_display} · ${emp.status === "active" ? "aktywny" : "archiwum"}`,
        }
      : null,
  );

  if (employee.isLoading) return <Loading />;
  if (employee.error || !employee.data)
    return <Alert color="red">{employee.error ? errorText(employee.error) : "Brak danych."}</Alert>;
  const e = employee.data;

  const terminateModal = (
    <>
      <Modal opened={terminateOpen} onClose={() => setTerminateOpen(false)} title="Przeniesienie do archiwum">
        <Stack>
          <Text size="sm">
            Pracownik zniknie z listy aktywnych. Dane zostaną zachowane w archiwum i będzie można je przywrócić.
            Po okresie przechowywania (10 lat od końca roku zwolnienia) administrator usunie je trwale.
          </Text>
          <DateField
            label="Data zwolnienia"
            
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
    </>
  );
  const historyCard = mobile ? (
    staff ? (
      <Section
        title="Historia zmian"
        action={history.data && history.data.length > HISTORY_SHORT ? { label: historyAll ? "Zwiń" : `Wszystkie (${history.data.length})`, onClick: () => setHistoryAll((v) => !v) } : undefined}
      >
        {history.isLoading && <Loading rows={2} />}
        {history.data?.length === 0 && <CompactEmpty title="Brak wpisów" text="Zmiany danych pojawią się po pierwszej edycji." />}
        {(historyAll ? history.data ?? [] : (history.data ?? []).slice(0, HISTORY_SHORT)).map((h) => (
          <ListRow
            key={h.id}
            title={ACTION_LABELS[h.action] ?? h.action}
            description={[formatDateTime(h.ts), h.username ?? "—", historyText(h)].filter(Boolean).join(" · ")}
          />
        ))}
      </Section>
    ) : null
  ) : (
    <>
      {staff && (
        <Card withBorder padding="lg">
          <Title order={5} mb="md">
            Historia zmian
          </Title>
          {history.isLoading && <Loading />}
          {history.data && history.data.length === 0 && <EmptyState compact title="Brak wpisów w historii"
          text="Zmiany danych pracownika pojawią się tutaj po pierwszej edycji." />}
          {history.data && history.data.length > 0 && (
            <Timeline bulletSize={12} lineWidth={2}>
              {(historyAll ? history.data : history.data.slice(0, HISTORY_SHORT)).map((h) => (
                <Timeline.Item key={h.id} title={ACTION_LABELS[h.action] ?? h.action}>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(h.ts)} · {h.username ?? "—"}
                  </Text>
                  {historyText(h) && <Text size="sm">{historyText(h)}</Text>}
                </Timeline.Item>
              ))}
            </Timeline>
          )}
          {history.data && history.data.length > HISTORY_SHORT && (
            <Button variant="subtle" size="xs" mt="sm" onClick={() => setHistoryAll((v) => !v)}>
              {historyAll ? "Zwiń" : `Pokaż wszystkie (${history.data.length})`}
            </Button>
          )}
        </Card>
      )}

    </>
  );
  const modals = (
    <>
      {staff && e.status === "terminated" && <RehireModal employee={e} opened={rehireOpen} onClose={() => setRehireOpen(false)} />}
      {canPhoto && <PhotoEditor employee={e} opened={photoOpen} onClose={() => setPhotoOpen(false)} />}
      {canEdit && <PrintCardsModal ids={[e.id]} opened={printOpen} onClose={() => setPrintOpen(false)} />}
    </>
  );
  const sex = e.sex === "K" ? "kobieta" : e.sex === "M" ? "mężczyzna" : "—";

  if (mobile) {
    const moreActions: SheetAction[] = [];
    if (staff && e.status === "active")
      moreActions.push({
        label: "Napisz do pracownika",
        icon: <IconMessage size={20} />,
        onClick: () => navigate(`/wiadomosci?do=${e.id}&nazwa=${encodeURIComponent(`${e.last_name} ${e.first_name} (${e.number})`)}`),
      });
    if (staff && e.status === "active")
      moreActions.push({ label: "Przenieś do archiwum", description: "Zwolnienie – utworzy checklistę odejścia.", icon: <IconArchive size={20} />, onClick: () => setTerminateOpen(true) });
    if (staff && e.status !== "active") {
      moreActions.push({ label: "Zatrudnij ponownie", icon: <IconUserCheck size={20} />, onClick: () => setRehireOpen(true) });
      moreActions.push({ label: "Cofnij zwolnienie", description: "Gdy zwolnienie wpisano omyłkowo.", icon: <IconRestore size={20} />, onClick: () => restore.mutate() });
    }
    const photoActions: SheetAction[] = [
      { label: e.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie", icon: <IconCamera size={20} />, onClick: () => setPhotoOpen(true) },
    ];
    if (e.has_photo && staff)
      photoActions.push({ label: "Usuń zdjęcie", description: "Bez zdjęcia nie wydrukujesz karty.", icon: <IconTrash size={20} />, danger: true, onClick: () => askDelete({ title: "Usunąć zdjęcie?", message: "Bez zdjęcia nie wydrukujesz karty.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && deletePhoto.mutate()) });
    const tabs = [
      { v: "dane", l: "Dane", show: true },
      { v: "dokumenty", l: "Dokumenty", show: canEdit || isAgency || staff, n: docsQ.data?.length },
      { v: "zadania", l: "Zadania", show: canEdit, warn: overdueN },
      { v: "szkolenia", l: "Szkolenia", show: !isAgency, warn: missingReq },
      { v: "konto", l: "Konto", show: staff },
      { v: "historia", l: "Historia", show: !isAgency },
    ].filter((t) => t.show);
    const idx = Math.max(0, tabs.findIndex((t) => t.v === tab));
    return (
      <Stack gap="md">
        <Group gap="md" wrap="nowrap" align="center">
          <div style={{ position: "relative", flex: "none" }}>
            <EmployeePhoto employee={e} width={64} />
            {canPhoto && (
              <ActionIcon
                aria-label={e.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
                className="ui-hit"
                radius="xl"
                size={32}
                variant="default"
                onClick={() => (photoActions.length > 1 ? setPhotoSheet(true) : setPhotoOpen(true))}
                style={{ position: "absolute", right: -10, bottom: -8, border: "2px solid var(--apt-ground)" }}
              >
                <IconCamera size={16} />
              </ActionIcon>
            )}
          </div>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Title order={1} size="h3" lh={1.2}>
              {e.last_name} {e.first_name}
            </Title>
            <Group gap={8} wrap="wrap">
              <Text size="sm" c="dimmed" ff="monospace">
                nr {e.number_display}
              </Text>
              {e.status === "active" ? <StatusBadge tone="ok">aktywny</StatusBadge> : <StatusBadge tone="neutral">archiwum od {formatDate(e.termination_date)}</StatusBadge>}
            </Group>
          </Stack>
        </Group>

        {(canEdit || moreActions.length > 0) && (
          <Group gap="sm" wrap="nowrap">
            {canEdit && (
              <Button size="md" px="sm" style={{ flex: 1 }} onClick={() => setPrintOpen(true)}>
                Drukuj kartę
              </Button>
            )}
            {canEdit && (
              <Button size="md" px="sm" variant="default" style={{ flex: 1 }} component={Link} to={`/pracownicy/${e.id}/edycja`}>
                Edytuj
              </Button>
            )}
            {moreActions.length > 0 && (
              <ActionIcon size={42} variant="default" radius="md" aria-label="Więcej akcji" onClick={() => setMoreSheet(true)}>
                <IconDots size={20} />
              </ActionIcon>
            )}
          </Group>
        )}

        <Tabs value={tab} onChange={(v) => setTab(v ?? "dane")} className="profile-tabs">
          <Tabs.List>
            {tabs.map((t) => (
              <Tabs.Tab
                key={t.v}
                value={t.v}
                rightSection={
                  "warn" in t && t.warn ? (
                    <span className="tab-count" data-warn aria-label={`${t.warn} wymaga uwagi`}>{t.warn}</span>
                  ) : "n" in t && t.n ? (
                    <span className="tab-count">{t.n}</span>
                  ) : undefined
                }
              >
                {t.l}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <SwipePager index={idx} onIndex={(i) => setTab(tabs[i].v)}>
            {tabs.map((t) => (
              <div key={t.v} style={{ paddingTop: 16 }}>
                {t.v === "dane" && (
                  <>
            <Stack gap="lg">
              {(overdueN > 0 || missingReq > 0) && (
                <UnstyledButton className="attention" onClick={() => setTab(overdueN ? "zadania" : "szkolenia")}>
                  <IconAlertTriangle size={20} aria-hidden style={{ flexShrink: 0 }} />
                  <span className="ui-row-text">
                    <span className="ui-row-title">Wymaga uwagi</span>
                    <span className="ui-row-desc">
                      {[overdueN ? `${overdueN} ${overdueN === 1 ? "zadanie" : overdueN < 5 ? "zadania" : "zadań"} po terminie` : null, missingReq ? `${missingReq} brakujące szkolenia` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <IconChevronRight size={18} aria-hidden />
                </UnstyledButton>
              )}
              <Section title="Zatrudnienie">
                <InfoRow label="Agencja">{e.agency?.name ?? "—"}</InfoRow>
                <InfoRow label="Wydział">{e.department?.name ?? "—"}</InfoRow>
                <InfoRow label="Stanowisko">{e.position?.name ?? "—"}</InfoRow>
                <InfoRow label="Zatrudniony od">{formatDate(e.hire_date)}</InfoRow>
              </Section>
              <Section title="Dane osobowe">
                {e.personal_data_visible ? (
                  <>
                    <InfoRow label="PESEL">
                      <PeselValue employee={e} />
                    </InfoRow>
                    <InfoRow label="Data urodzenia">
                      {formatDate(e.birth_date)}
                      {e.age !== null ? ` · ${e.age} lat` : ""}
                    </InfoRow>
                  </>
                ) : (
                  <InfoRow label="Wiek">{e.age !== null ? `${e.age} lat` : "—"}</InfoRow>
                )}
                <InfoRow label="Obywatelstwo">{e.country?.name ?? "—"}</InfoRow>
                <InfoRow label="Płeć">{sex}</InfoRow>
                {(e.contact_phone || e.contact_email) && (
                  <InfoRow label="Kontakt" stacked>
                    <ContactLine employeeId={e.id} kind="phone" value={e.contact_phone} />
                    <ContactLine employeeId={e.id} kind="email" value={e.contact_email} />
                  </InfoRow>
                )}
              </Section>
              {e.notes && (
                <Section title="Uwagi">
                  <div className="ui-row">
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {e.notes}
                    </Text>
                  </div>
                </Section>
              )}
            </Stack>
                  </>
                )}
                {t.v === "dokumenty" && (
                  <>
            <Stack gap="lg">
              {canEdit && <DocumentsCard employee={e} />}
              {(canEdit || isAgency) && <MedicalExamsCard employee={e} />}
              {staff && <PermitsCard employee={e} />}
            </Stack>
                  </>
                )}
                {t.v === "zadania" && (
                  <>
            {canEdit && <ChecklistsCard employee={e} />}
                  </>
                )}
                {t.v === "szkolenia" && (
                  <>
            <Stack gap="md">
              <TrainingsCard employee={e} />
              <MentorProgramsCard employee={e} />
            </Stack>
                  </>
                )}
                {t.v === "konto" && (
                  <>
            <Stack gap="md">
              <EmployeeAccountCard key={e.contact_email ?? ""} employeeId={e.id} contactEmail={e.contact_email} />
              <DataLinkCard key={`dl${e.contact_email ?? ""}`} employeeId={e.id} contactEmail={e.contact_email} contactPhone={e.contact_phone} />
            </Stack>
                  </>
                )}
                {t.v === "historia" && (
                  <>
            <Stack gap="lg">
              <TimelineCard employee={e} />
              {historyCard}
            </Stack>
                  </>
                )}
              </div>
            ))}
          </SwipePager>
        </Tabs>

        <ActionSheet opened={moreSheet} onClose={() => setMoreSheet(false)} title={`${e.last_name} ${e.first_name}`} actions={moreActions} />
        <ActionSheet opened={photoSheet} onClose={() => setPhotoSheet(false)} title="Zdjęcie do karty" actions={photoActions} />
        {modals}
        {terminateModal}
      </Stack>
    );
  }

  return (
    <Stack maw={1000}>
      {staff && e.status === "terminated" && (
        <RehireModal employee={e} opened={rehireOpen} onClose={() => setRehireOpen(false)} />
      )}
      <Anchor component={Link} to="/pracownicy" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Lista pracowników
        </Group>
      </Anchor>

      <Card withBorder padding="lg">
        <Group align="flex-start" gap={mobile ? "md" : "xl"} wrap="wrap">
          <Flex gap="xs" align="center" direction={mobile ? "row" : "column"}>
            <EmployeePhoto employee={e} width={mobile ? 72 : 150} />
            {canPhoto && (
              <Group gap={4}>
                <Button size="compact-sm" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setPhotoOpen(true)}>
                  {e.has_photo ? "Zmień" : "Dodaj zdjęcie"}
                </Button>
                {e.has_photo && staff && (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="red"
                    aria-label="Usuń zdjęcie"
                    loading={deletePhoto.isPending}
                    onClick={() => askDelete({ title: "Usunąć zdjęcie?", message: "Bez zdjęcia nie wydrukujesz karty.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && deletePhoto.mutate())}
                  >
                    <IconTrash size={14} />
                  </Button>
                )}
              </Group>
            )}
          </Flex>

          <Stack gap={6} style={{ flex: 1, minWidth: mobile ? "100%" : 260 }}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={2} size={mobile ? "h3" : undefined}>
                  {e.last_name} {e.first_name}
                </Title>
                <Group gap="xs" mt={4}>
                  <Text c="dimmed" visibleFrom="sm">Nr ewidencyjny</Text>
                  <Code fz="md">{e.number_display}</Code>
                  {e.status === "active" ? (
                    <Badge color="green" variant="light" leftSection={<IconCheck size={12} aria-hidden />}>
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
                {staff && e.status === "active" && (
                  <Button
                    variant="light"
                    component={Link}
                    to={`/wiadomosci?do=${e.id}&nazwa=${encodeURIComponent(`${e.last_name} ${e.first_name} (${e.number})`)}`}
                    leftSection={<IconMessage size={16} />}
                  >
                    Napisz do pracownika
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
                        <>
                          <Menu.Item leftSection={<IconUserCheck size={16} />} onClick={() => setRehireOpen(true)}>
                            Zatrudnij ponownie
                          </Menu.Item>
                          <Menu.Item leftSection={<IconRestore size={16} />} onClick={() => restore.mutate()}>
                            Cofnij zwolnienie (omyłkowe)
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 2, md: 3 }} mt="md" spacing="md" verticalSpacing="md">
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
              {(e.contact_phone || e.contact_email) && (
                <Field label="Kontakt">
                  <ContactLine employeeId={e.id} kind="phone" value={e.contact_phone} />
                  <ContactLine employeeId={e.id} kind="email" value={e.contact_email} />
                </Field>
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

      {canEdit && <ChecklistsCard employee={e} />}

      {(canEdit || isAgency) && <MedicalExamsCard employee={e} />}

      {hasRole("admin", "hr") && <PermitsCard employee={e} />}

      {!isAgency && <TrainingsCard employee={e} />}

      {!isAgency && <MentorProgramsCard employee={e} />}

      {staff && <DataLinkCard key={`dl${e.contact_email ?? ""}`} employeeId={e.id} contactEmail={e.contact_email} contactPhone={e.contact_phone} />}

      {staff && <EmployeeAccountCard key={e.contact_email ?? ""} employeeId={e.id} contactEmail={e.contact_email} />}

      {!isAgency && <TimelineCard employee={e} />}

      {historyCard}

      {canPhoto && <PhotoEditor employee={e} opened={photoOpen} onClose={() => setPhotoOpen(false)} />}
      {canEdit && <PrintCardsModal ids={[e.id]} opened={printOpen} onClose={() => setPrintOpen(false)} />}

      {terminateModal}
    </Stack>
  );
}
