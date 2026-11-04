import type { ReactNode } from "react";
import { Center, Paper, Stack } from "@mantine/core";

import { LanguagePicker } from "../lib/i18n";

/**
 * Wspólny układ ekranów logowania (logowanie, „Nie pamiętasz hasła?”, ustawienie hasła, zaproszenie):
 * karta na środku, pod nią zawsze w tym samym miejscu wybór języka, a niżej opcjonalne dodatki.
 */
export function AuthShell({ children, maw = 400, footer }: { children: ReactNode; maw?: number; footer?: ReactNode }) {
  return (
    <Center mih="100vh" p="md" style={{ background: "var(--apt-ground)" }}>
      <Stack align="center" w="100%" maw={maw} gap="md">
        <Paper withBorder shadow="sm" p="xl" w="100%">
          {children}
        </Paper>
        <LanguagePicker />
        {footer}
      </Stack>
    </Center>
  );
}
