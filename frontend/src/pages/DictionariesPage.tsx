import { useEffect, useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Group, Modal, Stack, Switch, Table, Tabs, Text, TextInput } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconSearch } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { options, useAgencies, useCountries, useDepartments, usePositions } from "../dictionaries";
import { ErrorState, Loading } from "../components/States";
import { CompactEmpty, FormScreen, ListRow, PageHead, Segments, StatusBadge, SwipePager, PageTitle } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

interface Item {
  id: number;
  name: string;
  is_active: boolean;
  code?: string | null;
  iso_code?: string | null;
  department_id?: number | null;
  email?: string | null;
}

type Kind = "agencies" | "departments" | "positions" | "countries";

const CONFIG: Record<Kind, { title: string; noun: string; codeLabel?: string; codeKey?: "code" | "iso_code" }> = {
  agencies: { title: "APT", noun: "APT", codeLabel: "Skrót (opcjonalnie)", codeKey: "code" },
  departments: { title: "Wydziały", noun: "wydział", codeLabel: "Skrót (opcjonalnie)", codeKey: "code" },
  positions: { title: "Stanowiska", noun: "stanowisko" },
  countries: { title: "Kraje", noun: "kraj", codeLabel: "Kod ISO (2 litery, opcjonalnie)", codeKey: "iso_code" },
};

