import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Code, CopyButton, Group, Menu, Modal, MultiSelect, Stack, Table, Tabs, Text, TextInput } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPlus, IconSearch } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";

import { api, ApiError, formatDateTime, ROLE_LABELS, type DictionaryItem, type Role, type User } from "../api";
import { useAuth } from "../auth";
import { ErrorState, EmptyState, Loading } from "../components/States";
import { ActionSheet, CompactEmpty, FormScreen, ListRow, PageHead, Segments, StatusBadge, SwipePager, type SheetAction, PageTitle } from "../components/Mobile";
import { useConfirm } from "../lib/confirm";

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
  const routeDisabled = location.pathname.endsWith("/wylaczeni");
  // telefon: zakładki przełączane w miejscu (zmiana adresu przeładowałaby ekran i przerwała przesuwanie palcem)
  const [mobileDisabled, setMobileDisabled] = useState(routeDisabled);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users") });
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });

  // editing zostaje ustawione także podczas animacji zamykania, żeby tytuł okna nie "skakał"
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const showDisabled = mobile ? mobileDisabled : routeDisabled;
  const confirm = useConfirm();
  const [sheetUser, setSheetUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
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

  // akcje wymagające potwierdzenia: reset hasła, reset 2FA, wyłączenie konta
  const run = async (u: User, kind: "reset" | "unlock" | "toggle" | "mfa" | "link") => {
    const asks: Record<string, { title: string; message: string; label: string } | undefined> = {
      reset: { title: "Zresetować hasło?", message: `Konto ${u.username} dostanie nowe hasło tymczasowe, stare przestanie działać.`, label: "Resetuj" },
      mfa: { title: "Zresetować logowanie dwuetapowe?", message: `${u.username} skonfiguruje je od nowa przy następnym logowaniu.`, label: "Resetuj" },
      toggle: u.is_active ? { title: "Wyłączyć konto?", message: `${u.username} nie zaloguje się do aplikacji.`, label: "Wyłącz" } : undefined,
    };
    const a = asks[kind];
    if (a && !(await confirm({ title: a.title, message: a.message, confirmLabel: a.label, danger: kind === "toggle" }))) return;
    action.mutate({ user: u, kind });
  };
  const userActions = (u: User): SheetAction[] => {
    const acts: SheetAction[] = [
      { label: "Edytuj", onClick: () => { setSheetUser(null); openEdit(u); } },
      { label: "Resetuj hasło", onClick: () => { setSheetUser(null); void run(u, "reset"); } },
    ];
    if (u.email && u.is_active) acts.push({ label: "Wyślij link do ustawienia hasła", onClick: () => { setSheetUser(null); void run(u, "link"); } });
    if (isLocked(u)) acts.push({ label: "Odblokuj", onClick: () => { setSheetUser(null); void run(u, "unlock"); } });
    if (u.mfa_enabled && u.id !== me?.user.id) acts.push({ label: "Resetuj logowanie dwuetapowe", onClick: () => { setSheetUser(null); void run(u, "mfa"); } });
    if (u.id !== me?.user.id) acts.push({ label: u.is_active ? "Wyłącz konto" : "Włącz konto", danger: u.is_active, onClick: () => { setSheetUser(null); void run(u, "toggle"); } });
    return acts;
  };

  return (
    <Stack>
      {mobile ? (
        <PageHead title="Użytkownicy" subtitle="Konta systemu" action={{ label: "Dodaj użytkownika", icon: <IconPlus size={22} />, onClick: openNew }} />
      ) : (
        <PageTitle
          title="Użytkownicy"
          actions={
            <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
              Dodaj użytkownika
            </Button>
          }
        />
      )}

      {mobile && (
        <>
          <TextInput aria-label="Szukaj użytkownika" placeholder="Szukaj" leftSection={<IconSearch size={18} aria-hidden />} size="md" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Segments
            value={showDisabled ? "wylaczeni" : "aktywni"}
            onChange={(v) => setMobileDisabled(v === "wylaczeni")}
            items={[
              { value: "aktywni", label: `Aktywni${activeCount !== undefined ? ` · ${activeCount}` : ""}` },
              { value: "wylaczeni", label: `Wyłączeni${disabledCount !== undefined ? ` · ${disabledCount}` : ""}` },
            ]}
          />
        </>
      )}

      {!mobile && <Tabs
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
      </Tabs>}

      {users.isLoading && <Loading />}
      {users.error && <ErrorState error={users.error} onRetry={() => users.refetch()} />}

      {!mobile && users.data && visible.length === 0 && (
        <EmptyState compact title={showDisabled ? "Brak wyłączonych kont" : "Brak aktywnych kont"} text={showDisabled ? "Wyłączone konta pojawią się tutaj." : "Dodaj pierwszego użytkownika przyciskiem powyżej."} />
      )}

      {mobile && users.data && (
        <SwipePager index={showDisabled ? 1 : 0} onIndex={(i) => setMobileDisabled(i === 1)}>
          {[false, true].map((dis) => {
            const list = (users.data ?? [])
              .filter((u) => u.is_active !== dis)
              .filter((u) => !search.trim() || `${u.full_name} ${u.username}`.toLowerCase().includes(search.trim().toLowerCase()));
            return list.length === 0 ? (
              <CompactEmpty
                key={String(dis)}
                title={search.trim() ? `Brak wyników dla „${search.trim()}”` : dis ? "Brak wyłączonych kont" : "Brak aktywnych kont"}
                text={search.trim() ? "Sprawdź pisownię." : dis ? "Wyłączone konta pojawią się tutaj." : "Dodaj pierwszego użytkownika przyciskiem „+”."}
              />
            ) : (
              <div key={String(dis)} className="ui-group">
                {list.map((u) => (
                  <ListRow
                    key={u.id}
                    leading={<span className="ui-thread-avatar" aria-hidden>{u.full_name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span>}
                    title={u.full_name}
                    description={`${ROLE_LABELS[u.role]} · ${u.last_login_at ? formatDateTime(u.last_login_at) : "nie logował się"}`}
                    trailing={isLocked(u) ? <StatusBadge tone="error">Zablokowany</StatusBadge> : !u.is_active ? <StatusBadge tone="neutral">Wyłączony</StatusBadge> : u.mfa_enabled ? <StatusBadge tone="ok">2FA</StatusBadge> : undefined}
                    onClick={() => setSheetUser(u)}
                  />
                ))}
              </div>
            );
          })}
        </SwipePager>
      )}

      {!mobile && users.data && visible.length > 0 && (
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
                        <Menu.Item onClick={() => void run(u, "reset")}>
                          Resetuj hasło
                        </Menu.Item>
                        {u.email && u.is_active && (
                          <Menu.Item onClick={() => void run(u, "link")}>
                            Wyślij link do ustawienia hasła
                          </Menu.Item>
                        )}
                        {isLocked(u) && (
                          <Menu.Item onClick={() => void run(u, "unlock")}>Odblokuj</Menu.Item>
                        )}
                        {u.mfa_enabled && u.id !== me?.user.id && (
                          <Menu.Item onClick={() => void run(u, "mfa")}>
                            Resetuj logowanie dwuetapowe
                          </Menu.Item>
                        )}
                        {u.id !== me?.user.id && (
                          <Menu.Item
                            color={u.is_active ? "red" : undefined}
                            onClick={() => void run(u, "toggle")}
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

      <ActionSheet
        opened={!!sheetUser}
        onClose={() => setSheetUser(null)}
        title={sheetUser?.full_name ?? ""}
        subtitle={sheetUser ? `${sheetUser.username} · ${ROLE_LABELS[sheetUser.role]}` : undefined}
        actions={sheetUser ? userActions(sheetUser) : []}
      />

      {mobile && formOpen && (
        <FormScreen
          title={editing === "new" ? "Nowy użytkownik" : "Edycja użytkownika"}
          subtitle={editing !== "new" && editing ? editing.username : "Konto systemu"}
          onClose={() => setFormOpen(false)}
          primary={{ label: editing === "new" ? "Utwórz konto" : "Zapisz zmiany", onClick: () => { setFormError(null); save.mutate(); }, disabled: (editing === "new" && form.username.trim().length < 3) || !form.full_name.trim() || (form.role === "agency" && !form.agency_id), loading: save.isPending }}
        >
          {((editing === "new" && form.username.trim().length < 3) || !form.full_name.trim() || (form.role === "agency" && !form.agency_id)) && (
            <span className="ui-hint-warn">
              {form.role === "agency" && !form.agency_id && form.full_name.trim() ? "Wybierz APT, do której należy konto." : "Wpisz login (min. 3 znaki) i imię i nazwisko."}
            </span>
          )}
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
                label="APT (agencja pracy)"
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
        </FormScreen>
      )}
      <Modal
        opened={!mobile && formOpen}
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
                label="APT (agencja pracy)"
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
