import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Box, Button, Group, Progress, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconInbox, IconSearch, IconWifiOff } from "@tabler/icons-react";

import { ApiError, slowStore } from "../api";

/** Pusty ekran: dlaczego jest pusty + jeden następny krok. */
export function EmptyState({
  title,
  text,
  action,
  secondary,
  icon,
  search,
  compact,
}: {
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  icon?: ReactNode;
  search?: boolean;
  compact?: boolean;
}) {
  if (compact && !action && !secondary)
    return (
      <Stack gap={2} py="xs" role="status">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        {text && (
          <Text size="sm" c="dimmed">
            {text}
          </Text>
        )}
      </Stack>
    );
  return (
    <Stack align="center" gap="xs" p={compact ? "md" : "xl"} ta="center" role="status">
      <ThemeIcon size={compact ? 40 : 56} radius="xl" variant="light">
        {icon ?? (search ? <IconSearch size={26} /> : <IconInbox size={26} />)}
      </ThemeIcon>
      <Text fw={600}>{title}</Text>
      {text && (
        <Text size="sm" c="dimmed" maw={360}>
          {text}
        </Text>
      )}
      {(action || secondary) && (
        <Group gap="xs" justify="center" mt={4}>
          {action && <Button onClick={action.onClick}>{action.label}</Button>}
          {secondary && (
            <Button variant="default" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </Group>
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
      <Alert color="yellow" variant="light" icon={<IconWifiOff size={18} />} py={6} mb="xs" role="status" aria-live="polite">
        Jesteś offline. Pokazujemy dane z ostatniej wizyty. Zmiany i wysyłka zadziałają po odzyskaniu połączenia.
      </Alert>
    );
  }
  if (slow) {
    return (
      <Box mb="xs" role="status" aria-live="polite">
        <Text size="xs" c="dimmed" mb={4}>
          Wolne połączenie – wczytywanie trwa dłużej niż zwykle. Nie odświeżaj strony.
        </Text>
        <Progress value={100} animated size="xs" />
      </Box>
    );
  }
  return null;
}

/** Szkielet listy w ramce (wzorzec karty): wiersze z tytułem i opisem, po prawej miejsce na stan/przyciski. */
export function RowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="ui-dlist" aria-busy="true" aria-label="Ładowanie">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-drow">
          <Box style={{ flex: 1 }}>
            <Skeleton height={12} width={`${55 - (i % 2) * 15}%`} mb={8} />
            <Skeleton height={9} width="35%" />
          </Box>
          <Skeleton height={28} width={90} radius="sm" />
        </div>
      ))}
    </div>
  );
}

/** Szkielet całej karty pracownika na komputerze – ten sam układ co gotowa strona, bez skoku po wczytaniu. */
export function DetailSkeleton() {
  const section = (rows: number, key: string) => (
    <section className="ui-dsec" key={key}>
      <Skeleton height={16} width={160} />
      <RowsSkeleton rows={rows} />
    </section>
  );
  const side = (rows: number, key: string) => (
    <section className="ui-dsec" key={key}>
      <Skeleton height={16} width={140} />
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} gap="md" wrap="nowrap">
          <Skeleton height={10} width={90} />
          <Skeleton height={10} width={`${50 - (i % 2) * 15}%`} />
        </Group>
      ))}
    </section>
  );
  return (
    <div className="ui-detail" aria-busy="true" aria-label="Ładowanie karty pracownika">
      <Skeleton height={10} width={180} />
      <header className="ui-detail-head">
        <Skeleton height={72} width={72} radius="md" />
        <Box className="ui-detail-headtext">
          <Skeleton height={24} width="40%" mb={10} />
          <Skeleton height={10} width="60%" mb={8} />
          <Skeleton height={10} width="30%" />
        </Box>
        <Group gap={8}>
          <Skeleton height={36} width={140} radius="sm" />
          <Skeleton height={36} width={80} radius="sm" />
          <Skeleton height={36} width={110} radius="sm" />
        </Group>
      </header>
      <div className="ui-detail-cols">
        <div className="ui-detail-main">{[section(2, "a"), section(2, "b"), section(1, "c"), section(1, "d")]}</div>
        <aside className="ui-detail-side">{[side(4, "e"), side(4, "f"), side(2, "g")]}</aside>
      </div>
    </div>
  );
}
