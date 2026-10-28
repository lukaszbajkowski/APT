import { InstallApp } from "../components/InstallApp";
import { PushCard } from "../components/PushCard";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Card, Center, CopyButton, Group, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconFingerprint, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDateTime, MFA_PATH, type Me } from "../api";
import { useAuth } from "../auth";
import { createPasskey, inAppBrowser, passkeyErrorText, passkeysSupported } from "../lib/passkey";

interface Options {
  challenge_id: string;
  options: Record<string, unknown>;
}

/** Strona z linku z zaproszenia: data urodzenia -> klucz dostępu (albo hasło jako zapas). */
export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [birth, setBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ name: string; needs_birth_date: boolean }>(`/auth/invite/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });

  async function run(fn: () => Promise<Me>) {
    setError(null);
    setBusy(true);
    try {
      const me = await fn();
      setMe(me);
      navigate(me.mfa_setup_required ? MFA_PATH : "/moje-konto", { replace: true });
    } catch (err) {
      setError(passkeyErrorText(err) ?? errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Safari (iPhone) wymaga, by okno klucza otworzyło się od razu po dotknięciu przycisku – bez pytania serwera
  // w międzyczasie. Dlatego wyzwanie pobieramy wcześniej („Dalej”), a „Utwórz klucz” od razu otwiera okno.
  const [prepared, setPrepared] = useState<Options | null>(null);
  const prepare = async () => {
    setError(null);
    setBusy(true);
    try {
      setPrepared(await api<Options>("/auth/invite/options", { method: "POST", body: { token, birth_date: birth || null } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const withPasskey = () =>
    run(async () => {
      if (!prepared) throw new Error("Brak wyzwania.");
      const credential = await createPasskey(prepared.options);
      return api<Me>("/auth/invite/passkey", {
        method: "POST",
        body: { token, birth_date: birth || null, challenge_id: prepared.challenge_id, credential },
      });
    });
  const needsBirth = info.data?.needs_birth_date ?? true;
  const ready = !needsBirth || !!birth;

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={440}>
        <Stack>
          <Title order={3} className="brand-title">
            Załóż swoje konto
          </Title>
          {info.isLoading && <Loader />}
          {(info.isError || !token) && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              Zaproszenie wygasło albo zostało już wykorzystane. Poproś kadry o nowe.
            </Alert>
          )}
          {info.data && (
            <>
              <Text size="sm">
                {info.data.name}, zalogujesz się na to konto twarzą, odciskiem palca albo PIN-em telefonu – bez hasła.
              </Text>
              {inAppBrowser() && (
                <Alert color="yellow" title="Otwórz w przeglądarce" icon={<IconAlertCircle size={18} />}>
                  <Text size="sm">
                    Ta strona otworzyła się w oknie aplikacji (np. komunikatora), gdzie klucz dostępu nie działa. Skopiuj
                    link, otwórz go w Safari lub Chrome i dokończ tam.
                  </Text>
                  <CopyButton value={window.location.href}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" mt="xs" onClick={copy}>
                        {copied ? "Skopiowano" : "Kopiuj link"}
                      </Button>
                    )}
                  </CopyButton>
                </Alert>
              )}
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {error}
                </Alert>
              )}
              {needsBirth && (
                <TextInput
                  label="Data urodzenia"
                  description="Potwierdzamy, że to Ty."
                  type="date"
                  value={birth}
                  onChange={(e) => setBirth(e.currentTarget.value)}
                />
              )}
              {!passkeysSupported() ? (
                <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                  To urządzenie albo przeglądarka nie obsługuje kluczy dostępu. Otwórz zaproszenie w Safari (iPhone) lub
                  Chrome (Android) albo skontaktuj się z kadrami.
                </Alert>
              ) : !prepared ? (
                <Button size="md" loading={busy} disabled={!ready} onClick={prepare}>
                  Dalej
                </Button>
              ) : (
                <Button size="md" leftSection={<IconFingerprint size={20} />} loading={busy} onClick={withPasskey}>
                  Utwórz klucz dostępu
                </Button>
              )}
            </>
          )}
          <Anchor component={Link} to="/login" size="sm" c="dimmed" ta="center">
            Mam już konto – zaloguj
          </Anchor>
        </Stack>
      </Paper>
    </Center>
  );
}

interface Passkey {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export function MyAccountPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const { me } = useAuth();
  const reauth = !hasRole("employee");
  const keys = useQuery({ queryKey: ["passkeys"], queryFn: () => api<Passkey[]>("/passkeys") });

  // Safari wymaga otwarcia okna klucza od razu po dotknięciu: wyzwanie pobieramy w osobnym kroku.
  const [prepared, setPrepared] = useState<Options | null>(null);
  const prepare = useMutation({
    mutationFn: () =>
      api<Options>("/passkeys/options", { method: "POST", body: reauth ? { password: pw, code: code || null } : {} }),
    onSuccess: (o) => {
      setError(null);
      setPrepared(o);
    },
    onError: (e) => setError(errorText(e)),
  });
  const add = useMutation({
    mutationFn: async () => {
      if (!prepared) throw new Error("Brak wyzwania.");
      const credential = await createPasskey(prepared.options);
      await api("/passkeys", { method: "POST", body: { challenge_id: prepared.challenge_id, credential } });
    },
    onSettled: () => setPrepared(null),
    onSuccess: () => {
      setError(null);
      setPw("");
      setCode("");
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (e) => setError(passkeyErrorText(e) ?? errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  if (!hasRole("employee") && !hasRole("admin", "hr", "manager", "viewer", "agency")) return <Navigate to="/" replace />;

  return (
    <Stack maw={640}>
      <Title order={2}>Klucze i powiadomienia</Title>
      <InstallApp />
      <PushCard />
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Twoje klucze</Title>
          <Button
            leftSection={<IconFingerprint size={18} />}
            loading={add.isPending || prepare.isPending}
            disabled={!passkeysSupported() || (!prepared && reauth && !pw)}
            onClick={() => (prepared ? add.mutate() : prepare.mutate())}
          >
            {prepared ? "Utwórz klucz na tym urządzeniu" : "Dodaj klucz"}
          </Button>
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          Logujesz się twarzą, odciskiem palca lub PIN-em urządzenia – bez hasła. Dodaj klucz także na drugim urządzeniu
          (np. komputerze), żeby nie stracić dostępu po zgubieniu telefonu. Gdy mimo to stracisz dostęp, kadry zresetują go
          i wyślą nowe zaproszenie.
        </Text>
        {reauth && (
          <Stack gap="xs" mb="sm">
            <Text size="sm">Przed dodaniem klucza potwierdź tożsamość:</Text>
            <PasswordInput label="Obecne hasło" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} />
            {me?.user.mfa_enabled && (
              <TextInput label="Kod z aplikacji" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
            )}
          </Stack>
        )}
        <Stack gap="xs">
          {keys.data?.map((k) => (
            <Group key={k.id} justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>
                  {k.name}
                </Text>
                <Text size="xs" c="dimmed">
                  dodany {formatDateTime(k.created_at)}
                  {k.last_used_at ? ` · ostatnio ${formatDateTime(k.last_used_at)}` : ""}
                </Text>
              </div>
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconTrash size={14} />}
                loading={remove.isPending && remove.variables === k.id}
                onClick={() => window.confirm("Usunąć ten klucz?") && remove.mutate(k.id)}
              >
                Usuń
              </Button>
            </Group>
          ))}
          {keys.data?.length === 0 && <Text size="sm">Nie masz jeszcze żadnego klucza.</Text>}
        </Stack>
      </Card>
    </Stack>
  );
}
