import { useState } from "react";
import { DangerAction, DangerZone, InfoRow, ListRow, Section, SheetHandle, StatusBadge, SectionHead, FormDialog } from "./Mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Button, Menu, CopyButton, Drawer, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconDots, IconKey, IconMail, IconUserOff, IconDevices } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useConfirm } from "../lib/confirm";
import { useIsPhone } from "../lib/device";

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
  const mobile = useIsPhone();
  const [inviteOpen, setInviteOpen] = useState(false);
  // ten sam panel: zaproszenie (pierwszy klucz) albo „dodaj urządzenie” (kolejny klucz, obecne zostają)
  const [mode, setMode] = useState<"invite" | "device">("invite");
  const [devOpen, setDevOpen] = useState(false);
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
    <section className="ui-dsec">
      <SectionHead title="Konto pracownika" />
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      <Stack gap="sm">
        <div className="ui-acct">
          <div className="ui-acct-state" data-tone={!a?.exists ? "none" : !a.active ? "off" : a.has_passkey ? "ok" : "warn"}>
            <span className="ui-acct-dot" aria-hidden />
            {!a?.exists ? "Bez konta" : !a.active ? "Konto wyłączone" : a.has_passkey ? "Konto aktywne" : "Czeka na aktywację"}
          </div>
          <Text size="sm" c="dimmed" mt={2}>
            {!a?.exists
              ? "Wyślij zaproszenie – pracownik założy konto sam na telefonie (twarz / odcisk palca)."
              : [
                  `Login: ${a.username}`,
                  a.has_passkey ? "klucz dostępu" : null,
                  a.last_login_at ? `ostatnio ${formatDateTime(a.last_login_at)}` : "jeszcze się nie logował(a)",
                  a.invite_pending ? "zaproszenie wysłane" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
          {(!a?.exists || (a.active && !a.has_passkey)) && (
            <Stack gap="xs" mt="sm">
              <TextInput
                size="sm"
                label="E-mail do zaproszenia (opcjonalnie)"
                description={contactEmail ? "Adres z kartoteki – możesz go zmienić." : "Bez adresu dostaniesz link do przekazania."}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            </Stack>
          )}
          <Group gap={8} mt="sm" wrap="nowrap" justify="flex-end">
            {(!a?.exists || (a.active && !a.has_passkey)) && (
              <Button size="xs" variant="default" leftSection={<IconMail size={14} />} loading={invite.isPending} onClick={() => invite.mutate()}>
                {a?.exists ? "Wyślij zaproszenie ponownie" : "Wyślij zaproszenie"}
              </Button>
            )}
            {activated && a?.active && (
              <Button size="xs" variant="default" leftSection={<IconDevices size={14} />} onClick={() => setDevOpen(true)}>
                Dodaj urządzenie
              </Button>
            )}
            {a?.exists && !a.active && (
              <Button size="xs" variant="default" loading={toggle.isPending} onClick={() => toggle.mutate(true)}>
                Włącz konto
              </Button>
            )}
            {a?.exists && a.active && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" size={30} aria-label="Więcej działań na koncie">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {activated && (
                    <Menu.Item
                      color="red"
                      leftSection={<IconKey size={16} />}
                      onClick={() =>
                        confirm({
                          title: "Zresetować dostęp?",
                          message: "Usunąć klucze, hasło i kody tego konta oraz wylogować pracownika? Np. po zgubieniu telefonu. Potem wyślij nowe zaproszenie.\n\nJeśli wpisano e-mail pracownika, dostanie wiadomość o resecie.",
                          confirmLabel: "Zresetuj dostęp",
                          danger: true,
                        }).then((ok) => ok && reset.mutate())
                      }
                    >
                      Zresetuj dostęp
                      <Text size="xs" c="dimmed">Np. po zgubieniu telefonu</Text>
                    </Menu.Item>
                  )}
                  <Menu.Item color="red" leftSection={<IconUserOff size={16} />} onClick={askDisable}>
                    Wyłącz konto
                    <Text size="xs" c="dimmed">Dane zostają w kartotece</Text>
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </div>
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
      <FormDialog
        opened={devOpen}
        onClose={() => setDevOpen(false)}
        title="Dodaj urządzenie"
        subtitle="Pracownik doda klucz na komputerze albo nowym telefonie. Obecne klucze zostają."
        size="sm"
        primary={{ label: email.trim() ? "Wyślij link" : "Utwórz link", formId: "fd-device", loading: device.isPending }}
      >
        <form
          id="fd-device"
          onSubmit={(ev) => {
            ev.preventDefault();
            setMode("device");
            device.mutate(undefined, { onSuccess: () => setDevOpen(false) });
          }}
        >
          <TextInput
            label="E-mail pracownika (opcjonalnie)"
            description="Bez adresu dostaniesz link do przekazania. Link działa 48 godzin, jeden raz."
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
        </form>
      </FormDialog>
    </section>
  );
}
