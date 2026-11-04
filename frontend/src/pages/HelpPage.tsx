import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Group, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconClock, IconEdit, IconMail, IconPhone, IconUser } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { useAuth } from "../auth";
import { AuthShell } from "../components/AuthShell";
import { FormDialog } from "../components/Mobile";
import { Loading } from "../components/States";
import { useT } from "../lib/i18n";

export interface SiteInfo {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_hours: string;
  privacy_text: string;
  updated_at: string | null;
}

export function useSiteInfo() {
  return useQuery({ queryKey: ["site-info"], queryFn: () => api<SiteInfo>("/site-info"), staleTime: 5 * 60_000 });
}

/** Wzór informacji o przetwarzaniu danych – do uzupełnienia przez administratora (w nawiasach kwadratowych). */
const PRIVACY_TEMPLATE = `## Kto jest administratorem Twoich danych
[Pełna nazwa pracodawcy / agencji, adres, NIP]. Kontakt w sprawie danych osobowych: [e-mail lub adres inspektora ochrony danych].

## Jakie dane przetwarzamy
Imię i nazwisko, numer ewidencyjny, PESEL, data urodzenia, zdjęcie na karcie identyfikacyjnej, dane kontaktowe, dane o zatrudnieniu, szkoleniach, badaniach i dokumentach pobytowych oraz dokumenty, które podpisujesz w aplikacji.

## Po co
Prowadzenie dokumentacji pracowniczej, wydawanie kart identyfikacyjnych, przekazywanie dokumentów do zapoznania i podpisu oraz kontakt w sprawach pracy. Podstawa prawna: [np. art. 6 ust. 1 lit. b i c RODO, art. 22¹ Kodeksu pracy].

## Komu przekazujemy dane
[Dostawca serwera], [dostawca SMS – jeśli używany], [inni odbiorcy, np. klient użytkownik]. Dane nie są sprzedawane ani wykorzystywane do reklamy.

## Jak długo
Przez okres zatrudnienia, a potem przez czas wymagany przepisami ([np. 10 lat dokumentacji pracowniczej]). Po tym czasie dane są trwale usuwane.

## Twoje prawa
Masz prawo dostępu do danych, ich sprostowania, ograniczenia przetwarzania, sprzeciwu i usunięcia (gdy przepisy na to pozwalają) oraz prawo skargi do Prezesa Urzędu Ochrony Danych Osobowych.

## Pliki cookie i dane w przeglądarce
Aplikacja używa wyłącznie niezbędnego pliku cookie sesji (żeby utrzymać zalogowanie) i zapisuje w przeglądarce ustawienia, np. wybrany język. Nie używamy plików cookie reklamowych ani analitycznych.`;

/** Treść: akapity oddzielone pustą linią, linia zaczynająca się od „## ” to nagłówek. */
function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split(/\n{2,}|\n(?=## )/).forEach((block, i) => {
    const b = block.trim();
    if (!b) return;
    const m = /^## (.+?)(?:\n([\s\S]*))?$/.exec(b);
    if (m) {
      out.push(<h3 key={`h${i}`} className="ui-help-h">{m[1]}</h3>);
      if (m[2]?.trim()) out.push(<p key={`p${i}`} className="ui-help-p">{m[2].trim()}</p>);
    } else out.push(<p key={`p${i}`} className="ui-help-p">{b}</p>);
  });
  return <div className="ui-help-text">{out}</div>;
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Group gap={10} wrap="nowrap" align="flex-start">
      <span className="ui-help-icon" aria-hidden>
        {icon}
      </span>
      <Text size="sm" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {children}
      </Text>
    </Group>
  );
}

/**
 * Pomoc i prywatność (publiczna, także przed logowaniem): kontakt w sprawie aplikacji i informacja o przetwarzaniu
 * danych. Administrator uzupełnia treść przyciskiem „Edytuj”.
 */
