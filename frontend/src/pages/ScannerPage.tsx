import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import jsQR from "jsqr";
import { Alert, Anchor, Box, Button, Drawer, Group, Paper, Skeleton, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconBolt, IconCamera, IconKeyboard, IconScan, IconUser } from "@tabler/icons-react";

import { api, errorText, formatDate, type Employee } from "../api";
import { EmployeePhoto } from "../components/EmployeePhoto";
import { InfoRow, PageTitle, SectionHead, SheetHandle, StatusBadge, useMobileHeader, useNavHeightVar } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return "Aparat działa tylko na stronie z HTTPS.";
  if (name === "NotAllowedError") return "Brak zgody na aparat. Zezwól na dostęp do aparatu w ustawieniach przeglądarki i spróbuj ponownie.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nie znaleziono aparatu w tym urządzeniu.";
  if (name === "NotReadableError") return "Aparat jest używany przez inną aplikację.";
  return "Nie udało się uruchomić aparatu.";
}

/** Wynik skanu – te same elementy co w karcie pracownika: stan (kropka + tekst), zdjęcie, pary „etykieta – wartość”. */
function ScanResult({ employee }: { employee: Employee }) {
  const active = employee.status === "active";
  return (
    <div className="ui-scan-res">
      <div className="ui-acct-state ui-scan-state" data-tone={active ? "ok" : "bad"}>
        <span className="ui-acct-dot" aria-hidden />
        {active ? "Aktywny pracownik" : "Nieaktywny – archiwum"}
      </div>
      <Group wrap="nowrap" align="center" gap="md">
        <EmployeePhoto employee={employee} width={88} />
        <div style={{ minWidth: 0 }}>
          <Title order={2} className="ui-dsec-title" style={{ wordBreak: "break-word" }}>
            {employee.last_name} {employee.first_name}
          </Title>
          <Text size="sm" c="dimmed" className="ui-mono">
            {employee.number_display}
          </Text>
        </div>
      </Group>
      <Paper withBorder radius="md" className="ui-cases ui-scan-kv">
        <InfoRow label="Agencja">{employee.agency?.name ?? "—"}</InfoRow>
        <InfoRow label="Wydział">{employee.department?.name ?? "—"}</InfoRow>
        <InfoRow label="Stanowisko">{employee.position?.name ?? "—"}</InfoRow>
        {!active && employee.termination_date && <InfoRow label="Zwolniony">{formatDate(employee.termination_date)}</InfoRow>}
      </Paper>
    </div>
  );
}

/* ostatnio sprawdzone – tylko na tym urządzeniu (bez zapisu na serwerze), dzisiejsze */
interface Recent {
  at: number;
  id?: number;
  name: string;
  ok: boolean;
  note: string;
}
const RECENT_KEY = "apt-scan-recent";
function loadRecent(): Recent[] {
  try {
    const day = new Date().toDateString();
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[]).filter((r) => new Date(r.at).toDateString() === day);
  } catch {
    return [];
  }
}
function saveRecent(list: Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* pamięć przeglądarki może być niedostępna */
  }
}
const hhmm = (t: number) => new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

