import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { ApiError } from "../api";

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(username, password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(result.user.must_change_password ? "/zmiana-hasla" : from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się połączyć z serwerem.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={380}>
        <form onSubmit={submit}>
          <Stack>
            <div>
              <Title order={3} className="brand-title">
                Identyfikacja pracowników APT
              </Title>
              <Text size="sm" c="dimmed">
                Zaloguj się, aby kontynuować
              </Text>
            </div>
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}
            <TextInput
              label="Login"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
            <PasswordInput
              label="Hasło"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={busy} fullWidth>
              Zaloguj
            </Button>
            <Text size="xs" c="dimmed" ta="center">
              Nie pamiętasz hasła? Poproś administratora o reset.
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
