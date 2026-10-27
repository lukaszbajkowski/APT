import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Box, Center, Group, Loader, Modal, Portal, Stack, Text } from "@mantine/core";
import { IconEyeOff, IconShieldLock } from "@tabler/icons-react";

import { api, errorText, withAcct } from "../api";

interface Preview {
  pages: number;
  signed: boolean;
  title: string;
}

/**
 * Podgląd dokumentu w aplikacji: strony jako obrazy ze znakiem wodnym (kto i kiedy ogląda).
 * Utrudnia kopiowanie: brak menu kontekstowego, zaznaczania i przeciągania, strona ukrywa się
 * przy próbie zrzutu ekranu (PrtScn, Win+Shift+S, Cmd+Shift+3/4/5), drukowaniu i gdy okno traci fokus.
 */
export function DocumentViewer({ docId, opened, onClose }: { docId: string; opened: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["preview", docId],
    queryFn: () => api<Preview>(`/documents/${docId}/preview`),
    enabled: opened,
    gcTime: 0,
    staleTime: 0,
  });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const hide = () => setHidden(true);
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "PrintScreen" || k === "Meta" || k === "OS" || ((e.metaKey || e.ctrlKey) && ["p", "s", "P", "S"].includes(k)) || (e.metaKey && e.shiftKey)) {
        if (k !== "Meta" && k !== "OS") e.preventDefault();
        hide();
        if (k === "PrintScreen") void navigator.clipboard?.writeText?.("").catch(() => undefined);
      }
    };
    const onVis = () => document.hidden && hide();
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", hide);
    window.addEventListener("beforeprint", hide);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("copy", block, true);
    document.body.classList.add("doc-viewer-open");
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("beforeprint", hide);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("copy", block, true);
      document.body.classList.remove("doc-viewer-open");
    };
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      zIndex={500}
      title={
        <Group gap="xs">
          <Text fw={600}>{q.data?.title ?? "Podgląd dokumentu"}</Text>
          {q.data?.signed && (
            <Badge color="teal" variant="light">
              wersja podpisana
            </Badge>
          )}
        </Group>
      }
      styles={{ body: { background: "var(--mantine-color-gray-1)", minHeight: "calc(100vh - 60px)" } }}
    >
      <Box
        className="doc-viewer"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onClick={() => hidden && setHidden(false)}
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", position: "relative" }}
      >
        {q.isLoading && (
          <Center py="xl">
            <Loader />
          </Center>
        )}
        {q.error && <Alert color="red">{errorText(q.error)}</Alert>}
        {q.data && (
          <Stack gap="md" align="center" py="md" style={{ filter: hidden ? "blur(28px)" : undefined, transition: "filter .1s" }}>
            {Array.from({ length: q.data.pages }, (_, i) => (
              <Box
                key={i}
                role="img"
                aria-label={`Strona ${i + 1}`}
                w="100%"
                maw={900}
                style={{
                  aspectRatio: "210 / 297",
                  backgroundImage: `url(${withAcct(`/api/documents/${docId}/preview/${i}`)})`,
                  backgroundSize: "contain",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center top",
                  backgroundColor: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,.15)",
                  pointerEvents: "none",
                }}
              />
            ))}
          </Stack>
        )}
        {hidden && (
          <Portal>
          <Center style={{ position: "fixed", inset: 0, zIndex: 1000, cursor: "pointer" }} onClick={() => setHidden(false)}>
            <Stack align="center" gap={6} bg="white" p="lg" style={{ borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,.15)" }}>
              <IconEyeOff size={36} color="var(--mantine-color-gray-6)" />
              <Text fw={600}>Podgląd ukryty</Text>
              <Text size="sm" c="dimmed" ta="center" maw={320}>
                Dokument ukrywa się, gdy okno traci fokus albo przy próbie zrzutu ekranu lub druku. Kliknij, aby wrócić.
              </Text>
            </Stack>
          </Center>
          </Portal>
        )}
        <Group justify="center" gap={6} pb="md">
          <IconShieldLock size={14} color="var(--mantine-color-gray-6)" />
          <Text size="xs" c="dimmed">
            Tylko podgląd · na stronach widnieje Twoje imię i nazwisko oraz czas otwarcia · otwarcie zapisano w dzienniku
          </Text>
        </Group>
      </Box>
    </Modal>
  );
}
