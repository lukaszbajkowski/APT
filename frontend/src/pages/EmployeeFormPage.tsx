import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Card, Group, Input, Modal, SegmentedControl, SimpleGrid, Stack, Text, Paper, TextInput, Textarea, Title } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";

import { api, ApiError, errorText, type DuplicateRef, type Employee } from "../api";
import { useAuth } from "../auth";
import { options, useAgencies, useCountries, useDepartments, usePositions } from "../dictionaries";
import { parsePesel } from "../pesel";
import { Loading } from "../components/States";
import { DateField } from "../components/DateField";
import { UnstyledButton } from "@mantine/core";
import { useMobileHeader, useNavHeightVar } from "../components/Mobile";
import type { ReactNode } from "react";
import { useIsPhone } from "../lib/device";

/* Grupa pól: na komputerze karta, na telefonie etykieta sekcji bez ramki (formularz na pełnym ekranie). */
function Block({ mobile, title, children }: { mobile: boolean; title: string; children: ReactNode }) {
  if (mobile)
    return (
      <section className="ui-form-group">
        {title && <h2 className="ui-section-title">{title}</h2>}
        {children}
      </section>
    );
  return (
    <Card withBorder padding="lg">
      {title && (
        <Title order={4} mb="sm">
          {title}
        </Title>
      )}
      {children}
    </Card>
  );
}

interface FormState {
  last_name: string;
  first_name: string;
  pesel: string;
  clear_pesel: boolean;
  birth_date: string;
  sex: "" | "K" | "M";
  country_id: string | null;
  agency_id: string | null;
  department_id: string | null;
  position_id: string | null;
  hire_date: string;
  notes: string;
}

const EMPTY: FormState = {
  last_name: "",
  first_name: "",
  pesel: "",
  clear_pesel: false,
  birth_date: "",
  sex: "",
  country_id: null,
  agency_id: null,
  department_id: null,
  position_id: null,
  hire_date: "",
  notes: "",
};

function fromEmployee(e: Employee): FormState {
  return {
    last_name: e.last_name,
    first_name: e.first_name,
    pesel: "",
    clear_pesel: false,
    birth_date: e.birth_date ?? "",
    sex: e.sex ?? "",
    country_id: e.country ? String(e.country.id) : null,
    agency_id: e.agency ? String(e.agency.id) : null,
    department_id: e.department ? String(e.department.id) : null,
    position_id: e.position ? String(e.position.id) : null,
    hire_date: e.hire_date ?? "",
    notes: e.notes ?? "",
  };
}

const num = (v: string | null) => (v ? Number(v) : null);
const str = (v: string) => (v.trim() ? v.trim() : null);

function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("pl-PL");
}

function payload(f: FormState): Record<string, unknown> {
  return {
    last_name: f.last_name.trim(),
    first_name: f.first_name.trim(),
    birth_date: f.birth_date || null,
    sex: f.sex || null,
    country_id: num(f.country_id),
    agency_id: num(f.agency_id),
    department_id: num(f.department_id),
    position_id: num(f.position_id),
    hire_date: f.hire_date || null,
    notes: str(f.notes),
  };
}

/** Osadzenie w okienku na karcie pracownika (komputer): bez nagłówka strony, przyciski na dole okienka. */
export interface EmbedForm {
  id: string;
  part: "dane" | "zatrudnienie";
  onClose: () => void;
}

