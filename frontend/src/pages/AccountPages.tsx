import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Card, Center, Group, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconFingerprint, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, MFA_PATH, type Me } from "../api";
import { useAuth } from "../auth";
import { createPasskey, passkeyErrorText, passkeysSupported } from "../lib/passkey";

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
  const [password, setPassword] = useState("");
  const [fallback, setFallback] = useState(!passkeysSupported());
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

  const withPasskey = () =>
    run(async () => {
      const o = await api<Options>("/auth/invite/options", { method: "POST", body: { token, birth_date: birth || null } });
      const credential = await createPasskey(o.options);
      return api<Me>("/auth/invite/passkey", {
        method: "POST",
        body: { token, birth_date: birth || null, challenge_id: o.challenge_id, credential },
      });
    });
  const withPassword = () =>
    run(() => api<Me>("/auth/invite/password", { method: "POST", body: { token, birth_date: birth || null, password } }));

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
              {!fallback ? (
                <>
                  <Button size="md" leftSection={<IconFingerprint size={20} />} loading={busy} disabled={!ready} onClick={withPasskey}>
                    Utwórz klucz dostępu
                  </Button>
                  <Anchor component="button" type="button" size="sm" onClick={() => setFallback(true)}>
                    Nie działa? Ustaw hasło (z kodem z aplikacji)
                  </Anchor>
                </>
              ) : (
                <>
                  <PasswordInput
                    label="Hasło"
                    description="Potem poprosimy o skonfigurowanie kodu z aplikacji uwierzytelniającej."
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                  />
                  <Button size="md" loading={busy} disabled={!ready || !password} onClick={withPassword}>
                    Ustaw hasło
                  </Button>
                  {passkeysSupported() && (
                    <Anchor component="button" type="button" size="sm" onClick={() => setFallback(false)}>
                      Wróć do klucza dostępu
                    </Anchor>
                  )}
                </>
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

interface MyEmployee {
  number: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  has_passkey: boolean;
  has_password: boolean;
}

export function MyAccountPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ["my-employee"], queryFn: () => api<MyEmployee>("/me/employee"), enabled: hasRole("employee") });
  const keys = useQuery({ queryKey: ["passkeys"], queryFn: () => api<Passkey[]>("/passkeys") });

  const add = useMutation({
    mutationFn: async () => {
      const o = await api<Options>("/passkeys/options", { method: "POST" });
      const credential = await createPasskey(o.options);
      await api("/passkeys", { method: "POST", body: { challenge_id: o.challenge_id, credential } });
    },
    onSuccess: () => {
      setError(null);
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
      <Title order={2}>Moje konto</Title>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      {mine.data && (
        <Card withBorder padding="lg">
          <Title order={4} mb="xs">
            Moje dane
          </Title>
          <Text>
            {mine.data.first_name} {mine.data.last_name}
          </Text>
          <Text size="sm" c="dimmed">
            Numer ewidencyjny: {mine.data.number}
            {mine.data.birth_date ? ` · urodzony(a) ${formatDate(mine.data.birth_date)}` : ""}
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            Zmiana zdjęcia i danych kontaktowych pojawi się w kolejnym etapie. Do tego czasu zgłoś zmiany w kadrach.
          </Text>
        </Card>
      )}
      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Klucze dostępu</Title>
          <Button
            leftSection={<IconFingerprint size={18} />}
            loading={add.isPending}
            disabled={!passkeysSupported()}
            onClick={() => add.mutate()}
          >
            Dodaj klucz
          </Button>
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          Logujesz się twarzą, odciskiem palca lub PIN-em urządzenia. Dodaj klucz na każdym swoim telefonie lub komputerze.
        </Text>
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
