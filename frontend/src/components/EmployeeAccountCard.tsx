import { useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { DangerAction, DangerZone, InfoRow, Section, StatusBadge } from "./Mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CopyButton, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconMail } from "@tabler/icons-react";

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
      <Alert color="green" variant="light" title={result.sent ? "Zaproszenie wysłane e-mailem" : "Link do zaproszenia"}>
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
          <InfoRow label="Stan">
            {!a?.exists ? <StatusBadge tone="neutral">brak konta</StatusBadge> : !a.active ? <StatusBadge tone="neutral">wyłączone</StatusBadge> : a.has_passkey ? <StatusBadge tone="ok">aktywne</StatusBadge> : <StatusBadge tone="wait">czeka na aktywację</StatusBadge>}
          </InfoRow>
          {a?.exists && <InfoRow label="Login"><span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>{a.username}</span></InfoRow>}
          {a?.has_passkey && <InfoRow label="Logowanie">klucz dostępu</InfoRow>}
          {a?.last_login_at && <InfoRow label="Ostatnio">{formatDateTime(a.last_login_at)}</InfoRow>}
        </Section>
        {!activated && (a?.active ?? true) && (
          <Section title="Zaproszenie" plain>
            <Stack gap="sm">
              <TextInput label="Wyślij na e-mail" description={contactEmail ? undefined : "Bez adresu dostaniesz link do przekazania."} type="email" size="md" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              <Button size="md" variant="default" leftSection={<IconMail size={18} />} loading={invite.isPending} onClick={() => invite.mutate()}>
                {a?.exists ? "Wyślij zaproszenie ponownie" : "Wyślij zaproszenie"}
              </Button>
              {resultBox}
            </Stack>
          </Section>
        )}
        {a?.exists && !a.active && (
          <Button size="md" variant="default" loading={toggle.isPending} onClick={() => toggle.mutate(true)}>
            Włącz konto
          </Button>
        )}
        {a?.exists && a.active && (
          <DangerZone>
            {activated && <DangerAction label="Zresetuj dostęp" description="Np. po zgubieniu telefonu. Stare klucze przestaną działać." loading={reset.isPending} onClick={askReset} />}
            <DangerAction label="Wyłącz konto" description="Pracownik nie zaloguje się, dane zostają w kartotece." loading={toggle.isPending} onClick={askDisable} />
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
          {a.has_passkey ? " · klucz dostępu" : ""}
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
        {!activated && (a?.active ?? true) && (
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
        {a?.exists && !a.active && (
          <Button variant="default" loading={toggle.isPending} onClick={() => toggle.mutate(true)} style={{ alignSelf: "flex-start" }}>
            Włącz konto
          </Button>
        )}
        {a?.exists && a.active && (
          <Stack gap="xs" p="sm" mt="xs" className="danger-zone">
            <Text size="sm" fw={700} c="red">
              Zmiany, których nie da się cofnąć
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
          <Alert color="green" variant="light" title={result.sent ? "Zaproszenie wysłane e-mailem" : "Link do zaproszenia"}>
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