export function EmployeeFormPage({ embed }: { embed?: EmbedForm } = {}) {
  const params0 = useParams();
  const id = embed?.id ?? params0.id;
  const editing = id !== undefined;
  // komputer: osobno dane osobowe (poprawki) i zatrudnienie (zmiana od dnia, ślad w przebiegu)
  const [params] = useSearchParams();
  const part = editing ? (embed?.part ?? (params.get("czesc") as "dane" | "zatrudnienie" | null)) : null;
  const showPersonal = part !== "zatrudnienie";
  const showEmployment = part !== "dane";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const mobile = useIsPhone();
  useNavHeightVar();

  const employee = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api<Employee>(`/employees/${id}`),
    enabled: editing,
  });
  const agencies = useAgencies();
  const departments = useDepartments();
  const positions = usePositions();
  const countries = useCountries();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [peselDuplicate, setPeselDuplicate] = useState<DuplicateRef | null>(null);
  const [possibleDuplicate, setPossibleDuplicate] = useState<DuplicateRef | null>(null);

  useEffect(() => {
    if (employee.data) {
      const f = fromEmployee(employee.data);
      setForm(f);
      setOriginal(f);
    }
  }, [employee.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // PESEL: natychmiastowa walidacja i uzupełnienie daty urodzenia i płci.
  const peselCheck = useMemo(() => (form.pesel.trim() ? parsePesel(form.pesel) : null), [form.pesel]);
  useEffect(() => {
    setPeselDuplicate(null);
    if (peselCheck?.valid) {
      setForm((f) => ({ ...f, birth_date: peselCheck.birthDate, sex: peselCheck.sex }));
      const exclude = editing ? `?exclude_id=${id}` : "";
      api<{ duplicate_of: DuplicateRef | null }>(`/employees/check-pesel${exclude}`, {
        method: "POST",
        body: { pesel: form.pesel },
      })
        .then((r) => setPeselDuplicate(r.duplicate_of))
        .catch(() => undefined);
    }
  }, [peselCheck, editing, id, form.pesel]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const [effectiveDate, setEffectiveDate] = useState(todayIso);
  const assignmentChanged =
    editing &&
    !!original &&
    (form.agency_id !== original.agency_id ||
      form.department_id !== original.department_id ||
      form.position_id !== original.position_id);

  const save = useMutation({
    mutationFn: async (confirmDuplicate: boolean) => {
      const body = payload(form);
      if (editing && original) {
        const before = payload(original);
        for (const key of Object.keys(body)) {
          if (JSON.stringify(body[key]) === JSON.stringify(before[key])) delete body[key];
        }
        if (!staff) {
          for (const key of Object.keys(body)) if (!["position_id", "notes"].includes(key)) delete body[key];
        }
      }
      if (form.pesel.trim()) body.pesel = form.pesel.trim();
      else if (form.clear_pesel) body.pesel = "";
      if (confirmDuplicate) body.confirm_duplicate = true;
      if (assignmentChanged && effectiveDate) body.effective_date = effectiveDate;
      return editing
        ? api<Employee>(`/employees/${id}`, { method: "PATCH", body })
        : api<Employee>("/employees", { method: "POST", body });
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.setQueryData(["employee", String(e.id)], e);
      qc.invalidateQueries({ queryKey: ["planned-changes", e.id] });
      qc.invalidateQueries({ queryKey: ["employee-timeline", e.id] });
      notifications.show({
        color: "green",
        message: !editing
          ? `Dodano pracownika nr ${e.number_display}.`
          : assignmentChanged && effectiveDate > todayIso
            ? `Zapisano. Zmiana przydziału zaplanowana na ${new Date(effectiveDate + "T00:00:00").toLocaleDateString("pl-PL")}.`
            : "Zapisano zmiany.",
      });
      if (embed) embed.onClose();
      else navigate(`/pracownicy/${e.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "possible_duplicate") {
        setPossibleDuplicate(err.data?.employee as DuplicateRef);
        return;
      }
      if (err instanceof ApiError && err.code === "pesel_duplicate") {
        setPeselDuplicate(err.data?.employee as DuplicateRef);
      }
      setFe((err instanceof ApiError ? (err.data?.fields as Record<string, string> | undefined) : undefined) ?? {});
      setError(errorText(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const missing: Record<string, string> = {};
    if (!form.last_name.trim()) missing.last_name = "Wpisz nazwisko.";
    if (!form.first_name.trim()) missing.first_name = "Wpisz imię.";
    setFe(missing);
    if (Object.keys(missing).length) {
      setError("Uzupełnij zaznaczone pola.");
      return;
    }
    if (peselCheck && !peselCheck.valid) {
      setError(peselCheck.message);
      return;
    }
    save.mutate(false);
  }

  useMobileHeader(
    mobile
      ? {
          title: editing ? "Edycja danych" : "Nowy pracownik",
          subtitle: editing ? (employee.data ? `${employee.data.last_name} ${employee.data.first_name} · nr ${employee.data.number_display}` : undefined) : "Numer nada się po zapisaniu",
          back: editing ? `/pracownicy/${id}` : "/pracownicy",
        }
      : null,
  );
  if (editing && employee.isLoading) return <Loading />;
  if (editing && employee.error) return <Alert color="red">{errorText(employee.error)}</Alert>;

  const personalLocked = !staff;
  // z numerem PESEL (nowym albo zapisanym w kartotece) data urodzenia i płeć wynikają z niego – nie da się ich zmienić
  const fromPesel = !!peselCheck?.valid || (editing && !!employee.data?.has_pesel && !form.clear_pesel && !form.pesel.trim());
  const current = employee.data;
  const positionOptions = options(positions.data, num(form.position_id), (p) =>
    !form.department_id ? true : p.department_id === null || p.department_id === Number(form.department_id),
  );

  return (
    <form onSubmit={submit} className={mobile ? "ui-inpage" : embed ? "ui-embed-form" : undefined}>
      <Stack maw={embed ? undefined : 900} className={mobile ? "ui-chat-body ui-form-body" : undefined} gap={mobile ? 24 : undefined}>
        {!embed && (
        <Group justify="space-between" className="ui-desktop-only">
          <div>
            <Anchor component={Link} to={editing ? `/pracownicy/${id}` : "/pracownicy"} size="sm" className="ui-desktop-only">
              <Group gap={4}>
                <IconArrowLeft size={14} /> {editing ? "Wróć do profilu" : "Wróć do listy"}
              </Group>
            </Anchor>
            <Title order={2} mt={4} className="ui-desktop-only">
              {!editing
                ? "Nowy pracownik"
                : part === "dane"
                  ? `Dane osobowe: ${current?.last_name ?? ""} ${current?.first_name ?? ""}`
                  : part === "zatrudnienie"
                    ? `Zatrudnienie: ${current?.last_name ?? ""} ${current?.first_name ?? ""}`
                    : `Edycja: ${current?.last_name ?? ""} ${current?.first_name ?? ""}`}
            </Title>
            {editing && current && (
              <Text c="dimmed" size="sm">
                Nr ewidencyjny {current.number_display}
              </Text>
            )}
            {!editing && (
              <Text c="dimmed" size="sm">
                Numer ewidencyjny zostanie nadany automatycznie po zapisaniu.
              </Text>
            )}
          </div>
        </Group>
        )}

        {mobile && (!form.last_name.trim() || !form.first_name.trim()) && (
          <span className="ui-hint-warn">Wpisz nazwisko i imię – reszta danych jest nieobowiązkowa.</span>
        )}
        {!editing && peselDuplicate?.archived && (
          <Alert color="blue" title="Ta osoba jest już w kartotece (archiwum)">
            {peselDuplicate.name} (nr {peselDuplicate.number}) – zwolniona
            {peselDuplicate.termination_date ? ` ${new Date(peselDuplicate.termination_date).toLocaleDateString("pl-PL")}` : ""}.
            Zamiast zakładać nową kartotekę, zatrudnij ją ponownie – zachowasz numer, historię, szkolenia i dokumenty.
            <Group mt="xs">
              <Button component={Link} to={`/pracownicy/${peselDuplicate.id}?rehire=1`} size="xs">
                Zatrudnij ponownie
              </Button>
            </Group>
          </Alert>
        )}
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
            {peselDuplicate && (
              <>
                {" "}
                <Anchor component={Link} to={`/pracownicy/${peselDuplicate.id}`}>
                  Otwórz: {peselDuplicate.name} ({peselDuplicate.number})
                </Anchor>
              </>
            )}
          </Alert>
        )}
        {personalLocked && (
          <Alert color="blue" variant="light">
            Jako kierownik możesz zmienić tylko stanowisko i uwagi.
          </Alert>
        )}

        {showPersonal && (
        <Block mobile={!!mobile || !!embed} title={part ? "" : "Dane osobowe"}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={16} verticalSpacing={16}>
            <TextInput
              label="Nazwisko"
              required
              disabled={personalLocked}
              value={form.last_name}
              error={fe.last_name}
              onChange={(e) => set("last_name", e.currentTarget.value)}
            />
            <TextInput
              label="Imię"
              required
              disabled={personalLocked}
              value={form.first_name}
              error={fe.first_name}
              onChange={(e) => set("first_name", e.currentTarget.value)}
            />
            {staff && (
              <TextInput
                label="PESEL"
                inputMode="numeric"
                maxLength={13}
                autoComplete="off"
                placeholder={
                  editing && current?.has_pesel && !form.clear_pesel
                    ? `bez zmian (${current.pesel_masked})`
                    : "11 cyfr"
                }
                description={
                  editing && current?.has_pesel ? (
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      onClick={() => set("clear_pesel", !form.clear_pesel)}
                    >
                      {form.clear_pesel ? "Anuluj usuwanie numeru PESEL" : "Usuń numer PESEL"}
                    </Anchor>
                  ) : (
                    "Data urodzenia i płeć uzupełnią się same."
                  )
                }
                error={
                  peselCheck && !peselCheck.valid
                    ? peselCheck.message
                    : peselDuplicate
                      ? `Ten PESEL ma już ${peselDuplicate.name} (nr ${peselDuplicate.number}).`
                      : form.clear_pesel
                        ? "Numer PESEL zostanie usunięty po zapisaniu."
                        : undefined
                }
                value={form.pesel}
                onChange={(e) => set("pesel", e.currentTarget.value.replace(/[^\d\s]/g, ""))}
              />
            )}
            {staff && (
              <DateField
                label="Data urodzenia"
                description={fromPesel ? "Wynika z numeru PESEL" : undefined}
                disabled={fromPesel}
                value={form.birth_date}
                onChange={(e) => set("birth_date", e.currentTarget.value)}
              />
            )}
            <Input.Wrapper label="Płeć" description={fromPesel ? "Wynika z numeru PESEL" : undefined}>
              {mobile ? (
                <div className="ui-seg2" role="radiogroup" aria-label="Płeć" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  {([["K", "Kobieta"], ["M", "Mężczyzna"], ["none", "Nie podano"]] as const).map(([v, l]) => {
                    const on = (form.sex || "none") === v;
                    return (
                      <UnstyledButton key={v} role="radio" aria-checked={on} data-on={on || undefined} disabled={personalLocked || fromPesel} onClick={() => set("sex", v === "none" ? "" : v)}>
                        {l}
                      </UnstyledButton>
                    );
                  })}
                </div>
              ) : (
                <SegmentedControl
                  fullWidth
                  disabled={personalLocked || fromPesel}
                  value={form.sex || "none"}
                  onChange={(v) => set("sex", v === "none" ? "" : (v as "K" | "M"))}
                  data={[
                    { value: "K", label: "Kobieta" },
                    { value: "M", label: "Mężczyzna" },
                    { value: "none", label: "Nie podano" },
                  ]}
                />
              )}
            </Input.Wrapper>
            {staff && (
              <Select
                label="Obywatelstwo"
                searchable
                clearable
                data={options(countries.data, num(form.country_id))}
                value={form.country_id}
                onChange={(v) => set("country_id", v)}
              />
            )}
          </SimpleGrid>
        </Block>
        )}

        {showEmployment && (
        <Block mobile={!!mobile || !!embed} title={part ? "" : "Zatrudnienie"}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={16} verticalSpacing={16}>
            <Select
              label="APT (agencja pracy)"
              searchable
              clearable
              disabled={personalLocked}
              data={options(agencies.data, num(form.agency_id))}
              value={form.agency_id}
              onChange={(v) => set("agency_id", v)}
              nothingFoundMessage="Brak – dodaj APT w Słownikach"
            />
            <DateField
              label="Data zatrudnienia"
              
              disabled={personalLocked}
              value={form.hire_date}
              error={fe.hire_date}
              onChange={(e) => set("hire_date", e.currentTarget.value)}
            />
            <Select
              label="Wydział"
              searchable
              clearable
              disabled={personalLocked}
              data={options(departments.data, num(form.department_id))}
              value={form.department_id}
              onChange={(v) => {
                const pos = positions.data?.find((p) => String(p.id) === form.position_id);
                const keepPosition = !pos || pos.department_id === null || String(pos.department_id) === v;
                setForm((f) => ({ ...f, department_id: v, position_id: keepPosition ? f.position_id : null }));
              }}
            />
            <Select
              label="Stanowisko"
              searchable
              clearable
              data={positionOptions}
              value={form.position_id}
              placeholder={!form.department_id ? "Najpierw wybierz wydział (zawęzi listę)" : undefined}
              onChange={(v) => {
                // wybór stanowiska uzupełnia wydział, do którego ono należy
                const pos = positions.data?.find((p) => String(p.id) === v);
                setForm((f) => ({
                  ...f,
                  position_id: v,
                  department_id: !f.department_id && pos?.department_id ? String(pos.department_id) : f.department_id,
                }));
              }}
            />
          </SimpleGrid>
          {assignmentChanged && (
            <Paper withBorder p="sm" mt="md" radius="md" bg="var(--mantine-color-blue-light)">
              <Group align="flex-end" gap="md" wrap="wrap">
                <DateField
                  
                  label="Zmiana APT / wydziału / stanowiska obowiązuje od"
                  value={effectiveDate}
                  min={current?.hire_date ?? undefined}
                  onChange={(e) => setEffectiveDate(e.currentTarget.value)}
                  w={300}
                />
                <Text size="xs" c={effectiveDate > todayIso ? "blue" : "dimmed"} mb={8} style={{ flex: 1, minWidth: 200 }}>
                  {effectiveDate > todayIso
                    ? `Zaplanowana zmiana: do ${dayBefore(effectiveDate)} obowiązuje obecny przydział, a nowy aplikacja wprowadzi sama w dniu ${new Date(effectiveDate + "T00:00:00").toLocaleDateString("pl-PL")}. Pozostałe zmiany w formularzu zapiszą się od razu.`
                    : `Poprzedni przydział kończy się dzień wcześniej${effectiveDate ? ` (${dayBefore(effectiveDate)})` : ""}. Zapisze się w „Przebiegu zatrudnienia”.`}
                </Text>
              </Group>
            </Paper>
          )}
          <Textarea
            mt={embed ? undefined : "md"}
            label="Uwagi"
            autosize
            minRows={2}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => set("notes", e.currentTarget.value)}
          />
        </Block>
        )}

        {!mobile && embed && (
          <Group justify="flex-end" className="ui-modal-foot">
            <Button variant="default" onClick={embed.onClose}>
              Anuluj
            </Button>
            <Button type="submit" loading={save.isPending}>
              Zapisz zmiany
            </Button>
          </Group>
        )}
        {!mobile && !embed && (
          <Group justify="flex-end">
            <Button variant="default" component={Link} to={editing ? `/pracownicy/${id}` : "/pracownicy"}>
              Anuluj
            </Button>
            <Button type="submit" loading={save.isPending}>
              {editing ? "Zapisz zmiany" : "Dodaj pracownika"}
            </Button>
          </Group>
        )}
      </Stack>
      {mobile && (
        <div className="ui-chat-compose">
          <Button size="lg" radius="md" variant="default" component={Link} to={editing ? `/pracownicy/${id}` : "/pracownicy"} style={{ flex: "none", minWidth: 110 }}>
            Anuluj
          </Button>
          <Button size="lg" radius="md" fullWidth type="submit" loading={save.isPending} disabled={!form.last_name.trim() || !form.first_name.trim()}>
            {editing ? "Zapisz zmiany" : "Dodaj pracownika"}
          </Button>
        </div>
      )}

      <Modal opened={possibleDuplicate !== null} onClose={() => setPossibleDuplicate(null)} title="Możliwy duplikat">
        <Stack>
          <Text size="sm">
            W kartotece jest już osoba o tym samym imieniu, nazwisku i dacie urodzenia:
          </Text>
          {possibleDuplicate && (
            <Anchor component={Link} to={`/pracownicy/${possibleDuplicate.id}`} target="_blank">
              {possibleDuplicate.name} (nr {possibleDuplicate.number})
            </Anchor>
          )}
          <Text size="sm">Czy na pewno to inna osoba?</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPossibleDuplicate(null)}>
              Wróć do formularza
            </Button>
            <Button
              color="orange"
              loading={save.isPending}
              onClick={() => {
                setPossibleDuplicate(null);
                save.mutate(true);
              }}
            >
              To inna osoba – zapisz
            </Button>
          </Group>
        </Stack>
      </Modal>
    </form>
  );
}
