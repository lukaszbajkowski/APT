import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconBook, IconCheck, IconFileSpreadsheet, IconFingerprint, IconUserPlus } from "@tabler/icons-react";

import { api, type DictionaryItem } from "../api";

/** Pusta baza: kolejność prac (Słowniki → pracownicy → konta) z odhaczaniem kroków. */
export function GettingStarted({ employees }: { employees: number }) {
  const agencies = useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments") });
  const dictOk = (agencies.data?.length ?? 0) > 0 && (departments.data?.length ?? 0) > 0;
  const steps = [
    {
      done: dictOk,
      icon: <IconBook size={18} />,
      title: "1. Uzupełnij słowniki",
      text: "Dodaj agencje pracy (APT – to nazwa agencji, która zatrudnia pracownika), wydziały i stanowiska. Bez nich nie przypiszesz pracownika do miejsca pracy.",
      to: "/slowniki",
      label: "Otwórz słowniki",
    },
    {
      done: employees > 0,
      icon: <IconFileSpreadsheet size={18} />,
      title: "2. Dodaj pracowników",
      text: "Najszybciej zaimportujesz całą listę z arkusza (Excel, Numbers, CSV). Pojedyncze osoby dodasz ręcznie.",
      to: "/pracownicy/import",
      label: "Importuj z arkusza",
      alt: { to: "/pracownicy/nowy", label: "Dodaj ręcznie" },
    },
    {
      done: false,
      icon: <IconFingerprint size={18} />,
      title: "3. Załóż konta pracownikom",
      text: "Pracownik dostaje zaproszenie, ustawia hasło i czyta komunikaty oraz pisze do kadr z telefonu. Zaproszenie wyślesz z karty pracownika lub z listy kont.",
      to: "/konta-pracownikow",
      label: "Konta pracowników",
    },
  ];
  return (
    <Card withBorder padding="lg">
      <Title order={4}>Od czego zacząć</Title>
      <Text size="sm" c="dimmed" mb="md">
        Kartoteka jest jeszcze pusta. Zrób te trzy kroki po kolei – zajmie to kilkanaście minut.
      </Text>
      <Stack gap="md">
        {steps.map((s) => (
          <Group key={s.title} wrap="nowrap" align="flex-start">
            <ThemeIcon variant={s.done ? "filled" : "light"} color={s.done ? "teal" : "navy"} size={36} radius="xl">
              {s.done ? <IconCheck size={18} /> : s.icon}
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text fw={600}>{s.title}</Text>
              <Text size="sm" c="dimmed" mb={6}>
                {s.text}
              </Text>
              <Group gap="xs">
                <Button component={Link} to={s.to} size="xs" variant={s.done ? "default" : "filled"}>
                  {s.done ? "Zobacz" : s.label}
                </Button>
                {s.alt && !s.done && (
                  <Button component={Link} to={s.alt.to} size="xs" variant="default" leftSection={<IconUserPlus size={14} />}>
                    {s.alt.label}
                  </Button>
                )}
              </Group>
            </div>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