export function HelpPage() {
  const T = useT();
  const navigate = useNavigate();
  const { me, hasRole } = useAuth();
  const q = useSiteInfo();
  const [editing, setEditing] = useState(false);
  const admin = !!me && !me.mfa_pending && hasRole("admin");
  const d = q.data;
  const hasContact = !!d && !!(d.contact_name || d.contact_email || d.contact_phone);

  return (
    <AuthShell maw={680} title="Pomoc i prywatność">
      <Stack gap="lg">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconArrowLeft size={18} />}
            px={6}
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(me ? "/" : "/login"))}
          >
            {T("Wróć")}
          </Button>
          {admin && (
            <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
              {T("Edytuj")}
            </Button>
          )}
        </Group>
        <Title order={1} fz={26}>
          {T("Pomoc i prywatność")}
        </Title>
        {q.isLoading && <Loading />}
        {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
        {d && (
          <>
            <section>
              <Title order={2} fz={18} mb="sm">
                {T("Kontakt w sprawie aplikacji")}
              </Title>
              {hasContact ? (
                <Stack gap={10}>
                  {d.contact_name && <Row icon={<IconUser size={18} />}>{d.contact_name}</Row>}
                  {d.contact_phone && (
                    <Row icon={<IconPhone size={18} />}>
                      <Anchor href={`tel:${d.contact_phone.replace(/[^0-9+]/g, "")}`}>{d.contact_phone}</Anchor>
                    </Row>
                  )}
                  {d.contact_email && (
                    <Row icon={<IconMail size={18} />}>
                      <Anchor href={`mailto:${d.contact_email}`}>{d.contact_email}</Anchor>
                    </Row>
                  )}
                  {d.contact_hours && <Row icon={<IconClock size={18} />}>{d.contact_hours}</Row>}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  {T("W sprawie konta, hasła i dostępu skontaktuj się z działem kadr.")}
                </Text>
              )}
              <Text size="sm" c="dimmed" mt="sm">
                {T("Zgubiony telefon albo klucz dostępu? Zgłoś to od razu – kadry zablokują stare logowanie i wyślą nowy link.")}
              </Text>
            </section>
            <section>
              <Title order={2} fz={18} mb="sm">
                {T("Jak przetwarzamy Twoje dane")}
              </Title>
              {d.privacy_text ? (
                <Rich text={T(d.privacy_text)} />
              ) : (
                <Text size="sm" c="dimmed">
                  {admin
                    ? T("Nie ma jeszcze informacji o przetwarzaniu danych. Kliknij „Edytuj” i wstaw wzór do uzupełnienia.")
                    : T("Informacja o przetwarzaniu danych jest w przygotowaniu. Do tego czasu zapytaj w dziale kadr.")}
                </Text>
              )}
              {d.updated_at && d.privacy_text && (
                <Text size="xs" c="dimmed" mt="md">
                  {T("Ostatnia zmiana")}: {formatDateTime(d.updated_at)}
                </Text>
              )}
            </section>
          </>
        )}
      </Stack>
      {admin && editing && d && <EditDialog info={d} onClose={() => setEditing(false)} />}
    </AuthShell>
  );
}

function EditDialog({ info, onClose }: { info: SiteInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState(info);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SiteInfo>(k: K, val: SiteInfo[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: () =>
      api<SiteInfo>("/site-info", {
        method: "PUT",
        body: { contact_name: v.contact_name, contact_email: v.contact_email.trim(), contact_phone: v.contact_phone, contact_hours: v.contact_hours, privacy_text: v.privacy_text },
      }),
    onSuccess: (data) => {
      qc.setQueryData(["site-info"], data);
      notifications.show({ color: "teal", message: "Zapisano – zmiany widać od razu, także na ekranie logowania" });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  const emailBad = !!v.contact_email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contact_email.trim());
  const phoneBad = !/^[0-9 +()-]*$/.test(v.contact_phone);
  return (
    <FormDialog
      opened
      onClose={onClose}
      title="Pomoc i prywatność"
      size="xl"
      dirty={JSON.stringify(v) !== JSON.stringify(info)}
      primary={{ label: "Zapisz", onClick: () => save.mutate(), loading: save.isPending, disabled: emailBad || phoneBad }}
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}
        <Text size="sm" c="dimmed">
          Strona jest publiczna – widać ją pod ekranem logowania i w menu konta. Nie wpisuj tu danych pracowników ani haseł.
        </Text>
        <TextInput label="Kontakt – kto" placeholder="np. Dział kadr APT" value={v.contact_name} onChange={(e) => set("contact_name", e.currentTarget.value)} maxLength={120} />
        <TextInput label="Telefon" placeholder="np. +48 600 100 200" value={v.contact_phone} onChange={(e) => set("contact_phone", e.currentTarget.value)} maxLength={40} error={phoneBad ? "Tylko cyfry, spacje, +, ( ) i -" : undefined} />
        <TextInput label="E-mail" type="email" placeholder="np. kadry@firma.pl" value={v.contact_email} onChange={(e) => set("contact_email", e.currentTarget.value)} maxLength={200} error={emailBad ? "Niepoprawny adres e-mail" : undefined} />
        <TextInput label="Godziny" placeholder="np. pn–pt 8:00–16:00" value={v.contact_hours} onChange={(e) => set("contact_hours", e.currentTarget.value)} maxLength={120} />
        <Textarea
          label="Informacja o przetwarzaniu danych (RODO)"
          description="Akapity oddzielaj pustą linią. Linia zaczynająca się od „## ” to nagłówek. Treść powinien zatwierdzić prawnik lub inspektor ochrony danych."
          value={v.privacy_text}
          onChange={(e) => set("privacy_text", e.currentTarget.value)}
          autosize
          minRows={8}
          maxRows={20}
          maxLength={20000}
        />
        {!v.privacy_text.trim() && (
          <Group>
            <Button variant="light" onClick={() => set("privacy_text", PRIVACY_TEMPLATE)}>
              Wstaw wzór do uzupełnienia
            </Button>
          </Group>
        )}
      </Stack>
    </FormDialog>
  );
}
