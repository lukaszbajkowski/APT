import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Button, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

import { translateText as t } from "../lib/i18n";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Błąd ekranu:", error); // eslint-disable-line no-console
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Stack align="center" gap="xs" p="xl" ta="center" role="alert">
        <ThemeIcon size={56} radius="xl" variant="light" color="orange">
          <IconAlertTriangle size={26} />
        </ThemeIcon>
        <Text fw={600}>{t("Ten ekran nie wczytał się poprawnie")}</Text>
        <Text size="sm" c="dimmed" maw={360}>
          {t("Odśwież stronę. Jeśli błąd wróci, zgłoś go administratorowi – podaj, który ekran otwierałeś(-aś).")}
        </Text>
        <Button mt="xs" onClick={() => window.location.reload()}>
          {t("Odśwież")}
        </Button>
      </Stack>
    );
  }
}

/** Błąd w jednym ekranie nie zostawia pustej strony: reszta aplikacji (menu) działa, przejście na inny ekran resetuje stan. */
export function ScreenErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
