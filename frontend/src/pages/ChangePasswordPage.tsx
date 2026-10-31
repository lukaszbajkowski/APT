import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Center, Group, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { NewPasswordFields, passwordOk } from "../components/PasswordFields";
import { api, ApiError, MFA_PATH, type Me } from "../api";

export function ChangePasswordPage() {
  const { me, setMe, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!me?.user.must_change_password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCurrentError(null);
    setNewError(null);
    if (!passwordOk(next, repeat, me?.user.username)) {
      setError("Nowe hasło nie spełnia wszystkich wymagań albo hasła nie są takie same – sprawdź listę pod polem.");
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
      navigate(result.mfa_setup_required ? MFA_PATH : "/", { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Nie udało się zmienić hasła.";
      if (/obecne/i.test(msg)) setCurrentError(msg);
      else if (/nowe|hasło/i.test(msg) && err instanceof ApiError && err.status === 400) setNewError(msg);
      else setError(msg);
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
              error={currentError}
              onChange={(e) => {
                setCurrent(e.currentTarget.value);
                setCurrentError(null);
              }}
            />
            <NewPasswordFields
              pw={next}
              repeat={repeat}
              onPw={setNext}
              onRepeat={setRepeat}
              username={me?.user.username}
              serverError={newError}
            />
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
