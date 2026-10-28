import { useEffect, useState } from "react";
import { Button, Card, Group, List, Modal, Text, Title } from "@mantine/core";
import { IconDeviceMobile, IconDownload } from "@tabler/icons-react";

import { clearInstallPrompt, getInstallPrompt, isIos, isMobile, isStandalone, onInstallChange } from "../lib/install";

/**
 * Instalacja aplikacji na telefonie lub komputerze. Chrome / Edge / Android: przycisk uruchamia systemowe okno
 * instalacji. iPhone i inne przeglądarki nie mają takiego okna – pokazujemy krótką instrukcję.
 */
export function InstallApp() {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);

  if (!isMobile() && !isStandalone()) return null; // na komputerze nie ma „ekranu głównego”
  if (isStandalone()) {
    return (
      <Card withBorder padding="md">
        <Group gap="xs">
          <IconDeviceMobile size={18} />
          <Text size="sm">Aplikacja jest zainstalowana na tym urządzeniu.</Text>
        </Group>
      </Card>
    );
  }

  const prompt = getInstallPrompt();
  async function install() {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => undefined);
      clearInstallPrompt();
    } else {
      setHelp(true);
    }
  }

  return (
    <Card withBorder padding="lg">
      <Title order={4} mb={4}>
        Aplikacja na telefonie
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Dodaj aplikację do ekranu głównego – otworzy się na pełnym ekranie, jak zwykła aplikacja, i będzie można włączyć
        powiadomienia.
      </Text>
      <Button leftSection={<IconDownload size={16} />} onClick={install}>
        Zainstaluj aplikację
      </Button>
      <Modal opened={help} onClose={() => setHelp(false)} title="Jak dodać aplikację do ekranu głównego" size="md">
        {isIos() ? (
          <List type="ordered" spacing="xs" size="sm">
            <List.Item>Otwórz tę stronę w przeglądarce Safari (nie w innej aplikacji).</List.Item>
            <List.Item>Dotknij przycisku „Udostępnij” (kwadrat ze strzałką) na dolnym pasku.</List.Item>
            <List.Item>Wybierz „Dodaj do ekranu początkowego”, a potem „Dodaj”.</List.Item>
            <List.Item>Otwórz aplikację z nowej ikony „APT” na ekranie głównym.</List.Item>
          </List>
        ) : (
          <List type="ordered" spacing="xs" size="sm">
            <List.Item>Otwórz menu przeglądarki (trzy kropki lub ikona menu).</List.Item>
            <List.Item>Wybierz „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”.</List.Item>
            <List.Item>Potwierdź. Aplikacja pojawi się na ekranie głównym lub w menu aplikacji.</List.Item>
          </List>
        )}
        <Text size="xs" c="dimmed" mt="sm">
          Jeśli nie widzisz takiej opcji, ta przeglądarka może nie obsługiwać instalacji – spróbuj w Chrome (Android) lub Safari (iPhone).
        </Text>
      </Modal>
    </Card>
  );
}
