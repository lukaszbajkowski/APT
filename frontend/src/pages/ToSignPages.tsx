import { DocumentViewer } from "../components/DocumentViewer";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Checkbox, Group, Image, Loader, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconFingerprint } from "@tabler/icons-react";

import { api, errorText, formatDateTime, withAcct } from "../api";
import { getPasskey, passkeyErrorText, passkeysSupported } from "../lib/passkey";
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
  const list = useQuery({ queryKey: ["my-signatures"], queryFn: () => api<ListOut>("/me/signatures"), ...LIVE });
  return (
    <Stack maw={640}>
      <Title order={2}>Do podpisu</Title>
      {list.isLoading && <Loader />}
      {list.data && list.data.pending.length === 0 && (
        <Text c="dimmed">Nie masz dokumentów do podpisu. O nowym dokumencie dostaniesz powiadomienie.</Text>
      )}
      {list.data?.pending.map((p) => (
        <Card key={p.id} withBorder padding="md">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={600}>{p.document}</Text>
              <Text size="xs" c="dimmed">
                Od {formatDateTime(p.requested_at)}
                {p.requested_by ? ` · ${p.requested_by}` : ""}
              </Text>
            </div>
            <Button component={Link} to={`/moje-konto/do-podpisu/${p.id}`}>
              Podpisz
            </Button>
          </Group>
        </Card>
      ))}
      {list.data && list.data.signed.length > 0 && (
        <>
          <Title order={4} mt="md">
            Podpisane
          </Title>
          {list.data.signed.map((s, i) => (
            <Card key={i} withBorder padding="sm" component={Link} to={`/moje-konto/do-podpisu/podpisane/${s.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={500}>
                  {s.document}
                </Text>
                <Badge color="teal" variant="light" leftSection={<IconCheck size={10} />}>
                  {s.signed_at ? formatDateTime(s.signed_at) : "podpisano"}
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
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const base = `/me/signatures/${id}`;
  const info = useQuery({ queryKey: ["my-signature", id], queryFn: () => api<{ document: string; pages: number }>(base), retry: false });
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const t = setInterval(load, 4 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(t);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-signatures"] });
      qc.invalidateQueries({ queryKey: ["my-sig-count"] });
      notifications.show({ color: "green", message: "Dokument podpisany." });
      navigate("/moje-konto/do-podpisu", { replace: true });
    },
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
        </Alert>
        <Button component={Link} to="/moje-konto/do-podpisu" variant="default">
          Wróć do listy
        </Button>
      </Stack>
    );
  return (
    <Stack maw={640}>
      <Title order={2}>{info.data?.document ?? "Podpis"}</Title>
      {!info.data && <Loader />}
      {info.data && (
        <>
          <Card withBorder padding="xs">
            <Stack gap="xs">
              {Array.from({ length: info.data.pages }, (_, i) => (
                <Image key={i} src={withAcct(`/api${base}/page/${i}`)} alt={`Strona ${i + 1}`} style={{ border: "1px solid var(--mantine-color-default-border)" }} />
              ))}
            </Stack>
          </Card>
          <Card withBorder padding="md">
            <Stack>
              {!passkeysSupported() && (
                <Alert color="orange" icon={<IconAlertCircle size={18} />}>
                  To urządzenie nie obsługuje kluczy dostępu – otwórz konto w Safari lub Chrome.
                </Alert>
              )}
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {error}
                </Alert>
              )}
              <SignaturePad onChange={setImage} />
              <Checkbox checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} label="Zapoznałem(-am) się z treścią dokumentu i podpisuję go." />
              <Button size="lg" leftSection={<IconFingerprint size={20} />} loading={sign.isPending} disabled={!image || !consent || !ready || !passkeysSupported()} onClick={() => sign.mutate()}>
                Podpisz dokument
              </Button>
              <Text size="xs" c="dimmed">
                Po dotknięciu potwierdzisz podpis twarzą, odciskiem palca lub PIN-em urządzenia. Zapiszemy podpis, datę i godzinę oraz adres IP.
              </Text>
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
