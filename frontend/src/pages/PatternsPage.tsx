import { useState } from "react";
import { Button, Group, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { IconDownload, IconEye, IconFileText, IconPencil, IconPlus, IconPrinter, IconSignature } from "@tabler/icons-react";

import { ActionSheet, CompactEmpty, DangerAction, DangerZone, InfoRow, ListRow, Section, StatusBadge, PageTitle } from "../components/Mobile";

/** Wzornik: wszystkie wspólne klocki w jednym miejscu – do sprawdzenia na telefonie (jasny i ciemny motyw). */
export function PatternsPage() {
  const [sheet, setSheet] = useState(false);
  return (
    <Stack gap="lg" maw={640}>
      <PageTitle title="Wzornik" description="Wspólne elementy ekranów. Przewiń w dół – nazwa ekranu pojawi się w pasku u góry." />

      <Foundations />

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

/** Fundamenty (etap 1): skala tekstu, odstępów i role kolorów – żywa dokumentacja dla kolejnych ekranów. */
function Foundations() {
  const type: [string, string, number, number][] = [
    ["Tytuł strony", "26/32 · 700", 26, 700],
    ["Sekcja", "18/24 · 650", 18, 650],
    ["Wyróżnienie", "15/22 · 600", 15, 600],
    ["Treść", "15/22 · 400", 15, 400],
    ["Tabela", "14/20 · 400", 14, 400],
    ["Opis, etykieta", "13/18 · 400", 13, 400],
  ];
  const roles: [string, string, string][] = [
    ["Akcent", "główna akcja, zaznaczenie, link", "var(--mantine-primary-color-filled)"],
    ["Wymaga działania", "tylko gdy trzeba zareagować", "var(--mantine-color-orange-text)"],
    ["Błąd / usuwanie", "błędy i akcje nieodwracalne", "var(--mantine-color-red-text)"],
    ["Potwierdzenie", "komunikat po akcji („Zapisano”)", "var(--mantine-color-green-text)"],
  ];
  return (
    <Stack gap="lg">
      <section>
        <Title order={3}>Typografia</Title>
        <Text size="xs" c="dimmed" mb="xs">
          Golos Text, 6 stopni. Numery kart i PESEL – krój o stałej szerokości.
        </Text>
        {type.map(([name, spec, px, w]) => (
          <Group key={name} gap="md" wrap="nowrap" py={6} style={{ borderBottom: "1px solid var(--apt-line)" }}>
            <Text size="xs" c="dimmed" w={150} style={{ flex: "none" }}>
              {name} · {spec}
            </Text>
            <Text fz={px} fw={w} lh={1.3}>
              Zażółć gęślą jaźń · Їжак
            </Text>
          </Group>
        ))}
        <Group gap="md" wrap="nowrap" py={6}>
          <Text size="xs" c="dimmed" w={150} style={{ flex: "none" }}>
            Numery · mono 13
          </Text>
          <Text ff="monospace" fz={13}>
            000005 · 84030512345
          </Text>
        </Group>
      </section>
      <section>
        <Title order={3}>Odstępy</Title>
        <Text size="xs" c="dimmed" mb="xs">
          4 · 8 · 12 · 16 · 24 · 32 · 48 – blisko to, co do siebie należy; sekcje najdalej.
        </Text>
        <Group gap="md" align="flex-end">
          {[4, 8, 12, 16, 24, 32, 48].map((n) => (
            <Stack key={n} gap={4} align="center">
              <div style={{ width: n, height: n, background: "var(--mantine-primary-color-light)" }} />
              <Text size="xs" c="dimmed">
                {n}
              </Text>
            </Stack>
          ))}
        </Group>
      </section>
      <section>
        <Title order={3}>Role kolorów</Title>
        <Text size="xs" c="dimmed" mb="xs">
          Ta sama paleta, jedno znaczenie. Wszystko, co tylko informuje, jest szarym lub zwykłym tekstem.
        </Text>
        {roles.map(([name, use, c]) => (
          <Group key={name} gap="sm" py={4} wrap="nowrap">
            <div style={{ width: 16, height: 16, borderRadius: 4, background: c, flex: "none" }} />
            <Text size="sm" fw={600} w={140} style={{ flex: "none" }}>
              {name}
            </Text>
            <Text size="sm" c="dimmed">
              {use}
            </Text>
          </Group>
        ))}
      </section>
    </Stack>
  );
}
