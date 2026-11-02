import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Group, Skeleton, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell, IconBellOff, IconInfoCircle } from "@tabler/icons-react";

import { useT } from "../lib/i18n";
import { ListRow, Section, StatusBadge } from "./Mobile";
import { api } from "../api";
import { isIos, isStandalone } from "../lib/install";

function toKey(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/**
 * Powiadomienia push na tym urządzeniu. Treść powiadomień jest ogólna (np. „Masz dokument do podpisu”) –
 * nazwiska, tytuły dokumentów i treść wiadomości nie opuszczają aplikacji.
 */
export function PushCard({ rows = false }: { rows?: boolean } = {}) {
  const t = useT();
  const [on, setOn] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(supported() ? Notification.permission : "denied");

  async function registration() {
    return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  }

  useEffect(() => {
    if (!supported()) {
      setOn(false);
      return;
    }
    // „włączone” znaczy: to urządzenie ma subskrypcję I jest zapisane dla TEGO konta (przeglądarka może mieć
    // subskrypcję zapisaną wcześniej dla innego konta)
    registration()
      .then((r) => r.pushManager.getSubscription())
      .then((s) =>
        s ? api<{ this_device: boolean }>(`/push/status?endpoint=${encodeURIComponent(s.endpoint)}`).then((st) => st.this_device) : false,
      )
      .then(setOn)
      .catch(() => setOn(false));
  }, []);

  const enable = useMutation({
    mutationFn: async () => {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error(t("Przeglądarka nie pozwoliła na powiadomienia. Zmień to w ustawieniach strony."));
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const { public_key } = await api<{ public_key: string }>("/push/key");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(public_key) });
        } catch {
          throw new Error(t("Nie udało się połączyć z usługą powiadomień przeglądarki. Spróbuj ponownie za chwilę."));
        }
      }
      await api("/push/subscribe", { method: "POST", body: sub.toJSON() });
      setOn(true);
    },
    onSuccess: () => notifications.show({ color: "green", message: t("Powiadomienia włączone na tym urządzeniu.") }),
  });
  const disable = useMutation({
    mutationFn: async () => {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const st = await api<{ other_accounts: number }>(`/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`).catch(() => ({ other_accounts: 1 }));
        await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
        // subskrypcję w przeglądarce kasujemy tylko wtedy, gdy nie korzysta z niej inne konto
        if (st.other_accounts === 0) await sub.unsubscribe();
      }
      setOn(false);
    },
    onSuccess: () => notifications.show({ message: t("Powiadomienia wyłączone na tym urządzeniu.") }),
  });
  const test = useMutation({
    mutationFn: async () => {
      const sub = await (await registration()).pushManager.getSubscription();
      return api("/push/test", { method: "POST", body: { endpoint: sub?.endpoint ?? null } });
    },
    onSuccess: () => notifications.show({ message: t("Wysłano testowe powiadomienie.") }),
  });

  const needInstall = isIos() && !isStandalone();

  // telefon: sekcja z wierszami zamiast karty z akapitem
  if (rows) {
    const blocked = permission === "denied" && supported() && !on;
    return (
      <Section title={t("Powiadomienia")}>
        {on === null ? (
          <Skeleton height={60} aria-busy="true" aria-label="Ładowanie" />
        ) : needInstall ? (
          <ListRow title={t("Najpierw zainstaluj aplikację")} description={t("Na iPhonie powiadomienia działają tylko w aplikacji dodanej do ekranu początkowego.")} trailing={<StatusBadge tone="neutral">{t("Wyłączone")}</StatusBadge>} />
        ) : !supported() ? (
          <ListRow title={t("Powiadomienia niedostępne")} description={t("Ta przeglądarka nie obsługuje powiadomień push.")} />
        ) : blocked ? (
          <ListRow title={t("Powiadomienia zablokowane")} description={t("Odblokuj je w ustawieniach przeglądarki dla tej strony.")} trailing={<StatusBadge tone="warn">{t("Zablokowane")}</StatusBadge>} />
        ) : on ? (
          <>
            <ListRow leading={<span className="ui-row-icon" aria-hidden><IconBell size={22} /></span>} title={t("Powiadomienia włączone")} description={t("Bez nazwisk i szczegółów – tylko krótka informacja.")} trailing={<StatusBadge tone="ok">{t("Włączone")}</StatusBadge>} />
            <ListRow title={test.isPending ? t("Wysyłanie…") : t("Wyślij testowe powiadomienie")} onClick={() => test.mutate()} />
            <ListRow leading={<span className="ui-row-icon" aria-hidden><IconBellOff size={22} /></span>} title={disable.isPending ? t("Wyłączanie…") : t("Wyłącz na tym urządzeniu")} onClick={() => disable.mutate()} />
          </>
        ) : (
          <ListRow leading={<span className="ui-row-icon" aria-hidden><IconBell size={22} /></span>} title={enable.isPending ? t("Włączanie…") : t("Włącz powiadomienia")} description={t("Dowiesz się od razu o dokumencie do podpisu i odpowiedzi kadr.")} onClick={() => enable.mutate()} />
        )}
      </Section>
    );
  }

  return (
    <Card withBorder padding="lg">
      <Title order={4} mb={4}>
        {t("Powiadomienia na tym urządzeniu")}
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        {t("Dostaniesz krótkie powiadomienie na tym urządzeniu (telefonie, tablecie lub komputerze), gdy pojawi się coś dla Ciebie (np. dokument do podpisu albo odpowiedź kadr). Treść jest ogólna – bez nazwisk i szczegółów.")}
      </Text>
      {on === null && <Skeleton height={44} radius="md" aria-busy="true" aria-label="Ładowanie" />}
      {needInstall && (
        <Alert color="blue" icon={<IconInfoCircle size={18} />} mb="sm">
          {t("Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu początkowego: w Safari wybierz „Udostępnij” → „Dodaj do ekranu początkowego”, otwórz aplikację z ikony i wróć tutaj.")}
        </Alert>
      )}
      {!needInstall && !supported() && (
        <Alert color="orange" icon={<IconInfoCircle size={18} />}>
          {t("Ta przeglądarka nie obsługuje powiadomień push.")}
        </Alert>
      )}
      {permission === "denied" && supported() && !on && !needInstall && (
        <Alert color="orange" icon={<IconInfoCircle size={18} />} mb="sm">
          {t("Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony. Odblokuj je, aby je włączyć.")}
        </Alert>
      )}
      {on !== null && supported() && !needInstall && (
        <Group>
          {on ? (
            <>
              <Button variant="light" leftSection={<IconBell size={16} />} loading={test.isPending} onClick={() => test.mutate()}>
                {t("Wyślij testowe")}
              </Button>
              <Button variant="default" leftSection={<IconBellOff size={16} />} loading={disable.isPending} onClick={() => disable.mutate()}>
                {t("Wyłącz na tym urządzeniu")}
              </Button>
            </>
          ) : (
            <Button leftSection={<IconBell size={16} />} loading={enable.isPending} onClick={() => enable.mutate()}>
              {t("Włącz powiadomienia")}
            </Button>
          )}
        </Group>
      )}
    </Card>
  );
}
