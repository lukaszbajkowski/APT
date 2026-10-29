import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Alert, Box, Button, FileButton, Group, Image, Modal, Slider, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCamera, IconCheck, IconUpload, IconWand } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useT } from "../lib/i18n";
import { api, errorText, type Employee } from "../api";

const OUT_W = 600;
const OUT_H = 800;

/** Data URL -> Blob bez fetch (polityka CSP serwera blokuje fetch na adresach data:). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUT_W, OUT_H);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.92),
  );
}

function Camera({ onShot, onCancel }: { onShot: (dataUrl: string) => void; onCancel: () => void }) {
  const T = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [good, setGood] = useState(false);

  // prowadnica: co pół sekundy oceniamy podgląd (światło, odległość, ostrość) i podpowiadamy, co poprawić
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const timer = setInterval(async () => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      const W = 160;
      const H = Math.round((W * v.videoHeight) / v.videoWidth);
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      const lum = (x: number, y: number) => {
        const i = (y * W + x) * 4;
        return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      };
      const x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7), y0 = Math.round(H * 0.15), y1 = Math.round(H * 0.85);
      let sum = 0, left = 0, right = 0, n = 0, nl = 0, nr = 0, lap = 0, lapN = 0, lapSum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const l = lum(x, y);
          sum += l;
          n++;
          if (x < (x0 + x1) / 2) { left += l; nl++; } else { right += l; nr++; }
          if (x > x0 && y > y0 && x < x1 - 1 && y < y1 - 1) {
            const d = 4 * l - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1);
            lapSum += d;
            lap += d * d;
            lapN++;
          }
        }
      }
      const mean = sum / n;
      const sharp = lap / lapN - (lapSum / lapN) ** 2;
      let msg: string | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FD = (window as any).FaceDetector;
      if (FD) {
        try {
          const faces = await new FD({ fastMode: true, maxDetectedFaces: 2 }).detect(v);
          if (faces.length === 0) msg = T("Nie widzę twarzy – ustaw się na wprost aparatu.");
          else if (faces.length > 1) msg = T("Na zdjęciu ma być tylko jedna osoba.");
          else {
            const b = faces[0].boundingBox;
            const frac = b.height / v.videoHeight;
            const cx = (b.x + b.width / 2) / v.videoWidth;
            if (frac < 0.3) msg = T("Podejdź bliżej.");
            else if (frac > 0.52) msg = T("Odsuń się trochę.");
            else if (Math.abs(cx - 0.5) > 0.12) msg = T("Ustaw twarz na środku owalu.");
          }
        } catch {
          /* detektor niedostępny – zostają podpowiedzi o świetle i ostrości */
        }
      }
      if (!msg && mean < 70) msg = T("Za ciemno – stań twarzą do okna lub włącz światło.");
      else if (!msg && mean > 200) msg = T("Za jasno – odsuń się od mocnego światła.");
      else if (!msg && Math.abs(left / nl - right / nr) > 35) msg = T("Światło pada z boku – obróć się twarzą do źródła światła.");
      else if (!msg && sharp < 25) msg = T("Trzymaj telefon nieruchomo – obraz jest nieostry.");
      setHint(msg);
      setGood(msg === null);
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setError(T("Nie udało się włączyć kamery. Sprawdź uprawnienia przeglądarki.")));
    if (!navigator.mediaDevices) setError(T("Ta przeglądarka nie udostępnia kamery (wymagane HTTPS)."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    onShot(c.toDataURL("image/jpeg", 0.95));
  }

  return (
    <Stack>
      {error ? (
        <Alert color="red">{error}</Alert>
      ) : (
        <Box pos="relative">
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", borderRadius: 8, background: "#000" }} />
          <svg viewBox="0 0 100 75" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <path fillRule="evenodd" fill="rgba(0,0,0,0.35)" d="M0 0H100V75H0Z M33 38 a17 27.5 0 1 0 34 0 a17 27.5 0 1 0 -34 0Z" />
            <ellipse cx="50" cy="38" rx="17" ry="27.5" fill="none" stroke={good ? "#37b24d" : "#ffffff"} strokeWidth="0.8" strokeDasharray={good ? undefined : "2 1.5"} />
          </svg>
          <Box pos="absolute" bottom={8} left={8} right={8} ta="center" style={{ pointerEvents: "none" }}>
            <Text size="sm" fw={600} c="white" style={{ textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>
              {hint ?? T("Świetnie – możesz zrobić zdjęcie.")}
            </Text>
          </Box>
        </Box>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          {T("Wróć")}
        </Button>
        <Button leftSection={<IconCamera size={16} />} onClick={shoot} disabled={!!error}>
          {T("Zrób zdjęcie")}
        </Button>
      </Group>
    </Stack>
  );
}

export function PhotoEditor({
  employee,
  opened,
  onClose,
  endpoint,
  onSaved,
}: {
  employee: Employee;
  opened: boolean;
  onClose: () => void;
  endpoint?: string; // np. /me/photo dla pracownika edytującego własne zdjęcie
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const T = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  // automatyczna poprawa: podgląd „przed i po”, zatwierdzany ręcznie
  type Enh = { image: string; notes: { level: string; text: string }[]; changed: string[] };
  const [enh, setEnh] = useState<Enh | null>(null);
  const [original, setOriginal] = useState<string | null>(null); // zdjęcie sprzed zatwierdzonej poprawy

  useEffect(() => {
    if (!opened) {
      setEnh(null);
      setOriginal(null);
      setSrc(null);
      setCamera(false);
      setZoom(1);
      setError(null);
    }
  }, [opened]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  function loadFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(T("Wybierz plik graficzny (JPG, PNG, WebP)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  const enhance = useMutation({
    mutationFn: async () => {
      if (!src) throw new Error("Brak zdjęcia");
      const blob = dataUrlToBlob(src);
      const form = new FormData();
      form.append("file", blob, "zdjecie.jpg");
      return api<Enh>(`${endpoint ?? `/employees/${employee.id}/photo`}/enhance`, { method: "POST", form });
    },
    onSuccess: (r) => {
      setError(null);
      setEnh(r);
    },
    onError: (err) => setError(errorText(err)),
  });
  const acceptEnhanced = () => {
    if (!enh) return;
    setOriginal(src);
    setSrc(enh.image);
    setEnh(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };
  const revertOriginal = () => {
    setSrc(original);
    setOriginal(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!src || !area) throw new Error("Brak zdjęcia");
      const blob = await cropToBlob(src, area);
      const form = new FormData();
      form.append("file", blob, "zdjecie.jpg");
      return api<Employee>(endpoint ?? `/employees/${employee.id}/photo`, { method: "PUT", form });
    },
    onSuccess: (e) => {
      if (endpoint) {
        onSaved?.();
        notifications.show({ color: "green", message: T("Zapisano zdjęcie.") });
        onClose();
        return;
      }
      qc.setQueryData(["employee", String(e.id)], e);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(e.id)] });
      notifications.show({ color: "green", message: T("Zapisano zdjęcie.") });
      onClose();
    },
    onError: (err) => setError(errorText(err)),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={T("Zdjęcie pracownika")} size="lg">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        {!src && !camera && (
          <Stack align="center" py="lg">
            <Text size="sm" c="dimmed" ta="center">
              {T("Zdjęcie zostanie przycięte do proporcji karty (3:4). Najlepiej twarz na jasnym, jednolitym tle.")}
            </Text>
            <Group>
              <FileButton onChange={loadFile} accept="image/jpeg,image/png,image/webp">
                {(props) => (
                  <Button {...props} leftSection={<IconUpload size={16} />}>
                    {T("Wybierz plik")}
                  </Button>
                )}
              </FileButton>
              <Button variant="light" leftSection={<IconCamera size={16} />} onClick={() => setCamera(true)}>
                {T("Użyj kamery")}
              </Button>
            </Group>
          </Stack>
        )}
        {camera && !src && (
          <Camera
            onCancel={() => setCamera(false)}
            onShot={(d) => {
              setCamera(false);
              setSrc(d);
            }}
          />
        )}
        {src && enh && (
          <Stack>
            <Group grow align="flex-start" wrap="nowrap">
              <Stack gap={4} align="center">
                <Text size="sm" fw={600}>
                  {T("Przed")}
                </Text>
                <Image src={src} radius="sm" mah={320} fit="contain" />
              </Stack>
              <Stack gap={4} align="center">
                <Text size="sm" fw={600}>
                  {T("Po")}
                </Text>
                <Image src={enh.image} radius="sm" mah={320} fit="contain" />
              </Stack>
            </Group>
            <Stack gap={4}>
              {enh.notes.map((n, i) => (
                <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                  {n.level === "ok" ? <IconCheck size={16} color="var(--mantine-color-green-6)" /> : <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}
                  <Text size="xs">{T(n.text)}</Text>
                </Group>
              ))}
            </Stack>
            {enh.changed.length > 0 && (
              <Text size="xs" c="dimmed">
                {T("Zmieniono:")} {enh.changed.map((c) => T(c)).join(", ")}
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEnh(null)}>
                {T("Zostaw oryginał")}
              </Button>
              <Button leftSection={<IconCheck size={16} />} onClick={acceptEnhanced}>
                {T("Użyj poprawionego")}
              </Button>
            </Group>
          </Stack>
        )}
        {src && !enh && (
          <>
            <Box pos="relative" h={420} bg="dark.7" style={{ borderRadius: 8, overflow: "hidden" }}>
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={3 / 4}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </Box>
            <div>
              <Text size="sm" mb={4}>
                {T("Powiększenie")}
              </Text>
              <Slider min={1} max={3} step={0.05} value={zoom} onChange={setZoom} label={null} />
            </div>
            {original ? (
              <Group gap="xs">
                <IconCheck size={16} color="var(--mantine-color-green-6)" />
                <Text size="xs">{T("Użyto zdjęcia poprawionego automatycznie.")}</Text>
                <Button size="compact-xs" variant="subtle" onClick={revertOriginal}>
                  {T("Wróć do oryginału")}
                </Button>
              </Group>
            ) : (
              <Button variant="light" leftSection={<IconWand size={16} />} loading={enhance.isPending} onClick={() => enhance.mutate()}>
                {T("Popraw automatycznie")}
              </Button>
            )}
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setSrc(null)}>
                {T("Wybierz inne")}
              </Button>
              <Group>
                <Button variant="default" onClick={onClose}>
                  {T("Anuluj")}
                </Button>
                <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!area}>
                  {T("Zapisz zdjęcie")}
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
