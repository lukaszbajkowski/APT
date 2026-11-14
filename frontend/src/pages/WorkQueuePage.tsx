import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";

import { api, errorText } from "../api";
import { CompactEmpty, ListRow, PageHead, Section, PageTitle, PageLoading } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

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
  const mobile = useIsPhone();
  if (q.isLoading) return <PageLoading title="Do zrobienia" />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const d = q.data!;
  if (mobile)
    return (
      <Stack gap={24}>
        <PageHead title="Do zrobienia" subtitle={d.total ? `Czeka na kadry: ${d.total}` : undefined} />
        {d.groups.length === 0 && (
          <CompactEmpty title="Wszystko zrobione" text="Nic nie czeka na Twoją uwagę." />
        )}
        {d.groups.map((g) => (
          <Section key={g.key} title={`${g.label} · ${g.count}`} action={{ label: "Wszystkie", to: g.url }}>
            {g.items.map((it, i) => (
              <ListRow key={i} title={it.title} description={it.detail ?? undefined} to={it.url} />
            ))}
            {g.count > g.items.length && <ListRow title={`Pokaż wszystkie (${g.count})`} muted to={g.url} />}
          </Section>
        ))}
      </Stack>
    );
  return (
    <Stack>
      <PageTitle
        title="Do zrobienia"
        description={
          <>
            Wszystko, co czeka na kadry, w jednym miejscu: {d.total} pozycji. Kliknij nagłówek grupy, aby zobaczyć pełną listę.
          </>
        }
      />
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
