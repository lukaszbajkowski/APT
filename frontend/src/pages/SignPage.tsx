import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Container,
  FileButton,
  Group,
  Image,
  List,
  Loader,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCircleCheck, IconDownload, IconEraser, IconFileUpload, IconFingerprint, IconSignature } from "@tabler/icons-react";

import { api, errorText } from "../api";

interface Info {
  document: string;
  person: string;
  role: string;
  role_label: string;
  needs_birth_date: boolean;
  needs_name: boolean;
  expires_at: string | null;
  device_check: boolean;
}

interface Check {
  level: "qualified" | "valid" | "unverified" | "invalid";
  label: string;
  notes: string[];
}

const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64u = (s: string) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)).buffer;
};

/** Prosi telefon o potwierdzenie blokadą ekranu (Face ID / odcisk palca / PIN) – WebAuthn z wymuszoną weryfikacją. */
async function confirmWithDevice(token: string, view: string | null): Promise<Record<string, unknown>> {
  if (!window.PublicKeyCredential) throw new Error("Ta przeglądarka nie obsługuje potwierdzenia blokadą urządzenia.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = await api<any>(`/sign/${token}/device/options`, { method: "POST", body: { view } });
  const publicKey = {
    ...o,
    challenge: unb64u(o.challenge),
    user: { ...o.user, id: unb64u(o.user.id) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    excludeCredentials: (o.excludeCredentials ?? []).map((c: any) => ({ ...c, id: unb64u(c.id) })),
  } as PublicKeyCredentialCreationOptions;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  } catch {
    throw new Error("Potwierdzenie blokadą urządzenia zostało anulowane albo się nie powiodło. Spróbuj jeszcze raz.");
  }
  if (!cred) throw new Error("Nie udało się potwierdzić blokadą urządzenia.");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64u(r.clientDataJSON),
      attestationObject: b64u(r.attestationObject),
      transports: r.getTransports?.() ?? [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment,
  };
}

/** Pole do podpisu palcem / rysikiem / myszką. Przezroczyste tło, linia w kolorze tuszu. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * ratio);
      c.height = Math.round(r.height * ratio);
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0b1f66";
      ctx.lineWidth = 2.6;
      dirty.current = false;
      onChange(null);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1f66";
    ctx.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (dirty.current) onChange(canvas.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <Stack gap={6}>
      <Box
        style={{
          position: "relative",
          border: "2px dashed var(--mantine-color-gray-4)",
          borderRadius: 12,
          background: "#fff",
          height: 200,
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvas}
          aria-label="Pole podpisu"
          style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair", touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
        />
        <Text size="xs" c="gray.5" style={{ position: "absolute", left: 14, bottom: 10, pointerEvents: "none" }}>
          Podpisz się tutaj palcem lub myszką
        </Text>
      </Box>
      <Group justify="flex-end">
        <Button size="xs" variant="subtle" color="gray" leftSection={<IconEraser size={14} />} onClick={clear}>
          Wyczyść
        </Button>
      </Group>
    </Stack>
  );
}

export function SignPage() {
  const { token = "" } = useParams();
  const info = useQuery({ queryKey: ["sign-info", token], queryFn: () => api<Info>(`/sign/${token}`), retry: false });
  const [view, setView] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [birth, setBirth] = useState("");
  const [name, setName] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  // czy telefon potrafi potwierdzić blokadą ekranu (null – jeszcze sprawdzamy)
  const [deviceOk, setDeviceOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!info.data?.device_check) return;
    const pk = window.PublicKeyCredential;
    if (!pk?.isUserVerifyingPlatformAuthenticatorAvailable) return setDeviceOk(false);
    pk.isUserVerifyingPlatformAuthenticatorAvailable()
      .then(setDeviceOk)
      .catch(() => setDeviceOk(false));
  }, [info.data?.device_check]);

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ view: string; pages: number }>(`/sign/${token}/verify`, {
        method: "POST",
        body: { birth_date: birth || null },
      });
      setView(r.view);
      setPages(r.pages);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // bez potwierdzenia daty urodzenia od razu pokazujemy dokument
  useEffect(() => {
    if (info.data && !info.data.needs_birth_date && !view) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.data]);

  async function sign() {
    setError(null);
    setBusy(true);
    try {
      const device = info.data?.device_check ? await confirmWithDevice(token, view) : null;
      await api(`/sign/${token}`, { method: "POST", body: { image, view, consent, signer_name: name || null, device } });
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadTrusted(file: File) {
    setError(null);
    setBusy(true);
    try {
      const f = new FormData();
      f.append("file", file);
      if (view) f.append("view", view);
      if (name) f.append("signer_name", name);
      const r = await api<{ check?: Check }>(`/sign/${token}/trusted`, { method: "POST", form: f });
      setCheck(r.check ?? null);
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const v = view ? `?v=${encodeURIComponent(view)}` : "";

  return (
    <Box bg="var(--mantine-color-gray-0)" mih="100vh" py="lg">
      <Container size={760} px="md">
        <Text fw={700} c="navy.7" mb="md">
          Identyfikacja pracowników APT
        </Text>
        {info.isLoading && <Loader />}
        {info.error && (
          <Alert color="red" title="Nie można otworzyć dokumentu">
            {errorText(info.error)}
          </Alert>
        )}
        {done && (
          <Card withBorder padding="xl" radius="md">
            <Center>
              <Stack align="center" gap="xs">
                <IconCircleCheck size={56} color="var(--mantine-color-teal-6)" />
                <Title order={3}>Dziękujemy – dokument podpisany</Title>
                <Text c="dimmed" ta="center">
                  Podpisany dokument trafił do działu kadr. Możesz zamknąć tę stronę.
                </Text>
                {check && (
                  <Text size="sm" ta="center" c={check.level === "qualified" ? "teal.7" : "dimmed"}>
                    Sprawdzenie podpisu w pliku: {check.label}.
                  </Text>
                )}
              </Stack>
            </Center>
          </Card>
        )}
        {info.data && !done && (
          <Stack>
            <div>
              <Title order={2}>Dokument do podpisu</Title>
              <Text c="dimmed">
                {info.data.document}
                {info.data.person ? ` · ${info.data.person}` : ""} · podpisuje: {info.data.role_label.toLowerCase()}
              </Text>
            </div>
            {error && <Alert color="red">{error}</Alert>}

            {!view && info.data.needs_birth_date && (
              <Card withBorder padding="lg" radius="md" component="form" onSubmit={verify}>
                <Stack>
                  <Text>Dla bezpieczeństwa potwierdź swoją datę urodzenia.</Text>
                  <TextInput type="date" label="Data urodzenia" required value={birth} onChange={(e) => setBirth(e.currentTarget.value)} />
                  <Button type="submit" loading={busy}>
                    Dalej
                  </Button>
                </Stack>
              </Card>
            )}

            {view && (
              <>
                <Card withBorder padding="xs" radius="md">
                  <Stack gap="xs">
                    {Array.from({ length: pages }, (_, i) => (
                      <Image key={i} src={`/api/sign/${token}/page/${i}${v}`} alt={`Strona ${i + 1}`} radius="sm" style={{ border: "1px solid var(--mantine-color-gray-3)" }} />
                    ))}
                  </Stack>
                  <Group justify="flex-end" mt="xs">
                    <Button size="xs" variant="subtle" component="a" href={`/api/sign/${token}/pdf${v}`} leftSection={<IconDownload size={14} />}>
                      Pobierz PDF
                    </Button>
                  </Group>
                </Card>

                <Card withBorder padding="lg" radius="md">
                  {info.data.needs_name && (
                    <TextInput mb="md" label="Imię i nazwisko osoby podpisującej" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
                  )}
                  <Tabs defaultValue="screen">
                    <Tabs.List mb="md">
                      <Tabs.Tab value="screen" leftSection={<IconSignature size={16} />}>
                        Podpis na ekranie
                      </Tabs.Tab>
                      <Tabs.Tab value="trusted">Podpis zaufany lub kwalifikowany</Tabs.Tab>
                    </Tabs.List>
                    <Tabs.Panel value="screen">
                      <Stack>
                        {info.data.device_check && (
                          <Alert color={deviceOk === false ? "red" : "blue"} icon={<IconFingerprint size={18} />}>
                            {deviceOk === false
                              ? "Ten telefon nie obsługuje potwierdzenia blokadą ekranu (Face ID, odcisk palca lub PIN). Ustaw blokadę ekranu w telefonie albo poproś dział kadr o nowy link bez tego wymogu. Możesz też wgrać plik z podpisem zaufanym lub kwalifikowanym (zakładka obok)."
                              : "Po kliknięciu „Podpisz dokument” telefon poprosi o potwierdzenie: twarzą, odciskiem palca albo kodem odblokowania."}
                          </Alert>
                        )}
                        <SignaturePad onChange={setImage} />
                        <Checkbox
                          checked={consent}
                          onChange={(e) => setConsent(e.currentTarget.checked)}
                          label="Zapoznałem(-am) się z treścią dokumentu i podpisuję go."
                        />
                        <Button size="md" onClick={sign} loading={busy} disabled={!image || !consent || (info.data.needs_name && !name.trim()) || (info.data.device_check && deviceOk === false)}>
                          Podpisz dokument
                        </Button>
                        <Text size="xs" c="dimmed">
                          Zapiszemy podpis, datę i godzinę, adres IP i rodzaj urządzenia – na potwierdzenie, kto i kiedy podpisał.
                        </Text>
                      </Stack>
                    </Tabs.Panel>
                    <Tabs.Panel value="trusted">
                      <Stack>
                        <List type="ordered" size="sm" spacing={6}>
                          <List.Item>Pobierz dokument (przycisk „Pobierz PDF” wyżej).</List.Item>
                          <List.Item>
                            Otwórz{" "}
                            <Anchor href="https://moj.gov.pl/nforms/signer/upload?xFormsAppName=SIGNER" target="_blank" rel="noreferrer">
                              podpisywanie dokumentu na gov.pl
                            </Anchor>
                            , dodaj pobrany plik i podpisz profilem zaufanym (albo e-dowodem). Możesz też podpisać plik własnym
                            certyfikatem kwalifikowanym (np. w aplikacji swojego dostawcy podpisu).
                          </List.Item>
                          <List.Item>Pobierz podpisany plik i wgraj go poniżej.</List.Item>
                        </List>
                        <FileButton accept="application/pdf,.xml,.xades,text/xml,application/xml" onChange={(f) => f && uploadTrusted(f)}>
                          {(props) => (
                            <Button {...props} variant="light" leftSection={<IconFileUpload size={16} />} loading={busy} disabled={info.data!.needs_name && !name.trim()}>
                              Wgraj podpisany plik
                            </Button>
                          )}
                        </FileButton>
                      </Stack>
                    </Tabs.Panel>
                  </Tabs>
                </Card>
              </>
            )}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
