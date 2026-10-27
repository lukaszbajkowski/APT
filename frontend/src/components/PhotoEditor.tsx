import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Alert, Box, Button, FileButton, Group, Modal, Slider, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, errorText, type Employee } from "../api";

const OUT_W = 600;
const OUT_H = 800;

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setError("Nie udało się włączyć kamery. Sprawdź uprawnienia przeglądarki."));
    if (!navigator.mediaDevices) setError("Ta przeglądarka nie udostępnia kamery (wymagane HTTPS).");
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
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8, background: "#000" }} />
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          Wróć
        </Button>
        <Button leftSection={<IconCamera size={16} />} onClick={shoot} disabled={!!error}>
          Zrób zdjęcie
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
  const [src, setSrc] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) {
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
      setError("Wybierz plik graficzny (JPG, PNG, WebP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

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
        notifications.show({ color: "green", message: "Zapisano zdjęcie." });
        onClose();
        return;
      }
      qc.setQueryData(["employee", String(e.id)], e);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(e.id)] });
      notifications.show({ color: "green", message: "Zapisano zdjęcie." });
      onClose();
    },
    onError: (err) => setError(errorText(err)),
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Zdjęcie pracownika" size="lg">
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        {!src && !camera && (
          <Stack align="center" py="lg">
            <Text size="sm" c="dimmed" ta="center">
              Zdjęcie zostanie przycięte do proporcji karty (3:4). Najlepiej twarz na jasnym, jednolitym tle.
            </Text>
            <Group>
              <FileButton onChange={loadFile} accept="image/jpeg,image/png,image/webp">
                {(props) => (
                  <Button {...props} leftSection={<IconUpload size={16} />}>
                    Wybierz plik
                  </Button>
                )}
              </FileButton>
              <Button variant="light" leftSection={<IconCamera size={16} />} onClick={() => setCamera(true)}>
                Użyj kamery
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
        {src && (
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
                Powiększenie
              </Text>
              <Slider min={1} max={3} step={0.05} value={zoom} onChange={setZoom} label={null} />
            </div>
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setSrc(null)}>
                Wybierz inne
              </Button>
              <Group>
                <Button variant="default" onClick={onClose}>
                  Anuluj
                </Button>
                <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!area}>
                  Zapisz zdjęcie
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
