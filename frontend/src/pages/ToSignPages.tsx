import { DocumentViewer } from "../components/DocumentViewer";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Image, List, Stack, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconDownload, IconFileUpload, IconFingerprint, IconSignature } from "@tabler/icons-react";

import { api, errorText, formatDateTime, withAcct } from "../api";
import { useAuth } from "../auth";
import { getPasskey, passkeyErrorText, passkeysSupported } from "../lib/passkey";
import { useT } from "../lib/i18n";
import { SignaturePad } from "./SignPage";
import { EmptyState, Loading } from "../components/States";
import { useMediaQuery } from "@mantine/hooks";
import { CompactEmpty, FormScreen, ListRow, PageHead, Section, StatusBadge } from "../components/Mobile";

interface ListOut {
  pending: { id: number; document: string; requested_at: string; requested_by: string | null }[];
  signed: { id: number; document: string; signed_at: string | null }[];
}
interface Challenge {
  challenge_id: string;
  options: Record<string, unknown>;
}

const LIVE = { refetchInterval: 8000, refetchOnWindowFocus: true } as const;

/** Lista „Do podpisu” pracownika z kontem. */
export function ToSignListPage() {
  const t = useT();
  const list = useQuery({ queryKey: ["my-signatures"], queryFn: () => api<ListOut>("/me/signatures"), ...LIVE });
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  if (mobile) {
    const pending = list.data?.pending ?? [];
    const signed = list.data?.signed ?? [];
    return (
      <Stack gap={24}>
        <PageHead title={t("Do podpisu")} subtitle={pending.length ? t("Czeka na podpis: {n}", { n: pending.length }) : undefined} />
        {list.isLoading ? (
          <Loading />
        ) : (
          <>
            <Section title={t("Czekają na podpis")}>
              {pending.length ? (
                pending.map((p) => (
                  <ListRow
                    key={p.id}
                    leading={<span className="ui-row-icon" data-tone="warn" aria-hidden><IconSignature size={22} /></span>}
                    title={p.document}
                    description={t("Od {date}", { date: formatDateTime(p.requested_at) }) + (p.requested_by ? ` · ${p.requested_by}` : "")}
                    to={`/moje-konto/do-podpisu/${p.id}`}
                  />
                ))
              ) : (
                <CompactEmpty title={t("Nie masz dokumentów do podpisu")} text={t("O nowym dokumencie dostaniesz powiadomienie.")} />
              )}
            </Section>
            {signed.length > 0 && (
              <Section title={t("Podpisane")}>
                {signed.map((d) => (
                  <ListRow
                    key={d.id}
                    title={d.document}
                    description={d.signed_at ? formatDateTime(d.signed_at) : undefined}
                    trailing={<StatusBadge tone="ok">{t("Podpisany")}</StatusBadge>}
                    to={`/moje-konto/do-podpisu/podpisane/${d.id}`}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </Stack>
    );
  }
  return (
    <Stack maw={640}>
      <Title order={2}>{t("Do podpisu")}</Title>
      {list.isLoading && <Loading />}
      {list.data && list.data.pending.length === 0 && (
        <EmptyState compact title={t("Nie masz dokumentów do podpisu")} text={t("O nowym dokumencie dostaniesz powiadomienie.")} />
      )}
      {list.data?.pending.map((p) => (
        <Card key={p.id} withBorder padding="md">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={600}>{p.document}</Text>
              <Text size="xs" c="dimmed">
                {t("Od {date}", { date: formatDateTime(p.requested_at) })}
                {p.requested_by ? ` · ${p.requested_by}` : ""}
              </Text>
            </div>
            <Button component={Link} to={`/moje-konto/do-podpisu/${p.id}`}>
              {t("Podpisz")}
            </Button>
          </Group>
        </Card>
      ))}
      {list.data && list.data.signed.length > 0 && (
        <>
          <Title order={4} mt="md">
            {t("Podpisane")}
          </Title>
          {list.data.signed.map((s, i) => (
            <Card key={i} withBorder padding="sm" component={Link} to={`/moje-konto/do-podpisu/podpisane/${s.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={500}>
                  {s.document}
                </Text>
                <Badge color="teal" variant="light" leftSection={<IconCheck size={10} />}>
                  {s.signed_at ? formatDateTime(s.signed_at) : t("podpisano")}
                </Badge>
              </Group>
            </Card>
          ))}
        </>
      )}
    </Stack>
  );
}

/** Podpis dokumentu w koncie: rysunek na ekranie + potwierdzenie kluczem dostępu. */
export function ToSignPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const base = `/me/signatures/${id}`;
  const info = useQuery({ queryKey: ["my-signature", id], queryFn: () => api<{ document: string; pages: number }>(base), retry: false });
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { me, accounts, switchAccount } = useAuth();
  const others = accounts.filter((a) => a.id !== me?.user.id && a.role === "employee");
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  // telefon: krok 1 – przeczytaj, krok 2 – podpis; „trusted” = podpis zaufany / kwalifikowany (plik)
  const [step, setStep] = useState<1 | 2>(1);
  const [trusted, setTrusted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["my-signatures"] });
    qc.invalidateQueries({ queryKey: ["my-sig-count"] });
    notifications.show({ color: "green", message: t("Dokument podpisany.") });
    navigate("/moje-konto/do-podpisu", { replace: true });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append("file", file);
      return api(`${base}/trusted`, { method: "POST", form: f });
    },
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });

  // Safari wymaga otwarcia okna klucza od razu po dotknięciu – wyzwanie pobieramy wcześniej i odświeżamy co 4 min.
  const challenge = useRef<Challenge | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<Challenge>(`${base}/challenge`, { method: "POST" })
        .then((c) => {
          if (!stop) {
            challenge.current = c;
            setReady(true);
          }
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [base]);

  const sign = useMutation({
    mutationFn: async () => {
      const c = challenge.current;
      if (!c || !image) throw new Error("Brak wyzwania.");
      challenge.current = null;
      setReady(false);
      const credential = await getPasskey(c.options);
      await api(`${base}/sign`, { method: "POST", body: { image, consent, challenge_id: c.challenge_id, credential } });
    },
    onSuccess: done,
    onError: (e) => {
      setError(passkeyErrorText(e) ?? errorText(e));
      api<Challenge>(`${base}/challenge`, { method: "POST" })
        .then((c) => {
          challenge.current = c;
          setReady(true);
        })
        .catch(() => undefined);
    },
  });

  if (info.isError)
    return (
      <Stack maw={640}>
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {errorText(info.error)}
          {others.length > 0 && " " + t("Ten dokument może należeć do innego konta zalogowanego w tej przeglądarce – przełącz konto.")}
        </Alert>
        {others.map((a) => (
          <Button key={a.id} variant="light" onClick={() => switchAccount(a.id)}>
            {t("Przełącz na konto: {name}", { name: a.full_name })}
          </Button>
        ))}
        <Button component={Link} to="/moje-konto/do-podpisu" variant="default">
          {t("Wróć do listy")}
        </Button>
      </Stack>
    );
  if (mobile) {
    const back = () => navigate("/moje-konto/do-podpisu");
    const missing = !image ? t("Złóż podpis palcem w polu poniżej.") : !consent ? t("Zaznacz, że zapoznałeś(-aś) się z dokumentem.") : null;
    const subtitle = step === 1 ? t("Krok 1 z 2 · Przeczytaj") : trusted ? t("Krok 2 z 2 · Plik z podpisem") : t("Krok 2 z 2 · Podpis");
    return (
      <FormScreen
        title={info.data?.document ?? t("Podpis")}
        subtitle={subtitle}
        onClose={back}
        onCancel={step === 2 ? () => (trusted ? setTrusted(false) : setStep(1)) : back}
        cancel={step === 2 ? t("Wstecz") : false}
        primary={
          step === 1
            ? { label: t("Dalej – podpis"), onClick: () => setStep(2), disabled: !info.data }
            : trusted
              ? { label: t("Wgraj plik"), onClick: () => fileRef.current?.click(), loading: upload.isPending }
              : { label: t("Podpisz"), onClick: () => sign.mutate(), loading: sign.isPending, disabled: !image || !consent || !ready || !passkeysSupported() }
        }
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="application/pdf,.xml,.xades,text/xml,application/xml"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) upload.mutate(f);
            e.currentTarget.value = "";
          }}
        />
        <Stack gap="md">
          {accounts.length > 1 && (
            <Alert color="blue" icon={<IconAlertCircle size={18} />}>
              {t("W tej przeglądarce jest zalogowanych kilka kont. Podpisujesz jako:")} <b>{me?.user.full_name}</b>.
            </Alert>
          )}
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {error}
            </Alert>
          )}
          {!info.data && <Loading rows={3} />}
          {info.data && step === 1 && (
            <>
              <Text size="sm" c="dimmed">
                {t("Przeczytaj dokument do końca. Podpiszesz go w następnym kroku.")}
              </Text>
              {Array.from({ length: info.data.pages }, (_, i) => (
                <Image key={i} src={withAcct(`/api${base}/page/${i}`)} alt={t("Strona {n}", { n: i + 1 })} radius="sm" style={{ border: "1px solid var(--apt-line)", background: "#fff" }} />
              ))}
              <Button component="a" variant="default" size="md" href={withAcct(`/api${base}/pdf`)} leftSection={<IconDownload size={18} />}>
                {t("Pobierz PDF")}
              </Button>
            </>
          )}
          {info.data && step === 2 && !trusted && (
            <>
              {!passkeysSupported() && (
                <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                  {t("To urządzenie nie obsługuje kluczy dostępu – otwórz konto w Safari lub Chrome.")}
                </Alert>
              )}
              {missing && <span className="ui-hint-warn">{missing}</span>}
              <SignaturePad onChange={setImage} />
              <Checkbox size="md" checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} label={t("Zapoznałem(-am) się z treścią dokumentu i podpisuję go.")} />
              <Text size="sm" c="dimmed">
                {t("Po dotknięciu „Podpisz” potwierdzisz podpis twarzą, odciskiem palca lub PIN-em telefonu. Zapiszemy podpis, datę i godzinę oraz adres IP.")}
              </Text>
              <Section title={t("Inny sposób")}>
                <ListRow
                  leading={<span className="ui-row-icon" aria-hidden><IconFileUpload size={22} /></span>}
                  title={t("Podpis zaufany lub kwalifikowany")}
                  description={t("Podpiszesz plik na gov.pl i wgrasz go tutaj")}
                  onClick={() => setTrusted(true)}
                />
              </Section>
            </>
          )}
          {info.data && step === 2 && trusted && (
            <ol className="ui-steps">
              <li>
                <Anchor href={withAcct(`/api${base}/pdf`)}>{t("Pobierz dokument (PDF).")}</Anchor>
              </li>
              <li>
                {t("Otwórz")}{" "}
                <Anchor href="https://moj.gov.pl/nforms/signer/upload?xFormsAppName=SIGNER" target="_blank" rel="noreferrer">
                  {t("podpisywanie dokumentu na gov.pl")}
                </Anchor>
                {t(", dodaj pobrany plik i podpisz profilem zaufanym (albo e-dowodem). Możesz też podpisać plik własnym certyfikatem kwalifikowanym.")}
              </li>
              <li>{t("Pobierz podpisany plik i wgraj go przyciskiem na dole.")}</li>
            </ol>
          )}
        </Stack>
      </FormScreen>
    );
  }

  return (
    <Stack maw={640}>
      <Title order={2}>{info.data?.document ?? t("Podpis")}</Title>
      {accounts.length > 1 && (
        <Alert color="blue" icon={<IconAlertCircle size={18} />}>
          {t("W tej przeglądarce jest zalogowanych kilka kont. Podpisujesz jako:")} <b>{me?.user.full_name}</b>.
        </Alert>
      )}
      {!info.data && <Loading />}
      {info.data && (
        <>
          <Group justify="flex-end">
            <Button component="a" variant="default" href={withAcct(`/api${base}/pdf`)} leftSection={<IconDownload size={16} />}>
              {t("Pobierz PDF")}
            </Button>
          </Group>
          <Card withBorder padding="xs">
            <Stack gap="xs">
              {Array.from({ length: info.data.pages }, (_, i) => (
                <Image key={i} src={withAcct(`/api${base}/page/${i}`)} alt={t("Strona {n}", { n: i + 1 })} style={{ border: "1px solid var(--apt-line)" }} />
              ))}
            </Stack>
          </Card>
          <Card withBorder padding="md">
            <Stack>
              {!passkeysSupported() && (
                <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                  {t("To urządzenie nie obsługuje kluczy dostępu – otwórz konto w Safari lub Chrome.")}
                </Alert>
              )}
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {error}
                </Alert>
              )}
              <Tabs defaultValue="screen" keepMounted={false}>
                <Tabs.List mb="md" grow>
                  <Tabs.Tab value="screen" leftSection={<IconSignature size={16} />}>
                    {t("Na ekranie")}
                  </Tabs.Tab>
                  <Tabs.Tab value="trusted" leftSection={<IconFileUpload size={16} />}>
                    {t("Plik z podpisem")}
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="screen">
                  <Stack>
              <SignaturePad onChange={setImage} />
                      <Checkbox checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} label={t("Zapoznałem(-am) się z treścią dokumentu i podpisuję go.")} />
                      <Button size="lg" leftSection={<IconFingerprint size={20} />} loading={sign.isPending} disabled={!image || !consent || !ready || !passkeysSupported()} onClick={() => sign.mutate()}>
                        {t("Podpisz dokument")}
                      </Button>
                      <Text size="xs" c="dimmed">
                        {t("Po dotknięciu potwierdzisz podpis twarzą, odciskiem palca lub PIN-em urządzenia. Zapiszemy podpis, datę i godzinę oraz adres IP.")}
                      </Text>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="trusted">
                  <Stack>
                    <Text fw={600}>{t("Podpis zaufany lub kwalifikowany")}</Text>
                    <List type="ordered" size="sm" spacing={6}>
                      <List.Item>{t("Pobierz dokument (przycisk „Pobierz PDF” u góry).")}</List.Item>
                      <List.Item>
                        {t("Otwórz")}{" "}
                        <Anchor href="https://moj.gov.pl/nforms/signer/upload?xFormsAppName=SIGNER" target="_blank" rel="noreferrer">
                          {t("podpisywanie dokumentu na gov.pl")}
                        </Anchor>
                        {t(", dodaj pobrany plik i podpisz profilem zaufanym (albo e-dowodem). Możesz też podpisać plik własnym certyfikatem kwalifikowanym.")}
                      </List.Item>
                      <List.Item>{t("Pobierz podpisany plik i wgraj go poniżej.")}</List.Item>
                    </List>
                    <FileButton accept="application/pdf,.xml,.xades,text/xml,application/xml" onChange={(f) => f && upload.mutate(f)}>
                      {(props) => (
                        <Button {...props} variant="light" leftSection={<IconFileUpload size={16} />} loading={upload.isPending}>
                          {t("Wgraj podpisany plik")}
                        </Button>
                      )}
                    </FileButton>
                  </Stack>
                </Tabs.Panel>
              </Tabs>
            </Stack>
          </Card>
        </>
      )}
    </Stack>
  );
}

/** Podgląd własnego podpisanego dokumentu: ten sam widok co u kadr, z możliwością pobrania. */
export function SignedDocPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const base = `/me/signatures/signed/${id}`;
  return (
    <DocumentViewer
      docId={String(id)}
      base={base}
      downloadUrl={`${base}/pdf`}
      opened
      onClose={() => navigate("/moje-konto/do-podpisu")}
    />
  );
}
