import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { Loading } from "../components/States";

interface QualityCheck {
  key: string;
  label: string;
  count: number;
}
interface QualityRow {
  id: number;
  number: string;
  last_name: string;
  first_name: string;
  agency: string | null;
  department: string | null;
  missing: string[];
}
interface Quality {
  active_total: number;
  checks: QualityCheck[];
  rows: QualityRow[];
}

const SHORT: Record<string, string> = {
  pesel: "PESEL",
  sex: "płeć",
  photo: "zdjęcie",
  department: "wydział",
  position: "stanowisko",
  trainings: "wymagane szkolenia",
};

export function QualityPage() {
  const q = useQuery({ queryKey: ["quality"], queryFn: () => api<Quality>("/quality") });
  const [filter, setFilter] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const data = q.data!;
  const rows = filter ? data.rows.filter((r) => r.missing.includes(filter)) : data.rows;

  return (
    <Stack>
      <div>
        <Title order={2}>Braki w danych</Title>
        <Text c="dimmed" size="sm">
          Aktywni pracownicy z niekompletną kartoteką ({data.rows.length} z {data.active_total}). Przypomnienie e-mail
          wychodzi w poniedziałki do administratorów, HR i kierowników.
        </Text>
      </div>

      {data.rows.length === 0 ? (
        <Alert color="green" icon={<IconCircleCheck />}>
          Wszystkie dane są kompletne.
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: data.checks.length }} spacing="sm">
            {data.checks.map((c) => {
              const active = filter === c.key;
              return (
                <UnstyledButton key={c.key} onClick={() => setFilter(active ? null : c.key)} disabled={!c.count}>
                  <Card
                    withBorder
                    padding="sm"
                    style={{
                      borderColor: active ? "var(--mantine-primary-color-filled)" : undefined,
                      opacity: c.count ? 1 : 0.55,
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      {c.label}
                    </Text>
                    <Text fw={700} size="xl" c={c.count ? "orange" : "teal"}>
                      {c.count}
                    </Text>
                  </Card>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
          {filter && (
            <Text size="sm">
              Filtr: {SHORT[filter]} ·{" "}
              <Anchor component="button" size="sm" onClick={() => setFilter(null)}>
                pokaż wszystkie
              </Anchor>
            </Text>
          )}
          <Card withBorder padding={0}>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pracownik</Table.Th>
                  <Table.Th>Brakuje</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/pracownicy/${r.id}`}>
                        {r.last_name} {r.first_name}
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        nr {r.number}
                        {r.agency || r.department ? ` · ${[r.agency, r.department].filter(Boolean).join(" / ")}` : ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {r.missing.map((k) => (
                          <Badge key={k} variant="light" color="orange" size="sm">
                            {SHORT[k] ?? k}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  );
}