function DictionaryTab({ kind, query, addSignal = 0, search }: { kind: Kind; query: UseQueryResult<Item[]>; addSignal?: number; /** wyszukiwanie z nagłówka ekranu (telefon) */ search?: string }) {
  const cfg = CONFIG[kind];
  const mobile = useIsPhone();
  const qc = useQueryClient();
  const departments = useDepartments();
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  function open(item: Item | "new") {
    setEditing(item);
    setError(null);
    if (item === "new") {
      setName("");
      setCode("");
      setEmail("");
      setDepartmentId(null);
      setActive(true);
    } else {
      setName(item.name);
      setCode((cfg.codeKey ? item[cfg.codeKey] : "") ?? "");
      setEmail(item.email ?? "");
      setDepartmentId(item.department_id ? String(item.department_id) : null);
      setActive(item.is_active);
    }
  }

  useEffect(() => {
    if (addSignal > 0) open("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name };
      if (cfg.codeKey) body[cfg.codeKey] = code.trim() ? code.trim().toUpperCase() : null;
      if (kind === "agencies") body.email = email.trim() || null;
      if (kind === "positions") body.department_id = departmentId ? Number(departmentId) : null;
      if (editing === "new") return api(`/${kind}`, { method: "POST", body });
      return api(`/${kind}/${(editing as Item).id}`, { method: "PATCH", body: { ...body, is_active: active } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      notifications.show({ color: "green", message: "Zapisano." });
      setEditing(null);
    },
    onError: (err) => setError(errorText(err)),
  });

  const deptName = (id?: number | null) =>
    id ? (departments.data?.find((d) => d.id === id)?.name ?? `#${id}`) : "wszystkie wydziały";
  const term = (search ?? filter).trim().toLowerCase();
  const rows = (query.data ?? []).filter((i) => i.name.toLowerCase().includes(term));

  return (
    <Stack mt={mobile ? 0 : "md"}>
      {mobile ? (
        search === undefined && <TextInput aria-label="Szukaj w słowniku" placeholder="Szukaj" size="md" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
      ) : (
        <Group justify="space-between">
          <TextInput aria-label="Szukaj w słowniku" placeholder="Szukaj" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={240} />
          <Button leftSection={<IconPlus size={16} />} onClick={() => open("new")}>
            Dodaj {cfg.noun}
          </Button>
        </Group>
      )}
      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.length === 0 && (mobile ? (
        <CompactEmpty title="Słownik jest pusty" text="Dodaj pierwszą pozycję przyciskiem „+”." />
      ) : (
        <Text c="dimmed">Słownik jest pusty. Dodaj pierwszą pozycję przyciskiem powyżej.</Text>
      ))}
      {mobile && term && rows.length === 0 && !!query.data?.length && (
        <CompactEmpty title={`Brak wyników dla „${(search ?? filter).trim()}”`} text="Sprawdź pisownię albo zajrzyj do innej zakładki." />
      )}
      {mobile && rows.length > 0 && (
        <div className="ui-group">
          {rows.map((i) => (
            <ListRow
              key={i.id}
              muted={!i.is_active}
              title={i.name}
              description={[cfg.codeKey ? i[cfg.codeKey] : null, kind === "positions" ? deptName(i.department_id) : null, kind === "agencies" ? i.email : null].filter(Boolean).join(" · ") || undefined}
              trailing={!i.is_active ? <StatusBadge tone="neutral">Wyłączone</StatusBadge> : undefined}
              onClick={() => open(i)}
            />
          ))}
        </div>
      )}
      {!mobile && rows.length > 0 && (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nazwa</Table.Th>
              {cfg.codeKey && <Table.Th>{cfg.codeKey === "iso_code" ? "Kod ISO" : "Skrót"}</Table.Th>}
              {kind === "positions" && <Table.Th>Wydział</Table.Th>}
              {kind === "agencies" && <Table.Th>E-mail do zestawień</Table.Th>}
              <Table.Th>Status</Table.Th>
              <Table.Th w={48} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((i) => (
              <Table.Tr key={i.id} opacity={i.is_active ? 1 : 0.55}>
                <Table.Td>{i.name}</Table.Td>
                {cfg.codeKey && <Table.Td>{i[cfg.codeKey] ?? "—"}</Table.Td>}
                {kind === "positions" && <Table.Td>{deptName(i.department_id)}</Table.Td>}
                {kind === "agencies" && (
                  <Table.Td>
                    <Text size="sm" c={i.email ? undefined : "dimmed"} style={{ wordBreak: "break-all" }}>
                      {i.email ?? "—"}
                    </Text>
                  </Table.Td>
                )}
                <Table.Td>
                  {i.is_active ? <Badge color="green" variant="light">aktywne</Badge> : <Badge color="gray">wyłączone</Badge>}
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Edytuj ${i.name}`} onClick={() => open(i)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {mobile && editing !== null && (
        <FormScreen
          title={editing === "new" ? "Nowa pozycja" : "Edycja"}
          subtitle={editing === "new" ? cfg.title : `${cfg.title} · ${editing.name}`}
          onClose={() => setEditing(null)}
          primary={{ label: editing === "new" ? "Dodaj" : "Zapisz zmiany", onClick: () => { setError(null); save.mutate(); }, disabled: !name.trim(), loading: save.isPending }}
        >
          {!name.trim() && <span className="ui-hint-warn">Wpisz nazwę, żeby zapisać.</span>}
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Nazwa" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
            {cfg.codeLabel && (
              <TextInput
                label={cfg.codeLabel}
                maxLength={cfg.codeKey === "iso_code" ? 2 : 32}
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
            )}
            {kind === "agencies" && (
              <TextInput
                label="E-mail do zestawień"
                description="Na ten adres 1. dnia miesiąca trafia zestawienie osób za poprzedni miesiąc. Kilka adresów – oddziel przecinkiem."
                placeholder="kadry@agencja.pl"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            )}
            {kind === "positions" && (
              <Select
                label="Wydział"
                description="Puste = stanowisko dostępne we wszystkich wydziałach"
                clearable
                searchable
                data={options(departments.data, departmentId ? Number(departmentId) : null)}
                value={departmentId}
                onChange={setDepartmentId}
              />
            )}
            {editing !== "new" && (
              <Switch
                label="Aktywne (wyłączonej pozycji nie można przypisać nowym pracownikom)"
                checked={active}
                onChange={(e) => setActive(e.currentTarget.checked)}
              />
            )}
        </FormScreen>
      )}
      <Modal
        opened={!mobile && editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? `Nowa pozycja: ${cfg.title}` : `Edycja: ${cfg.title}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Nazwa" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
            {cfg.codeLabel && (
              <TextInput
                label={cfg.codeLabel}
                maxLength={cfg.codeKey === "iso_code" ? 2 : 32}
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
            )}
            {kind === "agencies" && (
              <TextInput
                label="E-mail do zestawień"
                description="Na ten adres 1. dnia miesiąca trafia zestawienie osób za poprzedni miesiąc. Kilka adresów – oddziel przecinkiem."
                placeholder="kadry@agencja.pl"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            )}
            {kind === "positions" && (
              <Select
                label="Wydział"
                description="Puste = stanowisko dostępne we wszystkich wydziałach"
                clearable
                searchable
                data={options(departments.data, departmentId ? Number(departmentId) : null)}
                value={departmentId}
                onChange={setDepartmentId}
              />
            )}
            {editing !== "new" && (
              <Switch
                label="Aktywne (wyłączonej pozycji nie można przypisać nowym pracownikom)"
                checked={active}
                onChange={(e) => setActive(e.currentTarget.checked)}
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Anuluj
              </Button>
              <Button type="submit" loading={save.isPending}>
                Zapisz
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

export function DictionariesPage() {
  const agencies = useAgencies();
  const departments = useDepartments();
  const positions = usePositions();
  const countries = useCountries();
  const mobile = useIsPhone();
  const [tab, setTab] = useState<Kind>("agencies");
  const [addSignal, setAddSignal] = useState(0);
  const [search, setSearch] = useState("");
  if (mobile) {
    // wszystkie zakładki wczytane od razu – przy przesuwaniu palcem sąsiednia lista jest już gotowa
    const queries = { agencies, departments, positions, countries } as Record<Kind, UseQueryResult<Item[]>>;
    const kinds = Object.keys(CONFIG) as Kind[];
    const go = (k: Kind) => {
      setTab(k);
      setAddSignal(0);
    };
    return (
      <Stack>
        <PageHead title="Słowniki" subtitle="Pozycje do wyboru w kartotece" action={{ label: `Dodaj ${CONFIG[tab].noun}`, icon: <IconPlus size={22} />, onClick: () => setAddSignal((n) => n + 1) }} />
        <TextInput aria-label="Szukaj w słowniku" placeholder="Szukaj" leftSection={<IconSearch size={18} aria-hidden />} size="md" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Segments value={tab} onChange={(v) => go(v as Kind)} items={kinds.map((k) => ({ value: k, label: CONFIG[k].title }))} />
        <SwipePager index={kinds.indexOf(tab)} onIndex={(i) => go(kinds[i])}>
          {kinds.map((k) => (
            <DictionaryTab key={k} kind={k} query={queries[k]} addSignal={k === tab ? addSignal : 0} search={search} />
          ))}
        </SwipePager>
      </Stack>
    );
  }
  return (
    <Stack>
      <PageTitle
        title="Słowniki"
      />
      <Tabs defaultValue="agencies" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="agencies">APT</Tabs.Tab>
          <Tabs.Tab value="departments">Wydziały</Tabs.Tab>
          <Tabs.Tab value="positions">Stanowiska</Tabs.Tab>
          <Tabs.Tab value="countries">Kraje</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="agencies">
          <DictionaryTab kind="agencies" query={agencies as UseQueryResult<Item[]>} />
        </Tabs.Panel>
        <Tabs.Panel value="departments">
          <DictionaryTab kind="departments" query={departments as UseQueryResult<Item[]>} />
        </Tabs.Panel>
        <Tabs.Panel value="positions">
          <DictionaryTab kind="positions" query={positions as UseQueryResult<Item[]>} />
        </Tabs.Panel>
        <Tabs.Panel value="countries">
          <DictionaryTab kind="countries" query={countries as UseQueryResult<Item[]>} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
