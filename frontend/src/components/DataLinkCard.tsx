import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, CopyButton, Drawer, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ListRow, Section, SheetHandle, FormDialog } from "./Mobile";
import { IconAlertCircle, IconCheck, IconCopy } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useConfirm } from "../lib/confirm";
import { useIsPhone } from "../lib/device";

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
export function DataLinkCard({ employeeId, contactEmail }: { employeeId: number; contactEmail?: string | null; contactPhone?: string | null }) {
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
  const mobile = useIsPhone();
  const [sheet, setSheet] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api<Status>(`/employees/${employeeId}/data-link`, { method: "DELETE" }),
    onSuccess: (s) => {
      setResult(null);
      qc.setQueryData(key, s);
      notifications.show({ color: "green", message: "Link do aktualizacji danych unieważniony." });
    },
    onError: (e) => setError(errorText(e)),
  });
  const s = st.data;
  if (!s || s.account_active) return null; // pracownik z kontem zmienia dane w aplikacji
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
        <Drawer
          opened={sheet}
          onClose={() => setSheet(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet" }}
          aria-label="Link do aktualizacji danych"
        >
          <SheetHandle onClose={() => setSheet(false)}>
            <div className="ui-sheet-head">
              <div className="ui-sheet-title">Link do aktualizacji danych</div>
              <div className="ui-row-desc">Pracownik bez konta zmieni zdjęcie, telefon i e-mail po potwierdzeniu daty urodzenia. Link działa 7 dni.</div>
            </div>
          </SheetHandle>
          <Stack gap="md" px={8} pb="md">
            {!s.has_birth_date && (
              <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                Uzupełnij datę urodzenia w kartotece – bez niej nie da się potwierdzić tożsamości.
              </Alert>
            )}
            {error && <Alert color="red">{error}</Alert>}
            {s.active && (
              <Text size="sm">
                Aktywny link do {s.expires_at ? formatDateTime(s.expires_at) : ""}
                {s.last_used_at ? ` · otwarty ${formatDateTime(s.last_used_at)}` : " · jeszcze nie otwarty"}
              </Text>
            )}
            <TextInput size="md" label="E-mail (opcjonalnie)" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <TextInput size="md" label="Telefon do SMS (opcjonalnie)" type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
            <Button size="md" fullWidth loading={create.isPending} disabled={!s.has_birth_date} onClick={() => create.mutate()}>
              {s.active ? "Wyślij nowy link" : "Utwórz i wyślij link"}
            </Button>
            {s.active && (
              <Button
                size="md"
                fullWidth
                variant="default"
                loading={cancel.isPending}
                onClick={() => {
                  // najpierw chowamy arkusz, żeby pytanie nie wisiało nad nim
                  setSheet(false);
                  confirm({ title: "Unieważnić link?", message: "Pracownik nie otworzy już swojej strony z danymi.", confirmLabel: "Unieważnij", danger: true }).then(
                    (ok) => ok && cancel.mutate(),
                  );
                }}
              >
                Unieważnij link
              </Button>
            )}
            {result && (
              <Alert color="green" icon={<IconCheck size={18} />}>
                {result.sent.length ? `Wysłano: ${result.sent.join(", ")}.` : "Link utworzony – nic nie wysłano."}
                <Text size="xs" mt={6} style={{ wordBreak: "break-all" }}>
                  {result.link}
                </Text>
                <CopyButton value={result.link}>
                  {({ copied, copy }) => (
                    <Button mt="xs" size="sm" variant="default" leftSection={<IconCopy size={14} />} onClick={copy}>
                      {copied ? "Skopiowano" : "Kopiuj link"}
                    </Button>
                  )}
                </CopyButton>
              </Alert>
            )}
          </Stack>
        </Drawer>
      </>
    );
  // komputer: część sekcji „Kontakt” – stan linku jednym zdaniem, wysyłka w okienku
  return (
    <>
      {s.active && (
        <Text size="sm" c="dimmed">
          Link do aktualizacji aktywny do {s.expires_at ? formatDateTime(s.expires_at) : "—"}
          {s.last_used_at ? ` · otwarty ${formatDateTime(s.last_used_at)}` : " · jeszcze nie otwarty"}
        </Text>
      )}
      <Group gap="lg">
        <Anchor component="button" type="button" size="sm" fw={600} onClick={() => setSheet(true)}>
          {s.active ? "Wyślij nowy link" : "Poproś o aktualizację"}
        </Anchor>
        {s.active && (
          <Anchor
            component="button"
            type="button"
            size="sm"
            fw={600}
            c="red"
            onClick={() => confirm({ title: "Unieważnić link?", message: "Pracownik nie otworzy już swojej strony z danymi.", confirmLabel: "Unieważnij", danger: true }).then((ok) => ok && cancel.mutate())}
          >
            Unieważnij link
          </Anchor>
        )}
      </Group>
      <FormDialog
        opened={sheet}
        onClose={() => setSheet(false)}
        title="Link do aktualizacji danych"
        subtitle="Pracownik bez konta zmieni zdjęcie, telefon i e-mail po potwierdzeniu daty urodzenia."
        size="md"
        cancel={result ? false : "Anuluj"}
        primary={result ? { label: "Gotowe", onClick: () => { setSheet(false); setResult(null); } } : { label: s.active ? "Wyślij nowy link" : "Utwórz link", onClick: () => create.mutate(), loading: create.isPending, disabled: !s.has_birth_date }}
      >
        <Stack gap="sm">
          {!s.has_birth_date && (
            <Alert color="orange" icon={<IconAlertCircle size={18} />}>
              Uzupełnij datę urodzenia w kartotece – bez niej nie da się potwierdzić tożsamości.
            </Alert>
          )}
          {error && <Alert color="red">{error}</Alert>}
          {result ? (
            <Alert color="green" icon={<IconCheck size={18} />}>
              {result.sent.length ? `Wysłano: ${result.sent.join(", ")}. ` : "Link utworzony – nic nie wysłano. "}
              {s.active ? "Poprzedni link przestał działać." : ""}
              <Text size="xs" mt={6} style={{ wordBreak: "break-all" }}>
                {result.link}
              </Text>
              <CopyButton value={result.link}>
                {({ copied, copy }) => (
                  <Button mt="xs" size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={copy}>
                    {copied ? "Skopiowano" : "Kopiuj link"}
                  </Button>
                )}
              </CopyButton>
            </Alert>
          ) : (
            <>
              <TextInput label="Wyślij e-mailem (opcjonalnie)" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              <TextInput label="Wyślij SMS-em (opcjonalnie)" type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
              <Text size="xs" c="dimmed">
                Bez adresu i numeru dostaniesz link do przekazania. Link czeka na użycie 7 dni, po otwarciu działa 15 minut, blokuje się po 5 błędnych
                próbach.
              </Text>
            </>
          )}
        </Stack>
      </FormDialog>
    </>
  );
}
