import { Card, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useAuth } from "../auth";
import { ROLE_LABELS } from "../api";

const COMING = [
  { title: "Kartoteka pracowników", text: "Lista, wyszukiwanie, profil pracownika i zdjęcie. Etap 2." },
  { title: "Import z Excela / CSV", text: "Wczytanie istniejącej listy pracowników z podglądem błędów. Etap 3." },
  { title: "Karty identyfikacyjne", text: "Wydruk kart CR80 do PDF z kodem QR. Etap 4." },
  { title: "Dokumenty z szablonów", text: "Generowanie dokumentów .docx/PDF, np. deklaracji Medicover. Etap 5." },
];

export function HomePage() {
  const { me } = useAuth();
  return (
    <Stack>
      <div>
        <Title order={2}>Dzień dobry, {me?.user.full_name.split(" ")[0]}</Title>
        <Text c="dimmed">Zalogowano jako: {me ? ROLE_LABELS[me.user.role] : ""}</Text>
      </div>
      <Text>Moduły w przygotowaniu:</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {COMING.map((c) => (
          <Card key={c.title} withBorder>
            <Text fw={600}>{c.title}</Text>
            <Text size="sm" c="dimmed">
              {c.text}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
