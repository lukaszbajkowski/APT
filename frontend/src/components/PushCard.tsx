import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Group, Loader, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell, IconBellOff, IconInfoCircle } from "@tabler/icons-react";

import { api, errorText } from "../api";

function toKey(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/**
 * Powiadomienia push na tym urządzeniu. Treść powiadomień jest ogólna (np. „Masz dokument do podpisu”) –
 * nazwiska, tytuły dokumentów i treść wiadomości nie opuszczają aplikacji.
 */
export function PushCard() {
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
    registration()
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setOn(!!s))
      .catch(() => setOn(false));
  }, []);

  const enable = useMutation({
    mutationFn: async () => {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Przeglądarka nie pozwoliła na powiadomienia. Zmień to w ustawieniach strony.");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const { public_key } = await api<{ public_key: string }>("/push/key");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(public_key) });
        } catch {
          throw new Error("Nie udało się połączyć z usługą powiadomień przeglądarki. Spróbuj ponownie za chwilę.");
        }
      }
      await api("/push/subscribe", { method: "POST", body: sub.toJSON() });
      setOn(true);
    },
    onSuccess: () => notifications.show({ color: "green", message: "Powiadomienia włączone na tym urządzeniu." }),
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const disable = useMutation({
    mutationFn: async () => {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setOn(false);
    },
    onSuccess: () => notifications.show({ message: "Powiadomienia wyłączone na tym urządzeniu." }),
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const test = useMutation({
    mutationFn: () => api("/push/test", { method: "POST" }),
    onSuccess: () => notifications.show({ message: "Wysłano testowe powiadomienie." }),
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  const needInstall = isIos() && !standalone();
  return (
    <Card withBorder padding="lg">
      <Title order={4} mb={4}>
        Powiadomienia na telefonie
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Dostaniesz krótkie powiadomienie, gdy pojawi się coś dla Ciebie (np. dokument do podpisu albo odpowiedź kadr). Treść jest
        ogólna – bez nazwisk i szczegółów.
      </Text>
      {on === null && <Loader size="sm" />}
      {needInstall && (
        <Alert color="blue" icon={<IconInfoCircle size={18} />} mb="sm">
          Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu początkowego: w Safari wybierz „Udostępnij” → „Dodaj do ekranu
          początkowego”, otwórz aplikację z ikony i wróć tutaj.
        </Alert>
      )}
      {!needInstall && !supported() && (
        <Alert color="orange" icon={<IconInfoCircle size={18} />}>
          Ta przeglądarka nie obsługuje powiadomień push.
        </Alert>
      )}
      {permission === "denied" && supported() && !on && !needInstall && (
        <Alert color="orange" icon={<IconInfoCircle size={18} />} mb="sm">
          Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony. Odblokuj je, aby je włączyć.
        </Alert>
      )}
      {on !== null && supported() && !needInstall && (
        <Group>
          {on ? (
            <>
              <Button variant="light" leftSection={<IconBell size={16} />} loading={test.isPending} onClick={() => test.mutate()}>
                Wyślij testowe
              </Button>
              <Button variant="default" leftSection={<IconBellOff size={16} />} loading={disable.isPending} onClick={() => disable.mutate()}>
                Wyłącz na tym urządzeniu
              </Button>
            </>
          ) : (
            <Button leftSection={<IconBell size={16} />} loading={enable.isPending} onClick={() => enable.mutate()}>
              Włącz powiadomienia
            </Button>
          )}
        </Group>
      )}
    </Card>
  );
}
