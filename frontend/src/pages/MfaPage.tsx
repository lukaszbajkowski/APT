import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Code,
  CopyButton,
  Group,
  List,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconCopy, IconDownload, IconShieldCheck, IconShieldLock } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { api, errorText, type Me } from "../api";

interface SetupData {
  secret: string;
  otpauth_uri: string;
  qr_svg: string;
}

interface CodesResult {
  recovery_codes: string[];
  me: Me;
}

function downloadCodes(codes: string[], username: string) {
  const text = [
    "Identyfikacja pracowników APT – kody zapasowe logowania dwuetapowego",
    `Konto: ${username}`,
    `Wygenerowano: ${new Date().toLocaleString("pl-PL")}`,
    "",
    "Każdy kod działa tylko raz. Przechowuj je w bezpiecznym miejscu.",
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kody-zapasowe-${username}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function CodeInput({ value, onChange, label = "Kod z aplikacji" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <TextInput
      label={label}
      placeholder="123456"
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value.replace(/[^\d ]/g, ""))}
      styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 20, letterSpacing: 5 } }}
      maw={220}
    />
  );
}

function RecoveryCodes({ codes, username, onDone, doneLabel }: { codes: string[]; username: string; onDone: () => void; doneLabel: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <Stack>
      <Alert color="orange" variant="light" icon={<IconAlertCircle size={18} />} title="Zapisz kody zapasowe">
        Jeśli zgubisz telefon, zalogujesz się jednym z tych kodów (każdy działa raz). Zapisz je teraz – później nie
        będzie można ich zobaczyć ponownie.
      </Alert>
      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing={6}>
          {codes.map((c) => (
            <Code key={c} fz="md" ta="center" py={4}>
              {c}
            </Code>
          ))}
        </SimpleGrid>
      </Paper>
      <Group>
        <CopyButton value={codes.join("\n")}>
          {({ copied, copy }) => (
            <Button variant="default" leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
              {copied ? "Skopiowano" : "Kopiuj"}
            </Button>
          )}
        </CopyButton>
        <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => downloadCodes(codes, username)}>
          Pobierz plik .txt
        </Button>
      </Group>
      <Checkbox label="Zapisałem kody w bezpiecznym miejscu" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
      <Group justify="flex-end">
        <Button disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </Group>
    </Stack>
  );
}

