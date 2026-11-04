import { InstallApp } from "../components/InstallApp";
import { PushCard } from "../components/PushCard";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Card, Center, CopyButton, Drawer, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconDevices, IconFingerprint, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDateTime, MFA_PATH, type Me } from "../api";
import { useAuth } from "../auth";
import { LanguagePicker, useT } from "../lib/i18n";
import { createPasskey, inAppBrowser, passkeyErrorText, passkeysSupported } from "../lib/passkey";
import { EmptyState, Loading } from "../components/States";
import { DateField } from "../components/DateField";
import { useConfirm } from "../lib/confirm";
import { useMediaQuery } from "@mantine/hooks";
import { CompactEmpty, ListRow, PageHead, Section, SheetHandle } from "../components/Mobile";

interface Options {
  challenge_id: string;
  options: Record<string, unknown>;
}

/** Strona z linku z zaproszenia: data urodzenia -> klucz dostępu (albo hasło jako zapas). */
export function InvitePage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [birth, setBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ name: string; needs_birth_date: boolean; add_device?: boolean }>(`/auth/invite/${encodeURIComponent(token)}`),
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
  // link „dodaj urządzenie”: konto już działa, to urządzenie dostanie kolejny klucz
  const addDevice = !!info.data?.add_device;
  const ready = !needsBirth || !!birth;

  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={440}>
        <Stack>
          <Title order={3} className="brand-title">
            {addDevice ? t("Dodaj to urządzenie") : t("Załóż swoje konto")}
          </Title>
          <LanguagePicker />
          {info.isLoading && <Loading />}
          {(info.isError || !token) && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {t("Link wygasł albo został już wykorzystany. Poproś kadry o nowy.")}
            </Alert>
          )}
          {info.data && (
            <>
              <Text size="sm">
                {info.data.name},{" "}
                {addDevice
                  ? t("utworzysz klucz na tym urządzeniu. Klucze na Twoich pozostałych urządzeniach dalej działają.")
                  : t("zalogujesz się na to konto twarzą, odciskiem palca albo PIN-em telefonu – bez hasła.")}
              </Text>
              {inAppBrowser() && (
                <Alert color="yellow" title={t("Otwórz w przeglądarce")} icon={<IconAlertCircle size={18} />}>
                  <Text size="sm">
                    {t("Ta strona otworzyła się w oknie aplikacji (np. komunikatora), gdzie klucz dostępu nie działa. Skopiuj link, otwórz go w Safari lub Chrome i dokończ tam.")}
                  </Text>
                  <CopyButton value={window.location.href}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" mt="xs" onClick={copy}>
                        {copied ? t("Skopiowano") : t("Kopiuj link")}
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
                <DateField
                  label={t("Data urodzenia")}
                  description={t("Potwierdzamy, że to Ty.")}
                  
                  value={birth}
                  onChange={(e) => setBirth(e.currentTarget.value)}
                />
              )}
              {!passkeysSupported() ? (
                <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                  {t("To urządzenie albo przeglądarka nie obsługuje kluczy dostępu. Otwórz zaproszenie w Safari (iPhone) lub Chrome (Android) albo skontaktuj się z kadrami.")}
                </Alert>
              ) : !prepared ? (
                <Button size="md" loading={busy} disabled={!ready} onClick={prepare}>
                  {t("Dalej")}
                </Button>
              ) : (
                <Button size="md" leftSection={<IconFingerprint size={20} />} loading={busy} onClick={withPasskey}>
                  {addDevice ? t("Utwórz klucz na tym urządzeniu") : t("Utwórz klucz dostępu")}
                </Button>
              )}
            </>
          )}
          <Anchor component={Link} to="/login" size="sm" c="dimmed" ta="center">
            {t("Mam już konto – zaloguj")}
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

/** Panel od dołu: jak dodać klucz logowania na innym urządzeniu (bez klucza na nim). */
function OtherDeviceSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const t = useT();
  const steps = [
    t("Na komputerze otwórz aptid.pl i kliknij „Klucz na telefonie? Zaloguj kodem QR” – pojawi się kod QR."),
    t("Jeśli zamiast kodu zobaczysz okno z wyborem, wybierz „Użyj telefonu lub tabletu” (albo „Inne urządzenie”)."),
    t("Zeskanuj kod aparatem telefonu, na którym masz klucz, i potwierdź twarzą lub odciskiem palca. Oba urządzenia muszą mieć włączony Bluetooth i być obok siebie."),
    t("Po zalogowaniu wejdź w „Logowanie i powiadomienia” i dotknij „Dodaj klucz” – nowe urządzenie dostanie własny klucz."),
  ];
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label={t("Klucz na innym urządzeniu")}>
      <SheetHandle onClose={onClose}>
        <div className="ui-sheet-head">
          <div className="ui-sheet-title">{t("Klucz na innym urządzeniu")}</div>
        </div>
      </SheetHandle>
      <Stack gap={16} px={8} pb="md">
        <Text size="sm">
          {t("Ten sam iPhone, iPad i Mac (jedno Apple ID) albo Android z tym samym kontem Google mają klucz od razu – nic nie musisz robić.")}
        </Text>
        <div>
          <Text fw={700} mb={8}>{t("Inne urządzenie (np. komputer)")}</Text>
          <ol className="ui-steps">
            {steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
        <Text size="sm" c="dimmed">
          {t("Zgubiłeś telefon i nie masz klucza na innym urządzeniu? Poproś kadry o reset dostępu – dostaniesz nowe zaproszenie.")}
        </Text>
        <Button size="lg" variant="default" fullWidth onClick={onClose}>
          {t("Rozumiem")}
        </Button>
      </Stack>
    </Drawer>
  );
}

