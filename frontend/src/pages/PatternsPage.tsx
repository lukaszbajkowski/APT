import { useState } from "react";
import { Button, Group, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { IconDownload, IconEye, IconFileText, IconPencil, IconPlus, IconPrinter, IconSignature } from "@tabler/icons-react";

import { ActionSheet, CompactEmpty, DangerAction, DangerZone, InfoRow, ListRow, Section, StatusBadge } from "../components/Mobile";

/** Wzornik: wszystkie wspólne klocki w jednym miejscu – do sprawdzenia na telefonie (jasny i ciemny motyw). */
export function PatternsPage() {
  const [sheet, setSheet] = useState(false);
  return (
    <Stack gap="lg" maw={640}>
      <div>
        <Title order={1} size="h2">
          Wzornik
        </Title>
        <Text c="dimmed" size="sm">
          Wspólne elementy ekranów. Przewiń w dół – nazwa ekranu pojawi się w pasku u góry.
        </Text>
      </div>

      <SimpleGrid cols={2} spacing="sm">
        <Button size="md" leftSection={<IconPrinter size={18} />}>
          Główna akcja
        </Button>
        <Button size="md" variant="default" leftSection={<IconPencil size={18} />}>
          Druga akcja
        </Button>
      </SimpleGrid>

      <Group gap="xs">
        <StatusBadge tone="ok">Aktywny</StatusBadge>
        <StatusBadge tone="warn">Po terminie</StatusBadge>
        <StatusBadge tone="error">Błąd</StatusBadge>
        <StatusBadge tone="wait">Czeka</StatusBadge>
        <StatusBadge tone="neutral">Archiwum</StatusBadge>
      </Group>

      <div>
        <Section title="Dane">
          <InfoRow label="Agencja">Złoty Indyk</InfoRow>
          <InfoRow label="Wydział">Suszarnia krwi</InfoRow>
          <InfoRow label="Zatrudniony od">27.10.2026</InfoRow>
          <InfoRow label="E-mail" stacked>
            bardzo.dlugi.adres.pracownika@przykladowa-domena.com
          </InfoRow>
        </Section>

        <Section title="Dokumenty" action={{ label: "Generuj", icon: <IconPlus size={16} />, onClick: () => setSheet(true) }}>
          <ListRow
            leading={
              <ThemeIcon variant="light" size={40} radius="md">
                <IconFileText size={20} />
              </ThemeIcon>
            }
            title="Deklaracja Medicover"
            description={
              <Group gap={6} component="span">
                <StatusBadge tone="ok">Podpisany</StatusBadge> 27.10.2026, 16:35
              </Group>
            }
            onClick={() => setSheet(true)}
          />
          <ListRow title="Umowa powierzenia" description="Czeka na podpis od 3 dni" onClick={() => setSheet(true)} />
        </Section>

        <Section title="Badania i pobyt">
          <CompactEmpty title="Badania lekarskie" text="Brak wpisów" action={{ label: "Dodaj", onClick: () => undefined }} />
          <CompactEmpty title="Dokumenty pobytowe" text="Nie dotyczy – obywatelstwo polskie" />
        </Section>
      </div>

      <TextInput label="Pole tekstowe (16 px – iPhone nie powiększa strony)" placeholder="Wpisz coś" size="md" />

      <DangerZone>
        <DangerAction label="Zresetuj dostęp" description="Np. po zgubieniu telefonu. Stare klucze przestaną działać." onClick={() => undefined} />
        <DangerAction label="Wyłącz konto" description="Pracownik nie zaloguje się, dane zostają w kartotece." onClick={() => undefined} />
      </DangerZone>

      <ActionSheet
        opened={sheet}
        onClose={() => setSheet(false)}
        title="Deklaracja Medicover"
        subtitle="Podpisany 27.10.2026, 16:35"
        actions={[
          { label: "Podgląd dokumentu", icon: <IconEye size={22} />, onClick: () => undefined },
          { label: "Pobierz PDF", icon: <IconDownload size={22} />, onClick: () => undefined },
          { label: "Szczegóły podpisu", icon: <IconSignature size={22} />, onClick: () => undefined },
        ]}
      />
    </Stack>
  );
}
