import { Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";

/** Kroki odblokowania mikrofonu dla przeglądarki, której ktoś używa (strona nie może sama otworzyć ustawień). */
function steps(): { name: string; items: string[] } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  if (ios)
    return {
      name: "Safari na iPhonie / iPadzie",
      items: ["Stuknij „aA” (albo ikonę ustawień) po lewej stronie adresu.", "Wybierz „Ustawienia witryny”.", "Przy „Mikrofon” wybierz „Zezwalaj”.", "Wróć do aplikacji i spróbuj jeszcze raz."],
    };
  if (/Firefox\//.test(ua))
    return {
      name: "Firefox",
      items: ["Kliknij przekreśloną ikonę mikrofonu albo kłódkę po lewej stronie adresu.", "Przy „Używanie mikrofonu” kliknij „×”, aby usunąć blokadę.", "Kliknij „Zezwól na mikrofon” poniżej."],
    };
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua))
    return {
      name: "Safari na Macu",
      items: ["W menu Safari wybierz „Ustawienia dla tej witryny…”.", "Przy „Mikrofon” wybierz „Zezwalaj”.", "Kliknij „Zezwól na mikrofon” poniżej."],
    };
  const edge = /Edg\//.test(ua);
  if (android)
    return {
      name: "Chrome na Androidzie",
      items: ["Stuknij ikonę ustawień (suwaki) lub kłódkę po lewej stronie adresu.", "Wybierz „Uprawnienia” → „Mikrofon” i włącz.", "Gdy telefon zapyta, zezwól aplikacji Chrome na mikrofon."],
    };
  return {
    name: edge ? "Microsoft Edge" : "Chrome",
    items: [
      "Kliknij ikonę ustawień (suwaki) albo kłódkę po lewej stronie adresu strony.",
      "Przy „Mikrofon” przełącz na „Zezwalaj”.",
      "Jeśli mikrofonu nie ma na liście: „Ustawienia witryny” → „Mikrofon” → „Zezwalaj”.",
      "Kliknij „Zezwól na mikrofon” poniżej.",
    ],
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

let seq = 0;
let ID = "apt-mic-help-0";

function Body({ T, open, blocked }: { T: (s: string) => string; open: boolean; blocked: boolean }) {
  const st = steps();
  return (
    <Stack gap={8}>
      <Text size="sm">
        {blocked
          ? T("Przeglądarka nie zapytała ponownie – odblokuj mikrofon w jej ustawieniach:")
          : T("Mikrofon służy do dyktowania tekstu i nagrywania wiadomości głosowych. Przeglądarka go teraz blokuje.")}
      </Text>
      {(open || blocked) && (
        <div>
          <Text size="xs" c="dimmed">
            {st.name}
          </Text>
          <ol className="ui-mic-steps">
            {st.items.map((x) => (
              <li key={x}>{T(x)}</li>
            ))}
          </ol>
        </div>
      )}
      <Group gap={8}>
        <Button
          size="xs"
          onClick={async () => {
            if (await ask()) {
              notifications.hide(ID);
              notifications.show({ color: "green", message: T("Mikrofon włączony – możesz dyktować i nagrywać.") });
            } else render(T, true, true);
          }}
        >
          {T("Zezwól na mikrofon")}
        </Button>
        {!open && !blocked && (
          <UnstyledButton className="ui-link" onClick={() => render(T, true, false)}>
            {T("Pokaż jak")}
          </UnstyledButton>
        )}
      </Group>
    </Stack>
  );
}

// powiadomienie ma stałą wysokość z chwili pokazania – rozwinięcie kroków pokazuje je od nowa (bez ucięcia)
function render(T: (s: string) => string, open: boolean, blocked: boolean) {
  notifications.hide(ID);
  ID = `apt-mic-help-${++seq}`; // nowe powiadomienie (nowa wysokość), nie zmiana starego
  const id = ID;
  window.setTimeout(
    () =>
      notifications.show({
        id,
        color: "yellow",
        title: T("Brak dostępu do mikrofonu"),
        message: <Body T={T} open={open} blocked={blocked} />,
        autoClose: false,
      }),
    open ? 250 : 0,
  );
}

/**
 * Brak dostępu do mikrofonu: powiadomienie z „Zezwól na mikrofon” (ponowne pytanie przeglądarki) i krokami dla tej
 * przeglądarki („Pokaż jak”). Gdy zgoda zostanie włączona w ustawieniach, powiadomienie znika samo.
 */
export function showMicHelp(T: (s: string) => string) {
  render(T, false, false);
  navigator.permissions
    ?.query({ name: "microphone" as PermissionName })
    .then((p) => {
      p.onchange = () => {
        if (p.state === "granted") {
          notifications.hide(ID);
          notifications.show({ color: "green", message: T("Mikrofon włączony – możesz dyktować i nagrywać.") });
          p.onchange = null;
        }
      };
    })
    .catch(() => undefined);
}