export function MyAccountPage() {
  const t = useT();
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
  // telefon (kadry): hasło do potwierdzenia pojawia się dopiero po „Dodaj klucz”
  const [adding, setAdding] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
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
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (id: number) => api(`/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  if (!hasRole("employee") && !hasRole("admin", "hr", "manager", "viewer", "agency")) return <Navigate to="/" replace />;

  const addKey = () => (prepared ? add.mutate() : prepare.mutate());

  if (mobile)
    return (
      <Stack gap={24}>
        <PageHead title={t("Logowanie i powiadomienia")} />
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        <Section title={t("Klucze logowania")}>
          {keys.isLoading ? (
            <Loading rows={1} />
          ) : keys.data?.length ? (
            keys.data.map((k) => (
              <ListRow
                key={k.id}
                leading={<span className="ui-row-icon" aria-hidden><IconFingerprint size={22} /></span>}
                title={k.name}
                description={k.last_used_at ? t("ostatnio {date}", { date: formatDateTime(k.last_used_at) }) : t("dodany {date}", { date: formatDateTime(k.created_at) })}
                trailing={
                  <Button
                    variant="subtle"
                    color="red"
                    loading={remove.isPending && remove.variables === k.id}
                    onClick={() => confirm({ title: t("Usunąć klucz?"), message: t("Na tym urządzeniu nie zalogujesz się już tym kluczem."), confirmLabel: t("Usuń"), danger: true }).then((ok) => ok && remove.mutate(k.id))}
                  >
                    {t("Usuń")}
                  </Button>
                }
              />
            ))
          ) : (
            <CompactEmpty title={t("Nie masz jeszcze klucza dostępu")} text={t("Dodaj klucz, żeby logować się twarzą lub odciskiem palca.")} />
          )}
        </Section>
        {reauth && adding && (
          <Stack gap={16}>
            <span className="ui-hint-warn">{t("Potwierdź, że to Ty – wpisz hasło, potem utwórz klucz.")}</span>
            <PasswordInput label={t("Obecne hasło")} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} />
            {me?.user.mfa_enabled && (
              <TextInput label={t("Kod z aplikacji")} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
            )}
          </Stack>
        )}
        <Stack gap={8}>
          <Button
            size="lg"
            fullWidth
            leftSection={<IconFingerprint size={20} />}
            loading={add.isPending || prepare.isPending}
            disabled={!passkeysSupported() || (adding && !prepared && reauth && !pw)}
            onClick={() => (reauth && !adding ? setAdding(true) : addKey())}
          >
            {prepared ? t("Utwórz klucz na tym urządzeniu") : adding ? t("Dalej") : t("Dodaj klucz")}
          </Button>
        </Stack>
        <div className="ui-group">
          <ListRow
            leading={<span className="ui-row-icon" aria-hidden><IconDevices size={22} /></span>}
            title={t("Klucz na innym urządzeniu")}
            description={t("Jak zalogować się na komputerze lub drugim telefonie")}
            onClick={() => setOtherOpen(true)}
          />
        </div>
        <OtherDeviceSheet opened={otherOpen} onClose={() => setOtherOpen(false)} />
        <PushCard rows />
        <InstallApp rows />
      </Stack>
    );

  return (
    <Stack maw={640}>
      <Title order={2}>{t("Logowanie i powiadomienia")}</Title>
      <InstallApp />
      <PushCard />
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
          <Title order={4}>{t("Twoje klucze")}</Title>
          <Button
            leftSection={<IconFingerprint size={18} />}
            loading={add.isPending || prepare.isPending}
            disabled={!passkeysSupported() || (!prepared && reauth && !pw)}
            onClick={() => (prepared ? add.mutate() : prepare.mutate())}
          >
            {prepared ? t("Utwórz klucz na tym urządzeniu") : t("Dodaj klucz")}
          </Button>
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          {t("Logujesz się twarzą, odciskiem palca lub PIN-em urządzenia – bez hasła. Dodaj klucz także na drugim urządzeniu (np. komputerze), żeby nie stracić dostępu po zgubieniu telefonu. Gdy mimo to stracisz dostęp, kadry zresetują go i wyślą nowe zaproszenie.")}{" "}
          <Anchor component="button" type="button" size="sm" onClick={() => setOtherOpen(true)}>
            {t("Jak dodać klucz na innym urządzeniu")}
          </Anchor>
        </Text>
        <OtherDeviceSheet opened={otherOpen} onClose={() => setOtherOpen(false)} />
        {reauth && (
          <Stack gap="xs" mb="sm">
            <Text size="sm">{t("Przed dodaniem klucza potwierdź tożsamość:")}</Text>
            <PasswordInput label={t("Obecne hasło")} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} />
            {me?.user.mfa_enabled && (
              <TextInput label={t("Kod z aplikacji")} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
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
                  {t("dodany {date}", { date: formatDateTime(k.created_at) })}
                  {k.last_used_at ? ` · ${t("ostatnio {date}", { date: formatDateTime(k.last_used_at) })}` : ""}
                </Text>
              </div>
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconTrash size={14} />}
                loading={remove.isPending && remove.variables === k.id}
                onClick={() => confirm({ title: t("Usunąć klucz?"), message: t("Usunąć ten klucz?"), confirmLabel: t("Usuń"), danger: true }).then((ok) => ok && remove.mutate(k.id))}
              >
                {t("Usuń")}
              </Button>
            </Group>
          ))}
          {keys.data?.length === 0 && <EmptyState compact title={t("Nie masz jeszcze klucza dostępu")} text={t("Klucz pozwala logować się odciskiem palca lub twarzą. Dodaj go przyciskiem powyżej.")} />}
        </Stack>
      </Card>
    </Stack>
  );
}
