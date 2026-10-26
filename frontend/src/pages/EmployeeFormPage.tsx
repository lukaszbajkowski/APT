import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";

import { api, ApiError, errorText, type DuplicateRef, type Employee } from "../api";
import { useAuth } from "../auth";
import { options, useAgencies, useCountries, useDepartments, usePositions } from "../dictionaries";
import { parsePesel } from "../pesel";

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

export function EmployeeFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");

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
      return editing
        ? api<Employee>(`/employees/${id}`, { method: "PATCH", body })
        : api<Employee>("/employees", { method: "POST", body });
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.setQueryData(["employee", String(e.id)], e);
      notifications.show({
        color: "green",
        message: editing ? "Zapisano zmiany." : `Dodano pracownika nr ${e.number_display}.`,
      });
      navigate(`/pracownicy/${e.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "possible_duplicate") {
        setPossibleDuplicate(err.data?.employee as DuplicateRef);
        return;
      }
      if (err instanceof ApiError && err.code === "pesel_duplicate") {
        setPeselDuplicate(err.data?.employee as DuplicateRef);
      }
      setError(errorText(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (peselCheck && !peselCheck.valid) {
      setError(peselCheck.message);
      return;
    }
    save.mutate(false);
  }

  if (editing && employee.isLoading) return <Loader />;
  if (editing && employee.error) return <Alert color="red">{errorText(employee.error)}</Alert>;

  const personalLocked = !staff;
  const current = employee.data;
  const positionOptions = options(positions.data, num(form.position_id), (p) =>
    !form.department_id ? true : p.department_id === null || p.department_id === Number(form.department_id),
  );

  return (
    <form onSubmit={submit}>
      <Stack maw={900}>
        <Group justify="space-between">
          <div>
            <Anchor component={Link} to={editing ? `/pracownicy/${id}` : "/pracownicy"} size="sm">
              <Group gap={4}>
                <IconArrowLeft size={14} /> {editing ? "Wróć do profilu" : "Wróć do listy"}
              </Group>
            </Anchor>
            <Title order={2} mt={4}>
              {editing ? `Edycja: ${current?.last_name} ${current?.first_name}` : "Nowy pracownik"}
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

        <Card withBorder padding="lg">
          <Title order={4} mb="sm">
            Dane osobowe
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Nazwisko"
              required
              disabled={personalLocked}
              value={form.last_name}
              onChange={(e) => set("last_name", e.currentTarget.value)}
            />
            <TextInput
              label="Imię"
              required
              disabled={personalLocked}
              value={form.first_name}
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
              <TextInput
                label="Data urodzenia"
                type="date"
                disabled={!!peselCheck?.valid}
                value={form.birth_date}
                onChange={(e) => set("birth_date", e.currentTarget.value)}
              />
            )}
            <div>
              <Text size="sm" fw={500} mb={4}>
                Płeć
              </Text>
              <SegmentedControl
                disabled={personalLocked || !!peselCheck?.valid}
                value={form.sex || "none"}
                onChange={(v) => set("sex", v === "none" ? "" : (v as "K" | "M"))}
                data={[
                  { value: "K", label: "Kobieta" },
                  { value: "M", label: "Mężczyzna" },
                  { value: "none", label: "—" },
                ]}
              />
            </div>
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
        </Card>

        <Card withBorder padding="lg">
          <Title order={4} mb="sm">
            Zatrudnienie
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="APT"
              searchable
              clearable
              disabled={personalLocked}
              data={options(agencies.data, num(form.agency_id))}
              value={form.agency_id}
              onChange={(v) => set("agency_id", v)}
              nothingFoundMessage="Brak – dodaj APT w Słownikach"
            />
            <TextInput
              label="Data zatrudnienia"
              type="date"
              disabled={personalLocked}
              value={form.hire_date}
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
              onChange={(v) => set("position_id", v)}
            />
          </SimpleGrid>
          <Textarea
            mt="md"
            label="Uwagi"
            autosize
            minRows={2}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => set("notes", e.currentTarget.value)}
          />
        </Card>

        <Group justify="flex-end">
          <Button variant="default" component={Link} to={editing ? `/pracownicy/${id}` : "/pracownicy"}>
            Anuluj
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? "Zapisz zmiany" : "Dodaj pracownika"}
          </Button>
        </Group>
      </Stack>

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
