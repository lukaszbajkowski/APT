import { useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { DangerAction, DangerZone, InfoRow, ListRow, Section, SheetHandle, StatusBadge } from "./Mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CopyButton, Drawer, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconMail, IconUserOff, IconDevices } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useConfirm } from "../lib/confirm";

interface Account {
  exists: boolean;
  username: string | null;
  active: boolean;
  has_passkey: boolean;
  last_login_at: string | null;
  invite_pending: boolean;
}
interface InviteOut {
  link: string;
  sent: boolean;
  account: Account;
}

/** Konto pracownika w systemie (tylko kadry): zaproszenie, status, wyłączenie. */
export function EmployeeAccountCard({ employeeId, contactEmail }: { employeeId: number; contactEmail?: string | null }) {
  const confirm = useConfirm();
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [inviteOpen, setInviteOpen] = useState(false);
  // ten sam panel: zaproszenie (pierwszy klucz) albo „dodaj urządzenie” (kolejny klucz, obecne zostają)
  const [mode, setMode] = useState<"invite" | "device">("invite");
  const qc = useQueryClient();
  const key = ["account", employeeId];
  const acc = useQuery({ queryKey: key, queryFn: () => api<Account>(`/employees/${employeeId}/account`) });
  const [email, setEmail] = useState(contactEmail ?? "");
  const [result, setResult] = useState<InviteOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      api<InviteOut>(`/employees/${employeeId}/account/invite`, { method: "POST", body: { email: email.trim() || null } }),
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      qc.setQueryData(key, r.account);
    },
    onError: (e) => setError(errorText(e)),
  });
  const device = useMutation({
    mutationFn: () =>
      api<InviteOut>(`/employees/${employeeId}/account/device-link`, { method: "POST", body: { email: email.trim() || null } }),
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      qc.setQueryData(key, r.account);
    },
    onError: (e) => setError(errorText(e)),
  });
  const openSheet = (m: "invite" | "device") => {
    setMode(m);
    setResult(null);
    setError(null);
    setInviteOpen(true);
  };
  const reset = useMutation({
    mutationFn: () => api<Account>(`/employees/${employeeId}/account/reset`, { method: "POST", body: { email: email.trim() || null } }),
    onSuccess: (a) => {
      setError(null);
      setResult(null);
      qc.setQueryData(key, a);
    },
    onError: (e) => setError(errorText(e)),
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api<Account>(`/employees/${employeeId}/account/active`, { method: "POST", body: { active } }),
    onSuccess: (a) => {
      setError(null);
      qc.setQueryData(key, a);
    },
    onError: (e) => setError(errorText(e)),
  });

  const a = acc.data;
  const activated = !!a && a.has_passkey;
  const askReset = () =>
    confirm({
      title: "Zresetować konto?",
      message: "Usunąć klucze, hasło i kody tego konta oraz wylogować pracownika? Potem wyślij nowe zaproszenie.",
      confirmLabel: "Zresetuj konto",
      danger: true,
    }).then((ok) => ok && reset.mutate());
  const askDisable = () =>
    confirm({
      title: "Wyłączyć konto?",
      message: "Pracownik nie zaloguje się do aplikacji, dopóki nie włączysz konta ponownie. Dane w kartotece zostają bez zmian.",
      confirmLabel: "Wyłącz konto",
      danger: true,
    }).then((ok) => ok && toggle.mutate(false));
  if (mobile) {
    const resultBox = result && (
      <Alert color="green" variant="light" title={result.sent ? (mode === "device" ? "Link wysłany e-mailem" : "Zaproszenie wysłane e-mailem") : mode === "device" ? "Link „dodaj urządzenie”" : "Link do zaproszenia"}>
        {!result.sent && (
          <Stack gap={6}>
            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
              {result.link}
            </Text>
            <CopyButton value={result.link}>{({ copied, copy }) => <Button size="xs" variant="default" onClick={copy}>{copied ? "Skopiowano" : "Kopiuj link"}</Button>}</CopyButton>
          </Stack>
        )}
      </Alert>
    );
    return (
      <Stack gap="lg">
        {error && <Alert color="red" icon={<IconAlertCircle size={18} />}>{error}</Alert>}
        <Section title="Konto w aplikacji">
          {!a?.exists ? (
            <ListRow
              leading={<IconUserOff size={20} />}
              title="Brak konta"
              description="Pracownik założy je sam na telefonie – twarz lub odcisk palca."
            />
          ) : (
            <>
              <InfoRow label="Stan">
                {!a.active ? <StatusBadge tone="neutral">Wyłączone</StatusBadge> : a.has_passkey ? <StatusBadge tone="ok">Aktywne</StatusBadge> : <StatusBadge tone="wait">Czeka na aktywację</StatusBadge>}
              </InfoRow>
              <InfoRow label="Login"><span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>{a.username}</span></InfoRow>
              {a.has_passkey && <InfoRow label="Logowanie">Klucz dostępu</InfoRow>}
              {a.last_login_at && <InfoRow label="Ostatnio">{formatDateTime(a.last_login_at)}</InfoRow>}
            </>
          )}
        </Section>
        {(!a?.exists || (a.active && !a.has_passkey)) && (
          <Button size="md" fullWidth leftSection={<IconMail size={18} />} onClick={() => openSheet("invite")}>
            {a?.exists ? "Wyślij zaproszenie ponownie" : "Załóż konto – wyślij zaproszenie"}
          </Button>
        )}
        {activated && a?.active && (
          <Section title="Nowe urządzenie">
            <ListRow
              leading={<span className="ui-row-icon" aria-hidden><IconDevices size={22} /></span>}
              title="Wyślij link „dodaj urządzenie”"
              description="Pracownik doda klucz na komputerze albo nowym telefonie. Obecne klucze zostają."
              onClick={() => openSheet("device")}
            />
          </Section>
        )}
        <Drawer
          opened={inviteOpen}
          onClose={() => setInviteOpen(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet" }}
          aria-label="Zaproszenie do aplikacji"
        >
          <SheetHandle onClose={() => setInviteOpen(false)}>
            <div className="ui-sheet-head">
              <div className="ui-sheet-title">{mode === "device" ? "Dodaj urządzenie" : a?.exists ? "Wyślij zaproszenie ponownie" : "Załóż konto"}</div>
              <div className="ui-row-desc">
                {mode === "device"
                  ? "Pracownik otworzy link na nowym urządzeniu, potwierdzi datę urodzenia i utworzy tam klucz. Link działa 48 godzin, jeden raz."
                  : "Pracownik dostanie link i sam utworzy klucz logowania na swoim telefonie."}
              </div>
            </div>
          </SheetHandle>
          <Stack gap="md" px={8} pb="md">
            <TextInput
              size="md"
              label="E-mail pracownika"
              description={contactEmail ? "Adres z kartoteki – możesz go zmienić." : "Opcjonalnie. Bez adresu dostaniesz link do przekazania."}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            {error && <Alert color="red" icon={<IconAlertCircle size={18} />}>{error}</Alert>}
            <Button size="md" fullWidth leftSection={<IconMail size={18} />} loading={invite.isPending || device.isPending} onClick={() => (mode === "device" ? device.mutate() : invite.mutate())}>
              {mode === "device" ? (email.trim() ? "Wyślij link" : "Utwórz link do przekazania") : email.trim() ? "Wyślij zaproszenie" : "Utwórz link do zaproszenia"}
            </Button>
            {resultBox}
          </Stack>
        </Drawer>
        {a?.exists && !a.active && (
          <Button size="md" variant="default" loading={toggle.isPending} onClick={() => toggle.mutate(true)}>
            Włącz konto
          </Button>
        )}
        {a?.exists && a.active && (
          <DangerZone>
            {activated && <DangerAction label="Zresetuj dostęp" description="Np. po zgubieniu telefonu. Stare klucze przestaną działać – trzeba będzie wysłać nowe zaproszenie." loading={reset.isPending} onClick={askReset} />}
            <DangerAction label="Wyłącz konto" description="Pracownik nie zaloguje się, dopóki go nie włączysz. Dane zostają w kartotece." loading={toggle.isPending} onClick={askDisable} />
          </DangerZone>
        )}
      </Stack>
    );
  }
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Konto pracownika</Title>
        {a?.exists && (
          <Badge
            variant="light"
            color={a.active ? (a.has_passkey ? "green" : "orange") : "gray"}
            leftSection={a.active && a.has_passkey ? <IconCheck size={12} aria-hidden /> : undefined}
          >
            {!a.active ? "wyłączone" : a.has_passkey ? "aktywne" : "czeka na aktywację"}
          </Badge>
        )}
      </Group>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} mb="sm">
          {error}
        </Alert>
      )}
      {a?.exists && (
        <Text size="sm" c="dimmed" mb="sm">
          Login: {a.username}
          {a.has_passkey ? " · Klucz dostępu" : ""}
          {a.last_login_at ? ` · ostatnie logowanie ${formatDateTime(a.last_login_at)}` : ""}
          {a.invite_pending ? " · zaproszenie wysłane" : ""}
        </Text>
      )}
      {!a?.exists && (
        <Text size="sm" c="dimmed" mb="sm">
          Pracownik nie ma konta. Wyślij zaproszenie – założy je sam na telefonie (twarz / odcisk palca).
        </Text>
      )}
      <Stack gap="sm">
        {(!a?.exists || (a.active && !a.has_passkey)) && (
          <>
            <TextInput
              label="E-mail do zaproszenia (opcjonalnie)"
              description={contactEmail ? "Adres z kartoteki – możesz go zmienić." : "Bez adresu dostaniesz link do przekazania."}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button variant="default" leftSection={<IconMail size={16} />} loading={invite.isPending} onClick={() => invite.mutate()} style={{ alignSelf: "flex-start" }}>
              {a?.exists ? "Wyślij zaproszenie ponownie" : "Wyślij zaproszenie"}
            </Button>
          </>
        )}
        {activated && a?.active && (
          <>
            <TextInput
              label="E-mail do linku „dodaj urządzenie” (opcjonalnie)"
              description="Pracownik doda klucz na komputerze albo nowym telefonie. Obecne klucze zostają. Link działa 48 godzin, jeden raz."
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button variant="default" leftSection={<IconDevices size={16} />} loading={device.isPending} onClick={() => { setMode("device"); device.mutate(); }} style={{ alignSelf: "flex-start" }}>
              Wyślij link „dodaj urządzenie”
            </Button>
          </>
        )}
        {a?.exists && !a.active && (
          <Button variant="default" loading={toggle.isPending} onClick={() => toggle.mutate(true)} style={{ alignSelf: "flex-start" }}>
            Włącz konto
          </Button>
        )}
        {a?.exists && a.active && (
          <Stack gap="xs" p="sm" mt="xs" className="danger-zone">
            <Text size="sm" fw={700} c="red">
              Działania wymagające ostrożności
            </Text>
            {activated && (
              <Button
                variant="outline"
                color="red"
                justify="flex-start"
                h="auto"
                py={8}
                loading={reset.isPending}
                onClick={() =>
                  confirm({
                    title: "Zresetować konto?",
                    message: "Usunąć klucze, hasło i kody tego konta oraz wylogować pracownika? Potem wyślij nowe zaproszenie.\n\nJeśli wpisano e-mail pracownika, dostanie wiadomość o resecie.",
                    confirmLabel: "Zresetuj konto",
                    danger: true,
                  }).then((ok) => ok && reset.mutate())
                }
              >
                <Stack gap={0} align="flex-start">
                  <span>Zresetuj dostęp</span>
                  <Text span size="xs" c="dimmed" fw={400} style={{ whiteSpace: "normal", textAlign: "left" }}>
                    Np. po zgubieniu telefonu. Stare klucze przestaną działać.
                  </Text>
                </Stack>
              </Button>
            )}
            <Button variant="outline" color="red" justify="flex-start" h="auto" py={8} loading={toggle.isPending} onClick={askDisable}>
              <Stack gap={0} align="flex-start">
                <span>Wyłącz konto</span>
                <Text span size="xs" c="dimmed" fw={400} style={{ whiteSpace: "normal", textAlign: "left" }}>
                  Pracownik nie zaloguje się, dane zostają w kartotece.
                </Text>
              </Stack>
            </Button>
          </Stack>
        )}
        {result && (
          <Alert color="green" variant="light" title={result.sent ? (mode === "device" ? "Link wysłany e-mailem" : "Zaproszenie wysłane e-mailem") : mode === "device" ? "Link „dodaj urządzenie”" : "Link do zaproszenia"}>
            <Text size="sm" style={{ wordBreak: "break-all" }}>
              {result.link}
            </Text>
            <CopyButton value={result.link}>
              {({ copied, copy }) => (
                <Button size="xs" variant="subtle" onClick={copy}>
                  {copied ? "Skopiowano" : "Kopiuj link"}
                </Button>
              )}
            </CopyButton>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
