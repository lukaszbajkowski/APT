import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Tabs,
  UnstyledButton,
  Anchor,
  Button,
  Code,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconCamera,
  IconDots,
  IconEye,
  IconEyeOff,
  IconRestore,
  IconUserCheck,
  IconTrash,
  IconMessage,
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
  type GeneratedDoc,
} from "../api";
import { useAuth } from "../auth";
import { MedicalExamsCard } from "../components/MedicalExams";
import { PermitsCard } from "../components/Permits";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { PhotoEditor } from "../components/PhotoEditor";
import { PrintCardsModal } from "../components/PrintCardsModal";
import { DocumentsCard } from "../components/DocumentsCard";
import { EmployeeFormPage } from "./EmployeeFormPage";
import { useRemindSignature } from "../components/Signatures";
import { SectionHead } from "../components/Mobile";
import { TrainingsCard } from "../components/TrainingsCard";
import { ChecklistsCard, RehireModal, TimelineCard, type ChecklistItem } from "../components/Lifecycle";
import { MentorProgramsCard } from "../components/MentorPrograms";
import { DataLinkCard } from "../components/DataLinkCard";
import { EmployeeAccountCard } from "../components/EmployeeAccountCard";
import { Loading } from "../components/States";
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
  const [editPart, setEditPart] = useState<"dane" | "zatrudnienie" | null>(null);
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
  // aktywna zakładka zawsze widoczna w pasku przewijanym w bok (np. po wejściu z Kont pracowników na „Konto”)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".profile-tabs .mantine-Tabs-tab[data-active]");
    const list = el?.parentElement;
    if (!el || !list) return;
    list.scrollTo({ left: el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  }, [tab, !!employee.data]);
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
  // braki szkoleń wymaganych na stanowisku (ten sam klucz co sekcja „Szkolenia”)
  const reqQ = useQuery({
    queryKey: ["employee-requirements", Number(id)],
    queryFn: () => api<{ label: string; state: string }[]>(`/employees/${id}/requirements`),
    enabled: canEdit && !isAgency,
  });
  const checklists = useQuery({
    queryKey: ["employee-checklists", Number(id)],
    queryFn: () => api<{ onboarding: ChecklistItem[]; offboarding: ChecklistItem[] }>(`/employees/${id}/checklists`),
    enabled: canEdit,
  });
  const docsQ = useQuery({ queryKey: ["documents", Number(id)], queryFn: () => api<GeneratedDoc[]>(`/employees/${id}/documents`), enabled: canEdit });
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
        <section className="ui-dsec">
          <SectionHead
            title="Historia zmian"
            action={history.data && history.data.length > HISTORY_SHORT ? { label: historyAll ? "Zwiń" : `Wszystkie (${history.data.length})`, onClick: () => setHistoryAll((v) => !v) } : undefined}
          />
          {history.isLoading && <Loading />}
          {history.data && history.data.length === 0 && (
            <Text size="sm" c="dimmed">
              Brak wpisów. Zmiany pojawią się tu po pierwszej edycji.
            </Text>
          )}
          {history.data && history.data.length > 0 && (
            <ul className="ui-hist">
              {(historyAll ? history.data : history.data.slice(0, HISTORY_SHORT)).map((h) => (
                <li key={h.id}>
                  <div className="ui-hist-title">{ACTION_LABELS[h.action] ?? h.action}</div>
                  {historyText(h) && <div className="ui-hist-text">{historyText(h)}</div>}
                  <div className="ui-drow-meta">
                    {formatDateTime(h.ts)} · {h.username ?? "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

    </>
  );
  const modals = (
    <>
      {/* edycja danych osobowych / zatrudnienia w okienku na karcie (komputer) */}
      <Modal opened={!!editPart} onClose={() => setEditPart(null)} size="lg" title={editPart === "dane" ? "Dane osobowe" : "Zatrudnienie"}>
        {editPart && <EmployeeFormPage embed={{ id: String(e.id), part: editPart, onClose: () => setEditPart(null) }} />}
      </Modal>
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

  // ——— komputer: wzorzec „karta szczegółów” – nagłówek, po lewej praca, po prawej dane do wglądu ———
  const pendingDocs = (docsQ.data ?? []).filter((d) => d.signature_pending && !d.signed_at);
  const reqMissing = (reqQ.data ?? []).filter((r) => r.state === "missing" || r.state === "expired").map((r) => r.label);
  const overdueItems = [...(checklists.data?.onboarding ?? []), ...(checklists.data?.offboarding ?? [])].filter((x) => x.state === "overdue");
  const meta = [e.position?.name && e.department?.name ? `${e.position.name}, ${e.department.name}` : e.position?.name ?? e.department?.name, e.agency?.name, e.hire_date ? `zatrudniony od ${formatDate(e.hire_date)}` : null].filter(Boolean).join(" · ");
  const writeTo = `/wiadomosci?do=${e.id}&nazwa=${encodeURIComponent(`${e.last_name} ${e.first_name} (${e.number})`)}`;
  return (
    <div className="ui-detail">
      <div className="ui-crumb">
        <Anchor component={Link} to="/pracownicy">Pracownicy</Anchor> / {e.last_name} {e.first_name}
      </div>
      <header className="ui-detail-head">
        <button type="button" className="ui-detail-photo" onClick={canPhoto ? () => setPhotoOpen(true) : undefined} aria-label={canPhoto ? (e.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie") : undefined} disabled={!canPhoto}>
          <EmployeePhoto employee={e} width={72} />
        </button>
        <div className="ui-detail-headtext">
          <Title order={1}>
            {e.last_name} {e.first_name}
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            <span className="ui-mono">{e.number_display}</span>
            {meta ? ` · ${meta}` : ""}
            {e.status !== "active" && ` · w archiwum od ${formatDate(e.termination_date)}`}
            {e.retention_until && ` · dane przechowywane do ${formatDate(e.retention_until)}`}
          </Text>
          {canPhoto && !e.has_photo && (
            <Text size="sm" mt={6}>
              <Anchor component="button" fw={600} onClick={() => setPhotoOpen(true)}>
                Dodaj zdjęcie
              </Anchor>{" "}
              <Text span c="dimmed">· bez zdjęcia karta się nie wydrukuje</Text>
            </Text>
          )}
          {canPhoto && e.has_photo && staff && (
            <Text size="sm" mt={6}>
              <Anchor component="button" onClick={() => setPhotoOpen(true)}>Zmień zdjęcie</Anchor>
              <Text span c="dimmed"> · </Text>
              <Anchor component="button" c="red" onClick={() => askDelete({ title: "Usunąć zdjęcie?", message: "Bez zdjęcia nie wydrukujesz karty.", confirmLabel: "Usuń", danger: true }).then((ok) => ok && deletePhoto.mutate())}>
                Usuń
              </Anchor>
            </Text>
          )}
        </div>
        <Group gap="xs" wrap="nowrap" style={{ flex: "none" }}>
          {canEdit && e.status === "active" && (
            <Button onClick={() => document.getElementById("nowy-dokument")?.click()}>Nowy dokument</Button>
          )}
          {staff && e.status === "active" && (
            <Button variant="default" component={Link} to={writeTo}>
              Napisz
            </Button>
          )}
          {canEdit && (
            <Button variant="default" onClick={() => setPrintOpen(true)}>
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
      </header>

      <div className="ui-detail-cols">
        <div className="ui-detail-main">
          {canEdit && (overdueItems.length > 0 || pendingDocs.length > 0 || reqMissing.length > 0) && (
            <AttentionSection items={overdueItems} docs={pendingDocs} reqMissing={reqMissing} />
          )}
          {canEdit && <DocumentsCard employee={e} />}
          {canEdit && <ChecklistsCard employee={e} />}
          {!isAgency && <TrainingsCard employee={e} />}
          {(canEdit || isAgency) && <MedicalExamsCard employee={e} />}
          {hasRole("admin", "hr") && <PermitsCard employee={e} />}
          {!isAgency && <MentorProgramsCard employee={e} />}
          {!isAgency && <TimelineCard employee={e} />}
        </div>
        <aside className="ui-detail-side">
          <section className="ui-dsec">
            <div className="ui-dsec-head">
              <Title order={2} className="ui-dsec-title">Dane osobowe</Title>
              {staff && (
                <Anchor component="button" type="button" onClick={() => setEditPart("dane")} fw={600} size="sm" aria-label="Edytuj dane osobowe">
                  Edytuj
                </Anchor>
              )}
            </div>
            <dl className="ui-dl">
              {e.personal_data_visible ? (
                <>
                  <dt>PESEL</dt>
                  <dd>
                    <PeselValue employee={e} />
                  </dd>
                  <dt>Data urodzenia</dt>
                  <dd>
                    {formatDate(e.birth_date)}
                    {e.age !== null && <Text span c="dimmed"> ({e.age} lat)</Text>}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Wiek</dt>
                  <dd>{e.age !== null ? `${e.age} lat` : "—"}</dd>
                </>
              )}
              <dt>Płeć</dt>
              <dd>{sex}</dd>
              <dt>Obywatelstwo</dt>
              <dd>{e.country?.name ?? <Text span c="dimmed">nie podano</Text>}</dd>
            </dl>
          </section>
          <section className="ui-dsec">
            <div className="ui-dsec-head">
              <Title order={2} className="ui-dsec-title">Zatrudnienie</Title>
              {canEdit && (
                <Anchor component="button" type="button" onClick={() => setEditPart("zatrudnienie")} fw={600} size="sm" aria-label="Edytuj zatrudnienie">
                  Edytuj
                </Anchor>
              )}
            </div>
            <dl className="ui-dl">
              <dt>Agencja (APT)</dt>
              <dd>{e.agency?.name ?? "—"}</dd>
              <dt>Wydział</dt>
              <dd>{e.department?.name ?? "—"}</dd>
              <dt>Stanowisko</dt>
              <dd>{e.position?.name ?? "—"}</dd>
              <dt>Od</dt>
              <dd>{formatDate(e.hire_date)}</dd>
            </dl>
          </section>
          <section className="ui-dsec">
            <Title order={2} className="ui-dsec-title">Kontakt</Title>
            <dl className="ui-dl">
              <dt>Telefon</dt>
              <dd>{e.contact_phone ? <ContactLine employeeId={e.id} kind="phone" value={e.contact_phone} /> : <Text span c="dimmed">nie podano</Text>}</dd>
              <dt>E-mail</dt>
              <dd>{e.contact_email ? <ContactLine employeeId={e.id} kind="email" value={e.contact_email} /> : <Text span c="dimmed">nie podano</Text>}</dd>
            </dl>
            {/* kontakt podaje sam pracownik (konto albo link z potwierdzeniem daty urodzenia) – kadry mogą go tylko usunąć */}
            {staff && <DataLinkCard key={`dl${e.contact_email ?? ""}`} employeeId={e.id} contactEmail={e.contact_email} contactPhone={e.contact_phone} />}
          </section>
          {e.notes && (
            <section className="ui-dsec">
              <Title order={2} className="ui-dsec-title">Uwagi</Title>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }} mt={8}>
                {e.notes}
              </Text>
            </section>
          )}
          {staff && <EmployeeAccountCard key={e.contact_email ?? ""} employeeId={e.id} contactEmail={e.contact_email} />}
          {historyCard}
        </aside>
      </div>

      {modals}
      {terminateModal}
    </div>
  );
}

/** „Wymaga uwagi”: zadania po terminie (do odhaczenia od razu) i dokumenty czekające na podpis. */
/** Przewija do sekcji i na chwilę ją podświetla. */
function flash(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.classList.add("ui-flash");
  window.setTimeout(() => el?.classList.remove("ui-flash"), 1600);
}

function AttentionSection({ items, docs, reqMissing }: { items: ChecklistItem[]; docs: GeneratedDoc[]; reqMissing: string[] }) {
  const remind = useRemindSignature();
  return (
    <section className="ui-dsec">
      <Title order={2} className="ui-dsec-title">Wymaga uwagi</Title>
      <div className="ui-dlist">
        {reqMissing.length > 0 && (
          <div className="ui-drow">
            <div style={{ minWidth: 0 }}>
              <div className="ui-drow-title">
                Brak szkoleń wymaganych na stanowisku: {reqMissing.length}
              </div>
              <div className="ui-drow-meta">{reqMissing.join(" · ")}</div>
            </div>
            <Button size="xs" variant="default" onClick={() => flash("szkolenia")}>
              Pokaż szkolenia
            </Button>
          </div>
        )}
        {/* zadania z checklist: jeden wiersz na checklistę (pełna lista jest niżej w „Checklistach”) */}
        {(["onboarding", "offboarding"] as const).map((kind) => {
          const late = items.filter((it) => it.kind === kind);
          if (!late.length) return null;
          return (
            <div key={kind} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title">
                  {kind === "onboarding" ? "Wdrożenie" : "Odejście"}: {late.length === 1 ? "1 zadanie" : `${late.length} zadania`} po terminie
                </div>
                <div className="ui-drow-meta">
                  {late
                    .map((it) => `${it.label} (od ${formatDate(it.due_date)})`)
                    .join(" · ")}
                </div>
              </div>
              <Button
                size="xs"
                variant="default"
                onClick={() => flash("checklisty")}
              >
                Pokaż checklistę
              </Button>
            </div>
          );
        })}
        {docs.map((d) => (
          <div key={d.id} className="ui-drow">
            <div style={{ minWidth: 0 }}>
              <button
                type="button"
                className="ui-drow-title ui-linklike"
                onClick={() => {
                  const row = document.getElementById(`dok-${d.id}`);
                  row?.scrollIntoView({ behavior: "smooth", block: "center" });
                  row?.classList.add("ui-flash");
                  window.setTimeout(() => row?.classList.remove("ui-flash"), 1600);
                }}
              >
                {d.template_name}
              </button>
              <div className="ui-drow-meta">
                <span className="ui-warn">czeka na podpis</span> · wygenerowany {formatDateTime(d.created_at)}
              </div>
            </div>
            <Button size="xs" variant="default" loading={remind.isPending && remind.variables?.id === d.id} onClick={() => remind.mutate(d)}>
              Przypomnij o podpisie
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
