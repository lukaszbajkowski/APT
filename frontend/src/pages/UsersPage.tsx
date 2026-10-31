import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPlus } from "@tabler/icons-react";

import { api, ApiError, formatDateTime, ROLE_LABELS, type DictionaryItem, type Role, type User } from "../api";
import { useAuth } from "../auth";
import { Loading } from "../components/States";

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "employee").map((r) => ({ value: r, label: ROLE_LABELS[r] }));

interface FormState {
  username: string;
  full_name: string;
  email: string;
  role: Role;
  agency_ids: string[];
  department_ids: string[];
  agency_id: string | null;
}

const EMPTY_FORM: FormState = { username: "", full_name: "", email: "", role: "viewer", agency_ids: [], department_ids: [], agency_id: null };

function isLocked(u: User) {
  return !!u.locked_until && new Date(u.locked_until) > new Date();
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : "Wystąpił nieoczekiwany błąd.";
}

export function UsersPage() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const showDisabled = location.pathname.endsWith("/wylaczeni");
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users") });
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });

  // editing zostaje ustawione także podczas animacji zamykania, żeby tytuł okna nie "skakał"
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string; inviteTo?: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  function openNew() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing("new");
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setForm({
      username: u.username,
      full_name: u.full_name,
      email: u.email ?? "",
      role: u.role,
      agency_ids: [],
      department_ids: u.scopes.filter((s) => s.department_id !== null).map((s) => String(s.department_id)),
      agency_id: u.agency_id ? String(u.agency_id) : null,
    });
    setFormError(null);
    setEditing(u);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const scopes = {
        agency_ids: form.agency_ids.map(Number),
        department_ids: form.department_ids.map(Number),
      };
      if (editing === "new") {
        const res = await api<{ user: User; temporary_password: string; invite_sent: boolean }>("/users", {
          method: "POST",
          body: { username: form.username, full_name: form.full_name, email: form.email || null, role: form.role, scopes, agency_id: form.agency_id ? Number(form.agency_id) : null },
        });
        setTempPassword({
          username: res.user.username,
          password: res.temporary_password,
          inviteTo: res.invite_sent ? (res.user.email ?? undefined) : undefined,
        });
        setTempOpen(true);
      } else if (editing) {
        const body: Record<string, unknown> = {
          full_name: form.full_name,
          email: form.email.trim(),
          scopes,
          agency_id: form.agency_id ? Number(form.agency_id) : null,
        };
        if (form.role !== editing.role) body.role = form.role;
        await api<User>(`/users/${editing.id}`, { method: "PATCH", body });
        notifications.show({ color: "green", message: "Zapisano zmiany." });
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      invalidate();
    },
    onError: (err) => setFormError(errorText(err)),
  });

  const action = useMutation({
    mutationFn: async ({ user, kind }: { user: User; kind: "reset" | "unlock" | "toggle" | "mfa" | "link" }) => {
      if (kind === "reset") {
        const res = await api<{ temporary_password: string }>(`/users/${user.id}/reset-password`, {
          method: "POST",
        });
        setTempPassword({ username: user.username, password: res.temporary_password });
        setTempOpen(true);
      } else if (kind === "link") {
        await api(`/users/${user.id}/send-password-link`, { method: "POST" });
        notifications.show({ color: "green", message: `Wysłano link do ustawienia hasła na ${user.email}.` });
      } else if (kind === "mfa") {
        await api(`/users/${user.id}/mfa-reset`, { method: "POST" });
        notifications.show({
          color: "green",
          message: `Wyłączono logowanie dwuetapowe konta ${user.username}. Przy następnym logowaniu skonfiguruje je od nowa.`,
        });
      } else if (kind === "unlock") {
        await api(`/users/${user.id}/unlock`, { method: "POST" });
        notifications.show({ color: "green", message: `Odblokowano konto ${user.username}.` });
      } else {
        await api(`/users/${user.id}`, { method: "PATCH", body: { is_active: !user.is_active } });
        notifications.show({
          color: "green",
          message: user.is_active ? `Wyłączono konto ${user.username}.` : `Włączono konto ${user.username}.`,
        });
      }
    },
    onSuccess: invalidate,
    onError: (err) => notifications.show({ color: "red", message: errorText(err) }),
  });

  const agencyName = (id: number | null) => agencies.data?.find((a) => a.id === id)?.name ?? `#${id}`;
  const departmentName = (id: number | null) => departments.data?.find((d) => d.id === id)?.name ?? `#${id}`;
  const activeCount = users.data?.filter((u) => u.is_active).length;
  const disabledCount = users.data?.filter((u) => !u.is_active).length;
  const visible = users.data?.filter((u) => u.is_active !== showDisabled) ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Użytkownicy</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
          Dodaj użytkownika
        </Button>
      </Group>

      <Tabs
        value={showDisabled ? "wylaczeni" : "aktywni"}
        onChange={(v) => navigate(v === "wylaczeni" ? "/uzytkownicy/wylaczeni" : "/uzytkownicy")}
      >
        <Tabs.List>
          <Tabs.Tab
            value="aktywni"
            rightSection={activeCount !== undefined && <Badge size="sm" variant="light">{activeCount}</Badge>}
          >
            Aktywni
          </Tabs.Tab>
          <Tabs.Tab
            value="wylaczeni"
            rightSection={disabledCount !== undefined && <Badge size="sm" variant="light" color="gray">{disabledCount}</Badge>}
          >
            Wyłączeni
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {users.isLoading && <Loading />}
      {users.error && <Alert color="red">{errorText(users.error)}</Alert>}

      {users.data && visible.length === 0 && (
        <Text c="dimmed" size="sm">
          {showDisabled ? "Brak wyłączonych kont." : "Brak aktywnych kont."}
        </Text>
      )}

      {users.data && visible.length > 0 && (
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Login</Table.Th>
                <Table.Th>Imię i nazwisko</Table.Th>
                <Table.Th>Rola</Table.Th>
                <Table.Th>Zakres</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Ostatnie logowanie</Table.Th>
                <Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Code>{u.username}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{u.full_name}</Text>
                    {u.email && (
                      <Text size="xs" c="dimmed">
                        {u.email}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{ROLE_LABELS[u.role]}</Table.Td>
                  <Table.Td>
                    {u.role === "agency" ? (
                      <Text size="sm">{u.agency_id ? agencyName(u.agency_id) : "—"}</Text>
                    ) : u.role === "manager" ? (
                      u.scopes.length ? (
                        <Text size="sm">
                          {u.scopes
                            .map((s) => departmentName(s.department_id))
                            .join(", ")}
                        </Text>
                      ) : (
                        <Text size="sm" c="orange">
                          brak przypisań
                        </Text>
                      )
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {u.is_active ? <Badge color="green">aktywne</Badge> : <Badge color="gray">wyłączone</Badge>}
                      {isLocked(u) && <Badge color="red">zablokowane</Badge>}
                      {u.mfa_enabled ? (
                        <Badge color="teal" variant="light">
                          2FA
                        </Badge>
                      ) : (
                        u.mfa_required &&
                        u.is_active && (
                          <Badge color="orange" variant="light">
                            bez 2FA
                          </Badge>
                        )
                      )}
                      {u.must_change_password && u.is_active && (
                        <Badge color="yellow" variant="light">
                          hasło tymczasowe
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{formatDateTime(u.last_login_at)}</Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" aria-label="Akcje">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => openEdit(u)}>Edytuj</Menu.Item>
                        <Menu.Item onClick={() => action.mutate({ user: u, kind: "reset" })}>
                          Resetuj hasło
                        </Menu.Item>
                        {u.email && u.is_active && (
                          <Menu.Item onClick={() => action.mutate({ user: u, kind: "link" })}>
                            Wyślij link do ustawienia hasła
                          </Menu.Item>
                        )}
                        {isLocked(u) && (
                          <Menu.Item onClick={() => action.mutate({ user: u, kind: "unlock" })}>Odblokuj</Menu.Item>
                        )}
                        {u.mfa_enabled && u.id !== me?.user.id && (
                          <Menu.Item onClick={() => action.mutate({ user: u, kind: "mfa" })}>
                            Resetuj logowanie dwuetapowe
                          </Menu.Item>
                        )}
                        {u.id !== me?.user.id && (
                          <Menu.Item
                            color={u.is_active ? "red" : undefined}
                            onClick={() => action.mutate({ user: u, kind: "toggle" })}
                          >
                            {u.is_active ? "Wyłącz konto" : "Włącz konto"}
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing === "new" ? "Nowy użytkownik" : "Edycja użytkownika"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            save.mutate();
          }}
        >
          <Stack>
            {formError && <Alert color="red">{formError}</Alert>}
            <TextInput
              label="Login"
              description="małe litery, cyfry, kropka, myślnik; min. 3 znaki"
              required
              disabled={editing !== "new"}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
            />
            <TextInput
              label="Imię i nazwisko"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.currentTarget.value })}
            />
            <TextInput
              label="E-mail"
              description="opcjonalnie – link do ustawienia hasła, reset hasła i powiadomienia o bezpieczeństwie"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
            <Select
              label="Rola"
              data={ROLE_OPTIONS}
              allowDeselect={false}
              disabled={editing !== "new" && editing?.id === me?.user.id}
              value={form.role}
              onChange={(v) => v && setForm({ ...form, role: v as Role })}
            />
            {form.role === "agency" && (
              <Select
                label="APT"
                description="Konto agencji widzi tylko osoby z tej APT (bez PESEL), może wgrywać zdjęcia i badania lekarskie oraz zgłaszać nowe osoby do zatwierdzenia przez kadry."
                required
                searchable
                data={(agencies.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
                value={form.agency_id}
                onChange={(v) => setForm({ ...form, agency_id: v })}
              />
            )}
            {form.role === "manager" && (
              <>
                <MultiSelect
                  label="Widoczne wydziały"
                  placeholder={departments.data?.length ? "Wybierz" : "Brak wydziałów w słowniku (etap 2)"}
                  data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
                  value={form.department_ids}
                  onChange={(v) => setForm({ ...form, department_ids: v })}
                  searchable
                />
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit" loading={save.isPending}>
                {editing === "new" ? "Utwórz" : "Zapisz"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={tempOpen}
        onClose={() => setTempOpen(false)}
        onExitTransitionEnd={() => setTempPassword(null)}
        title="Hasło tymczasowe"
        closeOnClickOutside={false}
      >
        {tempPassword && (
          <Stack>
            <Text size="sm">
              Przekaż to hasło użytkownikowi <b>{tempPassword.username}</b> bezpiecznym kanałem. Po zamknięciu tego
              okna nie będzie można go ponownie wyświetlić. Przy pierwszym logowaniu użytkownik musi ustawić własne
              hasło.
            </Text>
            {tempPassword.inviteTo && (
              <Alert color="green" variant="light">
                Wysłano też e-mail z linkiem do ustawienia hasła na <b>{tempPassword.inviteTo}</b> – użytkownik może
                skorzystać z linku zamiast hasła tymczasowego.
              </Alert>
            )}
            <Group>
              <Code fz="lg" p="sm">
                {tempPassword.password}
              </Code>
              <CopyButton value={tempPassword.password}>
                {({ copied, copy }) => (
                  <Button variant="light" onClick={copy}>
                    {copied ? "Skopiowano" : "Kopiuj"}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end">
              <Button onClick={() => setTempOpen(false)}>Zamknij</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
