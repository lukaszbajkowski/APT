import type { ReactNode } from "react";
import { Anchor, Center, Paper, Stack } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";

import { useDocTitle } from "../lib/docTitle";
import { LanguagePicker, useT } from "../lib/i18n";

/**
 * Wspólny układ ekranów logowania (logowanie, „Nie pamiętasz hasła?”, ustawienie hasła, zaproszenie):
 * karta na środku, pod nią zawsze w tym samym miejscu wybór języka i link „Pomoc i prywatność”, a niżej opcjonalne dodatki.
 */
export function AuthShell({ children, maw = 400, footer, title }: { children: ReactNode; maw?: number; footer?: ReactNode; title?: string }) {
  const t = useT();
  const { pathname } = useLocation();
  useDocTitle(title ? t(title) : undefined);
  return (
    <Center mih="100vh" p="md" style={{ background: "var(--apt-ground)" }}>
      <Stack align="center" w="100%" maw={maw} gap="md">
        <Paper withBorder shadow="sm" p="xl" w="100%">
          {children}
        </Paper>
        <LanguagePicker />
        {pathname !== "/pomoc" && (
          <Anchor component={Link} to="/pomoc" size="sm" c="dimmed" ta="center">
            {t("Pomoc i prywatność")}
          </Anchor>
        )}
        {footer}
      </Stack>
    </Center>
  );
}
