import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CopyButton, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";

interface Account {
  exists: boolean;
  username: string | null;
  active: boolean;
  has_passkey: boolean;
  has_password: boolean;
  last_login_at: string | null;
  invite_pending: boolean;
}
interface InviteOut {
  link: string;
  sent: boolean;
  account: Account;
}

/** Konto pracownika w systemie (tylko kadry): zaproszenie, status, wyłączenie. */
export function EmployeeAccountCard({ employeeId }: { employeeId: number }) {
  const qc = useQueryClient();
  const key = ["account", employeeId];
  const acc = useQuery({ queryKey: key, queryFn: () => api<Account>(`/employees/${employeeId}/account`) });
  const [email, setEmail] = useState("");
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
  const toggle = useMutation({
    mutationFn: (active: boolean) => api<Account>(`/employees/${employeeId}/account/active`, { method: "POST", body: { active } }),
    onSuccess: (a) => {
      setError(null);
      qc.setQueryData(key, a);
    },
    onError: (e) => setError(errorText(e)),
  });

  const a = acc.data;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Konto pracownika</Title>
        {a?.exists && (
          <Badge color={a.active ? (a.has_passkey || a.has_password ? "green" : "yellow") : "gray"}>
            {!a.active ? "wyłączone" : a.has_passkey || a.has_password ? "aktywne" : "czeka na aktywację"}
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
          {a.has_password ? " · hasło + kod z aplikacji" : ""}
          {a.last_login_at ? ` · ostatnie logowanie ${formatDateTime(a.last_login_at)}` : ""}
          {a.invite_pending ? " · zaproszenie wysłane" : ""}
        </Text>
      )}
      {!a?.exists && (
        <Text size="sm" c="dimmed" mb="sm">
          Pracownik nie ma konta. Wyślij zaproszenie – założy je sam na telefonie (twarz / odcisk palca).
        </Text>
      )}
      <Stack gap="xs">
        <TextInput
          label="E-mail pracownika (opcjonalnie)"
          description="Na ten adres wyślemy zaproszenie. Adresu nie zapisujemy – bez niego dostaniesz sam link."
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <Group>
          <Button loading={invite.isPending} disabled={a?.exists && !a.active} onClick={() => invite.mutate()}>
            {a?.exists ? "Wyślij zaproszenie ponownie" : "Wyślij zaproszenie"}
          </Button>
          {a?.exists && (
            <Button
              variant="light"
              color={a.active ? "red" : "green"}
              loading={toggle.isPending}
              onClick={() => toggle.mutate(!a.active)}
            >
              {a.active ? "Wyłącz konto" : "Włącz konto"}
            </Button>
          )}
        </Group>
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
