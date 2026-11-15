import { useState } from "react";
import { Button, Drawer, Group, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconEye, IconFileText, IconMessage, IconPencil, IconPlus, IconPrinter, IconSignature } from "@tabler/icons-react";

import { ActionSheet, CompactEmpty, DangerAction, DangerZone, InfoRow, ListRow, Section, SheetHandle, StatusBadge, PageTitle, SwipeRow, useSheetResize, type RowAction } from "../components/Mobile";

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

<Gestures />

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

/** Gesty na telefonie (styl iOS) – działające przykłady i zasady. Te same klocki są w aplikacji:
 *  SwipeRow (lista Pracownicy), arkusz z trzema wysokościami (edycja szablonu), zamykanie arkuszy, cofanie od krawędzi. */
function Gestures() {
  const [tall, setTall] = useState(false);
  const [h, setH] = useState(60);
  const sheet = useSheetResize(() => setTall(false), setH);
  const done = (what: string) => notifications.show({ color: "green", message: `Przykład: ${what}` });
  const actions: RowAction[] = [
    { label: "Napisz", tone: "accent", icon: <IconMessage size={20} />, onClick: () => done("Napisz") },
    { label: "Drukuj", icon: <IconPrinter size={20} />, onClick: () => done("Drukuj") },
    { label: "Otwórz", icon: <IconEye size={20} />, menuOnly: true, onClick: () => done("Otwórz") },
  ];
  const rules: [string, string][] = [
    ["Szybki ruch (≥ 0,5 px/ms)", "Liczy się prędkość w chwili puszczenia (z ostatnich 100 ms, czas zdarzeń), nie przebyta droga."],
    ["Arkusz zwykły", "Idzie za palcem w dół; zamyka machnięcie albo ⅓ wysokości, inaczej wraca. Pociągnąć można też za treść przewiniętą do góry."],
    ["Arkusz z wysokościami", "35 / 60 / 92% ekranu (min. 220 px). Szybko w dół – zamyka, szybko w górę – 92%, powoli – najbliższa wysokość; powoli nigdy nie zamyka."],
    ["Wiersz listy", "W lewo – akcje (główna orzechowa, reszta szara), przytrzymanie 0,5 s – menu; akcje nieodwracalne tylko z potwierdzeniem, nie pod gestem."],
    ["Cofanie", "Od lewej krawędzi – tylko w aplikacji na ekranie głównym iOS (w Safari robi to przeglądarka)."],
    ["Bez gestu", "Każda akcja z gestu ma drugą drogę: przycisk, „⋯”, „Gotowe”, klawisz menu / strzałki."],
  ];
  return (
    <Stack gap="sm">
      <Title order={3}>Gesty na telefonie</Title>
      <Text size="sm" c="dimmed">
        Przesuń wiersz w lewo albo przytrzymaj go. Przycisk niżej otwiera arkusz z trzema wysokościami.
      </Text>
      <div className="ui-group">
        <SwipeRow actions={actions} menuTitle="Kowalska Anna" menuSubtitle={<span className="ui-mono">000123</span>}>
          <ListRow title="Kowalska Anna" description="Magazyn · Operator wózka" onClick={() => done("stuknięcie w wiersz")} />
        </SwipeRow>
        <SwipeRow actions={actions} menuTitle="Nowak Piotr" menuSubtitle={<span className="ui-mono">000124</span>}>
          <ListRow title="Nowak Piotr" description="Produkcja · Pakowacz" onClick={() => done("stuknięcie w wiersz")} />
        </SwipeRow>
      </div>
      <Button variant="default" size="md" onClick={() => setTall(true)} w="fit-content">
        Arkusz z trzema wysokościami
      </Button>
      <Stack gap="sm">
        {rules.map(([k, v]) => (
          <div key={k}>
            <Text fw={600}>{k}</Text>
            <Text size="sm" c="dimmed">
              {v}
            </Text>
          </div>
        ))}
      </Stack>
      <Drawer
        opened={tall}
        onClose={() => setTall(false)}
        position="bottom"
        size="auto"
        radius="lg"
        withCloseButton={false}
        classNames={{ content: "ui-sheet ui-tpe-fsheet ui-sheet-sized" }}
        styles={{ content: { "--sheet-h": `${h}dvh` } as React.CSSProperties }}
        aria-label="Arkusz z trzema wysokościami"
      >
        <SheetHandle onClose={() => setTall(false)} sheet={sheet}>
          <div className="ui-sheet-head">
            <div className="ui-sheet-title">Arkusz z trzema wysokościami</div>
            <div className="ui-row-desc">Teraz: {Math.round(h)}% ekranu</div>
          </div>
        </SheetHandle>
        <div className="ui-tpe-fsheet-body" ref={sheet.bodyRef}>
          <Stack gap="sm">
            {Array.from({ length: 12 }, (_, i) => (
              <Text key={i}>Wiersz treści {i + 1} – przewiń treść; u góry ruch w dół należy do arkusza.</Text>
            ))}
          </Stack>
        </div>
        <Button size="md" fullWidth mt="sm" className="ui-tpe-fsheet-done" onClick={() => setTall(false)}>
          Gotowe
        </Button>
      </Drawer>
    </Stack>
  );
}
