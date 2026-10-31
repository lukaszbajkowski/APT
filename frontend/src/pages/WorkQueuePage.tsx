import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, errorText } from "../api";
import { Loading } from "../components/States";

interface Item {
  title: string;
  detail: string | null;
  url: string;
}
interface Group_ {
  key: string;
  label: string;
  count: number;
  url: string;
  items: Item[];
}
interface Queue {
  total: number;
  groups: Group_[];
}

export function WorkQueuePage() {
  const q = useQuery({ queryKey: ["work-queue"], queryFn: () => api<Queue>("/work-queue"), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const d = q.data!;
  return (
    <Stack>
      <div>
        <Title order={2}>Do zrobienia</Title>
        <Text c="dimmed" size="sm">
          Wszystko, co czeka na kadry, w jednym miejscu: {d.total} pozycji. Kliknij nagłówek grupy, aby zobaczyć pełną listę.
        </Text>
      </div>
      {d.groups.length === 0 && <Alert color="teal">Nic nie czeka na Twoją uwagę.</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {d.groups.map((g) => (
          <Card key={g.key} withBorder padding="lg">
            <Group justify="space-between" mb="xs">
              <Anchor component={Link} to={g.url} fw={600}>
                {g.label}
              </Anchor>
              <Badge variant="light" color="orange">
                {g.count}
              </Badge>
            </Group>
            <Stack gap={4}>
              {g.items.map((it, i) => (
                <Anchor key={i} component={Link} to={it.url} size="sm" c="inherit">
                  {it.title}
                  {it.detail && (
                    <Text span size="xs" c="dimmed">
                      {" "}
                      · {it.detail}
                    </Text>
                  )}
                </Anchor>
              ))}
              {g.count > g.items.length && (
                <Text size="xs" c="dimmed">
                  … i {g.count - g.items.length} więcej
                </Text>
              )}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
