import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SavedFilters } from "../components/SavedFilters";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Paper,
  Group,
  Menu,
  MultiSelect,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCertificate, IconChevronDown, IconFileSpreadsheet, IconFileText, IconPencil, IconPlus, IconPrinter, IconSearch } from "@tabler/icons-react";

import { api, apiDownload, errorText, formatDate, type Employee, type Page } from "../api";
import { notifications } from "@mantine/notifications";
import { useAuth } from "../auth";
import { options, useAgencies, useDepartments, usePositions } from "../dictionaries";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { PrintCardsModal } from "../components/PrintCardsModal";
import { BatchDocumentsModal } from "../components/BatchDocumentsModal";
import { TrainingModal } from "../components/TrainingsCard";
import { Loading } from "../components/States";

const PAGE_SIZE = 50;

const MISSING = [
  { value: "photo", label: "brak zdjęcia" },
  { value: "pesel", label: "brak PESEL" },
  { value: "birth_date", label: "brak daty urodzenia" },
  { value: "country", label: "brak obywatelstwa" },
  { value: "agency", label: "brak APT" },
  { value: "department", label: "brak wydziału" },
  { value: "position", label: "brak stanowiska" },
];

export function EmployeesPage() {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "hr");
  const canPrint = hasRole("admin", "hr", "manager");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "active";
  const agency = params.get("agency");
  const department = params.get("department");
  const position = params.get("position");
  const missing = params.getAll("missing");
  const sort = params.get("sort") ?? "name";
  const page = Number(params.get("page") ?? "1");
  const [debouncedQ] = useDebouncedValue(q, 300);

  const agencies = useAgencies();
  const departments = useDepartments();
  const positions = usePositions();

  function update(changes: Record<string, string | string[] | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value !== null && value !== "") next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({
      status,
      sort,
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    if (agency) p.set("agency_id", agency);
    if (department) p.set("department_id", department);
    if (position) p.set("position_id", position);
    missing.forEach((m) => p.append("missing", m));
    return p.toString();
  }, [status, sort, page, debouncedQ, agency, department, position, missing]);

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    p.delete("limit");
    p.delete("offset");
    return p.toString();
  }, [query]);

  const [exporting, setExporting] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  async function exportXlsx(withPesel: boolean, format: "xlsx" | "pdf" = "xlsx") {
    setExporting(true);
    try {
      const q = new URLSearchParams(filterQuery);
      if (withPesel) q.set("include_pesel", "true");
      if (format === "pdf") q.set("format", "pdf");
      await apiDownload(`/reports/employees.xlsx?${q.toString()}`, undefined, `pracownicy.${format}`);
      notifications.show({
        color: withPesel ? "orange" : "green",
        message: withPesel
          ? "Pobrano listę z numerami PESEL – przechowuj plik bezpiecznie i usuń, gdy nie będzie potrzebny."
          : "Pobrano listę pracowników.",
      });
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setExporting(false);
    }
  }

  async function selectAllResults() {
    setSelectingAll(true);
    try {
      const ids = await api<number[]>(`/employees/ids?${filterQuery}`);
      setSelected(new Set(ids));
    } finally {
      setSelectingAll(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const list = useQuery({
    queryKey: ["employees", query],
    queryFn: () => api<Page<Employee>>(`/employees?${query}`),
    placeholderData: keepPreviousData,
  });

  const sortHeader = (key: string, label: string) => {
    const active = sort === key || sort === `-${key}`;
    const desc = sort === `-${key}`;
    return (
      <Table.Th>
        <button
          type="button"
          onClick={() => update({ sort: active && !desc ? `-${key}` : key }, false)}
          style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}
        >
          {label}
          {active ? (desc ? " ↓" : " ↑") : ""}
        </button>
      </Table.Th>
    );
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Pracownicy</Title>
          {list.data && (
            <Text size="sm" c="dimmed">
              {list.data.total === 0 ? "Brak wyników" : `Znaleziono: ${list.data.total}`}
            </Text>
          )}
        </div>
        {staff && (
          <Menu position="bottom-end" width={290}>
            <Menu.Target>
              <Button leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={14} />}>
                Dodaj pracownika
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} to="/pracownicy/nowy" leftSection={<IconPencil size={16} />}>
                Wpisz ręcznie
              </Menu.Item>
              <Menu.Item component={Link} to="/pracownicy/import" leftSection={<IconFileSpreadsheet size={16} />}>
                Importuj z arkusza (Excel, Numbers, CSV)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <Group align="flex-end" gap="sm">
        <TextInput
          label="Szukaj"
          placeholder="nazwisko, imię lub numer"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => update({ q: e.currentTarget.value })}
          w={260}
        />
        <SegmentedControl
          value={status}
          onChange={(v) => update({ status: v === "active" ? null : v })}
          data={[
            { value: "active", label: "Aktywni" },
            { value: "terminated", label: "Archiwum" },
            { value: "all", label: "Wszyscy" },
          ]}
        />
        <Select
          label="APT"
          placeholder="Wszystkie"
          clearable
          searchable
          w={200}
          data={options(agencies.data, agency ? Number(agency) : null)}
          value={agency}
          onChange={(v) => update({ agency: v })}
        />
        <Select
          label="Wydział"
          placeholder="Wszystkie"
          clearable
          searchable
          w={200}
          data={options(departments.data, department ? Number(department) : null)}
          value={department}
          onChange={(v) => update({ department: v, position: null })}
        />
        <Select
          label="Stanowisko"
          placeholder="Wszystkie"
          clearable
          searchable
          w={200}
          data={options(
            positions.data,
            position ? Number(position) : null,
            (p) => !department || p.department_id === null || p.department_id === Number(department),
          )}
          value={position}
          onChange={(v) => update({ position: v })}
        />
        <MultiSelect
          label="Braki danych"
          placeholder={missing.length ? undefined : "—"}
          clearable
          w={230}
          data={staff ? MISSING : MISSING.filter((m) => !["pesel", "birth_date"].includes(m.value))}
          value={missing}
          onChange={(v) => update({ missing: v })}
        />
        <SavedFilters params={params} onApply={(p) => setParams(p, { replace: true })} />
      </Group>

      {canPrint && list.data && list.data.total > 0 && (
        <Paper withBorder px="md" py={8} className={selected.size ? "row-selected" : undefined}>
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {selected.size ? (
                <>
                  Zaznaczono: <b>{selected.size}</b>
                </>
              ) : (
                "Zaznacz osoby, aby wydrukować karty."
              )}
            </Text>
            <Group gap="xs">
              {selected.size < list.data.total && (
                <Button size="xs" variant="subtle" loading={selectingAll} onClick={selectAllResults}>
                  Zaznacz wszystkie wyniki ({list.data.total})
                </Button>
              )}
              {selected.size > 0 && (
                <Button size="xs" variant="subtle" color="gray" onClick={() => setSelected(new Set())}>
                  Wyczyść
                </Button>
              )}
              <Button
                size="xs"
                leftSection={<IconPrinter size={14} />}
                disabled={selected.size === 0}
                onClick={() => setPrintOpen(true)}
              >
                Drukuj karty{selected.size ? ` (${selected.size})` : ""}
              </Button>
              {staff && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconFileText size={14} />}
                  disabled={selected.size === 0}
                  onClick={() => setDocsOpen(true)}
                >
                  Dokument{selected.size ? ` (${selected.size})` : ""}
                </Button>
              )}
              {staff && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconCertificate size={14} />}
                  disabled={selected.size === 0 || selected.size > 200}
                  onClick={() => setTrainingOpen(true)}
                >
                  Szkolenie{selected.size ? ` (${selected.size})` : ""}
                </Button>
              )}
              <Menu position="bottom-end" width={260}>
                <Menu.Target>
                  <Button size="xs" variant="default" leftSection={<IconFileSpreadsheet size={14} />} loading={exporting}>
                    Eksport ({list.data.total})
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Eksport wyników z bieżącymi filtrami</Menu.Label>
                  <Menu.Item onClick={() => exportXlsx(false)}>Pobierz listę (Excel)</Menu.Item>
                  <Menu.Item onClick={() => exportXlsx(false, "pdf")}>Pobierz listę (PDF)</Menu.Item>
                  {staff && (
                    <>
                      <Menu.Divider />
                      <Menu.Item color="orange" onClick={() => exportXlsx(true)}>
                        Z numerami PESEL (Excel)
                      </Menu.Item>
                      <Menu.Item color="orange" onClick={() => exportXlsx(true, "pdf")}>
                        Z numerami PESEL (PDF)
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </Paper>
      )}

      {list.isLoading && <Loading />}
      {list.error && <Alert color="red">{errorText(list.error)}</Alert>}

      {list.data && list.data.items.length > 0 && (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover verticalSpacing={6} striped>
            <Table.Thead>
              <Table.Tr>
                {canPrint && (
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label="Zaznacz wszystkich na tej stronie"
                      checked={list.data.items.every((e) => selected.has(e.id))}
                      indeterminate={
                        list.data.items.some((e) => selected.has(e.id)) &&
                        !list.data.items.every((e) => selected.has(e.id))
                      }
                      onChange={(ev) => {
                        const on = ev.currentTarget.checked;
                        setSelected((prev) => {
                          const next = new Set(prev);
                          list.data!.items.forEach((e) => (on ? next.add(e.id) : next.delete(e.id)));
                          return next;
                        });
                      }}
                    />
                  </Table.Th>
                )}
                <Table.Th w={52} />
                {sortHeader("number", "Nr")}
                {sortHeader("name", "Nazwisko i imię")}
                <Table.Th>APT</Table.Th>
                <Table.Th>Wydział</Table.Th>
                <Table.Th>Stanowisko</Table.Th>
                {sortHeader("hire_date", "Zatrudniony")}
                {status !== "active" && <Table.Th>Status</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.items.map((e) => (
                <Table.Tr
                  key={e.id}
                  style={{ cursor: "pointer" }}
                  className={selected.has(e.id) ? "row-selected" : undefined}
                  onClick={() => navigate(`/pracownicy/${e.id}`)}
                >
                  {canPrint && (
                    <Table.Td onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        aria-label={`Zaznacz ${e.last_name} ${e.first_name}`}
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <EmployeePhoto employee={e} width={30} />
                  </Table.Td>
                  <Table.Td ff="monospace">{e.number_display}</Table.Td>
                  <Table.Td>
                    <Link
                      to={`/pracownicy/${e.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                    >
                      {e.last_name} {e.first_name}
                    </Link>
                  </Table.Td>
                  <Table.Td>{e.agency?.name ?? "—"}</Table.Td>
                  <Table.Td>{e.department?.name ?? "—"}</Table.Td>
                  <Table.Td>{e.position?.name ?? "—"}</Table.Td>
                  <Table.Td>{formatDate(e.hire_date)}</Table.Td>
                  {status !== "active" && (
                    <Table.Td>
                      {e.status === "active" ? (
                        <Badge color="green" variant="light">
                          aktywny
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light">
                          archiwum
                        </Badge>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {list.data && list.data.total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(list.data.total / PAGE_SIZE)}
          value={page}
          onChange={(p) => update({ page: p === 1 ? null : String(p) }, false)}
        />
      )}

      {canPrint && (
        <PrintCardsModal ids={[...selected]} opened={printOpen} onClose={() => setPrintOpen(false)} />
      )}
      {trainingOpen && (
        <TrainingModal employeeIds={[...selected]} editing={null} opened={trainingOpen} onClose={() => setTrainingOpen(false)} />
      )}
      {docsOpen && <BatchDocumentsModal ids={[...selected]} opened={docsOpen} onClose={() => setDocsOpen(false)} />}
    </Stack>
  );
}
