import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
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
import { IconPlus, IconSearch } from "@tabler/icons-react";

import { api, errorText, formatDate, type Employee, type Page } from "../api";
import { useAuth } from "../auth";
import { options, useAgencies, useDepartments, usePositions } from "../dictionaries";
import { EmployeePhoto } from "../components/EmployeePhoto";

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
          <Button component={Link} to="/pracownicy/nowy" leftSection={<IconPlus size={16} />}>
            Dodaj pracownika
          </Button>
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
      </Group>

      {list.isLoading && <Loader />}
      {list.error && <Alert color="red">{errorText(list.error)}</Alert>}

      {list.data && list.data.items.length > 0 && (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover verticalSpacing={6} striped>
            <Table.Thead>
              <Table.Tr>
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
                <Table.Tr key={e.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/pracownicy/${e.id}`)}>
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
    </Stack>
  );
}
