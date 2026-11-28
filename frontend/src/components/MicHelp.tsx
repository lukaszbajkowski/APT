import { useEffect, type ReactNode } from "react";
import { Button, Drawer, Group, Popover, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAdjustmentsHorizontal, IconLock, IconMicrophone, IconMicrophoneOff } from "@tabler/icons-react";

import { useT } from "../lib/i18n";
import { useIsPhone } from "../lib/device";
import { SheetHandle } from "./Mobile";

export type MicHelpState = "ask" | "blocked" | null;

/** Przeglądarka, z której ktoś korzysta: nazwa, ikona przy adresie (rysunek „gdzie stuknąć”) i kroki. */
function browser(): { name: string; pin: ReactNode; steps: ReactNode[] } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios)
    return {
      name: "Safari",
      pin: <b style={{ fontSize: 11 }}>aA</b>,
      steps: [<>Stuknij <b>aA</b> obok adresu</>, <>„Ustawienia witryny”</>, <>Mikrofon → <b>Zezwalaj</b></>],
    };
  if (/Firefox\//.test(ua))
    return {
      name: "Firefox",
      pin: <IconMicrophoneOff size={14} />,
      steps: [<>Kliknij przekreślony mikrofon obok adresu</>, <>Przy „Używanie mikrofonu” kliknij <b>×</b></>, <>Kliknij „Zezwól na mikrofon”</>],
    };
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua))
    return {
      name: "Safari",
      pin: <IconLock size={14} />,
      steps: [<>Menu Safari → „Ustawienia dla tej witryny…”</>, <>Mikrofon → <b>Zezwalaj</b></>],
    };
  const android = /Android/.test(ua);
  return {
    name: /Edg\//.test(ua) ? "Edge" : "Chrome",
    pin: <IconAdjustmentsHorizontal size={14} />,
    steps: android
      ? [<>Stuknij ikonę obok adresu</>, <>„Uprawnienia” → <b>Mikrofon</b></>, <>Włącz <b>Zezwalaj</b></>]
      : [<>Kliknij ikonę obok adresu strony</>, <>Mikrofon → <b>Zezwalaj</b></>],
  };
}

async function ask(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

function Body({ state, setState, onClose }: { state: Exclude<MicHelpState, null>; setState: (s: MicHelpState) => void; onClose: () => void }) {
  const T = useT();
  const phone = useIsPhone();
  const b = browser();
  const granted = () => {
    setState(null);
    notifications.show({ color: "green", message: T("Mikrofon włączony – możesz dyktować i nagrywać.") });
  };
  if (state === "ask")
    return (
      <Stack gap="md">
        <Group gap="md" wrap="nowrap" align="flex-start">
          <span className="ui-mich-ico" aria-hidden>
            <IconMicrophone size={phone ? 22 : 18} />
          </span>
          <div>
            <Text fw={600} size={phone ? "lg" : "md"}>
              {T("Włącz mikrofon")}
            </Text>
            <Text size="sm" c="dimmed">
              {T("Do dyktowania tekstu i wiadomości głosowych. Nagrywa tylko wtedy, gdy trzymasz przycisk.")}
            </Text>
          </div>
        </Group>
        <div className="ui-mich-actions" data-phone={phone || undefined}>
          <Button variant="default" size={phone ? "md" : "sm"} onClick={onClose}>
            {T("Nie teraz")}
          </Button>
          <Button size={phone ? "md" : "sm"} onClick={async () => ((await ask()) ? granted() : setState("blocked"))} data-autofocus>
            {T("Zezwól na mikrofon")}
          </Button>
        </div>
      </Stack>
    );
  return (
    <Stack gap="md">
      <Text fw={600} size={phone ? "lg" : "md"}>
        {T("Odblokuj mikrofon w przeglądarce")} {b.name}
      </Text>
      <div className="ui-mich-grid">
        <div className="ui-mich-addr" aria-hidden>
          <span className="ui-mich-arrow">↓ {phone ? T("tutaj") : T("kliknij tutaj")}</span>
          <span className="ui-mich-pin">{b.pin}</span>
          <span className="ui-mich-url">{location.host}</span>
        </div>
        <ol className="ui-mich-steps">
          {b.steps.map((s, i) => (
            <li key={i}>
              <span className="ui-mich-n">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" c="dimmed">
          {T("Gdy włączysz, to okno zniknie samo.")}
        </Text>
        <Button variant="default" size={phone ? "md" : "sm"} onClick={onClose} data-autofocus>
          {T("Zamknij")}
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * Brak dostępu do mikrofonu: telefon – arkusz od dołu, komputer – okienko nad przyciskiem mikrofonu.
 * Stan „ask” – prośba o zgodę; „blocked” – przeglądarka już nie pyta: rysunek paska adresu i kroki.
 * Gdy zgoda zostanie włączona (także w ustawieniach przeglądarki), okno zamyka się samo.
 */
export function MicHelp({ state, setState, children }: { state: MicHelpState; setState: (s: MicHelpState) => void; children: ReactNode }) {
  const T = useT();
  const phone = useIsPhone();
  const close = () => setState(null);
  useEffect(() => {
    if (!state || phone) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setState(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state, phone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state) return;
    let p: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((st) => {
        p = st;
        st.onchange = () => {
          if (st.state === "granted") {
            setState(null);
            notifications.show({ color: "green", message: T("Mikrofon włączony – możesz dyktować i nagrywać.") });
          }
        };
      })
      .catch(() => undefined);
    return () => {
      if (p) p.onchange = null;
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (phone)
    return (
      <>
        {children}
        <Drawer
          opened={!!state}
          onClose={close}
          position="bottom"
          size="auto"
          radius="lg"
          withCloseButton={false}
          classNames={{ content: "ui-sheet ui-mich-sheet" }}
          aria-label={T("Dostęp do mikrofonu")}
          zIndex={700}
        >
          <SheetHandle onClose={close} />
          <div className="ui-mich-body">{state && <Body state={state} setState={setState} onClose={close} />}</div>
        </Drawer>
      </>
    );
  return (
    <Popover opened={!!state} onChange={(o) => !o && close()} position="top-start" withArrow arrowPosition="side" arrowOffset={18} shadow="lg" radius="md" width={state === "blocked" ? 400 : 360} trapFocus closeOnEscape zIndex={700}>
      <Popover.Target>
        <span style={{ display: "inline-flex", flex: "none" }}>{children}</span>
      </Popover.Target>
      <Popover.Dropdown p="md">{state && <Body state={state} setState={setState} onClose={close} />}</Popover.Dropdown>
    </Popover>
  );
}
