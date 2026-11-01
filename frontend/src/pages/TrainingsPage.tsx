import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, GroupLabel, ListRow, PageHead, PickSheet, Segments, SheetHandle, StatusBadge, SwipePager, useMobileHeader } from "../components/Mobile";
import { MatrixMobile, ReportMobile, RequirementsMobile } from "../components/TrainingsMobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Menu,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Drawer,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconChevronDown, IconCircleCheck, IconFileSpreadsheet, IconPencil, IconPlus, IconTrash, IconUsers, IconDots, IconReportAnalytics, IconListCheck, IconCategory, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import {
  api,
  errorText,
  formatDate,
  TRAINING_STATUS,
  type DocTemplate,
  type ExpiringTraining,
  type InProgressTraining,
  type DictionaryItem,
  type TrainingProgram,
  type TrainingKind,
  type TrainingType,
} from "../api";
import { useAuth } from "../auth";
import { ProgramMentorsButton } from "../components/MentorPrograms";
import { TrainingsReport } from "../components/TrainingsReport";
import { CompetenceMatrix, PositionRequirements } from "../components/Competence";
import { Loading } from "../components/States";
import { useConfirm } from "../lib/confirm";

function Expiring({ mobile }: { mobile?: boolean }) {
  const q = useQuery({ queryKey: ["trainings-expiring"], queryFn: () => api<ExpiringTraining[]>("/trainings/expiring") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  if (mobile)
    return rows.length === 0 ? (
      <CompactEmpty title="Nic się nie kończy" text="W ciągu 30 dni nie kończy się żadne szkolenie ani uprawnienie." />
    ) : (
      <div className="ui-group">
        {rows.map((r) => (
          <ListRow
            key={r.training_id}
            to={`/pracownicy/${r.employee_id}`}
            title={`${r.last_name} ${r.first_name}`}
            description={
              <>
                {r.name ?? r.type_name}
                <br />
                <StatusBadge tone={r.status === "expired" ? "error" : "warn"}>
                  {r.status === "expired" ? "Wygasło" : "Kończy się"} {formatDate(r.valid_until)}
                </StatusBadge>
              </>
            }
          />
        ))}
      </div>
    );
  if (rows.length === 0)
    return (
      <Alert color="green" icon={<IconCircleCheck />}>
        W ciągu najbliższych 30 dni nie kończy się żadne szkolenie ani uprawnienie.
      </Alert>
    );
  return (
    <Card withBorder padding={0}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pracownik</Table.Th>
            <Table.Th>Szkolenie</Table.Th>
            <Table.Th ta="right">Ważne do</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const st = TRAINING_STATUS[r.status];
            return (
              <Table.Tr key={r.training_id}>
                <Table.Td>
                  <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                    {r.last_name} {r.first_name}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    nr {r.number}
                    {r.department ? ` · ${r.department}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.name ?? r.type_name}</Text>
                  {r.name && (
                    <Text size="xs" c="dimmed">
                      {r.type_name}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{formatDate(r.valid_until)}</Text>
                  <Badge color={st.color} variant="light" size="sm">
                    {st.label}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ProgramRow({
  typeId,
  program,
  departments,
  onDone,
}: {
  typeId: number;
  program: TrainingProgram | null;
  departments: DictionaryItem[];
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(program?.name ?? "");
  const [dep, setDep] = useState<string | null>(program?.department_id ? String(program.department_id) : null);
  const [days, setDays] = useState<number | string>(program?.standard_days ?? "");
  const dirty =
    !program ||
    name !== program.name ||
    dep !== (program.department_id ? String(program.department_id) : null) ||
    days !== (program.standard_days ?? "");
  const onError = (e: unknown) => notifications.show({ color: "red", message: errorText(e) });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, department_id: dep ? Number(dep) : null, standard_days: days === "" ? null : Number(days), is_active: true };
      return program
        ? api(`/training-programs/${program.id}`, { method: "PUT", body })
        : api(`/training-types/${typeId}/programs`, { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      if (!program) {
        setName("");
        setDep(null);
        setDays("");
      }
      onDone?.();
    },
    onError,
  });
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api(`/training-programs/${program!.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-types"] }),
    onError,
  });
  return (
    <Group gap="xs" wrap="nowrap" align="flex-end">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" style={{ flex: 1 }}>
        <TextInput size="xs" aria-label="Nazwa szkolenia" placeholder="Nazwa szkolenia" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select
          size="xs"
          aria-label="Wydział"
          placeholder="Wydział (dowolny)"
          clearable
          searchable
          data={departments.map((d) => ({ value: String(d.id), label: d.name }))}
          value={dep}
          onChange={setDep}
        />
        <NumberInput
          size="xs"
          aria-label="Standard (dni)"
          placeholder="Standard (dni)"
          min={0}
          max={3650}
          allowDecimal={false}
          suffix=" dni"
          value={days}
          onChange={setDays}
        />
      </SimpleGrid>
      <ActionIcon
        variant={program ? "subtle" : "filled"}
        aria-label={program ? "Zapisz pozycję" : "Dodaj do katalogu"}
        disabled={!name.trim() || !dirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {program ? <IconCheck size={14} /> : <IconPlus size={14} />}
      </ActionIcon>
      {!program && <div style={{ width: 28 + 48 + 8, flexShrink: 0 }} />}
      {program && <ProgramMentorsButton program={program} />}
      {program && (
        <ActionIcon
          variant="subtle"
          color="red"
          aria-label="Usuń z katalogu"
          onClick={() => confirm({ title: "Usunąć z katalogu?", message: `Usunąć „${program.name}” z katalogu? Wpisane szkolenia zostaną.`, confirmLabel: "Usuń", danger: true }).then((ok) => ok && remove.mutate())}
        >
          <IconTrash size={14} />
        </ActionIcon>
      )}
    </Group>
  );
}

/** Telefon: pozycja katalogu w panelu od dołu. */
function ProgramSheet({ typeId, program, onClose }: { typeId: number; program: TrainingProgram | null; onClose: () => void }) {
  const qc = useQueryClient();
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const [name, setName] = useState(program?.name ?? "");
  const [dep, setDep] = useState<string | null>(program?.department_id ? String(program.department_id) : null);
  const [days, setDays] = useState<number | string>(program?.standard_days ?? "");
  const [pickDep, setPickDep] = useState(false);
  const confirm = useConfirm();
  const onError = (e: unknown) => notifications.show({ color: "red", message: errorText(e) });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, department_id: dep ? Number(dep) : null, standard_days: days === "" ? null : Number(days), is_active: true };
      return program ? api(`/training-programs/${program.id}`, { method: "PUT", body }) : api(`/training-types/${typeId}/programs`, { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      notifications.show({ color: "green", message: program ? "Zapisano pozycję katalogu." : "Dodano do katalogu." });
      onClose();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/training-programs/${program!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      onClose();
    },
    onError,
  });
  const depName = departments.data?.find((d) => String(d.id) === dep)?.name;
  return (
    <>
      <Drawer opened onClose={onClose} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label="Pozycja katalogu">
        <SheetHandle onClose={onClose}>
          <div className="ui-sheet-head">
            <div className="ui-sheet-title">{program ? "Pozycja katalogu" : "Nowa pozycja katalogu"}</div>
          </div>
        </SheetHandle>
        <Stack gap="md" px="md" pb="sm">
          <TextInput size="md" label="Nazwa" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <div className="ui-form-field">
            <span className="ui-form-label">Wydział</span>
            <UnstyledButton className="ui-pick" onClick={() => setPickDep(true)}>
              <span data-on={!!dep || undefined}>{depName ?? "Dowolny"}</span>
              <IconChevronRight size={16} aria-hidden />
            </UnstyledButton>
          </div>
          <NumberInput size="md" label="Standard nauki" min={0} max={3650} allowDecimal={false} hideControls rightSection={<Text size="sm" c="dimmed" pr="sm">dni</Text>} value={days} onChange={setDays} />
          {program && (
            <div className="ui-form-field">
              <span className="ui-form-label">Kto może prowadzić</span>
              <ProgramMentorsButton program={program} />
            </div>
          )}
        </Stack>
        <div className="ui-filter-foot">
          {program && (
            <Button size="lg" variant="default" color="red" radius="md" c="red" onClick={() => confirm({ title: "Usunąć z katalogu?", message: `Usunąć „${program.name}” z katalogu? Wpisane szkolenia zostaną.`, confirmLabel: "Usuń", danger: true }).then((ok) => ok && remove.mutate())}>
              Usuń
            </Button>
          )}
          <Button size="lg" radius="md" style={{ flex: 1 }} disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Zapisz
          </Button>
        </div>
      </Drawer>
      <PickSheet opened={pickDep} onClose={() => setPickDep(false)} title="Wydział" options={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))} value={dep ? [dep] : []} clearLabel="Dowolny wydział" onChange={(v) => setDep(v[0] ?? null)} />
    </>
  );
}

function ProgramsEditor({ type }: { type: TrainingType }) {
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const programs = types.data?.find((t) => t.id === type.id)?.programs ?? type.programs;
  const deps = departments.data ?? [];
  return (
    <div>
      <Text size="sm" fw={500}>
        Katalog szkoleń stanowiskowych
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        Przy dodawaniu szkolenia wybierasz pozycję z katalogu – nazwa, wydział i standard czasu nauki wpiszą się same.
        Przycisk z liczbą osób – kto może prowadzić (być opiekunem) dane szkolenie.
      </Text>
      <Stack gap="xs">
        {programs.map((p) => (
          <ProgramRow key={p.id} typeId={type.id} program={p} departments={deps} />
        ))}
        <ProgramRow typeId={type.id} program={null} departments={deps} />
      </Stack>
    </div>
  );
}

function InProgress({ mobile }: { mobile?: boolean }) {
  const q = useQuery({ queryKey: ["trainings-in-progress"], queryFn: () => api<InProgressTraining[]>("/trainings/in-progress") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const rows = q.data ?? [];
  if (mobile)
    return rows.length === 0 ? (
      <CompactEmpty title="Nikt nie jest w trakcie" text="Brak trwających szkoleń stanowiskowych." />
    ) : (
      <div className="ui-group">
        {rows.map((r) => (
          <ListRow
            key={r.training_id}
            to={`/pracownicy/${r.employee_id}`}
            title={`${r.last_name} ${r.first_name}`}
            description={
              <>
                {[r.name ?? r.type_name, r.mentor_name ? `opiekun: ${r.mentor_name}` : null].filter(Boolean).join(" · ")}
                <br />
                <StatusBadge tone={r.status === "overdue" ? "warn" : "wait"}>
                  {r.status === "planned" ? `Zaplanowane od ${formatDate(r.start_date)}` : `${TRAINING_STATUS[r.status].label} · dzień ${r.days}${r.standard_days !== null ? ` z ${r.standard_days}` : ""}`}
                </StatusBadge>
              </>
            }
          />
        ))}
      </div>
    );
  if (rows.length === 0)
    return (
      <Alert color="gray" icon={<IconCircleCheck />}>
        Nikt nie jest teraz w trakcie szkolenia stanowiskowego.
      </Alert>
    );
  return (
    <Card withBorder padding={0}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pracownik</Table.Th>
            <Table.Th>Szkolenie</Table.Th>
            <Table.Th ta="right">Postęp</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const st = TRAINING_STATUS[r.status];
            return (
              <Table.Tr key={r.training_id}>
                <Table.Td>
                  <Anchor component={Link} to={`/pracownicy/${r.employee_id}`}>
                    {r.last_name} {r.first_name}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    nr {r.number}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.name ?? r.type_name}</Text>
                  <Text size="xs" c="dimmed">
                    {[`od ${formatDate(r.start_date)}`, r.exam_date ? `egzamin ${formatDate(r.exam_date)}` : null, r.department, r.mentor_name ? `opiekun: ${r.mentor_name}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Badge color={st.color} variant="light" size="sm">
                    {st.label}
                  </Badge>
                  {r.status !== "planned" && (
                    <Text size="xs" c={r.status === "overdue" ? "orange" : "dimmed"}>
                      dzień {r.days}
                      {r.standard_days !== null ? ` z ${r.standard_days}` : ""}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

interface TypeForm {
  name: string;
  kind: TrainingKind;
  validity_months: number | string;
  template_id: string | null;
  is_active: boolean;
}

function TypeModal({ editing, opened, onClose }: { editing: TrainingType | null; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<DocTemplate[]>("/templates"), enabled: opened });
  const [f, setF] = useState<TypeForm>({ name: "", kind: "general", validity_months: "", template_id: null, is_active: true });
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.data?.find((t) => String(t.id) === f.template_id);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types"), enabled: opened && !!mobile });
  const [pickTpl, setPickTpl] = useState(false);
  const [prog, setProg] = useState<TrainingProgram | "new" | null>(null);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setF(
      editing
        ? {
            name: editing.name,
            kind: editing.kind,
            validity_months: editing.validity_months ?? "",
            template_id: editing.template_id ? String(editing.template_id) : null,
            is_active: editing.is_active,
          }
        : { name: "", kind: "general", validity_months: "", template_id: null, is_active: true },
    );
  }, [opened, editing]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        kind: f.kind,
        validity_months: f.validity_months === "" ? null : Number(f.validity_months),
        template_id: f.template_id ? Number(f.template_id) : null,
        is_active: f.is_active,
      };
      return editing
        ? api<TrainingType>(`/training-types/${editing.id}`, { method: "PUT", body })
        : api<TrainingType>("/training-types", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-types"] });
      notifications.show({ color: "green", message: "Zapisano rodzaj szkolenia." });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  if (mobile) {
    const live = types.data?.find((t) => t.id === editing?.id) ?? editing;
    const quick = ["", "12", "24", "36", "60"];
    return (
      <Modal opened={opened} onClose={onClose} fullScreen withCloseButton={false} padding={0} transitionProps={{ transition: "slide-left", duration: 180 }} aria-label="Rodzaj szkolenia">
        <div className="ui-form">
          <header className="ui-chat-head">
            <UnstyledButton className="ui-chat-btn" onClick={onClose} aria-label="Wróć">
              <IconChevronLeft size={26} stroke={2.2} />
            </UnstyledButton>
            <span className="ui-chat-title">
              <span className="ui-chat-name">{editing ? "Rodzaj szkolenia" : "Nowy rodzaj szkolenia"}</span>
              <span className="ui-chat-sub">{f.name || "Bez nazwy"}</span>
            </span>
          </header>
          <div className="ui-form-scroll">
            {error && <Alert color="red">{error}</Alert>}
            <TextInput size="md" label="Nazwa" value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
            <div className="ui-form-field">
              <span className="ui-form-label">Typ</span>
              {([
                ["general", "Szkolenie / uprawnienie", "Data ukończenia i ważność, np. BHP, wózek, SEP"],
                ["position", "Szkolenie stanowiskowe", "Nauka z opiekunem: od–do, egzamin, katalog szkoleń"],
              ] as const).map(([v, t, d]) => (
                <UnstyledButton key={v} className="ui-option" data-on={f.kind === v || undefined} role="radio" aria-checked={f.kind === v} onClick={() => setF({ ...f, kind: v })}>
                  <span className="ui-option-dot" />
                  <span className="ui-row-text">
                    <span className="ui-row-title">{t}</span>
                    <span className="ui-row-desc">{d}</span>
                  </span>
                </UnstyledButton>
              ))}
            </div>
            <div className="ui-form-field">
              <span className="ui-form-label">Okres ważności</span>
              <span className="ui-form-hint">Po tylu miesiącach szkolenie wygasa</span>
              <div className="ui-chips-wrap">
                {quick.map((q) => (
                  <UnstyledButton key={q} className="ui-chip" data-active={String(f.validity_months) === q || undefined} aria-pressed={String(f.validity_months) === q} onClick={() => setF({ ...f, validity_months: q })}>
                    {q || "Bez terminu"}
                  </UnstyledButton>
                ))}
              </div>
              <NumberInput size="md" aria-label="Okres ważności w miesiącach" placeholder="Bez terminu" min={1} max={600} allowDecimal={false} hideControls rightSection={<Text size="sm" c="dimmed" pr="sm">miesięcy</Text>} rightSectionWidth={90} value={f.validity_months} onChange={(v) => setF({ ...f, validity_months: v })} />
            </div>
            <div className="ui-form-field">
              <span className="ui-form-label">Szablon dokumentu</span>
              <span className="ui-form-hint">Opcjonalnie – przy szkoleniu pojawi się „Generuj dokument”</span>
              <UnstyledButton className="ui-pick" onClick={() => setPickTpl(true)}>
                <span data-on={!!selectedTemplate || undefined}>{selectedTemplate?.name ?? "Brak"}</span>
                <IconChevronRight size={16} aria-hidden />
              </UnstyledButton>
              {selectedTemplate && selectedTemplate.fields.length > 0 && (
                <span className="ui-form-hint">Pola przy dodawaniu: {selectedTemplate.fields.map((x) => x.label).join(", ")}</span>
              )}
            </div>
            <div className="ui-switch-row">
              <span className="ui-row-text">
                <span className="ui-row-title">Aktywny</span>
                <span className="ui-row-desc">Do wyboru przy dodawaniu szkolenia</span>
              </span>
              <Switch size="lg" aria-label="Aktywny" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.currentTarget.checked })} />
            </div>
            {f.kind === "position" && (
              <div className="ui-form-field">
                <span className="ui-form-label">Katalog szkoleń stanowiskowych</span>
                <span className="ui-form-hint">Nazwa, wydział i standard wpiszą się same przy dodawaniu szkolenia</span>
                {live ? (
                  <>
                    {live.programs.length > 0 && (
                      <div className="ui-group">
                        {live.programs.map((pr) => (
                          <ListRow
                            key={pr.id}
                            onClick={() => setProg(pr)}
                            title={pr.name}
                            description={[pr.department ?? "Dowolny wydział", pr.standard_days ? `${pr.standard_days} dni` : null, pr.mentors.length ? `${pr.mentors.length} ${pr.mentors.length === 1 ? "opiekun" : "opiekunów"}` : "brak opiekuna"].filter(Boolean).join(" · ")}
                          />
                        ))}
                      </div>
                    )}
                    <UnstyledButton className="ui-link-row" onClick={() => setProg("new")}>
                      <IconPlus size={18} aria-hidden /> Dodaj szkolenie do katalogu
                    </UnstyledButton>
                  </>
                ) : (
                  <span className="ui-form-hint">Katalog uzupełnisz po zapisaniu rodzaju.</span>
                )}
              </div>
            )}
          </div>
          <div className="ui-chat-compose">
            <Button size="lg" fullWidth radius="md" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
              Zapisz
            </Button>
          </div>
        </div>
        <PickSheet
          opened={pickTpl}
          onClose={() => setPickTpl(false)}
          title="Szablon dokumentu"
          options={(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
          value={f.template_id ? [f.template_id] : []}
          clearLabel="Brak szablonu"
          onChange={(v) => setF({ ...f, template_id: v[0] ?? null })}
        />
        {live && prog !== null && (
          <ProgramSheet typeId={live.id} program={prog === "new" ? null : live.programs.find((x) => x.id === prog.id) ?? prog} onClose={() => setProg(null)} />
        )}
      </Modal>
    );
  }
  return (
    <Modal opened={opened} onClose={onClose} title={editing ? "Rodzaj szkolenia" : "Nowy rodzaj szkolenia"} size="xl">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput label="Nazwa" value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
          <NumberInput
            label="Okres ważności (miesiące)"
            placeholder="bezterminowe / wpisywane ręcznie"
            min={1}
            max={600}
            allowDecimal={false}
            value={f.validity_months}
            onChange={(v) => setF({ ...f, validity_months: v })}
          />
        </SimpleGrid>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Typ
          </Text>
          <SegmentedControl
            value={f.kind}
            onChange={(v) => setF({ ...f, kind: v as TrainingKind })}
            data={[
              { value: "general", label: "Szkolenie / uprawnienie" },
              { value: "position", label: "Szkolenie stanowiskowe" },
            ]}
          />
          {f.kind === "position" && (
            <Text size="xs" c="dimmed" mt={4}>
              Dodatkowo: nazwa, wydział, daty rozpoczęcia, egzaminu i zakończenia, opiekun, czas nauki wg standardu.
            </Text>
          )}
        </div>
        <Select
          label="Szablon dokumentu"
          description="Opcjonalnie – przy szkoleniu pojawi się „Generuj dokument”. W szablonie użyj znaczników szkolenie_* (ściąga w edytorze szablonu)."
          clearable
          data={(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
          value={f.template_id}
          onChange={(v) => setF({ ...f, template_id: v })}
        />
        <Switch label="Aktywny (do wyboru przy dodawaniu szkolenia)" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.currentTarget.checked })} />
        <div>
          <Text size="sm" fw={500}>
            Pola formularza
          </Text>
          {selectedTemplate ? (
            <>
              <Text size="xs" c="dimmed" mb="xs">
                Pochodzą z szablonu „{selectedTemplate.name}” – zmieniasz je w edytorze szablonu (etykiety, typy, formaty,
                wymagane).{" "}
                <Anchor component={Link} to={`/szablony/${selectedTemplate.id}`} size="xs">
                  Otwórz edytor szablonu
                </Anchor>
              </Text>
              {selectedTemplate.fields.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Szablon używa tylko danych z kartoteki i szkolenia.
                </Text>
              ) : (
                <Group gap={6}>
                  {selectedTemplate.fields.map((x) => (
                    <Badge key={x.key} variant="light" color={x.required ? "blue" : "gray"}>
                      {x.label}
                      {x.required ? " *" : ""}
                    </Badge>
                  ))}
                </Group>
              )}
            </>
          ) : (
            <Text size="xs" c="dimmed">
              Wybierz szablon dokumentu – jego pola formularza pojawią się przy dodawaniu szkolenia.
            </Text>
          )}
        </div>
        {f.kind === "position" &&
          (editing ? (
            <ProgramsEditor type={editing} />
          ) : (
            <Text size="xs" c="dimmed">
              Katalog szkoleń stanowiskowych (nazwa, wydział, standard) uzupełnisz po zapisaniu rodzaju.
            </Text>
          ))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Zapisz
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Types() {
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types") });
  const [modal, setModal] = useState<{ open: boolean; editing: TrainingType | null }>({ open: false, editing: null });
  if (types.isLoading) return <Loading />;
  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, editing: null })}>
          Dodaj rodzaj
        </Button>
      </Group>
      <Stack gap="xs">
        {types.data?.map((t) => (
          <Paper key={t.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text fw={600}>{t.name}</Text>
                  {!t.is_active && (
                    <Badge color="gray" variant="light" size="sm">
                      wyłączony
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {[
                    t.kind === "position" ? "stanowiskowe" : "szkolenie / uprawnienie",
                    t.validity_months ? `ważność ${t.validity_months} mies.` : "bez okresu ważności",
                    t.kind === "position" ? `katalog: ${t.programs.length}` : null,
                    t.template_name ? `szablon: ${t.template_name}` : null,
                    `wpisów: ${t.in_use}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </div>
              <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setModal({ open: true, editing: t })}>
                Edytuj
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
      <TypeModal editing={modal.editing} opened={modal.open} onClose={() => setModal({ open: false, editing: null })} />
    </Stack>
  );
}

export function TrainingsPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  if (mobile) return <TrainingsMobilePage staff={staff} />;
  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
      <div>
        <Title order={2}>Szkolenia</Title>
        <Text c="dimmed" size="sm">
          Szkolenia wpisuje się w kartotece pracownika, kilku osobom naraz – z listy pracowników (zaznacz osoby → „Szkolenie”).
          Przypomnienie e-mail o kończących się i przekraczających standard wychodzi w poniedziałki.
        </Text>
      </div>
      {staff && (
        <Menu position="bottom-end" width={290}>
            <Menu.Target>
              <Button leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={14} />}>
                Dodaj szkolenie
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} to="/pracownicy" leftSection={<IconPencil size={16} />}>
                Wpisz ręcznie (w kartotece pracownika)
              </Menu.Item>
              <Menu.Item component={Link} to="/pracownicy" leftSection={<IconUsers size={16} />}>
                Dla kilku osób (zaznacz na liście pracowników)
              </Menu.Item>
              <Menu.Item component={Link} to="/szkolenia/import" leftSection={<IconFileSpreadsheet size={16} />}>
                Importuj z arkusza (Excel, Numbers, CSV)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
      )}
      </Group>
      <Tabs defaultValue="expiring" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="expiring">Kończące się (30 dni)</Tabs.Tab>
          <Tabs.Tab value="progress">W trakcie</Tabs.Tab>
          <Tabs.Tab value="matrix">Matryca</Tabs.Tab>
          <Tabs.Tab value="report">Raport</Tabs.Tab>
          <Tabs.Tab value="requirements">Wymagania stanowisk</Tabs.Tab>
          {staff && <Tabs.Tab value="types">Rodzaje szkoleń</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="expiring">
          <Expiring />
        </Tabs.Panel>
        <Tabs.Panel value="progress">
          <InProgress />
        </Tabs.Panel>
        <Tabs.Panel value="matrix">
          <CompetenceMatrix />
        </Tabs.Panel>
        <Tabs.Panel value="requirements">
          <PositionRequirements />
        </Tabs.Panel>
        <Tabs.Panel value="report">
          <TrainingsReport />
        </Tabs.Panel>
        {staff && (
          <Tabs.Panel value="types">
            <Types />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

/** Telefon: „Terminy” i „Matryca” jako zakładki (przesuwane palcem), rzadsze widoki pod „⋯” jako osobne ekrany. */
function TrainingsMobilePage({ staff }: { staff: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sub = params.get("widok");
  const [tab, setTab] = useState(params.get("zakladka") === "matryca" ? "matrix" : "dates");
  const [addOpen, setAddOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [reportMenu, setReportMenu] = useState(false);
  const [typeModal, setTypeModal] = useState<{ open: boolean; editing: TrainingType | null }>({ open: false, editing: null });
  const exp = useQuery({ queryKey: ["trainings-expiring"], queryFn: () => api<ExpiringTraining[]>("/trainings/expiring") });
  const prog = useQuery({ queryKey: ["trainings-in-progress"], queryFn: () => api<InProgressTraining[]>("/trainings/in-progress") });
  const types = useQuery({ queryKey: ["training-types"], queryFn: () => api<TrainingType[]>("/training-types"), enabled: sub === "rodzaje" });
  const SUBS: Record<string, string> = { raport: "Raport", wymagania: "Wymagania stanowisk", rodzaje: "Rodzaje szkoleń" };
  useMobileHeader(sub && SUBS[sub] ? { title: "Szkolenia", back: "/szkolenia" } : null);
  const open = (w: string) => setParams({ widok: w });
  const addActions = [
    { label: "Jednej osobie", description: "W karcie pracownika, zakładka Szkolenia", icon: <IconPencil size={20} />, onClick: () => navigate("/pracownicy") },
    { label: "Kilku osobom naraz", description: "Pracownicy → ⋯ → Zaznacz kilka osób → Dodaj szkolenie", icon: <IconUsers size={20} />, onClick: () => navigate("/pracownicy") },
    { label: "Import z arkusza", description: "Excel, Numbers lub CSV", icon: <IconFileSpreadsheet size={20} />, onClick: () => navigate("/szkolenia/import") },
  ];

  if (sub && SUBS[sub]) {
    return (
      <Stack gap="md">
        {sub === "raport" && (
          <>
            <PageHead title="Raport" subtitle="Wszystkie wpisy szkoleń" extra={{ label: "Pobierz raport", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setReportMenu(true) }} />
            <ReportMobile menu={reportMenu} onMenuClose={() => setReportMenu(false)} />
          </>
        )}
        {sub === "wymagania" && (
          <>
            <PageHead title="Wymagania" subtitle="Szkolenia obowiązkowe na stanowiskach" />
            <RequirementsMobile />
          </>
        )}
        {sub === "rodzaje" && (
          <>
            <PageHead title="Rodzaje" subtitle="Rodzaje szkoleń i uprawnień" action={{ label: "Dodaj rodzaj", icon: <IconPlus size={22} />, onClick: () => setTypeModal({ open: true, editing: null }) }} />
            {types.isLoading && <Loading rows={4} />}
            {types.data && (
              <div className="ui-group">
                {types.data.map((t) => (
                  <ListRow
                    key={t.id}
                    onClick={() => setTypeModal({ open: true, editing: t })}
                    title={t.name}
                    description={
                      <>
                        {[
                          t.kind === "position" ? "Stanowiskowe" : "Szkolenie / uprawnienie",
                          t.validity_months ? `ważność ${t.validity_months} mies.` : "bez okresu ważności",
                          t.kind === "position" ? `katalog: ${t.programs.length}` : null,
                          t.template_name ? `szablon: ${t.template_name}` : null,
                          `wpisów: ${t.in_use}`,
                        ].filter(Boolean).join(" · ")}
                        {!t.is_active && (
                          <>
                            <br />
                            <StatusBadge tone="neutral">Wyłączony</StatusBadge>
                          </>
                        )}
                      </>
                    }
                  />
                ))}
              </div>
            )}
            <Text size="sm" c="dimmed">Dotknij rodzaju, aby zmienić nazwę, ważność, katalog lub szablon dokumentu.</Text>
            <TypeModal editing={typeModal.editing} opened={typeModal.open} onClose={() => setTypeModal({ open: false, editing: null })} />
          </>
        )}
      </Stack>
    );
  }

  const nExp = exp.data?.length ?? 0;
  const nProg = prog.data?.length ?? 0;
  return (
    <Stack gap="md">
      <PageHead
        title="Szkolenia"
        subtitle={nExp ? `${nExp} ${nExp === 1 ? "kończy się" : "kończą się"} w 30 dni` : "Nic nie kończy się w 30 dni"}
        extra={{ label: "Więcej widoków", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setMore(true) }}
        action={staff ? { label: "Dodaj szkolenie", icon: <IconPlus size={22} />, onClick: () => setAddOpen(true) } : undefined}
      />
      <Segments
        value={tab}
        onChange={setTab}
        items={[
          { value: "dates", label: nExp ? `Terminy · ${nExp}` : "Terminy" },
          { value: "matrix", label: "Matryca" },
        ]}
      />
      <SwipePager index={tab === "dates" ? 0 : 1} onIndex={(i) => setTab(i === 0 ? "dates" : "matrix")}>
        {[
          <Stack key="d" gap="md">
            <GroupLabel warn={nExp > 0}>Kończą się w 30 dni{nExp ? ` · ${nExp}` : ""}</GroupLabel>
            <Expiring mobile />
            <GroupLabel>W trakcie{nProg ? ` · ${nProg}` : ""}</GroupLabel>
            <InProgress mobile />
            <Text size="sm" c="dimmed">Przypomnienie e-mail o kończących się i przekraczających standard wychodzi w poniedziałki.</Text>
          </Stack>,
          <MatrixMobile key="m" />,
        ]}
      </SwipePager>
      <ActionSheet
        opened={more}
        onClose={() => setMore(false)}
        title="Szkolenia"
        actions={[
          { label: "Raport", description: "Wszystkie wpisy z filtrami i eksportem", icon: <IconReportAnalytics size={20} />, onClick: () => open("raport") },
          { label: "Wymagania stanowisk", description: "Co jest obowiązkowe na stanowisku", icon: <IconListCheck size={20} />, onClick: () => open("wymagania") },
          ...(staff ? [{ label: "Rodzaje szkoleń", description: "Słownik rodzajów, ważność, katalog, szablony", icon: <IconCategory size={20} />, onClick: () => open("rodzaje") }] : []),
          ...(staff ? [{ label: "Import z arkusza", description: "Excel, Numbers lub CSV", icon: <IconFileSpreadsheet size={20} />, onClick: () => navigate("/szkolenia/import") }] : []),
        ]}
      />
      <ActionSheet opened={addOpen} onClose={() => setAddOpen(false)} title="Dodaj szkolenie" actions={addActions} />
    </Stack>
  );
}
