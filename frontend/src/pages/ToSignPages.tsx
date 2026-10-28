import { DocumentViewer } from "../components/DocumentViewer";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Image, List, Loader, Stack, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconDownload, IconFileUpload, IconFingerprint, IconSignature } from "@tabler/icons-react";

import { api, errorText, formatDateTime, withAcct } from "../api";
import { useAuth } from "../auth";
import { getPasskey, passkeyErrorText, passkeysSupported } from "../lib/passkey";
import { useT } from "../lib/i18n";
import { SignaturePad } from "./SignPage";

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
  return (
    <Stack maw={640}>
      <Title order={2}>{t("Do podpisu")}</Title>
      {list.isLoading && <Loader />}
      {list.data && list.data.pending.length === 0 && (
        <Text c="dimmed">{t("Nie masz dokumentów do podpisu. O nowym dokumencie dostaniesz powiadomienie.")}</Text>
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
  return (
    <Stack maw={640}>
      <Title order={2}>{info.data?.document ?? t("Podpis")}</Title>
      {accounts.length > 1 && (
        <Alert color="blue" icon={<IconAlertCircle size={18} />}>
          {t("W tej przeglądarce jest zalogowanych kilka kont. Podpisujesz jako:")} <b>{me?.user.full_name}</b>.
        </Alert>
      )}
      {!info.data && <Loader />}
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
                <Image key={i} src={withAcct(`/api${base}/page/${i}`)} alt={t("Strona {n}", { n: i + 1 })} style={{ border: "1px solid var(--mantine-color-default-border)" }} />
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
