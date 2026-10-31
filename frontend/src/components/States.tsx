import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Box, Button, Group, Progress, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconInbox, IconSearchOff, IconWifiOff } from "@tabler/icons-react";

import { ApiError, slowStore } from "../api";

/** Pusty ekran: dlaczego jest pusty + jeden następny krok. */
export function EmptyState({
  title,
  text,
  action,
  icon,
  search,
}: {
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
  search?: boolean;
}) {
  return (
    <Stack align="center" gap="xs" p="xl" ta="center">
      <ThemeIcon size={56} radius="xl" variant="light">
        {icon ?? (search ? <IconSearchOff size={26} /> : <IconInbox size={26} />)}
      </ThemeIcon>
      <Text fw={600}>{title}</Text>
      {text && (
        <Text size="sm" c="dimmed" maw={360}>
          {text}
        </Text>
      )}
      {action && (
        <Button mt={4} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Stack>
  );
}

/** Ładowanie: kształt tego, co nadchodzi (zamiast kółka). */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <Stack gap="sm" py="xs" aria-busy="true" aria-label="Ładowanie">
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} wrap="nowrap">
          <Skeleton height={36} circle />
          <Box style={{ flex: 1 }}>
            <Skeleton height={10} width={`${70 - (i % 3) * 15}%`} mb={8} />
            <Skeleton height={8} width="40%" />
          </Box>
        </Group>
      ))}
    </Stack>
  );
}

/** Błąd: co się stało, czyja to wina i co zrobić. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  let title = "Nie udało się wczytać danych";
  let text = "To nie wygląda na Twój błąd. Spróbuj ponownie; jeśli się powtarza, zgłoś to administratorowi.";
  if (e?.status === 0) {
    title = "Brak połączenia z serwerem";
    text = "Problem jest po stronie sieci. Nic nie zostało zmienione. Sprawdź internet i spróbuj ponownie.";
  } else if (e?.status === 403) {
    title = "Brak uprawnień";
    text = "Twoje konto nie ma dostępu do tych danych. Jeśli powinno, poproś administratora o nadanie uprawnień.";
  } else if (e && e.status >= 400 && e.status < 500) {
    title = "Nie udało się wczytać danych";
    text = e.message;
  }
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} title={title}>
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{text}</Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return on;
}

/** Offline: zostają dane z ostatniej wizyty, informujemy co działa; wolne łącze: pasek postępu zamiast pustki. */
export function NetworkBanner() {
  const online = useOnline();
  const slow = useSyncExternalStore(slowStore.subscribe, slowStore.get);
  if (!online) {
    return (
      <Alert color="yellow" variant="light" icon={<IconWifiOff size={18} />} py={6} mb="xs">
        Jesteś offline. Pokazujemy dane z ostatniej wizyty. Zmiany i wysyłka zadziałają po odzyskaniu połączenia.
      </Alert>
    );
  }
  if (slow) {
    return (
      <Box mb="xs">
        <Text size="xs" c="dimmed" mb={4}>
          Wolne połączenie – wczytywanie trwa dłużej niż zwykle. Nie odświeżaj strony.
        </Text>
        <Progress value={100} animated size="xs" />
      </Box>
    );
  }
  return null;
}