export function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const mobile = useIsPhone();
  const phoneRef = useRef(mobile);
  phoneRef.current = mobile;
  // telefon, aparat włączony: ekran skanera zajmuje całą przestrzeń między paskiem górnym a menu
  const live = !!mobile && scanning;
  useNavHeightVar();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [manual, setManual] = useState("");
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef(false);
  sheetRef.current = sheet;
  const [typing, setTyping] = useState(false);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  // czy urządzenie ma aparat – lista urządzeń jest dostępna bez pytania o zgodę (bez nazw, ale z rodzajem)
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return setHasCamera(false);
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setHasCamera(d.some((x) => x.kind === "videoinput")))
      .catch(() => setHasCamera(true));
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const lookup = useCallback(
    async (code: string) => {
      setLoading(true);
      setLookupError(null);
      setEmployee(null);
      try {
        const e = await api<Employee>(`/employees/by-number/${encodeURIComponent(code.trim())}`);
        setEmployee(e);
        setSheet(true);
        navigator.vibrate?.(e.status === "active" ? 80 : [80, 60, 80]);
        const ok = e.status === "active";
        setRecent((l) => {
          const n = [{ at: Date.now(), id: e.id, name: `${e.last_name} ${e.first_name}`, ok, note: ok ? "Aktywny" : "Archiwum" }, ...l];
          saveRecent(n);
          return n;
        });
      } catch (err) {
        setLookupError(errorText(err));
        setSheet(true);
        navigator.vibrate?.([200]);
        setRecent((l) => {
          const n = [{ at: Date.now(), name: `Nr ${code.trim()}`, ok: false, note: "Nie rozpoznano" }, ...l];
          saveRecent(n);
          return n;
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const startingRef = useRef(false);
  const start = useCallback(async () => {
    // jeden start naraz (samo włączenie po wejściu + przycisk / podwójny efekt w trybie deweloperskim)
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setError(null);
    setLookupError(null);
    setSheet(false);
    if (phoneRef.current) setEmployee(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      // latarka tylko tam, gdzie aparat ją ma (Chrome na Androidzie; Safari zwykle nie)
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchOk(!!caps.torch);
      setTorch(false);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const detector =
        window.BarcodeDetector && (await (window.BarcodeDetector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.())?.includes("qr_code")
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null;
      canvasRef.current ??= document.createElement("canvas");

      const tick = async () => {
        if (!streamRef.current) return;
        if (!busyRef.current && !(phoneRef.current && sheetRef.current) && video.readyState >= 2) {
          busyRef.current = true;
          try {
            let value: string | null = null;
            if (detector) {
              const codes = await detector.detect(video);
              value = codes[0]?.rawValue ?? null;
            } else {
              const canvas = canvasRef.current!;
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
            const now = Date.now();
            if (value && !(lastCode.current && lastCode.current.code === value && now - lastCode.current.at < 4000)) {
              lastCode.current = { code: value, at: now };
              // aparat działa dalej: na telefonie pod arkuszem wyniku (wstrzymany, dopóki arkusz jest otwarty),
              // na komputerze kolejna karta od razu podmienia wynik
              await lookup(value);
            }
          } catch {
            /* pojedyncza klatka może się nie udać – próbujemy dalej */
          }
          busyRef.current = false;
        }
        timerRef.current = window.setTimeout(tick, 150);
      };
      tick();
    } catch (e) {
      stop();
      setError(cameraError(e));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [lookup, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch((t) => !t);
    } catch {
      setTorchOk(false);
    }
  };
  // telefon: aparat włącza się sam po wejściu, gdy zgoda już jest (bez osobnego „Włącz aparat”)
  useEffect(() => {
    if (!mobile || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((p) => p.state === "granted" && void start())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile]);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    if (!manual.trim()) return;
    setTyping(false);
    lookup(manual);
  }

  useMobileHeader(live ? { title: "Skaner kart", onBack: stop } : null);
  const today = recent.length;

  const video = (
    <Box pos="relative" className="ui-scan-video" style={{ display: scanning ? "block" : "none" }}>
      <video ref={videoRef} playsInline muted />
      <Box className="ui-scan-frame" data-live={live || undefined} />
      <Text c="white" size="sm" ta="center" className="ui-scan-hint" data-live={live || undefined}>
        Skieruj kod QR w ramkę
      </Text>
    </Box>
  );
  const manualForm = (
    <form onSubmit={submitManual} className="ui-scan-manual">
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <TextInput
          label={hasCamera === false || typing ? "Numer z karty" : "Albo wpisz numer z karty"}
          description={!mobile ? "Czytnik kodów podłączony do komputera wpisze numer sam." : undefined}
          placeholder="Np. 000123"
          inputMode="numeric"
          autoFocus={!mobile && hasCamera === false}
          value={manual}
          onChange={(e) => setManual(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="default">
          Sprawdź
        </Button>
      </Group>
    </form>
  );
  const failure = lookupError && (
    <div className="ui-scan-res">
      <div className="ui-acct-state ui-scan-state" data-tone="bad">
        <span className="ui-acct-dot" aria-hidden />
        Nie rozpoznano karty
      </div>
      <Text size="sm">{lookupError}</Text>
    </div>
  );
  const recentList = (
    <section className="ui-dsec">
      <SectionHead title="Ostatnio sprawdzone" extra={today ? <Text c="dimmed">{today}</Text> : undefined} />
      {recent.length === 0 ? (
        <Text size="sm" c="dimmed">
          Dziś na tym urządzeniu nikogo jeszcze nie sprawdzono.
        </Text>
      ) : (
        <Paper withBorder radius="md" className="ui-cases">
          {recent.slice(0, 10).map((r) => (
            <div key={r.at} className="ui-scan-recent">
              <span className="ui-cnt-dim">{hhmm(r.at)}</span>
              {r.id ? (
                <Anchor component={Link} to={`/pracownicy/${r.id}`} size="sm">
                  {r.name}
                </Anchor>
              ) : (
                <span>{r.name}</span>
              )}
              <StatusBadge tone={r.ok ? "ok" : "error"}>{r.note}</StatusBadge>
            </div>
          ))}
        </Paper>
      )}
    </section>
  );

  // ——— telefon: aparat na cały ekran (jak w makiecie), na dole „Wpisz numer” i „Latarka”, wynik w arkuszu ———
  if (mobile)
    return (
      <Stack className={live ? "ui-scan-live" : undefined}>
        {!live && <PageTitle title="Skaner kart" description="Zeskanuj kod QR z karty identyfikacyjnej, aby sprawdzić, czy osoba jest aktywnym pracownikiem." />}
        {video}
        {live && (
          <div className="ui-scan-bar">
            <UnstyledButton className="ui-scan-pill" onClick={() => setTyping(true)}>
              <IconKeyboard size={20} aria-hidden />
              Wpisz numer
            </UnstyledButton>
            {torchOk && (
              <UnstyledButton className="ui-scan-pill" data-on={torch || undefined} onClick={toggleTorch} aria-pressed={torch}>
                <IconBolt size={20} aria-hidden />
                Latarka
              </UnstyledButton>
            )}
          </div>
        )}
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        {!live && hasCamera !== false && (
          <Button size="lg" leftSection={<IconCamera size={20} />} onClick={start} loading={starting}>
            Włącz aparat i skanuj
          </Button>
        )}
        {loading && <Skeleton height={72} radius="md" aria-busy="true" aria-label="Sprawdzam kartę" />}
        {!live && manualForm}
        {!live && recentList}
        <Drawer
          opened={typing}
          onClose={() => setTyping(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet ui-tpe-fsheet" }}
          aria-label="Wpisz numer z karty"
        >
          <SheetHandle onClose={() => setTyping(false)}>
            <div className="ui-sheet-head ui-tpe-fsheet-head">
              <div className="ui-sheet-title">Wpisz numer z karty</div>
            </div>
          </SheetHandle>
          <div className="ui-tpe-fsheet-body">{manualForm}</div>
        </Drawer>
        <Drawer
          opened={sheet && !loading && (!!employee || !!lookupError)}
          onClose={() => setSheet(false)}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet ui-tpe-fsheet" }}
          aria-label="Wynik skanu"
        >
          <SheetHandle onClose={() => setSheet(false)}>
            <div className="ui-sheet-head ui-tpe-fsheet-head">
              <div className="ui-sheet-title">Wynik</div>
            </div>
          </SheetHandle>
          <Stack gap="md" className="ui-tpe-fsheet-body">
            {employee ? <ScanResult employee={employee} /> : failure}
          </Stack>
          <Group grow mt="sm" className="ui-tpe-fsheet-done">
            {employee && (
              <Button size="md" variant="default" component={Link} to={`/pracownicy/${employee.id}`} leftSection={<IconUser size={18} />}>
                Otwórz kartę
              </Button>
            )}
            <Button size="md" leftSection={<IconScan size={18} />} onClick={() => (streamRef.current ? setSheet(false) : void start())}>
              Skanuj dalej
            </Button>
          </Group>
        </Drawer>
      </Stack>
    );

  // ——— komputer: aparat (albo sam numer) | wynik | ostatnio sprawdzone – na całą szerokość ———
  return (
    <Stack maw={1760} className="ui-scan-desk">
      <PageTitle
        title="Skaner kart"
        meta={today ? `Dziś sprawdzono ${today}` : undefined}
        description={hasCamera === false ? "Wpisz numer z karty albo użyj czytnika kodów – ten komputer nie ma aparatu." : "Zeskanuj kod QR z karty identyfikacyjnej albo wpisz jej numer."}
      />
      <div className="ui-scan-grid" data-nocam={hasCamera === false || undefined}>
        <div className="ui-scan-col">
          {hasCamera !== false && (
            <>
              {video}
              {!scanning && (
                <div className="ui-scan-off">
                  <Button leftSection={<IconCamera size={18} />} onClick={start} loading={starting}>
                    Włącz aparat
                  </Button>
                </div>
              )}
              {scanning && (
                <Button variant="default" onClick={stop}>
                  Zatrzymaj aparat
                </Button>
              )}
            </>
          )}
          {error && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {error}
            </Alert>
          )}
          {manualForm}
        </div>
        <section className="ui-dsec ui-scan-col">
          <SectionHead title="Wynik" />
          {loading ? (
            <Skeleton height={200} radius="md" aria-busy="true" aria-label="Sprawdzam kartę" />
          ) : employee ? (
            <>
              <ScanResult employee={employee} />
              <Group>
                <Button variant="default" component={Link} to={`/pracownicy/${employee.id}`} leftSection={<IconUser size={16} />}>
                  Otwórz kartę
                </Button>
              </Group>
            </>
          ) : failure ? (
            failure
          ) : (
            <Text size="sm" c="dimmed">
              Tu pojawi się wynik – stan, zdjęcie i przydział osoby.
            </Text>
          )}
        </section>
        <div className="ui-scan-col">{recentList}</div>
      </div>
    </Stack>
  );
}
