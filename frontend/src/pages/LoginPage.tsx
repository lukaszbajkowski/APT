import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Button, Center, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconFingerprint, IconShieldLock } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { LanguagePicker, useT } from "../lib/i18n";
import { InstallApp } from "../components/InstallApp";
import { api, ApiError, MFA_PATH, type Me } from "../api";
import { getPasskey, passkeyErrorText, passkeysSupported } from "../lib/passkey";

interface PasskeyChallenge {
  challenge_id: string;
  options: Record<string, unknown>;
}

function nextPath(me: Me, from: string) {
  if (me.user.must_change_password) return "/zmiana-hasla";
  if (me.mfa_setup_required) return MFA_PATH;
  return from;
}

function CodeStep({ onDone }: { onDone: (me: Me) => void }) {
  const { setMe, logout } = useAuth();
  const T = useT();
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
            <Title order={4}>{T("Logowanie dwuetapowe")}</Title>
            <Text size="sm" c="dimmed">
              {recovery
                ? T("Wpisz jeden z kodów zapasowych. Każdy działa tylko raz.")
                : T("Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej w telefonie.")}
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
            label={T("Kod zapasowy")}
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
            label={T("Kod z aplikacji")}
            placeholder="123456"
            autoFocus
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            name="otp"
            id="otp-code"
            data-form-type="other"
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.replace(/[^\d ]/g, ""))}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 22, letterSpacing: 6 } }}
          />
        )}
        <Button type="submit" loading={busy} fullWidth>
          {T("Potwierdź")}
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
            {recovery ? T("Użyj kodu z aplikacji") : T("Nie mam telefonu – użyj kodu zapasowego")}
          </Anchor>
          <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => logout()}>
            {T("Anuluj")}
          </Anchor>
        </Group>
      </Stack>
    </form>
  );
}

export function LoginPage() {
  const T = useT();
  const { me, login, setMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [params] = useSearchParams();
  const idleLogout = params.get("powod") === "bezczynnosc";
  const [expired] = useState(() => {
    try {
      const v = sessionStorage.getItem("apt-session-expired") === "1";
      sessionStorage.removeItem("apt-session-expired");
      return v;
    } catch {
      return false;
    }
  });
  const adding = params.get("dodaj") === "1"; // kolejne konto obok już zalogowanego
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api<{ password_reset: boolean }>("/auth/config"),
    staleTime: Infinity,
  });

  // Wyzwanie pobieramy z wyprzedzeniem: Safari (iPhone) wymaga, by okno klucza otworzyło się od razu po dotknięciu.
  const pre = useRef<PasskeyChallenge | null>(null);
  const loadChallenge = useCallback(() => {
    pre.current = null;
    api<PasskeyChallenge>("/auth/passkey/options", { method: "POST" })
      .then((o) => {
        pre.current = o;
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!passkeysSupported()) return;
    loadChallenge();
    const t = window.setInterval(loadChallenge, 4 * 60 * 1000); // wyzwanie ważne 5 min
    return () => window.clearInterval(t);
  }, [loadChallenge]);

  if (me && !me.mfa_pending && !adding) return <Navigate to={nextPath(me, from)} replace />;

  async function passkeyLogin() {
    setError(null);
    setBusy(true);
    try {
      const o = pre.current ?? (await api<PasskeyChallenge>("/auth/passkey/options", { method: "POST" }));
      pre.current = null;
      const credential = await getPasskey(o.options);
      const result = await api<Me>("/auth/passkey/login", { method: "POST", body: { challenge_id: o.challenge_id, credential } });
      setMe(result);
      navigate(nextPath(result, from), { replace: true });
    } catch (err) {
      setError(passkeyErrorText(err) ?? (err instanceof ApiError ? err.message : "Nie udało się zalogować kluczem dostępu."));
    } finally {
      setBusy(false);
      loadChallenge();
    }
  }

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
      <Stack align="center" w="100%" maw={400} gap="md">
      <Paper withBorder shadow="sm" p="xl" w="100%">
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
                  {T("Zaloguj się, aby kontynuować")}
                </Text>
              </div>
              {adding && me && (
                <Alert color="blue" variant="light">
                  {T("Dodajesz drugie konto. Konto {name} pozostaje zalogowane i przełączysz się na nie z menu użytkownika.", { name: me.user.full_name })}
                </Alert>
              )}
              {expired && !idleLogout && !error && (
                <Alert color="blue" variant="light">
                  {T("Twoja sesja wygasła ze względów bezpieczeństwa. Zaloguj się ponownie – wrócisz na stronę, na której byłeś(-aś). Zapisane dane są bezpieczne.")}
                </Alert>
              )}
              {idleLogout && !error && (
                <Alert color="blue" variant="light">
                  {T("Wylogowano automatycznie po okresie bezczynności. Zaloguj się ponownie.")}
                </Alert>
              )}
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {error}
                </Alert>
              )}
              <TextInput
                label={T("Login")}
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
              <PasswordInput
                label={T("Hasło")}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <Button type="submit" loading={busy} fullWidth>
                {T("Zaloguj")}
              </Button>
              {passkeysSupported() && (
                <Button type="button" variant="light" fullWidth leftSection={<IconFingerprint size={18} />} loading={busy} onClick={passkeyLogin}>
                  {T("Zaloguj kluczem dostępu")}
                </Button>
              )}
              {config.data?.password_reset ? (
                <Anchor component={Link} to="/reset-hasla" size="sm" ta="center">
                  {T("Nie pamiętasz hasła?")}
                </Anchor>
              ) : (
                <Text size="xs" c="dimmed" ta="center">
                  {T("Nie pamiętasz hasła? Poproś administratora o reset.")}
                </Text>
              )}
            </Stack>
          </form>
        )}
      </Paper>
      <LanguagePicker />
      <InstallApp compact />
      </Stack>
    </Center>
  );
}
