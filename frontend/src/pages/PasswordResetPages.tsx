import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Button, Center, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { NewPasswordFields, passwordOk } from "../components/PasswordFields";
import { Loading } from "../components/States";

function Shell({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={420}>
        {children}
      </Paper>
    </Center>
  );
}

export function ForgotPasswordPage() {
  const [login, setLogin] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/password-reset/request", { method: "POST", body: { login } });
      setSent(r.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {sent ? (
        <Stack>
          <IconMailCheck size={36} color="var(--mantine-color-green-6)" />
          <Title order={4}>Sprawdź skrzynkę</Title>
          <Text size="sm">{sent}</Text>
          <Text size="sm" c="dimmed">
            Link jest ważny godzinę. Nie ma wiadomości? Sprawdź folder spam albo poproś administratora o reset hasła.
          </Text>
          <Anchor component={Link} to="/login" size="sm">
            Wróć do logowania
          </Anchor>
        </Stack>
      ) : (
        <form onSubmit={submit}>
          <Stack>
            <div>
              <Title order={4}>Nie pamiętasz hasła?</Title>
              <Text size="sm" c="dimmed">
                Podaj login albo adres e-mail konta. Wyślemy link do ustawienia nowego hasła.
              </Text>
            </div>
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}
            <TextInput label="Login lub e-mail" required autoFocus value={login} onChange={(e) => setLogin(e.currentTarget.value)} />
            <Button type="submit" loading={busy} fullWidth>
              Wyślij link
            </Button>
            <Anchor component={Link} to="/login" size="sm" ta="center">
              Wróć do logowania
            </Anchor>
          </Stack>
        </form>
      )}
    </Shell>
  );
}

export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const check = useQuery({
    queryKey: ["reset-check", token],
    queryFn: () =>
      api<{ valid: boolean; username: string | null; purpose: string | null }>(
        `/auth/password-reset/check?token=${encodeURIComponent(token)}`,
      ),
    enabled: !!token,
    retry: false,
  });
  const [pw, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passwordOk(pw, repeat, check.data?.username)) {
      setError("Hasło nie spełnia wszystkich wymagań albo hasła nie są takie same – sprawdź listę pod polem.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: { token, new_password: pw } });
      notifications.show({ color: "green", message: "Hasło ustawione. Zaloguj się nowym hasłem." });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (token && check.isLoading) {
    return (
      <Shell>
        <Center>
          <Loading />
        </Center>
      </Shell>
    );
  }
  if (!token || !check.data?.valid) {
    return (
      <Shell>
        <Stack>
          <Title order={4}>Link nie działa</Title>
          <Text size="sm">Link wygasł albo został już użyty. Poproś o nowy.</Text>
          <Button component={Link} to="/reset-hasla">
            Wyślij nowy link
          </Button>
          <Anchor component={Link} to="/login" size="sm" ta="center">
            Wróć do logowania
          </Anchor>
        </Stack>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit}>
        <Stack>
          <div>
            <Title order={4}>{check.data.purpose === "invite" ? "Ustaw hasło do konta" : "Ustaw nowe hasło"}</Title>
            <Text size="sm" c="dimmed">
              Konto: <b>{check.data.username}</b>
            </Text>
          </div>
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {error}
            </Alert>
          )}
          <NewPasswordFields pw={pw} repeat={repeat} onPw={setPw} onRepeat={setRepeat} username={check.data.username} />
          <Button type="submit" loading={busy} fullWidth>
            Ustaw hasło
          </Button>
        </Stack>
      </form>
    </Shell>
  );
}
