import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import jsQR from "jsqr";
import { Alert, Badge, Box, Button, Card, Group, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertTriangle, IconCamera, IconCircleCheck, IconScan, IconUser } from "@tabler/icons-react";

import { api, errorText, formatDate, REVOKE_LABELS, type ScanOut } from "../api";
import { EmployeePhoto } from "../components/EmployeePhoto";

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

type Verdict = { color: string; title: string; ok: boolean };

function verdict(scan: ScanOut): Verdict {
  const e = scan.employee;
  if (e.status !== "active") return { color: "red", title: "nieaktywny – archiwum", ok: false };
  switch (scan.result) {
    case "valid":
      return { color: "green", title: "karta ważna", ok: true };
    case "replaced":
      return { color: "red", title: "karta nieważna", ok: false };
    case "revoked":
      return { color: "red", title: "karta unieważniona", ok: false };
    case "expired":
      return { color: "red", title: "karta po terminie", ok: false };
    case "unknown_card":
      return { color: "red", title: "nieznana karta", ok: false };
    case "legacy":
      return { color: "orange", title: "stara karta", ok: true };
    default:
      return { color: "blue", title: "aktywny pracownik", ok: true };
  }
}

function cardDetail(scan: ScanOut): string | null {
  const c = scan.card;
  const cur = scan.current_card;
  switch (scan.result) {
    case "replaced":
      return `Wydano nowszą kartę. To karta nr ${c?.version}. Aktualna jest karta nr ${cur?.version ?? "—"}${cur ? ` z ${formatDate(cur.issued_at.slice(0, 10))}` : ""}.`;
    case "revoked":
      return `Powód: ${REVOKE_LABELS[c?.revoke_reason ?? ""] ?? "—"}${c?.closed_at ? `, ${formatDate(c.closed_at.slice(0, 10))}` : ""}.`;
    case "expired":
      return `Karta była ważna do ${formatDate(c?.valid_until ?? null)}.`;
    case "unknown_card":
      return "Tej karty nie ma w rejestrze – mogła zostać podrobiona.";
    case "legacy":
      return "Karta wydrukowana przed wprowadzeniem rejestru kart. Porównaj zdjęcie z osobą i wydrukuj nową kartę.";
    case "manual":
      return cur
        ? `Sprawdzenie po numerze. Aktualna karta nr ${cur.version}${cur.valid_until ? `, ważna do ${formatDate(cur.valid_until)}` : ""}.`
        : "Sprawdzenie po numerze. Pracownik nie ma karty w rejestrze.";
    default:
      return c?.valid_until ? `Ważna do ${formatDate(c.valid_until)}.` : null;
  }
}

function ResultCard({ scan, onNext }: { scan: ScanOut; onNext: () => void }) {
  const employee = scan.employee;
  const v = verdict(scan);
  const detail = cardDetail(scan);
  const inactive = employee.status !== "active";
  return (
    <Card withBorder padding="lg" style={{ borderColor: `var(--mantine-color-${v.color}-6)`, borderWidth: 2 }}>
      <Stack>
        <Badge
          color={v.color}
          size="xl"
          fullWidth
          leftSection={v.ok ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}
        >
          {v.title}
        </Badge>
        {detail && (
          <Text size="sm" c={v.ok ? "dimmed" : v.color}>
            {detail}
          </Text>
        )}
        <Group wrap="nowrap" align="flex-start">
          <EmployeePhoto employee={employee} width={110} />
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Title order={3} style={{ wordBreak: "break-word" }}>
              {employee.last_name} {employee.first_name}
            </Title>
            <Text size="sm" c="dimmed">
              Nr {employee.number_display}
            </Text>
            <Text size="sm">{[employee.agency?.name, employee.department?.name].filter(Boolean).join(" · ") || "—"}</Text>
            {employee.position && <Text size="sm">{employee.position.name}</Text>}
            {inactive && employee.termination_date && (
              <Text size="sm" c="red">
                Zwolniony {formatDate(employee.termination_date)}
              </Text>
            )}
          </Stack>
        </Group>
        <Group grow>
          <Button variant="default" component={Link} to={`/pracownicy/${employee.id}`} leftSection={<IconUser size={16} />}>
            Profil
          </Button>
          <Button onClick={onNext} leftSection={<IconScan size={16} />}>
            Skanuj dalej
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<ScanOut | null>(null);
  const [manual, setManual] = useState("");

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const lookup = useCallback(
    async (code: string, manual = false) => {
      setLoading(true);
      setLookupError(null);
      setEmployee(null);
      try {
        const e = await api<ScanOut>(`/cards/scan/${encodeURIComponent(code.trim())}${manual ? "?manual=true" : ""}`);
        setEmployee(e);
        navigator.vibrate?.(verdict(e).ok ? 80 : [80, 60, 80, 60, 80]);
      } catch (err) {
        setLookupError(errorText(err));
        navigator.vibrate?.([200]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const start = useCallback(async () => {
    setError(null);
    setLookupError(null);
    setEmployee(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
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
        if (!busyRef.current && video.readyState >= 2) {
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
            if (value) {
              stop();
              busyRef.current = false;
              await lookup(value);
              return;
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
      setStarting(false);
    }
  }, [lookup, stop]);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    if (!manual.trim()) return;
    stop();
    lookup(manual, true);
  }

  return (
    <Stack maw={560}>
      <div>
        <Title order={2}>Skaner kart</Title>
        <Text c="dimmed" size="sm">
          Zeskanuj kod QR z karty identyfikacyjnej, aby sprawdzić, czy osoba jest aktywnym pracownikiem.
        </Text>
      </div>

      <Box
        pos="relative"
        style={{
          borderRadius: 12,
          overflow: "hidden",
          background: "#000",
          aspectRatio: "4 / 3",
          display: scanning ? "block" : "none",
        }}
      >
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <Box
          style={{
            position: "absolute",
            inset: "18% 24%",
            border: "3px solid rgba(255,255,255,0.85)",
            borderRadius: 16,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
          }}
        />
        <Text c="white" size="sm" ta="center" pos="absolute" bottom={10} left={0} right={0}>
          Skieruj aparat na kod QR na karcie
        </Text>
      </Box>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      {scanning ? (
        <Button variant="default" onClick={stop}>
          Zatrzymaj aparat
        </Button>
      ) : (
        !employee &&
        !loading && (
          <Button size="lg" leftSection={<IconCamera size={20} />} onClick={start} loading={starting}>
            Włącz aparat i skanuj
          </Button>
        )
      )}

      {loading && (
        <Group justify="center">
          <Loader />
        </Group>
      )}
      {lookupError && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Nie rozpoznano karty">
          <Stack gap="xs">
            <Text size="sm">{lookupError}</Text>
            <Group>
              <Button size="xs" onClick={start} leftSection={<IconScan size={14} />}>
                Skanuj ponownie
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      {employee && <ResultCard scan={employee} onNext={start} />}

      <form onSubmit={submitManual}>
        <Group align="flex-end" gap="xs">
          <TextInput
            label="Albo wpisz numer z karty"
            placeholder="np. 000123"
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button type="submit" variant="default">
            Sprawdź
          </Button>
        </Group>
      </form>
    </Stack>
  );
}
