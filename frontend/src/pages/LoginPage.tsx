import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Anchor, Button, Center, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, ApiError, MFA_PATH, type Me } from "../api";

function nextPath(me: Me, from: string) {
  if (me.user.must_change_password) return "/zmiana-hasla";
  if (me.mfa_setup_required) return MFA_PATH;
  return from;
}

function CodeStep({ onDone }: { onDone: (me: Me) => void }) {
  const { setMe, logout } = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api<Me>("/auth/mfa/verify", { method: "POST", body: { code } });
      setMe(result);
      onDone(result);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 423 || err.status === 401)) {
        await logout().catch(() => undefined);
      }
      setError(err instanceof ApiError ? err.message : "Nie udało się połączyć z serwerem.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <Group gap="sm" wrap="nowrap">
          <IconShieldLock size={28} color="var(--mantine-color-navy-6)" />
          <div>
            <Title order={4}>Logowanie dwuetapowe</Title>
            <Text size="sm" c="dimmed">
              {recovery
                ? "Wpisz jeden z kodów zapasowych. Każdy działa tylko raz."
                : "Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej w telefonie."}
            </Text>
          </div>
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        {recovery ? (
          <TextInput
            key="recovery"
            label="Kod zapasowy"
            placeholder="XXXXX-XXXXX"
            autoFocus
            required
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", letterSpacing: 2 } }}
          />
        ) : (
          <TextInput
            key="totp"
            label="Kod z aplikacji"
            placeholder="123456"
            autoFocus
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.replace(/[^\d ]/g, ""))}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 22, letterSpacing: 6 } }}
          />
        )}
        <Button type="submit" loading={busy} fullWidth>
          Potwierdź
        </Button>
        <Group justify="space-between">
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => {
              setRecovery((r) => !r);
              setCode("");
              setError(null);
            }}
          >
            {recovery ? "Użyj kodu z aplikacji" : "Nie mam telefonu – użyj kodu zapasowego"}
          </Anchor>
          <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => logout()}>
            Anuluj
          </Anchor>
        </Group>
      </Stack>
    </form>
  );
}

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (me && !me.mfa_pending) return <Navigate to={nextPath(me, from)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(username, password);
      if (!result.mfa_pending) navigate(nextPath(result, from), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się połączyć z serwerem.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={400}>
        {me?.mfa_pending ? (
          <CodeStep onDone={(result) => navigate(nextPath(result, from), { replace: true })} />
        ) : (
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
        )}
      </Paper>
    </Center>
  );
}
