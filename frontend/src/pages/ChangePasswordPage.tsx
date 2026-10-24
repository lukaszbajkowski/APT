import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Center, Group, List, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, ApiError, type Me } from "../api";

export function ChangePasswordPage() {
  const { me, setMe, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!me?.user.must_change_password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== repeat) {
      setError("Nowe hasła nie są takie same.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Me>("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setMe(result);
      notifications.show({ color: "green", message: "Hasło zostało zmienione." });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się zmienić hasła.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={420}>
        <form onSubmit={submit}>
          <Stack>
            <div>
              <Title order={3}>Zmiana hasła</Title>
              {forced && (
                <Text size="sm" c="dimmed">
                  Logujesz się hasłem tymczasowym. Ustaw własne hasło, aby kontynuować.
                </Text>
              )}
            </div>
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}
            <PasswordInput
              label="Obecne hasło"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.currentTarget.value)}
            />
            <PasswordInput
              label="Nowe hasło"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.currentTarget.value)}
            />
            <PasswordInput
              label="Powtórz nowe hasło"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.currentTarget.value)}
            />
            <List size="xs" c="dimmed">
              <List.Item>co najmniej 12 znaków</List.Item>
              <List.Item>co najmniej 3 z 4 grup: małe litery, wielkie litery, cyfry, znaki specjalne</List.Item>
              <List.Item>nie może zawierać loginu</List.Item>
            </List>
            <Group justify="space-between">
              {forced ? (
                <Button variant="subtle" color="gray" onClick={() => logout().then(() => navigate("/login"))}>
                  Wyloguj
                </Button>
              ) : (
                <Button variant="subtle" color="gray" onClick={() => navigate(-1)}>
                  Anuluj
                </Button>
              )}
              <Button type="submit" loading={busy}>
                Zmień hasło
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
