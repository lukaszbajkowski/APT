import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CopyButton, Drawer, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ListRow, Section } from "./Mobile";
import { IconAlertCircle, IconCheck, IconCopy } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useConfirm } from "../lib/confirm";

interface Status {
  account_active: boolean;
  has_birth_date: boolean;
  active: boolean;
  expires_at: string | null;
  created_at: string | null;
  last_used_at: string | null;
}
interface Out {
  link: string;
  sent: string[];
  status: Status;
}

/** Kadry: link „aktualizacja danych” dla pracownika bez konta (zdjęcie, telefon, e-mail). */
export function DataLinkCard({ employeeId, contactEmail, contactPhone }: { employeeId: number; contactEmail?: string | null; contactPhone?: string | null }) {
  const qc = useQueryClient();
  const key = ["data-link-status", employeeId];
  const st = useQuery({ queryKey: key, queryFn: () => api<Status>(`/employees/${employeeId}/data-link`), refetchInterval: 15_000 });
  const [email, setEmail] = useState(contactEmail ?? "");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<Out | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<Out>(`/employees/${employeeId}/data-link`, { method: "POST", body: { email: email.trim() || null, phone: phone.trim() || null } }),
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      qc.setQueryData(key, r.status);
    },
    onError: (e) => setError(errorText(e)),
  });
  const confirm = useConfirm();
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [sheet, setSheet] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api<Status>(`/employees/${employeeId}/data-link`, { method: "DELETE" }),
    onSuccess: (s) => {
      setResult(null);
      qc.setQueryData(key, s);
    },
    onError: (e) => setError(errorText(e)),
  });
  const s = st.data;
  if (!s || s.account_active) return null; // pracownik z kontem zmienia dane w aplikacji
  const body = (
    <>
      <Title order={4} mb="xs">
        Aktualizacja danych (bez konta)
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Link pozwala pracownikowi bez konta zmienić zdjęcie, telefon i e-mail po potwierdzeniu daty urodzenia. Czeka na użycie 7 dni, a od pierwszego
        potwierdzenia daty urodzenia działa już tylko 15 minut. Blokuje się po 5 błędnych próbach.
        {contactPhone ? ` Zapisany telefon: ${contactPhone}.` : ""}
      </Text>
      {!s.has_birth_date && (
        <Alert color="orange" icon={<IconAlertCircle size={18} />} mb="sm">
          Uzupełnij datę urodzenia w kartotece – bez niej nie da się potwierdzić tożsamości.
        </Alert>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} mb="sm">
          {error}
        </Alert>
      )}
      {s.active && (
        <Text size="sm" mb="sm">
          Aktywny link do {s.expires_at ? formatDateTime(s.expires_at) : ""}
          {s.last_used_at ? ` · otwarty ${formatDateTime(s.last_used_at)} (działa 15 min od pierwszego otwarcia)` : " · jeszcze nie otwarty"}
        </Text>
      )}
      <Stack gap="xs">
        <TextInput label="Wyślij e-mailem (opcjonalnie)" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <TextInput label="Wyślij SMS-em (opcjonalnie)" type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
        <Group>
          <Button loading={create.isPending} disabled={!s.has_birth_date} onClick={() => create.mutate()}>
            {s.active ? "Wyślij nowy link" : "Utwórz link"}
          </Button>
          {s.active && (
            <Button variant="default" loading={cancel.isPending} onClick={() => confirm({ title: "Unieważnić link?", message: "Unieważnić aktywny link? Pracownik nie otworzy już swojej strony z danymi.", confirmLabel: "Unieważnij", danger: true }).then((ok) => ok && cancel.mutate())}>
              Unieważnij
            </Button>
          )}
        </Group>
        {result && (
          <Alert color="green" icon={<IconCheck size={18} />}>
            {result.sent.length ? `Wysłano: ${result.sent.join(", ")}. ` : "Link utworzony – nic nie wysłano. "}
            Poprzedni link przestał działać.
            <Group mt="xs" gap="xs">
              <Text size="xs" style={{ wordBreak: "break-all" }}>
                {result.link}
              </Text>
              <CopyButton value={result.link}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={copy}>
                    {copied ? "Skopiowano" : "Kopiuj"}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Alert>
        )}
      </Stack>
    </>
  );
  if (mobile)
    return (
      <>
        <Section title="Aktualizacja danych bez konta">
          <ListRow
            title={s.active ? "Link jest aktywny" : "Wyślij link do aktualizacji"}
            description={s.active && s.expires_at ? `do ${formatDateTime(s.expires_at)}` : "Zdjęcie, telefon i e-mail po potwierdzeniu daty urodzenia."}
            onClick={() => setSheet(true)}
          />
        </Section>
        <Drawer opened={sheet} onClose={() => setSheet(false)} position="bottom" size="auto" radius="lg" title="Aktualizacja danych bez konta">
          {body}
        </Drawer>
      </>
    );
  return <Card withBorder padding="lg">{body}</Card>;
}