function SetupFlow({ forced }: { forced: boolean }) {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CodesResult | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api<SetupData>("/auth/mfa/setup", { method: "POST" }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(await api<CodesResult>("/auth/mfa/enable", { method: "POST", body: { code } }));
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <RecoveryCodes
        codes={result.recovery_codes}
        username={me?.user.username ?? "konto"}
        doneLabel={forced ? "Przejdź do aplikacji" : "Gotowe"}
        onDone={() => {
          setMe(result.me);
          notifications.show({ color: "green", message: "Logowanie dwuetapowe jest włączone." });
          if (forced) navigate("/", { replace: true });
        }}
      />
    );
  }

  return (
    <Stack>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      <List type="ordered" spacing="xs" size="sm">
        <List.Item>
          Zainstaluj w telefonie aplikację do kodów, np. <b>Google Authenticator</b> lub <b>Microsoft Authenticator</b>{" "}
          (na iPhonie wystarczą też wbudowane <b>Hasła</b>).
        </List.Item>
        <List.Item>Zeskanuj w niej kod QR.</List.Item>
        <List.Item>Wpisz 6-cyfrowy kod, który pokaże aplikacja.</List.Item>
      </List>
      {!setup ? (
        <Group>
          <Button onClick={start} loading={busy} leftSection={<IconShieldLock size={16} />}>
            Pokaż kod QR
          </Button>
        </Group>
      ) : (
        <form onSubmit={enable}>
          <Stack>
            <Group align="flex-start" gap="xl">
              <Box
                w={200}
                h={200}
                p={4}
                bg="white"
                style={{ borderRadius: 8, border: "1px solid var(--mantine-color-default-border)" }}
                aria-label="Kod QR do aplikacji uwierzytelniającej"
                dangerouslySetInnerHTML={{ __html: setup.qr_svg }}
              />
              <Stack gap={6} style={{ flex: 1, minWidth: 220 }}>
                <Text size="sm" c="dimmed">
                  Nie możesz zeskanować? Dodaj konto ręcznie i wpisz klucz:
                </Text>
                <Group gap={6}>
                  <Code fz="sm">
                    {setup.secret}
                  </Code>
                  <CopyButton value={setup.secret.replace(/ /g, "")}>
                    {({ copied, copy }) => (
                      <Button size="compact-xs" variant="subtle" onClick={copy}>
                        {copied ? "Skopiowano" : "Kopiuj"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <Text size="xs" c="dimmed">
                  Typ: oparty na czasie, 6 cyfr. Na telefonie z tą przeglądarką możesz też{" "}
                  <a href={setup.otpauth_uri}>otworzyć aplikację bezpośrednio</a>.
                </Text>
              </Stack>
            </Group>
            <CodeInput value={code} onChange={setCode} />
            <Group>
              <Button type="submit" loading={busy}>
                Włącz logowanie dwuetapowe
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
}

function EnabledPanel() {
  const { me, setMe } = useAuth();
  const [mode, setMode] = useState<"none" | "codes" | "disable">("none");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  if (!me) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "codes") {
        const res = await api<CodesResult>("/auth/mfa/recovery-codes", { method: "POST", body: { code } });
        setMe(res.me);
        setCodes(res.recovery_codes);
      } else {
        setMe(await api<Me>("/auth/mfa/disable", { method: "POST", body: { password } }));
        notifications.show({ message: "Wyłączono logowanie dwuetapowe." });
      }
      setMode("none");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setCode("");
      setPassword("");
    }
  }

  if (codes) {
    return <RecoveryCodes codes={codes} username={me.user.username} doneLabel="Gotowe" onDone={() => setCodes(null)} />;
  }

  return (
    <Stack>
      <Group gap="sm">
        <ThemeIcon color="green" variant="light" size="lg">
          <IconShieldCheck size={20} />
        </ThemeIcon>
        <div>
          <Text fw={600}>Logowanie dwuetapowe jest włączone</Text>
          <Text size="sm" c={me.recovery_codes_left <= 2 ? "orange" : "dimmed"}>
            Pozostałe kody zapasowe: {me.recovery_codes_left}
          </Text>
        </div>
      </Group>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      {mode === "none" && (
        <Group>
          <Button variant="default" onClick={() => setMode("codes")}>
            Wygeneruj nowe kody zapasowe
          </Button>
          {!me.user.mfa_required && (
            <Button variant="subtle" color="red" onClick={() => setMode("disable")}>
              Wyłącz
            </Button>
          )}
        </Group>
      )}
      {mode !== "none" && (
        <form onSubmit={submit}>
          <Stack>
            {mode === "codes" ? (
              <>
                <Text size="sm">Stare kody przestaną działać. Potwierdź kodem z aplikacji.</Text>
                <CodeInput value={code} onChange={setCode} />
              </>
            ) : (
              <PasswordInput label="Potwierdź hasłem" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} maw={320} />
            )}
            <Group>
              <Button type="submit" loading={busy} color={mode === "disable" ? "red" : undefined}>
                {mode === "codes" ? "Wygeneruj" : "Wyłącz logowanie dwuetapowe"}
              </Button>
              <Button variant="default" onClick={() => setMode("none")}>
                Anuluj
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
}

export function MfaPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  const forced = me.mfa_setup_required;

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={620}>
        <Stack>
          <div>
            <Group gap="xs">
              <Title order={3}>Logowanie dwuetapowe</Title>
              {me.user.mfa_required && (
                <Badge variant="light" color="orange">
                  wymagane dla Twojej roli
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              Przy logowaniu oprócz hasła podasz kod z aplikacji w telefonie. Nawet jeśli ktoś pozna Twoje hasło, nie
              zaloguje się bez telefonu.
            </Text>
          </div>
          {me.user.mfa_enabled ? <EnabledPanel /> : <SetupFlow forced={forced} />}
          <Group justify="flex-start">
            {forced ? (
              <Button variant="subtle" color="gray" onClick={() => logout().then(() => navigate("/login"))}>
                Wyloguj
              </Button>
            ) : (
              <Button variant="subtle" color="gray" onClick={() => navigate(-1)}>
                Wróć
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </Center>
  );
}
